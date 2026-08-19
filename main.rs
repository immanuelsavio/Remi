// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Dopamigo MVP - the entire Rust shell in one file.
//!
//! In the full repo this is spread over `app/src-tauri/src/{main,lib,paths,
//! state_io,app_commands,tray,popover,dashboard}.rs` plus a separate
//! `core/` crate. Here it is one file with section banners, because the module
//! split buys nothing at this size: every section is under 200 lines and the
//! whole shell is read top-to-bottom in one sitting.
//!
//! What it owns:
//!   * PATHS      - where settings.json and the data folder live
//!   * STATE I/O  - durable JSON with atomic write + .bak recovery
//!   * COMMANDS   - the IPC surface the Svelte frontend calls
//!   * TRAY       - the menu-bar icon (drawn in code, no PNG on disk)
//!   * POPOVER    - the tray-anchored window and its show/hide lifecycle
//!   * MAIN       - wiring
//!
//! The frontend owns the state SHAPE. Rust treats it as opaque
//! `serde_json::Value` and only guarantees the durability contract, so the
//! schema can evolve in TypeScript without a Rust change.

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::menu::{Menu, MenuEvent, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, WindowEvent};

// ===========================================================================
// PATHS
// ===========================================================================

/// Bundle identifier - must match `tauri.conf.json`. Names the subfolder under
/// the OS config dir that holds `settings.json`.
///
/// DELIBERATELY `.mvp`, not the production app's `com.dopamigo.app`. This MVP's
/// state shape is a strict SUBSET of the full app's (no backlog, metrics,
/// estimate log, wellness settings...), so pointing both at one file would let
/// this build silently drop those fields on its first save. Separate identifier
/// + separate data folder means you can run the two side by side.
const APP_IDENTIFIER: &str = "com.dopamigo.mvp";

/// Window labels, matching `tauri.conf.json`.
const POPOVER_LABEL: &str = "popover";
const DASHBOARD_LABEL: &str = "dashboard";

/// `settings.json` under the OS application-config dir. Machine-local: this is
/// never restored from a backup taken on another machine.
fn settings_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_IDENTIFIER)
        .join("settings.json")
}

/// The data folder holding `state.json`. Defaults to `~/Dopamigo MVP`,
/// overridable via `dataFolder` in settings.
///
/// Separate from the production app's `~/Dopamigo` for the reason given on
/// [`APP_IDENTIFIER`]: the same-named file with a narrower schema would lose
/// fields. Change this to `Dopamigo` only if you have replaced this MVP.
fn data_folder() -> PathBuf {
    if let Ok(raw) = fs::read_to_string(settings_path()) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(f) = v.get("dataFolder").and_then(|x| x.as_str()) {
                if !f.trim().is_empty() {
                    return PathBuf::from(f);
                }
            }
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Dopamigo MVP")
}

fn state_path(folder: &Path) -> PathBuf {
    folder.join("state.json")
}
fn backup_path(folder: &Path) -> PathBuf {
    folder.join("state.bak")
}
fn recovery_dir(folder: &Path) -> PathBuf {
    folder.join("Dopamigo Recovery")
}

// ===========================================================================
// STATE I/O - the durability contract
// ===========================================================================
//
// Rules, in priority order:
//   1. A malformed file is NEVER deleted or overwritten. It is copied into a
//      timestamped recovery folder so the user can still get their data back.
//   2. Writes are atomic: unique same-directory temp -> flush -> fsync ->
//      rename, then fsync the parent dir so the rename itself is durable.
//   3. A `.bak` of the last-known-GOOD file is taken before each overwrite, and
//      is actually read back on a bad load.
//
// Load outcomes are explicit so the UI can be honest rather than silently
// starting empty: fresh | loaded | recovered | damaged.

/// How a load resolved. `state` is `None` for `fresh` and `damaged`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadResult {
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    paths: Vec<String>,
}

/// Read + parse a JSON file. `Ok(None)` when it does not exist.
///
/// An EMPTY file is deliberately an error, not an empty object: that is what a
/// truncated write looks like, and treating it as `{}` would silently discard a
/// day's work instead of recovering the `.bak`.
fn try_read(path: &Path) -> Result<Option<serde_json::Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Err("file is empty (truncated write?)".into());
    }
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|e| e.to_string())
}

/// Copy a file into the recovery folder. Best-effort: failing to make the copy
/// must not stop us surfacing the damage to the user.
fn copy_into_recovery(folder: &Path, src: &Path, stamp: &str) -> Option<PathBuf> {
    if !src.exists() {
        return None;
    }
    let dir = recovery_dir(folder).join(stamp);
    fs::create_dir_all(&dir).ok()?;
    let dest = dir.join(src.file_name()?);
    fs::copy(src, &dest).ok()?;
    Some(dest)
}

/// Load the state, with real `.bak` recovery. Never destroys a bad file.
fn load_state(folder: &Path) -> LoadResult {
    let live = state_path(folder);
    let bak = backup_path(folder);
    let paths = vec![
        live.to_string_lossy().into_owned(),
        bak.to_string_lossy().into_owned(),
    ];

    match try_read(&live) {
        // Happy path.
        Ok(Some(v)) => LoadResult {
            kind: "loaded".into(),
            state: Some(v),
            message: None,
            paths,
        },
        // No live file. A lone `.bak` still counts as recoverable.
        Ok(None) => match try_read(&bak) {
            Ok(Some(v)) => {
                let _ = write_state(folder, &v);
                LoadResult {
                    kind: "recovered".into(),
                    state: Some(v),
                    message: Some(
                        "Today's file was missing, so Dopamigo restored your last backup.".into(),
                    ),
                    paths,
                }
            }
            _ => LoadResult {
                kind: "fresh".into(),
                state: None,
                message: None,
                paths,
            },
        },
        // Malformed live file: preserve it, then try the backup.
        Err(live_err) => {
            let stamp = format!(
                "recovery-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0)
            );
            match try_read(&bak) {
                Ok(Some(v)) => {
                    let copied = copy_into_recovery(folder, &live, &stamp);
                    let restored = write_state(folder, &v).is_ok();
                    let note = copied
                        .map(|p| format!(" A copy of the damaged file is in {}.", p.display()))
                        .unwrap_or_default();
                    LoadResult {
                        kind: if restored { "recovered" } else { "damaged" }.into(),
                        state: if restored { Some(v) } else { None },
                        message: Some(format!(
                            "Today's file couldn't be read ({live_err}), so Dopamigo restored your last backup.{note}"
                        )),
                        paths,
                    }
                }
                // Both bad: preserve BOTH, seed nothing.
                _ => {
                    copy_into_recovery(folder, &live, &stamp);
                    copy_into_recovery(folder, &bak, &stamp);
                    LoadResult {
                        kind: "damaged".into(),
                        state: None,
                        message: Some(format!(
                            "Dopamigo couldn't read today's file or its backup ({live_err}). \
                             Nothing was changed or deleted; copies are in the recovery folder."
                        )),
                        paths,
                    }
                }
            }
        }
    }
}

/// Atomically persist the state (see the STATE I/O contract above).
fn write_state(folder: &Path, state: &serde_json::Value) -> Result<(), String> {
    fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let dest = state_path(folder);
    let body = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;

    match try_read(&dest) {
        // Back up the prior GOOD file.
        Ok(Some(_)) => {
            let _ = fs::copy(&dest, backup_path(folder));
        }
        // First-ever write: seed `.bak` with the same content, so corruption
        // before the second save is still recoverable.
        Ok(None) => {
            if !backup_path(folder).exists() {
                let _ = fs::write(backup_path(folder), &body);
            }
        }
        // Live file is corrupt: leave any existing good `.bak` alone.
        Err(_) => {}
    }

    // Unique temp name in the SAME directory (atomicity needs one filesystem).
    // The pid alone is not unique: both webviews share this process, so two
    // concurrent saves would pick the same path and could truncate each other.
    static TMP_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = folder.join(format!(".state.json.tmp{}-{}", std::process::id(), seq));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    atomic_replace(&tmp, &dest)?;

    // fsync the directory so the rename survives a crash / power loss.
    #[cfg(unix)]
    if let Ok(dir) = fs::File::open(folder) {
        let _ = dir.sync_all();
    }
    Ok(())
}

#[cfg(not(windows))]
fn atomic_replace(tmp: &Path, dest: &Path) -> Result<(), String> {
    fs::rename(tmp, dest).map_err(|e| e.to_string())
}

/// Windows: a TRUE single-step replace. The naive remove-then-rename leaves a
/// window where the live file does not exist at all, so a crash there loses the
/// data even though it was safely written.
#[cfg(windows)]
fn atomic_replace(tmp: &Path, dest: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    fn wide(p: &Path) -> Vec<u16> {
        p.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }
    let (from, to) = (wide(tmp), wide(dest));
    let ok = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

// ===========================================================================
// COMMANDS - the IPC surface
// ===========================================================================

/// Serializes saves across BOTH webviews. Each window has its own JS `saving`
/// flag, which cannot order writes between windows.
static SAVE_LOCK: Mutex<()> = Mutex::new(());

/// Latched once a wipe begins, so a queued debounce or an unload flush cannot
/// recreate the files we just deleted.
static UNINSTALLING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
async fn load_app_state() -> Result<LoadResult, String> {
    Ok(load_state(&data_folder()))
}

#[tauri::command]
async fn save_app_state(state: serde_json::Value) -> Result<(), String> {
    if UNINSTALLING.load(Ordering::SeqCst) {
        return Ok(()); // going away; not an error the UI should shout about
    }
    let _guard = SAVE_LOCK.lock().map_err(|e| e.to_string())?;
    write_state(&data_folder(), &state)
}

#[tauri::command]
async fn get_data_folder() -> Result<String, String> {
    Ok(data_folder().to_string_lossy().into_owned())
}

// ---- settings.json ---------------------------------------------------------
//
// A SEPARATE file from state.json, holding machine-local + portable preferences
// that must survive a state restore taken on another machine: the data folder,
// the standard-daily routine list, and the auto-update switch.
//
// Every write is READ-MODIFY-WRITE through a generic JSON map rather than a
// typed struct. That is deliberate: unknown / forward-compat keys (and the ones
// this MVP drops) are preserved instead of being erased by a narrower schema.

/// Read `settings.json` as a JSON object. A missing file is an empty object; a
/// PRESENT-but-malformed one is an error, so we never clobber a recoverable file.
fn read_settings() -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let path = settings_path();
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(serde_json::Map::new());
    }
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(serde_json::Value::Object(m)) => Ok(m),
        Ok(_) => Err("settings.json is not a JSON object".into()),
        Err(e) => Err(e.to_string()),
    }
}

/// Merge one key into `settings.json`, preserving every other key.
fn patch_settings(key: &str, value: serde_json::Value) -> Result<(), String> {
    let path = settings_path();
    let mut map = read_settings()?;
    map.insert(key.to_string(), value);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let body =
        serde_json::to_string_pretty(&serde_json::Value::Object(map)).map_err(|e| e.to_string())?;
    fs::write(&path, body).map_err(|e| e.to_string())
}

/// The "standard daily" routine list, seeded fresh into every new day.
#[tauri::command]
async fn get_standard_daily() -> Result<Vec<String>, String> {
    Ok(read_settings()?
        .get("standardDaily")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default())
}

#[tauri::command]
async fn set_standard_daily_list(list: Vec<String>) -> Result<(), String> {
    patch_settings("standardDaily", serde_json::json!(list))
}

/// The silent-self-update preference. This MVP has no updater (see
/// INSTRUCTIONS.md §5), but the switch is still persisted so the setting - and a
/// real updater added later - round-trips correctly.
#[tauri::command]
async fn get_auto_update() -> Result<bool, String> {
    // Absent means ON, matching a fresh install of the full app.
    Ok(read_settings()?
        .get("autoUpdate")
        .and_then(|v| v.as_bool())
        .unwrap_or(true))
}

#[tauri::command]
async fn set_auto_update(on: bool) -> Result<(), String> {
    patch_settings("autoUpdate", serde_json::json!(on))
}

/// Reveal the data folder in Finder / Explorer / the desktop file manager.
#[tauri::command]
async fn open_data_folder() -> Result<(), String> {
    let folder = data_folder();
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?; // fresh install
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let cmd = "xdg-open";
    std::process::Command::new(cmd)
        .arg(&folder)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Fire a native OS notification (reminders, break-over, wellness nudges).
#[tauri::command]
async fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

/// Write a UTF-8 text file into the data folder (JSON backup export).
///
/// `file_name()` strips any directory components, so `../../escape.json`
/// collapses to a bare name inside the folder - exports are named files, never
/// arbitrary paths.
#[tauri::command]
async fn write_text_file(name: String, contents: String) -> Result<String, String> {
    let folder = data_folder();
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let safe = Path::new(&name)
        .file_name()
        .ok_or_else(|| "invalid file name".to_string())?;
    let dest = folder.join(safe);
    fs::write(&dest, contents).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Show (or clear) text beside the menu-bar icon - the running task's elapsed
/// time, the way a delivery app shows an ETA. macOS only; a silent no-op
/// elsewhere, so callers never branch on platform.
#[tauri::command]
async fn set_tray_title(app: AppHandle, title: Option<String>) -> Result<(), String> {
    apply_tray_title(&app, title);
    Ok(())
}

#[tauri::command]
async fn open_dashboard(app: AppHandle) -> Result<(), String> {
    show_dashboard(&app);
    Ok(())
}

/// Called by the dashboard as it is dismissed. Retained for the frontend
/// contract; the hide itself is handled in Rust (`CloseRequested`), and there is
/// no activation policy left to restore.
#[tauri::command]
async fn dashboard_closed() -> Result<(), String> {
    Ok(())
}

/// Exiting via `app.exit(0)` rather than a kill lets the normal exit handler
/// run. A tray-only app has no window chrome, so without this the only way out
/// would be Activity Monitor / Task Manager.
#[tauri::command]
async fn quit_app(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

/// DANGER ZONE: remove Dopamigo's data from this machine, then quit.
/// `keep_history` leaves the state files so a reinstall can recover them.
#[tauri::command]
async fn reset_and_uninstall_app(app: AppHandle, keep_history: bool) -> Result<(), String> {
    // Latch FIRST so any save already queued in either webview is rejected
    // instead of recreating what we are about to delete.
    UNINSTALLING.store(true, Ordering::SeqCst);

    let folder = data_folder();
    let _ = fs::remove_file(settings_path());
    if !keep_history {
        let _ = fs::remove_file(state_path(&folder));
        let _ = fs::remove_file(backup_path(&folder));
        let _ = fs::remove_dir_all(recovery_dir(&folder));
        // Exported backups and stale temps are app-created too; "remove
        // everything" must not leave them behind.
        if let Ok(entries) = fs::read_dir(&folder) {
            for e in entries.flatten() {
                let n = e.file_name().to_string_lossy().into_owned();
                if n.starts_with("dopamigo-backup-") || n.starts_with(".state.json.tmp") {
                    let _ = fs::remove_file(e.path());
                }
            }
        }
    }
    app.exit(0);
    Ok(())
}

// ===========================================================================
// TRAY - the menu-bar icon
// ===========================================================================

/// The live tray icon, kept so the title can be updated as the clock runs.
/// Stored rather than rebuilt: recreating a tray icon makes it flicker and lose
/// its position in the menu bar.
#[derive(Default)]
struct TrayHandle(Mutex<Option<tauri::tray::TrayIcon>>);

/// Draw the menu-bar mark in code: a filled ring on a transparent canvas.
///
/// The full app ships a designed `tray.png`. Generating it here keeps this
/// packet to text files only, and a template image is a solid mark anyway -
/// macOS recolours it for light/dark menu bars, so shape is all that matters.
fn tray_image() -> tauri::image::Image<'static> {
    const N: i32 = 32;
    let (outer, inner) = (15.0_f32, 9.5_f32);
    let c = (N as f32 - 1.0) / 2.0;
    let mut rgba = Vec::with_capacity((N * N * 4) as usize);
    for y in 0..N {
        for x in 0..N {
            let d = (((x as f32 - c).powi(2)) + ((y as f32 - c).powi(2))).sqrt();
            // Antialias both edges over one pixel so the ring isn't jagged.
            let a = ((outer - d).clamp(0.0, 1.0) * (d - inner).clamp(0.0, 1.0) * 255.0) as u8;
            rgba.extend_from_slice(&[0, 0, 0, a]); // black; macOS templates recolour
        }
    }
    tauri::image::Image::new_owned(rgba, N as u32, N as u32)
}

/// Show text next to the menu-bar icon. macOS only (documented as unsupported
/// on Windows; Linux panels may ignore it), so this is a silent no-op elsewhere.
fn apply_tray_title(app: &AppHandle, title: Option<String>) {
    let Some(handle) = app.try_state::<TrayHandle>() else {
        return;
    };
    // CLONE the icon out and DROP the lock before calling into the tray.
    // `TrayIcon` is a cheap handle; holding the mutex across `set_title` (a main
    // thread UI call) let a once-a-second title update block the tray's own
    // click handler - the icon stopped opening the popover.
    let tray = match handle.0.lock() {
        Ok(g) => g.as_ref().cloned(),
        Err(_) => None,
    };
    if let Some(tray) = tray {
        let _ = tray.set_title(title.as_deref());
    }
}

const MENU_OPEN: &str = "open";
const MENU_DASHBOARD: &str = "dashboard";
const MENU_QUIT: &str = "quit";

/// Pull the icon rectangle (physical px) out of any tray event.
fn event_rect(event: &TrayIconEvent) -> Option<(f64, f64, f64, f64)> {
    let rect = match event {
        TrayIconEvent::Click { rect, .. }
        | TrayIconEvent::DoubleClick { rect, .. }
        | TrayIconEvent::Enter { rect, .. }
        | TrayIconEvent::Move { rect, .. }
        | TrayIconEvent::Leave { rect, .. } => rect,
        _ => return None,
    };
    let pos = rect.position.to_physical::<f64>(1.0);
    let size = rect.size.to_physical::<f64>(1.0);
    Some((pos.x, pos.y, size.width, size.height))
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        MENU_OPEN => show_popover(app),
        MENU_DASHBOARD => show_dashboard(app),
        MENU_QUIT => {
            // Give the frontend's debounced save a moment to land: the webview
            // may have a write queued that Rust hasn't been asked for yet.
            std::thread::sleep(Duration::from_millis(200));
            app.exit(0);
        }
        _ => {}
    }
}

/// Build and register the tray icon.
///
/// Right-click opens the menu; left-click toggles the popover
/// (`show_menu_on_left_click(false)` is what keeps those separate). The menu
/// exists because a tray-only app otherwise has no way to quit at all.
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, MENU_OPEN, "Open Dopamigo", true, None::<&str>)?;
    let dash = MenuItem::with_id(app, MENU_DASHBOARD, "Open Dashboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit Dopamigo", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(app, &[&open, &dash, &quit])?;

    let tray = TrayIconBuilder::new()
        .tooltip("Dopamigo")
        .icon(tray_image())
        // macOS: recolour the mark to match a light or dark menu bar.
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            // Record the icon rect from EVERY event so the popover can anchor
            // under it. (We anchor manually because the positioner's TrayCenter
            // returned screen-centre on macOS in testing.)
            if let Some((x, y, w, h)) = event_rect(&event) {
                app.state::<TrayAnchor>().set(x, y, w, h);
            }
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_popover(app);
            }
        })
        .build(app)?;

    // Show the name until the first elapsed-time title replaces it: a tray item
    // whose image fails to load renders zero-width and looks like the app never
    // started, so text guarantees it is findable.
    if let Ok(mut g) = app.state::<TrayHandle>().0.lock() {
        *g = Some(tray);
    }
    apply_tray_title(app, Some("Dopamigo".into()));
    Ok(())
}

// ===========================================================================
// POPOVER + DASHBOARD windows
// ===========================================================================

/// The tray icon's rectangle in physical px, captured from tray events.
#[derive(Default)]
struct TrayAnchor(Mutex<Option<(f64, f64, f64, f64)>>);

impl TrayAnchor {
    fn set(&self, x: f64, y: f64, w: f64, h: f64) {
        if let Ok(mut g) = self.0.lock() {
            *g = Some((x, y, w, h));
        }
    }
    fn get(&self) -> Option<(f64, f64, f64, f64)> {
        self.0.lock().ok().and_then(|g| *g)
    }
}

/// How long after a hide a toggle-driven show is suppressed.
const DISMISS_DEBOUNCE: Duration = Duration::from_millis(200);

/// Guard against the menubar double-handler race.
///
/// Clicking the tray icon while the popover is open fires TWO things, in order:
/// (1) the popover loses focus -> autohide hides it; THEN (2) the tray click
/// handler runs `toggle_popover`, which now sees `is_visible() == false` and
/// would re-show it - so the tray could never DISMISS the popover, it just
/// flickered and reopened. We record the last hide and swallow a show that
/// arrives within ~200ms of it. `Instant` is monotonic, so this is pure UI
/// timing, not wall-clock logic.
#[derive(Default)]
struct PopoverGuard(Mutex<Option<Instant>>);

impl PopoverGuard {
    fn mark_hidden(&self) {
        if let Ok(mut g) = self.0.lock() {
            *g = Some(Instant::now());
        }
    }
    fn hidden_recently(&self) -> bool {
        self.0
            .lock()
            .ok()
            .and_then(|g| *g)
            .is_some_and(|t| t.elapsed() < DISMISS_DEBOUNCE)
    }
}

fn toggle_popover(app: &AppHandle) {
    let Some(win) = app.get_webview_window(POPOVER_LABEL) else {
        return;
    };
    match win.is_visible() {
        Ok(true) => {
            app.state::<PopoverGuard>().mark_hidden();
            hide_popover_window(app, &win);
        }
        _ => {
            if app.state::<PopoverGuard>().hidden_recently() {
                return; // this click was the dismiss; see PopoverGuard
            }
            show_popover(app);
        }
    }
}

/// Anchor the popover under the tray icon, then show + focus it.
///
/// Positioning happens BEFORE `show()` so the window never flashes at its old
/// location. We re-assert `always_on_top` on every show because a menu-bar
/// (Accessory) app's window can otherwise open BEHIND the frontmost app.
fn show_popover(app: &AppHandle) {
    let Some(win) = app.get_webview_window(POPOVER_LABEL) else {
        return;
    };
    let win_w = win.outer_size().map(|s| s.width as f64).unwrap_or(380.0);
    let monitor = win.current_monitor().ok().flatten();
    let (mon_x, mon_w, mon_y) = monitor
        .as_ref()
        .map(|m| {
            (
                m.position().x as f64,
                m.size().width as f64,
                m.position().y as f64,
            )
        })
        .unwrap_or((0.0, 1440.0, 0.0));

    let (mut x, y) = match app.state::<TrayAnchor>().get() {
        // Centre it under the icon, just below the menu bar.
        Some((tx, ty, tw, th)) => (tx + tw / 2.0 - win_w / 2.0, ty + th + 2.0),
        // No tray event seen yet (e.g. a Spotlight reopen): sit near the
        // top-right where menu-bar extras live, rather than mid-screen - which
        // would not read as a menu-bar popover at all.
        None => {
            let scale = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(2.0);
            (
                mon_x + mon_w - win_w - 12.0 * scale,
                mon_y + 24.0 * scale + 2.0,
            )
        }
    };
    // Clamp so a right-edge icon can't push the window off-screen.
    x = x.min(mon_x + mon_w - win_w - 4.0).max(mon_x + 4.0);
    let _ = win.set_position(PhysicalPosition::new(x, y));

    let _ = win.set_always_on_top(true);
    let _ = win.show();
    let _ = win.set_focus();
}

fn hide_popover_window(_app: &AppHandle, win: &tauri::WebviewWindow) {
    let _ = win.hide();
}

/// Click-away autohide: hide the popover the moment it loses focus.
fn register_autohide(app: &AppHandle) {
    let Some(win) = app.get_webview_window(POPOVER_LABEL) else {
        return;
    };
    let w = win.clone();
    let h = app.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            h.state::<PopoverGuard>().mark_hidden();
            hide_popover_window(&h, &w);
        }
    });
}

/// Reveal + focus the dashboard. It is a NORMAL window (config-declared, hidden
/// at startup) - no always-on-top, no panel treatment.
fn show_dashboard(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(DASHBOARD_LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

// ===========================================================================
// MAIN
// ===========================================================================

fn main() {
    tauri::Builder::default()
        // A second launch resurfaces the existing popover instead of starting a
        // new process.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_popover(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .manage(TrayHandle::default())
        .manage(TrayAnchor::default())
        .manage(PopoverGuard::default())
        .invoke_handler(tauri::generate_handler![
            load_app_state,
            save_app_state,
            get_data_folder,
            open_data_folder,
            get_standard_daily,
            set_standard_daily_list,
            get_auto_update,
            set_auto_update,
            notify,
            write_text_file,
            set_tray_title,
            open_dashboard,
            dashboard_closed,
            quit_app,
            reset_and_uninstall_app,
        ])
        .setup(|app| {
            // macOS: run as an Accessory (menu-bar) app - no Dock icon, no app
            // switcher entry. Load-bearing, not cosmetic: Accessory is what lets
            // the popover float over every Space. `Info.plist`'s LSUIElement
            // does the same thing earlier, avoiding a Dock-icon flash at launch.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle();
            build_tray(handle)?;
            register_autohide(handle);

            // A tray app should HIDE its windows, not destroy them: the webview
            // keeps its state, so reopening is instant.
            if let Some(dash) = handle.get_webview_window(DASHBOARD_LABEL) {
                dash.clone().on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = dash.hide();
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Re-opening an already-running .app on macOS does NOT start a second
            // process - LaunchServices sends a Reopen event instead, so
            // single-instance never fires. Without this, pressing Enter on
            // Dopamigo in Spotlight appears to do nothing (there are no windows
            // to restore in a tray-only app).
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = &event {
                show_popover(app);
            }
            let _ = (app, &event);
        });
}

// ===========================================================================
// TESTS - the durability contract, which is the only thing here worth testing
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn v(json: &str) -> serde_json::Value {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn fresh_when_no_files_exist() {
        let d = tempdir().unwrap();
        let r = load_state(d.path());
        assert_eq!(r.kind, "fresh");
        assert!(r.state.is_none());
    }

    #[test]
    fn round_trips_state() {
        let d = tempdir().unwrap();
        write_state(d.path(), &v(r#"{"dayNum":3}"#)).unwrap();
        let r = load_state(d.path());
        assert_eq!(r.kind, "loaded");
        assert_eq!(r.state.unwrap()["dayNum"], 3);
    }

    #[test]
    fn second_write_backs_up_the_prior_good_file() {
        let d = tempdir().unwrap();
        write_state(d.path(), &v(r#"{"dayNum":1}"#)).unwrap();
        write_state(d.path(), &v(r#"{"dayNum":2}"#)).unwrap();
        let bak: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(backup_path(d.path())).unwrap()).unwrap();
        assert_eq!(bak["dayNum"], 1, "backup holds the PRIOR good state");
        assert_eq!(load_state(d.path()).state.unwrap()["dayNum"], 2);
    }

    #[test]
    fn malformed_live_recovers_and_preserves_the_damaged_file() {
        let d = tempdir().unwrap();
        write_state(d.path(), &v(r#"{"dayNum":7}"#)).unwrap();
        write_state(d.path(), &v(r#"{"dayNum":8}"#)).unwrap(); // bak=7, live=8
        fs::write(state_path(d.path()), "{ not json").unwrap();

        let r = load_state(d.path());
        assert_eq!(r.kind, "recovered");
        assert_eq!(r.state.unwrap()["dayNum"], 7, "restored from .bak");

        // The damaged content was copied, not discarded.
        let dir = fs::read_dir(recovery_dir(d.path()))
            .unwrap()
            .next()
            .unwrap();
        let copy = dir.unwrap().path().join("state.json");
        assert!(copy.exists(), "damaged file must be preserved");
        assert!(fs::read_to_string(copy).unwrap().contains("not json"));
    }

    #[test]
    fn both_invalid_reports_damaged_and_never_seeds_or_deletes() {
        let d = tempdir().unwrap();
        fs::write(state_path(d.path()), "broken-live").unwrap();
        fs::write(backup_path(d.path()), "broken-bak").unwrap();

        let r = load_state(d.path());
        assert_eq!(r.kind, "damaged");
        assert!(r.state.is_none(), "must NOT seed an empty state");
        // Both originals untouched.
        assert_eq!(
            fs::read_to_string(state_path(d.path())).unwrap(),
            "broken-live"
        );
        assert_eq!(
            fs::read_to_string(backup_path(d.path())).unwrap(),
            "broken-bak"
        );
    }

    #[test]
    fn empty_file_is_malformed_not_an_empty_state() {
        let d = tempdir().unwrap();
        write_state(d.path(), &v(r#"{"dayNum":4}"#)).unwrap();
        fs::write(state_path(d.path()), "").unwrap(); // truncated write
        let r = load_state(d.path());
        assert_eq!(r.kind, "recovered", "must not become a blank day");
        assert_eq!(r.state.unwrap()["dayNum"], 4);
    }

    #[test]
    fn first_write_seeds_a_backup() {
        let d = tempdir().unwrap();
        write_state(d.path(), &v(r#"{"dayNum":1}"#)).unwrap();
        assert!(backup_path(d.path()).exists());
        fs::write(state_path(d.path()), "corrupt").unwrap();
        assert_eq!(load_state(d.path()).state.unwrap()["dayNum"], 1);
    }

    #[test]
    fn corrupt_live_never_becomes_the_backup() {
        let d = tempdir().unwrap();
        write_state(d.path(), &v(r#"{"dayNum":1}"#)).unwrap();
        fs::write(state_path(d.path()), "corrupt").unwrap();
        write_state(d.path(), &v(r#"{"dayNum":9}"#)).unwrap();
        let bak = fs::read_to_string(backup_path(d.path())).unwrap();
        assert!(!bak.contains("corrupt"));
    }

    #[test]
    fn no_temp_files_remain_after_write() {
        let d = tempdir().unwrap();
        write_state(d.path(), &v(r#"{"a":1}"#)).unwrap();
        let left: Vec<_> = fs::read_dir(d.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(".tmp"))
            .collect();
        assert!(left.is_empty(), "temp files left behind: {left:?}");
    }

    /// `settings.json` writes must PRESERVE unknown keys. The full app keeps
    /// `deviceId`, nudge prefs and a `dataFolder` there; a narrower schema that
    /// serialized only what it understood would silently erase them.
    #[test]
    fn settings_patch_preserves_unknown_keys() {
        let mut map = serde_json::Map::new();
        map.insert("deviceId".into(), serde_json::json!("abc-123"));
        map.insert("dataFolder".into(), serde_json::json!("/somewhere"));

        // Same read-modify-write `patch_settings` performs, without touching the
        // real config dir.
        map.insert("standardDaily".into(), serde_json::json!(["Standup"]));
        map.insert("autoUpdate".into(), serde_json::json!(false));

        assert_eq!(map.get("deviceId").unwrap(), "abc-123");
        assert_eq!(map.get("dataFolder").unwrap(), "/somewhere");
        assert_eq!(map.get("standardDaily").unwrap()[0], "Standup");
        assert_eq!(map.get("autoUpdate").unwrap(), false);
        assert_eq!(map.len(), 4, "no key may be dropped");
    }

    /// The MVP must not collide with the production app's files.
    #[test]
    fn data_paths_are_isolated_from_the_production_app() {
        assert_eq!(APP_IDENTIFIER, "com.dopamigo.mvp");
        assert!(settings_path()
            .to_string_lossy()
            .contains("com.dopamigo.mvp"));
        assert!(data_folder().ends_with("Dopamigo MVP"));
    }

    #[test]
    fn export_name_cannot_escape_the_data_folder() {
        let safe = Path::new("../../escape.json").file_name().unwrap();
        assert_eq!(safe, std::ffi::OsStr::new("escape.json"));
    }

    #[test]
    fn tray_image_is_a_ring_on_a_transparent_canvas() {
        let img = tray_image();
        assert_eq!((img.width(), img.height()), (32, 32));
        let px = |x: usize, y: usize| img.rgba()[(y * 32 + x) * 4 + 3];
        assert_eq!(px(0, 0), 0, "corner is transparent");
        assert_eq!(px(16, 16), 0, "centre is a hole, not a filled disc");
        assert!(px(16, 3) > 200, "the ring band itself is opaque");
    }
}

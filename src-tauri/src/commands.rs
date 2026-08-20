//! COMMANDS - the IPC surface the Svelte frontend calls. 16 commands: the
//! original 15 from the transport packet, plus `quit_listener_ready` (the
//! real quit-handshake ack - see `tray::QuitReadiness`).

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::migration::take_pending_message;
use crate::paths::{backup_path, data_folder, recovery_dir, settings_path, state_path};
use crate::settings::{patch_settings, read_settings};
use crate::state_io::{load_state, write_state_cas, CasOutcome, LoadResult};
use crate::tray::{apply_tray_title, QuitReadiness};
use crate::windows::show_dashboard;

/// Serializes saves across BOTH webviews. Each window has its own JS `saving`
/// flag, which cannot order writes between windows.
static SAVE_LOCK: Mutex<()> = Mutex::new(());

/// Latched once a wipe begins, so a queued debounce or an unload flush cannot
/// recreate the files we just deleted.
static UNINSTALLING: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn load_app_state() -> Result<LoadResult, String> {
    let mut result = load_state(&data_folder());
    // A freshly-migrated legacy MVP data set surfaces its one-time
    // supportive message here, riding the same `message` field a recovery
    // load uses. Read-once: only the very first `load_app_state` call after
    // a migrating boot sees it.
    if let Some(migration_note) = take_pending_message() {
        result.message = Some(match result.message.take() {
            Some(existing) => format!("{migration_note} {existing}"),
            None => migration_note.to_string(),
        });
    }
    Ok(result)
}

/// Compare-and-swap save. The frontend includes `_rev` (the revision it
/// last loaded/saved) inside `state` itself - Rust never needed a typed
/// schema for state before, and doesn't need one now to carry this one
/// extra field. Returns `{ "rev": N }` on success (the NEW revision, to
/// remember for the next save), or `{ "stale": true, "currentRev": N }` if
/// someone else (the other window) saved a newer revision first - the
/// write is REJECTED, never silently applied over their change. See
/// `state_io::write_state_cas` and `docs/data-durability.md`'s
/// cross-window section.
#[tauri::command]
pub async fn save_app_state(state: serde_json::Value) -> Result<serde_json::Value, String> {
    if UNINSTALLING.load(Ordering::SeqCst) {
        // Going away; not an error the UI should shout about. `rev: 0` is
        // a harmless placeholder - nothing further will be saved anyway.
        return Ok(serde_json::json!({ "rev": 0 }));
    }
    let expected_rev = state.get("_rev").and_then(|r| r.as_u64()).unwrap_or(0);
    let _guard = SAVE_LOCK.lock().map_err(|e| e.to_string())?;
    match write_state_cas(&data_folder(), &state, expected_rev)? {
        CasOutcome::Written(rev) => Ok(serde_json::json!({ "rev": rev })),
        CasOutcome::Stale { current_rev } => {
            Ok(serde_json::json!({ "stale": true, "currentRev": current_rev }))
        }
    }
}

#[tauri::command]
pub async fn get_data_folder() -> Result<String, String> {
    Ok(data_folder().to_string_lossy().into_owned())
}

/// The "standard daily" routine list, seeded fresh into every new day.
#[tauri::command]
pub async fn get_standard_daily() -> Result<Vec<String>, String> {
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
pub async fn set_standard_daily_list(list: Vec<String>) -> Result<(), String> {
    patch_settings("standardDaily", serde_json::json!(list))
}

/// The silent-self-update preference. This build has no updater, but the
/// switch is still persisted so it round-trips correctly.
#[tauri::command]
pub async fn get_auto_update() -> Result<bool, String> {
    // Absent means ON, matching a fresh install.
    Ok(read_settings()?
        .get("autoUpdate")
        .and_then(|v| v.as_bool())
        .unwrap_or(true))
}

#[tauri::command]
pub async fn set_auto_update(on: bool) -> Result<(), String> {
    patch_settings("autoUpdate", serde_json::json!(on))
}

/// The running app version, so the UI can show it without a network call.
#[tauri::command]
pub async fn get_app_version() -> Result<String, String> {
    Ok(crate::updater::current_version())
}

/// The version whose "what's new" notes the user has already seen.
///
/// Lives in `settings.json`, not `state.json`: it describes THIS
/// installation, not the user's work, so it must not travel inside a
/// backup and reappear on another machine as "already seen".
///
/// Empty means "never recorded" - which is a fresh install, not an
/// upgrade, so nothing is shown.
#[tauri::command]
pub async fn get_seen_version() -> Result<String, String> {
    Ok(read_settings()?
        .get("seenVersion")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string())
}

#[tauri::command]
pub async fn set_seen_version(version: String) -> Result<(), String> {
    patch_settings("seenVersion", serde_json::json!(version))
}

/// Reveal the data folder in Finder / Explorer / the desktop file manager.
#[tauri::command]
pub async fn open_data_folder() -> Result<(), String> {
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
pub async fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
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
/// collapses to a bare name inside the folder - exports are named files,
/// never arbitrary paths.
#[tauri::command]
pub async fn write_text_file(name: String, contents: String) -> Result<String, String> {
    let folder = data_folder();
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let safe = Path::new(&name)
        .file_name()
        .ok_or_else(|| "invalid file name".to_string())?;
    let dest = folder.join(safe);
    fs::write(&dest, contents).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Show (or clear) text beside the menu-bar icon.
#[tauri::command]
pub async fn set_tray_title(app: AppHandle, title: Option<String>) -> Result<(), String> {
    apply_tray_title(&app, title);
    Ok(())
}

#[tauri::command]
pub async fn open_dashboard(app: AppHandle) -> Result<(), String> {
    show_dashboard(&app);
    Ok(())
}

/// Called by the dashboard as it is dismissed. Retained for the frontend
/// contract; the hide itself is handled in Rust (`CloseRequested`).
#[tauri::command]
pub async fn dashboard_closed() -> Result<(), String> {
    Ok(())
}

/// Exiting via `app.exit(0)` rather than a kill lets the normal exit handler
/// run. A tray-only app has no window chrome, so without this the only way
/// out would be Activity Monitor / Task Manager.
#[tauri::command]
pub async fn quit_app(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

/// The frontend calls this once its `quit-requested` listener is actually
/// registered (see `registerQuitListener()` in `store/persistence.ts`).
/// This is the real half of the quit HANDSHAKE: until this fires, the tray
/// menu's Quit falls back to exiting directly rather than emitting into a
/// void nobody is listening to yet. See `tray::QuitReadiness` and
/// `tray::request_quit`.
#[tauri::command]
pub async fn quit_listener_ready(app: AppHandle) -> Result<(), String> {
    if let Some(r) = app.try_state::<QuitReadiness>() {
        r.mark_ready();
    }
    Ok(())
}

/// Delete a file, treating "it never existed" as success (not every install
/// has a `.bak` yet) but collecting any REAL failure (permission denied,
/// I/O error) into `errors` instead of discarding it.
fn try_remove_file(path: &std::path::Path, errors: &mut Vec<String>) {
    if let Err(e) = fs::remove_file(path) {
        if path.exists() {
            errors.push(format!("{}: {e}", path.display()));
        }
    }
}

/// Same as `try_remove_file`, for a directory tree (the recovery folder).
fn try_remove_dir(path: &std::path::Path, errors: &mut Vec<String>) {
    if let Err(e) = fs::remove_dir_all(path) {
        if path.exists() {
            errors.push(format!("{}: {e}", path.display()));
        }
    }
}

/// Every stale/exported artifact prefix Remi itself creates inside the
/// data folder, beyond `state.json` / `state.bak` / the recovery dir,
/// which get their own named removal. Kept as one list so "remove
/// everything" and any future audit of what Remi writes stay in sync.
///
/// - `remi-backup-*.json` - manual JSON backup exports (`exportBackup`)
/// - `remi-usage-*.json` - opt-in usage-log exports (`exportLogs`)
/// - `.state.json.tmp*` - `state_io::write_state`'s atomic-write temp files
/// - `.settings.json.tmp*` - `settings::write_settings_at`'s temp files
///   (the file-name-derived prefix, since `settings_path()` always points
///   at a file literally named `settings.json`)
const CLEANUP_PREFIXES: &[&str] = &[
    "remi-backup-",
    "remi-usage-",
    ".state.json.tmp",
    ".settings.json.tmp",
];

/// The uninstall logic, parameterized over the data folder and settings
/// path so it is fully testable without touching real user data. Returns
/// the paths that failed to delete (or the reason the data folder itself
/// couldn't even be enumerated), if any - an empty vec means a clean wipe.
fn uninstall_data(
    folder: &std::path::Path,
    settings: &std::path::Path,
    keep_history: bool,
) -> Vec<String> {
    let mut errors = Vec::new();
    try_remove_file(settings, &mut errors);
    if !keep_history {
        try_remove_file(&state_path(folder), &mut errors);
        try_remove_file(&backup_path(folder), &mut errors);
        try_remove_dir(&recovery_dir(folder), &mut errors);

        // Exported backups, usage logs and stale temps are app-created
        // too; "remove everything" must not leave them behind. A folder
        // that never existed (fresh install, nothing ever written) is not
        // an error - but one that exists and genuinely can't be read
        // (permission race, unmounted volume) must be REPORTED, not
        // silently treated as "nothing to clean up here".
        match fs::read_dir(folder) {
            Ok(entries) => {
                for entry in entries {
                    let e = match entry {
                        Ok(e) => e,
                        Err(err) => {
                            errors.push(format!("{}: {err}", folder.display()));
                            continue;
                        }
                    };
                    let n = e.file_name().to_string_lossy().into_owned();
                    if CLEANUP_PREFIXES.iter().any(|p| n.starts_with(p)) {
                        try_remove_file(&e.path(), &mut errors);
                    }
                }
            }
            Err(e) if folder.exists() => {
                errors.push(format!("{}: {e}", folder.display()));
            }
            Err(_) => { /* folder never existed - nothing to clean up */ }
        }
    }
    errors
}

/// DANGER ZONE: remove Remi's data from this machine, then quit.
/// `keep_history` leaves the state files so a reinstall can recover them.
///
/// Reports every deletion failure rather than swallowing it - a privacy
/// wipe that silently leaves files behind is worse than one that is honest
/// about what it couldn't remove.
///
/// The app does NOT exit before a failure can be communicated: `app.exit`
/// tears the process down, and an IPC response racing that teardown is not
/// a reliable way for the frontend to learn what went wrong. On failure,
/// `UNINSTALLING` is reset so the app resumes normal saves and stays open
/// - the caller sees the complete error and the user can retry, check
/// permissions, or free up disk space. Only a genuinely clean wipe exits.
#[tauri::command]
pub async fn reset_and_uninstall_app(app: AppHandle, keep_history: bool) -> Result<(), String> {
    // Latch FIRST so any save already queued in either webview is rejected
    // instead of recreating what we are about to delete.
    UNINSTALLING.store(true, Ordering::SeqCst);

    let errors = uninstall_data(&data_folder(), &settings_path(), keep_history);
    if errors.is_empty() {
        app.exit(0);
        Ok(())
    } else {
        // Un-latch: nothing was destroyed beyond what actually got
        // deleted, so normal operation (including saves) may resume.
        UNINSTALLING.store(false, Ordering::SeqCst);
        Err(format!(
            "Some files couldn't be removed: {}",
            errors.join("; ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::tempdir;

    #[test]
    fn export_name_cannot_escape_the_data_folder() {
        let safe = Path::new("../../escape.json").file_name().unwrap();
        assert_eq!(safe, std::ffi::OsStr::new("escape.json"));
    }

    #[test]
    fn uninstall_reports_no_errors_on_a_clean_wipe() {
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json");
        std::fs::write(&settings, "{}").unwrap();
        std::fs::write(state_path(d.path()), "{}").unwrap();
        std::fs::write(backup_path(d.path()), "{}").unwrap();

        let errors = uninstall_data(d.path(), &settings, false);
        assert!(
            errors.is_empty(),
            "clean wipe must report no errors: {errors:?}"
        );
        assert!(!state_path(d.path()).exists());
        assert!(!settings.exists());
    }

    #[test]
    fn uninstall_does_not_error_on_files_that_never_existed() {
        // A fresh install with no `.bak`/recovery folder yet must not be
        // reported as a failed uninstall.
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json"); // never created
        let errors = uninstall_data(d.path(), &settings, false);
        assert!(
            errors.is_empty(),
            "missing files are not failures: {errors:?}"
        );
    }

    #[test]
    fn uninstall_keep_history_preserves_state_and_backup() {
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json");
        std::fs::write(&settings, "{}").unwrap();
        std::fs::write(state_path(d.path()), "{}").unwrap();

        let errors = uninstall_data(d.path(), &settings, true);
        assert!(errors.is_empty());
        assert!(
            state_path(d.path()).exists(),
            "keep_history must preserve state.json"
        );
        assert!(!settings.exists(), "settings.json is always removed");
    }

    #[test]
    fn uninstall_removes_exported_backups_and_stale_temp_files() {
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json");
        std::fs::write(d.path().join("remi-backup-2026-01-01.json"), "{}").unwrap();
        std::fs::write(d.path().join(".state.json.tmp1234-0"), "{}").unwrap();

        uninstall_data(d.path(), &settings, false);
        assert!(!d.path().join("remi-backup-2026-01-01.json").exists());
        assert!(!d.path().join(".state.json.tmp1234-0").exists());
    }

    #[test]
    fn uninstall_reports_a_real_failure_instead_of_silently_succeeding() {
        // The bug this guards: every deletion used to be `let _ = ...`,
        // discarding real failures (permission denied, I/O error) and
        // always reporting success for a privacy-sensitive wipe operation.
        let d = tempdir().unwrap();
        // Make the settings path a DIRECTORY, not a file - `remove_file` on
        // it will genuinely fail, and unlike a missing file, it still
        // exists afterward.
        let settings = d.path().join("settings.json");
        std::fs::create_dir_all(&settings).unwrap();

        let errors = uninstall_data(d.path(), &settings, true);
        assert!(
            !errors.is_empty(),
            "a real removal failure must be reported"
        );
        assert!(settings.exists(), "the failed path must still be there");
    }

    #[test]
    fn uninstall_removes_usage_log_exports_too() {
        // The bug this guards: only remi-backup-* and .state.json.tmp*
        // were cleaned up; remi-usage-*.json (the opt-in usage-log
        // export, see store/telemetry.ts's exportLogs) was left behind by
        // "remove everything".
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json");
        std::fs::write(d.path().join("remi-usage-2026-01-01.json"), "{}").unwrap();

        uninstall_data(d.path(), &settings, false);
        assert!(!d.path().join("remi-usage-2026-01-01.json").exists());
    }

    #[test]
    fn uninstall_removes_stale_settings_temp_files_too() {
        // settings.rs's write_settings_at names its temp files
        // `.<filename>.tmp{pid}-{seq}` - for settings.json specifically
        // that is `.settings.json.tmp...`, a DIFFERENT prefix than
        // state.json's temp files. Both must be swept.
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json");
        std::fs::write(d.path().join(".settings.json.tmp1234-0"), "{}").unwrap();

        uninstall_data(d.path(), &settings, false);
        assert!(!d.path().join(".settings.json.tmp1234-0").exists());
    }

    #[test]
    fn uninstall_preserves_unrelated_files_in_the_data_folder() {
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json");
        std::fs::write(d.path().join("my-notes.txt"), "not Remi's").unwrap();
        std::fs::write(d.path().join("remi-backup-2026-01-01.json"), "{}").unwrap();

        uninstall_data(d.path(), &settings, false);
        assert!(
            d.path().join("my-notes.txt").exists(),
            "unrelated files must survive a wipe"
        );
        assert!(!d.path().join("remi-backup-2026-01-01.json").exists());
    }

    #[test]
    fn uninstall_reports_a_failure_to_enumerate_the_data_folder_rather_than_silently_skipping_it() {
        // The bug this guards: `if let Ok(entries) = fs::read_dir(folder)`
        // silently did nothing on Err, so exported backups/usage logs in a
        // folder that EXISTS but genuinely can't be enumerated (permission
        // race, a removable volume unmounting) would be reported as a
        // CLEAN wipe even though nothing inside was ever checked. A folder
        // that never existed at all (fresh install) is the DIFFERENT,
        // non-error case - see the "never existed" test above.
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json");
        // A path that EXISTS but is a FILE, not a directory, exists() ==
        // true yet read_dir() genuinely fails on it - a stand-in for a
        // real enumerate failure without depending on platform-specific
        // permission behavior.
        let not_a_directory = d.path().join("data-folder-is-actually-a-file");
        std::fs::write(&not_a_directory, "oops").unwrap();

        let errors = uninstall_data(&not_a_directory, &settings, false);
        assert!(
            !errors.is_empty(),
            "a folder that exists but cannot be enumerated must be reported as a failure, not a clean wipe"
        );
    }

    #[cfg(unix)]
    #[test]
    fn uninstall_never_follows_a_symlink_out_of_the_data_folder() {
        // A symlink INSIDE the data folder that points OUTSIDE it must
        // never cause recursive deletion to reach outside the intended
        // directory. `recovery_dir` is removed with `remove_dir_all`,
        // which on a symlink target removes the LINK itself, not what it
        // points to when the top-level entry passed to it is a symlink -
        // but if a symlink existed INSIDE the recovery dir pointing
        // elsewhere, remove_dir_all would follow it. Guard against that by
        // planting one and confirming the pointed-to file survives.
        use std::os::unix::fs::symlink;

        let d = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let canary = outside.path().join("do-not-delete.txt");
        std::fs::write(&canary, "safe").unwrap();

        let folder = d.path().join("data");
        std::fs::create_dir_all(recovery_dir(&folder)).unwrap();
        symlink(&canary, recovery_dir(&folder).join("escape-link")).unwrap();

        let settings = d.path().join("settings.json");
        uninstall_data(&folder, &settings, false);

        assert!(
            canary.exists(),
            "a symlink inside Remi's data must never cause deletion outside it"
        );
    }
}

//! COMMANDS - the IPC surface the Svelte frontend calls. 15 commands,
//! unchanged names and payload shapes from the transport packet.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::AppHandle;

use crate::migration::take_pending_message;
use crate::paths::{backup_path, data_folder, recovery_dir, settings_path, state_path};
use crate::settings::{patch_settings, read_settings};
use crate::state_io::{load_state, write_state, LoadResult};
use crate::tray::apply_tray_title;
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

#[tauri::command]
pub async fn save_app_state(state: serde_json::Value) -> Result<(), String> {
    if UNINSTALLING.load(Ordering::SeqCst) {
        return Ok(()); // going away; not an error the UI should shout about
    }
    let _guard = SAVE_LOCK.lock().map_err(|e| e.to_string())?;
    write_state(&data_folder(), &state)
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

/// The uninstall logic, parameterized over the data folder and settings
/// path so it is fully testable without touching real user data. Returns
/// the paths that failed to delete, if any - an empty vec means a clean
/// wipe.
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
        // Exported backups and stale temps are app-created too; "remove
        // everything" must not leave them behind.
        if let Ok(entries) = fs::read_dir(folder) {
            for e in entries.flatten() {
                let n = e.file_name().to_string_lossy().into_owned();
                if n.starts_with("remi-backup-") || n.starts_with(".state.json.tmp") {
                    try_remove_file(&e.path(), &mut errors);
                }
            }
        }
    }
    errors
}

/// DANGER ZONE: remove Remi's data from this machine, then quit.
/// `keep_history` leaves the state files so a reinstall can recover them.
///
/// Reports every deletion failure rather than swallowing it - a privacy
/// wipe that silently leaves files behind is worse than one that is honest
/// about what it couldn't remove. Still exits even on partial failure
/// (there is no good "undo" state to leave the app in), but the caller
/// gets to know.
#[tauri::command]
pub async fn reset_and_uninstall_app(app: AppHandle, keep_history: bool) -> Result<(), String> {
    // Latch FIRST so any save already queued in either webview is rejected
    // instead of recreating what we are about to delete.
    UNINSTALLING.store(true, Ordering::SeqCst);

    let errors = uninstall_data(&data_folder(), &settings_path(), keep_history);
    app.exit(0);
    if errors.is_empty() {
        Ok(())
    } else {
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
}

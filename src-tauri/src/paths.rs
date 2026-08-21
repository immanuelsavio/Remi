//! Where Remi's config and data live, and the legacy MVP locations migration
//! reads from. Rust treats state as opaque JSON; this module only resolves
//! paths.

use std::fs;
use std::path::PathBuf;

/// Bundle identifier - must match `tauri.conf.json`. Names the subfolder under
/// the OS config dir that holds `settings.json`.
pub const APP_IDENTIFIER: &str = "com.immanuelsavio.remi";

/// The legacy MVP identifier this build may migrate data from. Never written
/// to; only ever read during the one-time migration check.
pub const LEGACY_MVP_IDENTIFIER: &str = "com.dopamigo.mvp";

/// The separate, never-touched production identity. Migration must never
/// read from or write to this identifier or its data folder.
#[allow(dead_code)]
pub const LEGACY_PRODUCTION_IDENTIFIER: &str = "com.dopamigo.app";

/// Window labels, matching `tauri.conf.json`.
pub const POPOVER_LABEL: &str = "popover";
pub const DASHBOARD_LABEL: &str = "dashboard";

/// `settings.json` under the OS application-config dir for the given
/// identifier. Machine-local: never restored from a backup taken elsewhere.
pub fn settings_path_for(identifier: &str) -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(identifier)
        .join("settings.json")
}

pub fn settings_path() -> PathBuf {
    settings_path_for(APP_IDENTIFIER)
}

/// The data folder holding `state.json`. Defaults to `~/Remi`, overridable
/// via `dataFolder` in settings.
pub fn data_folder() -> PathBuf {
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
        .join("Remi")
}

/// The legacy MVP data folder (`~/Dopamigo MVP`), read-only migration source.
pub fn legacy_mvp_data_folder() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Dopamigo MVP")
}

pub fn state_path(folder: &std::path::Path) -> PathBuf {
    folder.join("state.json")
}
pub fn backup_path(folder: &std::path::Path) -> PathBuf {
    folder.join("state.bak")
}
/// Where automatic snapshots live.
///
/// Inside the data folder on purpose: both non-destructive uninstall paths
/// (the shell uninstaller without `--purge`, and "keep my history" in the
/// app) leave that folder alone, so the snapshots survive exactly the
/// accident they exist for. "Delete everything" removes this too.
pub fn autobackup_dir(folder: &std::path::Path) -> PathBuf {
    folder.join("backups")
}

pub fn recovery_dir(folder: &std::path::Path) -> PathBuf {
    folder.join("Remi Recovery")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_paths_are_isolated_from_the_production_app() {
        assert_eq!(APP_IDENTIFIER, "com.immanuelsavio.remi");
        assert!(settings_path()
            .to_string_lossy()
            .contains("com.immanuelsavio.remi"));
        assert!(data_folder().ends_with("Remi"));
    }

    #[test]
    fn legacy_identifiers_are_distinct_from_current_and_production() {
        assert_ne!(LEGACY_MVP_IDENTIFIER, APP_IDENTIFIER);
        assert_ne!(LEGACY_MVP_IDENTIFIER, LEGACY_PRODUCTION_IDENTIFIER);
        assert!(legacy_mvp_data_folder().ends_with("Dopamigo MVP"));
    }
}

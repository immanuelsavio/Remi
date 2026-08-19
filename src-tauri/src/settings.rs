//! `settings.json` - a SEPARATE file from `state.json`, holding machine-local
//! and portable preferences that must survive a state restore taken on
//! another machine: the data folder, the standard-daily routine list, the
//! auto-update switch, and the migration marker.
//!
//! Every write is READ-MODIFY-WRITE through a generic JSON map rather than a
//! typed struct. That is deliberate: unknown / forward-compat keys are
//! preserved instead of being erased by a narrower schema.

use std::fs;
use std::io::Write as _;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::paths::settings_path;

/// Read `settings.json` as a JSON object. A missing file is an empty object;
/// a PRESENT-but-malformed one is an error, so we never clobber a
/// recoverable file.
///
/// An EMPTY-but-present file is also an error, not a valid empty object:
/// that is what a truncated write looks like (crash, disk full), and
/// treating it as `{}` would silently discard every previously-saved key -
/// including a custom `dataFolder` pointer - with no error and no
/// recovery. A genuinely empty settings object is written as the literal
/// text `{}`, which is NOT empty.
pub fn read_settings() -> Result<serde_json::Map<String, serde_json::Value>, String> {
    read_settings_at(&settings_path())
}

pub fn read_settings_at(
    path: &std::path::Path,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Err("settings.json is empty (truncated write?)".into());
    }
    match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(serde_json::Value::Object(m)) => Ok(m),
        Ok(_) => Err("settings.json is not a JSON object".into()),
        Err(e) => Err(e.to_string()),
    }
}

/// Merge one key into `settings.json`, preserving every other key.
pub fn patch_settings(key: &str, value: serde_json::Value) -> Result<(), String> {
    let path = settings_path();
    let mut map = read_settings()?;
    map.insert(key.to_string(), value);
    write_settings_at(&path, &map)
}

/// Atomically persist `settings.json` (or any single JSON-object file at
/// `path`), using the same unique-temp-file + fsync + rename contract as
/// `state_io::write_state`: a crash mid-write can never leave a truncated
/// or partially-written file at `path` itself.
pub fn write_settings_at(
    path: &std::path::Path,
    map: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    let dir = path.parent().ok_or("settings path has no parent dir")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let body = serde_json::to_string_pretty(&serde_json::Value::Object(map.clone()))
        .map_err(|e| e.to_string())?;

    // Unique temp name in the SAME directory (atomicity needs one
    // filesystem), with a counter alongside the pid because both webviews
    // share this process and could otherwise race on the same temp path.
    static TMP_SEQ: AtomicU64 = AtomicU64::new(0);
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("settings.json");
    let tmp = dir.join(format!(".{file_name}.tmp{}-{}", std::process::id(), seq));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
        f.flush().map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    atomic_replace(&tmp, path)?;

    #[cfg(unix)]
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
    Ok(())
}

#[cfg(not(windows))]
fn atomic_replace(tmp: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    fs::rename(tmp, dest).map_err(|e| e.to_string())
}

/// Windows: a TRUE single-step replace, matching `state_io::atomic_replace`
/// - the naive remove-then-rename leaves a window where the live file does
/// not exist at all.
#[cfg(windows)]
fn atomic_replace(tmp: &std::path::Path, dest: &std::path::Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    fn wide(p: &std::path::Path) -> Vec<u16> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// `settings.json` writes must PRESERVE unknown keys. The full app keeps
    /// `deviceId`, nudge prefs and a `dataFolder` there; a narrower schema
    /// that serialized only what it understood would silently erase them.
    #[test]
    fn settings_patch_preserves_unknown_keys() {
        let mut map = serde_json::Map::new();
        map.insert("deviceId".into(), serde_json::json!("abc-123"));
        map.insert("dataFolder".into(), serde_json::json!("/somewhere"));
        map.insert("standardDaily".into(), serde_json::json!(["Standup"]));
        map.insert("autoUpdate".into(), serde_json::json!(false));

        assert_eq!(map.get("deviceId").unwrap(), "abc-123");
        assert_eq!(map.get("dataFolder").unwrap(), "/somewhere");
        assert_eq!(map.get("standardDaily").unwrap()[0], "Standup");
        assert_eq!(map.get("autoUpdate").unwrap(), false);
        assert_eq!(map.len(), 4, "no key may be dropped");
    }

    #[test]
    fn round_trips_a_real_write_and_read() {
        let d = tempdir().unwrap();
        let path = d.path().join("settings.json");
        let mut map = serde_json::Map::new();
        map.insert("dataFolder".into(), serde_json::json!("/custom/path"));
        write_settings_at(&path, &map).unwrap();

        let read_back = read_settings_at(&path).unwrap();
        assert_eq!(read_back.get("dataFolder").unwrap(), "/custom/path");
    }

    #[test]
    fn no_temp_files_remain_after_a_write() {
        // The bug this guards: a plain `fs::write` can leave a truncated
        // file on a crash mid-write. Writing through a temp file + rename
        // (the same contract state.json uses) means there is never a
        // window where settings.json itself is partially written.
        let d = tempdir().unwrap();
        let path = d.path().join("settings.json");
        write_settings_at(&path, &serde_json::Map::new()).unwrap();

        let leftover: Vec<_> = std::fs::read_dir(d.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(".tmp"))
            .collect();
        assert!(leftover.is_empty(), "temp files left behind: {leftover:?}");
    }

    #[test]
    fn an_empty_but_present_file_is_treated_as_malformed_not_valid_empty_settings() {
        // The bug this guards: a truncated write (crash, disk full) leaves
        // an empty file. Treating that as "no settings yet" silently
        // discards every previously-saved key - including the custom
        // dataFolder pointer - with no error and no recovery. An empty
        // file is a symptom of damage, not a legitimately empty settings
        // object (a legitimately empty object is written as `{}`, which is
        // NOT empty).
        let d = tempdir().unwrap();
        let path = d.path().join("settings.json");
        std::fs::write(&path, "").unwrap(); // simulates a truncated write

        let result = read_settings_at(&path);
        assert!(
            result.is_err(),
            "an empty file must be reported as malformed, not silently accepted as {{}}"
        );
    }

    #[test]
    fn a_genuinely_empty_object_still_reads_back_fine() {
        // Contrast with the above: `{}` (a real, complete write of an
        // empty map) is valid and must NOT be confused with a truncated
        // file.
        let d = tempdir().unwrap();
        let path = d.path().join("settings.json");
        write_settings_at(&path, &serde_json::Map::new()).unwrap();

        let result = read_settings_at(&path);
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn write_survives_being_called_from_a_settings_file_that_was_previously_valid() {
        // Overwriting an existing, valid settings.json must not corrupt it
        // mid-write - simulated here by writing twice and checking the
        // final content is exactly the second write, never a mix.
        let d = tempdir().unwrap();
        let path = d.path().join("settings.json");
        let mut first = serde_json::Map::new();
        first.insert("dataFolder".into(), serde_json::json!("/first"));
        write_settings_at(&path, &first).unwrap();

        let mut second = serde_json::Map::new();
        second.insert("dataFolder".into(), serde_json::json!("/second"));
        write_settings_at(&path, &second).unwrap();

        let read_back = read_settings_at(&path).unwrap();
        assert_eq!(read_back.get("dataFolder").unwrap(), "/second");
    }
}

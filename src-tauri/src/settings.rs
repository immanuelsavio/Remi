//! `settings.json` - a SEPARATE file from `state.json`, holding machine-local
//! and portable preferences that must survive a state restore taken on
//! another machine: the data folder, the standard-daily routine list, the
//! auto-update switch, and the migration marker.
//!
//! Every write is READ-MODIFY-WRITE through a generic JSON map rather than a
//! typed struct. That is deliberate: unknown / forward-compat keys are
//! preserved instead of being erased by a narrower schema.

use std::fs;

use crate::paths::settings_path;

/// Read `settings.json` as a JSON object. A missing file is an empty object;
/// a PRESENT-but-malformed one is an error, so we never clobber a
/// recoverable file.
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
        return Ok(serde_json::Map::new());
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

pub fn write_settings_at(
    path: &std::path::Path,
    map: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(&serde_json::Value::Object(map.clone()))
        .map_err(|e| e.to_string())?;
    fs::write(path, body).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
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
}

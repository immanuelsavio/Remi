//! One-time, conservative migration from the legacy Dopamigo MVP identity
//! (`com.dopamigo.mvp`, `~/Dopamigo MVP`) to Remi (`com.immanuelsavio.remi`,
//! `~/Remi`).
//!
//! Rules (ADDENDUM):
//!   1. Never touch `com.dopamigo.app` / `~/Dopamigo` - a different,
//!      separate production identity.
//!   2. If Remi already has usable state, do nothing - never overwrite it.
//!   3. If Remi has no usable state and valid legacy MVP data exists, COPY
//!      (never move/delete) it into the Remi location.
//!   4. A malformed legacy live file with a valid legacy backup migrates the
//!      backup; a malformed live file with no valid backup migrates nothing.
//!   5. Settings migrate as an opaque JSON map so unknown keys survive.
//!   6. A migration marker in Remi's settings prevents repeat work.
//!   7. Uses the same atomic-write/durability path as normal state writes.

use std::sync::atomic::{AtomicBool, Ordering};

use crate::paths::{self, backup_path, state_path};
use crate::settings;
use crate::state_io::{try_read, write_state};

/// Non-sensitive marker key. Its presence means "the migration check has
/// already run", regardless of whether it found anything to copy.
const MIGRATION_MARKER_KEY: &str = "legacyMvpMigrationChecked";

/// Set for the remainder of THIS process's lifetime when startup migration
/// actually copied legacy data, so the next `load_app_state` call can surface
/// the one-time supportive message. Read-once: `take_pending_message` clears
/// it, so a later reload (e.g. cross-window sync) doesn't repeat the banner.
static MIGRATED_THIS_BOOT: AtomicBool = AtomicBool::new(false);

/// Consume the pending migration message, if any. Returns `Some` at most once
/// per process lifetime.
pub fn take_pending_message() -> Option<&'static str> {
    if MIGRATED_THIS_BOOT.swap(false, Ordering::SeqCst) {
        Some(migration_message())
    } else {
        None
    }
}

/// Outcome of a migration attempt, used to decide whether to show the
/// one-time supportive message.
#[derive(Debug, PartialEq, Eq)]
pub enum MigrationOutcome {
    /// Nothing to do: already checked, or Remi already has data, or no
    /// legacy data exists.
    NoOp,
    /// Legacy data was found valid and copied into the Remi location.
    Migrated,
}

/// Run the migration check against the real filesystem locations. Safe to
/// call on every boot - it is a no-op after the first successful check.
pub fn run_startup_migration() -> MigrationOutcome {
    let outcome = run_migration(
        &paths::data_folder(),
        &paths::legacy_mvp_data_folder(),
        &paths::settings_path(),
        &paths::settings_path_for(paths::LEGACY_MVP_IDENTIFIER),
    );
    if outcome == MigrationOutcome::Migrated {
        MIGRATED_THIS_BOOT.store(true, Ordering::SeqCst);
    }
    outcome
}

/// The migration logic, parameterized over paths so it is fully testable
/// with temp directories and never touches real user data in tests.
fn run_migration(
    remi_folder: &std::path::Path,
    legacy_folder: &std::path::Path,
    remi_settings_path: &std::path::Path,
    legacy_settings_path: &std::path::Path,
) -> MigrationOutcome {
    let remi_settings = settings::read_settings_at(remi_settings_path).unwrap_or_default();
    if remi_settings.contains_key(MIGRATION_MARKER_KEY) {
        return MigrationOutcome::NoOp;
    }

    // Rule 2: Remi already has usable state -> never overwrite, just mark
    // the check done and stop.
    let remi_has_state = try_read(&state_path(remi_folder)).unwrap_or(None).is_some();
    if remi_has_state {
        mark_checked(remi_settings_path);
        return MigrationOutcome::NoOp;
    }

    // Rule 3/4: find a valid legacy state, preferring the live file, falling
    // back to its own backup - the same recovery contract normal loads use.
    let legacy_state = match try_read(&state_path(legacy_folder)) {
        Ok(Some(v)) => Some(v),
        _ => try_read(&backup_path(legacy_folder)).ok().flatten(),
    };

    let Some(state) = legacy_state else {
        // No usable legacy data. Nothing to migrate, but the check is done.
        mark_checked(remi_settings_path);
        return MigrationOutcome::NoOp;
    };

    // Copy (never move) the state through the normal durable write path.
    if write_state(remi_folder, &state).is_err() {
        // Leave everything untouched on failure; do not mark as checked so
        // a future boot can retry.
        return MigrationOutcome::NoOp;
    }

    // Copy legacy settings as an opaque map, preserving unknown keys, minus
    // the identifiers/paths that must not leak across identities.
    if let Ok(legacy_settings) = settings::read_settings_at(legacy_settings_path) {
        let mut merged = legacy_settings;
        merged.remove("dataFolder"); // do not inherit the legacy path
        let _ = settings::write_settings_at(remi_settings_path, &merged);
    }

    mark_checked(remi_settings_path);
    MigrationOutcome::Migrated
}

fn mark_checked(remi_settings_path: &std::path::Path) {
    let mut map = settings::read_settings_at(remi_settings_path).unwrap_or_default();
    map.insert(MIGRATION_MARKER_KEY.into(), serde_json::json!(true));
    let _ = settings::write_settings_at(remi_settings_path, &map);
}

/// One-time supportive message shown after a successful migration. The only
/// acceptable user-facing use of the old product name.
pub fn migration_message() -> &'static str {
    "Your previous Dopamigo MVP data was copied into Remi. The original files were left untouched as a backup."
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn v(json: &str) -> serde_json::Value {
        serde_json::from_str(json).unwrap()
    }

    struct Fixture {
        _root: tempfile::TempDir,
        remi_folder: std::path::PathBuf,
        legacy_folder: std::path::PathBuf,
        remi_settings: std::path::PathBuf,
        legacy_settings: std::path::PathBuf,
    }

    fn fixture() -> Fixture {
        let root = tempdir().unwrap();
        let remi_folder = root.path().join("Remi");
        let legacy_folder = root.path().join("Dopamigo MVP");
        let remi_settings = root.path().join("remi-settings.json");
        let legacy_settings = root.path().join("legacy-settings.json");
        Fixture {
            _root: root,
            remi_folder,
            legacy_folder,
            remi_settings,
            legacy_settings,
        }
    }

    #[test]
    fn no_legacy_and_no_remi_data_is_a_noop() {
        let f = fixture();
        let outcome = run_migration(
            &f.remi_folder,
            &f.legacy_folder,
            &f.remi_settings,
            &f.legacy_settings,
        );
        assert_eq!(outcome, MigrationOutcome::NoOp);
        assert!(!state_path(&f.remi_folder).exists());
    }

    #[test]
    fn valid_legacy_data_with_empty_remi_destination_is_migrated() {
        let f = fixture();
        write_state(&f.legacy_folder, &v(r#"{"dayNum":5}"#)).unwrap();

        let outcome = run_migration(
            &f.remi_folder,
            &f.legacy_folder,
            &f.remi_settings,
            &f.legacy_settings,
        );
        assert_eq!(outcome, MigrationOutcome::Migrated);
        let migrated = try_read(&state_path(&f.remi_folder)).unwrap().unwrap();
        assert_eq!(migrated["dayNum"], 5);
    }

    #[test]
    fn existing_remi_data_takes_precedence() {
        let f = fixture();
        write_state(&f.legacy_folder, &v(r#"{"dayNum":5}"#)).unwrap();
        write_state(&f.remi_folder, &v(r#"{"dayNum":99}"#)).unwrap();

        let outcome = run_migration(
            &f.remi_folder,
            &f.legacy_folder,
            &f.remi_settings,
            &f.legacy_settings,
        );
        assert_eq!(outcome, MigrationOutcome::NoOp);
        let state = try_read(&state_path(&f.remi_folder)).unwrap().unwrap();
        assert_eq!(
            state["dayNum"], 99,
            "Remi's own data must not be overwritten"
        );
    }

    #[test]
    fn both_locations_populated_leaves_legacy_untouched() {
        let f = fixture();
        write_state(&f.legacy_folder, &v(r#"{"dayNum":5}"#)).unwrap();
        write_state(&f.remi_folder, &v(r#"{"dayNum":99}"#)).unwrap();
        let legacy_before = fs::read_to_string(state_path(&f.legacy_folder)).unwrap();

        run_migration(
            &f.remi_folder,
            &f.legacy_folder,
            &f.remi_settings,
            &f.legacy_settings,
        );

        let legacy_after = fs::read_to_string(state_path(&f.legacy_folder)).unwrap();
        assert_eq!(legacy_before, legacy_after, "legacy file must be untouched");
    }

    #[test]
    fn malformed_legacy_live_with_valid_backup_migrates_the_backup() {
        let f = fixture();
        write_state(&f.legacy_folder, &v(r#"{"dayNum":7}"#)).unwrap(); // seeds .bak
        fs::write(state_path(&f.legacy_folder), "{ not json").unwrap();

        let outcome = run_migration(
            &f.remi_folder,
            &f.legacy_folder,
            &f.remi_settings,
            &f.legacy_settings,
        );
        assert_eq!(outcome, MigrationOutcome::Migrated);
        let migrated = try_read(&state_path(&f.remi_folder)).unwrap().unwrap();
        assert_eq!(migrated["dayNum"], 7);
        // The malformed legacy file itself must be left exactly as it was.
        assert_eq!(
            fs::read_to_string(state_path(&f.legacy_folder)).unwrap(),
            "{ not json"
        );
    }

    #[test]
    fn malformed_legacy_live_and_malformed_backup_migrates_nothing() {
        let f = fixture();
        fs::create_dir_all(&f.legacy_folder).unwrap();
        fs::write(state_path(&f.legacy_folder), "broken-live").unwrap();
        fs::write(backup_path(&f.legacy_folder), "broken-bak").unwrap();

        let outcome = run_migration(
            &f.remi_folder,
            &f.legacy_folder,
            &f.remi_settings,
            &f.legacy_settings,
        );
        assert_eq!(outcome, MigrationOutcome::NoOp);
        assert!(!state_path(&f.remi_folder).exists());
    }

    #[test]
    fn legacy_settings_retain_unknown_keys() {
        let f = fixture();
        write_state(&f.legacy_folder, &v(r#"{"dayNum":1}"#)).unwrap();
        let mut legacy_map = serde_json::Map::new();
        legacy_map.insert("deviceId".into(), serde_json::json!("legacy-device"));
        legacy_map.insert("standardDaily".into(), serde_json::json!(["Standup"]));
        legacy_map.insert("dataFolder".into(), serde_json::json!("/legacy/path"));
        settings::write_settings_at(&f.legacy_settings, &legacy_map).unwrap();

        run_migration(
            &f.remi_folder,
            &f.legacy_folder,
            &f.remi_settings,
            &f.legacy_settings,
        );

        let migrated = settings::read_settings_at(&f.remi_settings).unwrap();
        assert_eq!(migrated.get("deviceId").unwrap(), "legacy-device");
        assert_eq!(migrated.get("standardDaily").unwrap()[0], "Standup");
        assert!(
            !migrated.contains_key("dataFolder"),
            "must not inherit the legacy path onto Remi's own settings"
        );
    }

    #[test]
    fn migration_copies_instead_of_moving() {
        let f = fixture();
        write_state(&f.legacy_folder, &v(r#"{"dayNum":3}"#)).unwrap();

        run_migration(
            &f.remi_folder,
            &f.legacy_folder,
            &f.remi_settings,
            &f.legacy_settings,
        );

        assert!(
            state_path(&f.legacy_folder).exists(),
            "legacy file must still exist after migration"
        );
        assert!(state_path(&f.remi_folder).exists());
    }

    #[test]
    fn migration_never_touches_the_production_identity_paths() {
        // The production paths are compile-time constants, never passed into
        // `run_migration` at all - this asserts that invariant statically.
        assert_eq!(paths::LEGACY_PRODUCTION_IDENTIFIER, "com.dopamigo.app");
        assert_ne!(
            paths::LEGACY_MVP_IDENTIFIER,
            paths::LEGACY_PRODUCTION_IDENTIFIER
        );
    }

    #[test]
    fn migration_marker_prevents_repeat_work() {
        let f = fixture();
        write_state(&f.legacy_folder, &v(r#"{"dayNum":3}"#)).unwrap();

        let first = run_migration(
            &f.remi_folder,
            &f.legacy_folder,
            &f.remi_settings,
            &f.legacy_settings,
        );
        assert_eq!(first, MigrationOutcome::Migrated);

        // Simulate the user deleting the migrated state, then rebooting.
        fs::remove_file(state_path(&f.remi_folder)).unwrap();
        let second = run_migration(
            &f.remi_folder,
            &f.legacy_folder,
            &f.remi_settings,
            &f.legacy_settings,
        );
        assert_eq!(
            second,
            MigrationOutcome::NoOp,
            "marker must prevent re-migrating on a later boot"
        );
        assert!(!state_path(&f.remi_folder).exists());
    }

    #[test]
    fn failure_during_migration_leaves_legacy_data_untouched_and_no_partial_remi_file() {
        let f = fixture();
        write_state(&f.legacy_folder, &v(r#"{"dayNum":3}"#)).unwrap();
        // Make the Remi destination unwritable by pointing it at a path whose
        // parent is a file, not a directory - `write_state` will fail.
        let blocked_parent = f._root.path().join("blocked");
        fs::write(&blocked_parent, "not a directory").unwrap();
        let unwritable_remi_folder = blocked_parent.join("Remi");

        let outcome = run_migration(
            &unwritable_remi_folder,
            &f.legacy_folder,
            &f.remi_settings,
            &f.legacy_settings,
        );
        assert_eq!(outcome, MigrationOutcome::NoOp);
        assert!(
            state_path(&f.legacy_folder).exists(),
            "legacy data must survive a failed migration"
        );
        assert!(!state_path(&unwritable_remi_folder).exists());
    }
}

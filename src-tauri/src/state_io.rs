//! STATE I/O - the durability contract.
//!
//! Rules, in priority order:
//!   1. A malformed file is NEVER deleted or overwritten. It is copied into a
//!      timestamped recovery folder so the user can still get their data back.
//!   2. Writes are atomic: unique same-directory temp -> flush -> fsync ->
//!      rename, then fsync the parent dir so the rename itself is durable.
//!   3. A `.bak` of the last-known-GOOD file is taken before each overwrite,
//!      and is actually read back on a bad load.
//!
//! Load outcomes are explicit so the UI can be honest rather than silently
//! starting empty: fresh | loaded | recovered | damaged.

use std::fs;
use std::io::Write as _;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::paths::{backup_path, recovery_dir, state_path};

/// How a load resolved. `state` is `None` for `fresh` and `damaged`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadResult {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub paths: Vec<String>,
}

/// Read + parse a JSON file. `Ok(None)` when it does not exist.
///
/// An EMPTY file is deliberately an error, not an empty object: that is what a
/// truncated write looks like, and treating it as `{}` would silently discard
/// a day's work instead of recovering the `.bak`.
pub fn try_read(path: &Path) -> Result<Option<serde_json::Value>, String> {
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

/// Copy a file into the recovery folder. Best-effort: failing to make the
/// copy must not stop us surfacing the damage to the user.
fn copy_into_recovery(folder: &Path, src: &Path, stamp: &str) -> Option<std::path::PathBuf> {
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
pub fn load_state(folder: &Path) -> LoadResult {
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
                        "Today's file was missing, so Remi restored your last backup.".into(),
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
                            "Today's file couldn't be read ({live_err}), so Remi restored your last backup.{note}"
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
                            "Remi couldn't read today's file or its backup ({live_err}). \
                             Nothing was changed or deleted; copies are in the recovery folder."
                        )),
                        paths,
                    }
                }
            }
        }
    }
}

/// Read the `_rev` field out of a state JSON value, defaulting to 0 for a
/// file written before this field existed.
fn rev_of(v: &serde_json::Value) -> u64 {
    v.get("_rev").and_then(|r| r.as_u64()).unwrap_or(0)
}

/// Outcome of a compare-and-swap write attempt.
#[derive(Debug, PartialEq, Eq)]
pub enum CasOutcome {
    /// Written successfully; carries the new revision now on disk.
    Written(u64),
    /// The caller's `expected_rev` did not match what's currently on disk -
    /// SOMEONE ELSE (the other window) wrote a newer revision first. The
    /// write is rejected rather than silently overwriting their change;
    /// carries the actual current revision so the caller can reload and
    /// retry from a known-good baseline.
    Stale { current_rev: u64 },
}

/// Compare-and-swap write: only persists `state` if the revision currently
/// on disk matches `expected_rev` (or there is no file yet, for a first
/// write). This is the cross-window lost-update guard: two windows each
/// hold an independent in-memory store, and without this a stale whole-
/// state snapshot saved by one window could silently clobber a newer edit
/// the other window already persisted. `_rev` is stamped into the written
/// JSON, bumped by exactly one from `expected_rev`.
///
/// Race-free in practice because every `save_app_state` call (both
/// windows, one process) is serialized by `commands::SAVE_LOCK` - the
/// read-compare-write here never interleaves with another write.
pub fn write_state_cas(
    folder: &Path,
    state: &serde_json::Value,
    expected_rev: u64,
) -> Result<CasOutcome, String> {
    let dest = state_path(folder);
    let current_rev = match try_read(&dest) {
        Ok(Some(existing)) => rev_of(&existing),
        // No file yet, or the live file is malformed (the LOAD path is
        // what surfaces malformed-file recovery to the user; a save
        // shouldn't itself get stuck deciding what a broken file's
        // revision "really" was) - treat as revision 0, matching a fresh
        // frontend's starting expectation.
        Ok(None) | Err(_) => 0,
    };
    if expected_rev != current_rev {
        return Ok(CasOutcome::Stale { current_rev });
    }
    let next_rev = current_rev + 1;
    let mut stamped = state.clone();
    if let serde_json::Value::Object(map) = &mut stamped {
        map.insert("_rev".into(), serde_json::json!(next_rev));
    }
    write_state(folder, &stamped)?;
    Ok(CasOutcome::Written(next_rev))
}

/// Atomically persist the state (see the STATE I/O contract above).
pub fn write_state(folder: &Path, state: &serde_json::Value) -> Result<(), String> {
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
/// window where the live file does not exist at all, so a crash there loses
/// the data even though it was safely written.
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::recovery_dir;
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

    #[test]
    fn cas_first_write_at_revision_zero_succeeds_and_stamps_rev_one() {
        let d = tempdir().unwrap();
        let outcome = write_state_cas(d.path(), &v(r#"{"dayNum":1}"#), 0).unwrap();
        assert_eq!(outcome, CasOutcome::Written(1));
        let on_disk = load_state(d.path()).state.unwrap();
        assert_eq!(on_disk["_rev"], 1);
    }

    #[test]
    fn cas_write_matching_the_current_revision_succeeds_and_advances_it() {
        let d = tempdir().unwrap();
        write_state_cas(d.path(), &v(r#"{"dayNum":1}"#), 0).unwrap(); // rev -> 1
        let outcome = write_state_cas(d.path(), &v(r#"{"dayNum":2}"#), 1).unwrap();
        assert_eq!(outcome, CasOutcome::Written(2));
    }

    #[test]
    fn cas_rejects_a_stale_write_instead_of_silently_overwriting() {
        // The bug this guards: two independent windows, each with their
        // own in-memory store, could both save a full-state snapshot -
        // the second one landing would silently discard whatever the
        // first one persisted, with no way to tell it happened.
        let d = tempdir().unwrap();
        write_state_cas(d.path(), &v(r#"{"dayNum":1}"#), 0).unwrap(); // rev -> 1 (window A)
        write_state_cas(d.path(), &v(r#"{"dayNum":2}"#), 1).unwrap(); // rev -> 2 (window A again)

        // Window B still thinks the revision is 1 (its last known-good
        // load) and tries to save its own edit on top of that stale view.
        let outcome = write_state_cas(d.path(), &v(r#"{"dayNum":99}"#), 1).unwrap();
        assert_eq!(outcome, CasOutcome::Stale { current_rev: 2 });

        // Window A's dayNum:2 must be UNTOUCHED - not silently overwritten
        // by window B's stale dayNum:99.
        let on_disk = load_state(d.path()).state.unwrap();
        assert_eq!(on_disk["dayNum"], 2);
    }

    #[test]
    fn cas_retry_after_reloading_the_current_revision_succeeds() {
        let d = tempdir().unwrap();
        write_state_cas(d.path(), &v(r#"{"dayNum":1}"#), 0).unwrap(); // rev -> 1

        // A stale attempt is rejected...
        let stale = write_state_cas(d.path(), &v(r#"{"dayNum":99}"#), 0).unwrap();
        let CasOutcome::Stale { current_rev } = stale else {
            panic!("expected Stale");
        };

        // ...but retrying with the ACTUAL current revision succeeds.
        let retried = write_state_cas(d.path(), &v(r#"{"dayNum":99}"#), current_rev).unwrap();
        assert_eq!(retried, CasOutcome::Written(current_rev + 1));
        assert_eq!(load_state(d.path()).state.unwrap()["dayNum"], 99);
    }

    #[test]
    fn cas_treats_a_missing_file_as_revision_zero() {
        let d = tempdir().unwrap();
        // No prior write at all - the file doesn't exist yet.
        let outcome = write_state_cas(d.path(), &v(r#"{"dayNum":1}"#), 0).unwrap();
        assert_eq!(outcome, CasOutcome::Written(1));
    }
}

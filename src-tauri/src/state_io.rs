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
    /// Written successfully: the new revision now on disk, plus any
    /// non-fatal warning worth telling the user about (a backup copy that
    /// could not be refreshed, say - the data landed, the safety net is
    /// thinner than promised, and silence about that is how the promise
    /// became false).
    Written(u64, Option<String>),
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
    over_malformed: bool,
) -> Result<CasOutcome, String> {
    let dest = state_path(folder);
    let current_rev = match try_read(&dest) {
        Ok(Some(existing)) => rev_of(&existing),
        // No file yet: revision 0, matching a fresh frontend.
        Ok(None) => 0,
        // MALFORMED. This used to be revision 0 as well, and that was a
        // hole big enough to lose a day through: a frontend that has just
        // shown the recovery screen also sits at `_rev: 0`, so the
        // compare-and-swap MATCHED and an ordinary background save wrote a
        // blank day straight over the file the user was being told had
        // been preserved.
        //
        // An ordinary save is now refused outright. `over_malformed` is
        // for the one caller that genuinely means it - restoring a backup,
        // which is the whole way out of this state - and nothing else may
        // pass it.
        Err(e) => {
            if !over_malformed {
                return Err(format!(
                    "refusing to save over an unreadable state file ({e}) - restore a backup, \
                     or move the file aside first"
                ));
            }
            0
        }
    };
    if expected_rev != current_rev {
        return Ok(CasOutcome::Stale { current_rev });
    }
    let next_rev = current_rev + 1;
    let mut stamped = state.clone();
    if let serde_json::Value::Object(map) = &mut stamped {
        map.insert("_rev".into(), serde_json::json!(next_rev));
    }
    let warning = write_state_reporting(folder, &stamped)?;
    Ok(CasOutcome::Written(next_rev, warning))
}

/// Atomically persist the state (see the STATE I/O contract above).
pub fn write_state(folder: &Path, state: &serde_json::Value) -> Result<(), String> {
    write_state_reporting(folder, state).map(|_| ())
}

/// `write_state`, plus any non-fatal warning worth telling the user about.
pub fn write_state_reporting(
    folder: &Path,
    state: &serde_json::Value,
) -> Result<Option<String>, String> {
    let mut warning: Option<String> = None;
    fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    let dest = state_path(folder);
    let body = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;

    match try_read(&dest) {
        // Back up the prior GOOD file.
        //
        // A failure here was silently ignored, immediately before replacing
        // the only good copy that existed - so the documented promise ("a
        // `.bak` of the last-known-good is kept") could quietly be false at
        // exactly the moment it mattered. One retry, then the failure is
        // REPORTED rather than swallowed.
        //
        // It does not abort the write. The live file is the user's current
        // work and getting it to disk matters more than the safety copy;
        // refusing to save because a backup failed would turn a degraded
        // backup into lost work. The caller surfaces the warning.
        Ok(Some(_)) => {
            if fs::copy(&dest, backup_path(folder)).is_err() {
                if let Err(e) = fs::copy(&dest, backup_path(folder)) {
                    warning = Some(format!(
                        "Saved, but couldn't refresh the backup copy: {e}. \
                         Your data is written; the safety copy may be older."
                    ));
                }
            }
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
    Ok(warning)
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
    fn a_backup_that_cannot_be_refreshed_is_reported_but_does_not_block_the_save() {
        // The durability doc promises a `.bak` of the last-known-good. A
        // failed copy was silently ignored, immediately before replacing
        // the only good copy - so the promise could be false at exactly
        // the moment it mattered, with nobody told.
        let d = tempdir().unwrap();
        write_state(d.path(), &v(r#"{"dayNum":1}"#)).unwrap();

        // Make the backup path un-writable by putting a DIRECTORY there.
        let bak = backup_path(d.path());
        fs::remove_file(&bak).ok();
        fs::create_dir_all(&bak).unwrap();

        let warning = write_state_reporting(d.path(), &v(r#"{"dayNum":2}"#)).unwrap();
        assert!(warning.is_some(), "a failed backup must be reported");
        // ...and the user's actual work still landed. Refusing to save
        // because a backup failed turns a thin safety net into lost work.
        assert_eq!(load_state(d.path()).state.unwrap()["dayNum"], 2);
    }

    #[test]
    fn an_ordinary_save_is_refused_over_an_unreadable_file() {
        // THE HOLE. A malformed live file used to read as revision 0, and a
        // frontend that has just shown the recovery screen also sits at
        // revision 0 - so the compare-and-swap matched and a routine
        // background save wrote a blank day over the file the user had just
        // been told was preserved.
        let d = tempdir().unwrap();
        fs::create_dir_all(d.path()).unwrap();
        fs::write(state_path(d.path()), "{not json at all").unwrap();

        let err = write_state_cas(d.path(), &v(r#"{"dayNum":1}"#), 0, false).unwrap_err();
        assert!(err.contains("refusing to save"), "got: {err}");
        // Untouched, byte for byte.
        assert_eq!(
            fs::read_to_string(state_path(d.path())).unwrap(),
            "{not json at all"
        );
    }

    #[test]
    fn restoring_a_backup_may_deliberately_overwrite_an_unreadable_file() {
        // The way OUT of that state. Refusing here too would leave the user
        // stuck with a broken file and no in-app route past it.
        let d = tempdir().unwrap();
        fs::write(state_path(d.path()), "{not json at all").unwrap();

        let outcome = write_state_cas(d.path(), &v(r#"{"dayNum":7}"#), 0, true).unwrap();
        assert!(matches!(outcome, CasOutcome::Written(1, _)));
        assert_eq!(load_state(d.path()).state.unwrap()["dayNum"], 7);
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
        let outcome = write_state_cas(d.path(), &v(r#"{"dayNum":1}"#), 0, false).unwrap();
        assert!(matches!(outcome, CasOutcome::Written(1, _)));
        let on_disk = load_state(d.path()).state.unwrap();
        assert_eq!(on_disk["_rev"], 1);
    }

    #[test]
    fn cas_write_matching_the_current_revision_succeeds_and_advances_it() {
        let d = tempdir().unwrap();
        write_state_cas(d.path(), &v(r#"{"dayNum":1}"#), 0, false).unwrap(); // rev -> 1
        let outcome = write_state_cas(d.path(), &v(r#"{"dayNum":2}"#), 1, false).unwrap();
        assert!(matches!(outcome, CasOutcome::Written(2, _)));
    }

    #[test]
    fn cas_rejects_a_stale_write_instead_of_silently_overwriting() {
        // The bug this guards: two independent windows, each with their
        // own in-memory store, could both save a full-state snapshot -
        // the second one landing would silently discard whatever the
        // first one persisted, with no way to tell it happened.
        let d = tempdir().unwrap();
        write_state_cas(d.path(), &v(r#"{"dayNum":1}"#), 0, false).unwrap(); // rev -> 1 (window A)
        write_state_cas(d.path(), &v(r#"{"dayNum":2}"#), 1, false).unwrap(); // rev -> 2 (window A again)

        // Window B still thinks the revision is 1 (its last known-good
        // load) and tries to save its own edit on top of that stale view.
        let outcome = write_state_cas(d.path(), &v(r#"{"dayNum":99}"#), 1, false).unwrap();
        assert_eq!(outcome, CasOutcome::Stale { current_rev: 2 });

        // Window A's dayNum:2 must be UNTOUCHED - not silently overwritten
        // by window B's stale dayNum:99.
        let on_disk = load_state(d.path()).state.unwrap();
        assert_eq!(on_disk["dayNum"], 2);
    }

    #[test]
    fn cas_retry_after_reloading_the_current_revision_succeeds() {
        let d = tempdir().unwrap();
        write_state_cas(d.path(), &v(r#"{"dayNum":1}"#), 0, false).unwrap(); // rev -> 1

        // A stale attempt is rejected...
        let stale = write_state_cas(d.path(), &v(r#"{"dayNum":99}"#), 0, false).unwrap();
        let CasOutcome::Stale { current_rev } = stale else {
            panic!("expected Stale");
        };

        // ...but retrying with the ACTUAL current revision succeeds.
        let retried =
            write_state_cas(d.path(), &v(r#"{"dayNum":99}"#), current_rev, false).unwrap();
        assert!(matches!(retried, CasOutcome::Written(r, _) if r == current_rev + 1));
        assert_eq!(load_state(d.path()).state.unwrap()["dayNum"], 99);
    }

    #[test]
    fn cas_treats_a_missing_file_as_revision_zero() {
        let d = tempdir().unwrap();
        // No prior write at all - the file doesn't exist yet.
        let outcome = write_state_cas(d.path(), &v(r#"{"dayNum":1}"#), 0, false).unwrap();
        assert!(matches!(outcome, CasOutcome::Written(1, _)));
    }
}

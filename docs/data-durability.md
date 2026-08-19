# Data durability

Four rules, in priority order. Rule 1 outranks everything. Implemented in
`src-tauri/src/state_io.rs`.

1. **A malformed file is NEVER deleted or overwritten.** It is _copied_
   into a timestamped recovery folder, and the UI shows an honest recovery
   screen. A blank day would read as "all my work vanished".
2. **Writes are atomic:** unique same-directory temp → `write` → `flush` →
   `sync_all` → rename → **fsync the parent dir** so the rename itself is
   durable. The temp name includes pid _and_ a counter, because both
   webviews share one process and two concurrent saves would otherwise
   pick the same path.
3. **A `.bak` of the last-known-GOOD file** is taken before each
   overwrite, and is actually _read back_ on a bad load. A corrupt live
   file never becomes the backup. The first write seeds `.bak` too, so
   corruption before the second save is still recoverable.
4. **Load outcomes are explicit:** `fresh | loaded | recovered | damaged`.
   An **empty file is malformed**, not `{}` — that's what a truncated
   write looks like, and treating it as an empty object silently loses
   the day.

On Windows, `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)` gives a true
single-step replace. The naive remove-then-rename leaves a window where
the live file doesn't exist at all — a crash there loses data that was
already safely written.

`hydrate()` (`src/domain/hydration.ts`) is the frontend half of the same
paranoia. Every value off disk is coerced, clamped or dropped:

- a bare string in `mains` is **not** a task (`filter(Boolean)` is not
  enough — a truthy string would survive as a phantom "Untitled")
- a reminder with no usable `at` is dropped
- a session pointing at a missing or done task is cleared
- a return-stack entry whose target is gone is dropped
- a history record with no `dateISO` is discarded
- missing notification prefs default **ON** — absent must not read as
  "the user turned this off" — but `privateNotifications` defaults
  **OFF**, since it changes what banners say

`settings.json` is a **separate file**, read-modify-written through a
generic JSON map (`src-tauri/src/settings.rs`), never a typed struct — so
unknown and forward-compat keys always survive a write. It shares the same
atomic-write contract as `state.json` (unique temp file, fsync, rename)
and the same empty-file-is-malformed rule, so a crash mid-write can't
truncate it and silently drop the custom `dataFolder` pointer.

## Legacy Dopamigo MVP → Remi migration

Implemented in `src-tauri/src/migration.rs`, run once at startup
(`run_startup_migration`, called from `main.rs`'s `setup` hook).

**Identities involved:**

|                                   | Identifier               | Data folder      |
| --------------------------------- | ------------------------ | ---------------- |
| Remi (current)                    | `com.immanuelsavio.remi` | `~/Remi`         |
| Legacy MVP (migration source)     | `com.dopamigo.mvp`       | `~/Dopamigo MVP` |
| Legacy production (never touched) | `com.dopamigo.app`       | `~/Dopamigo`     |

**Rules:**

1. Never read from or write to `com.dopamigo.app` / `~/Dopamigo` — a
   separate, unrelated production app.
2. If Remi already has usable state, migration is a no-op — never
   overwrite it.
3. If Remi has no usable state and valid legacy MVP data exists, **copy**
   (never move or delete) it into the Remi location.
4. A malformed legacy live file with a valid legacy backup migrates the
   backup; malformed live + no valid backup migrates nothing.
5. Settings migrate as an opaque JSON map, minus `dataFolder` (the legacy
   machine-local path must not leak onto Remi's own settings).
6. A marker (`legacyMvpMigrationChecked`) in Remi's settings prevents the
   check from repeating on every boot.
7. Uses the same atomic-write/durability path as normal state writes.
8. If both locations are populated, Remi's existing data wins and the
   legacy location is left untouched.

On a successful migration, the one-time supportive message rides the
`message` field of the next `load_app_state` response (see
`commands::load_app_state` and `migration::take_pending_message`):

> "Your previous Dopamigo MVP data was copied into Remi. The original
> files were left untouched as a backup."

This is the only acceptable user-facing use of the old product name.

Eleven deterministic tests cover this in `migration.rs`'s `#[cfg(test)]`
module, all using `tempfile::tempdir()` — none touch real home-directory
data:

- no legacy and no Remi data → no-op
- valid legacy data with empty Remi destination → migrated
- existing Remi data takes precedence → no-op, no overwrite
- both locations populated → legacy left untouched
- malformed legacy live + valid legacy backup → backup migrated, damaged
  file untouched
- malformed legacy live + malformed backup → no-op, nothing migrated
- legacy settings retain unknown keys, minus `dataFolder`
- migration copies, never moves (legacy file still exists after)
- migration never touches the production identity's paths
- the marker prevents repeat work on a later boot
- a failed migration (unwritable destination) leaves legacy data
  untouched and creates no partial Remi file

## Quit is a real persistence barrier

A save failure must never be allowed to quit silently. Two things make
this true, both in `src/store/persistence.ts`:

1. **`flushSave()` rejects on a real write failure** instead of catching
   the error and resolving as if nothing happened. `savedAt` is only
   mirrored into live state on success - a failed write must not make the
   app believe it saved. If a save is already in flight and a mutation
   arrives, the caller's promise resolves/rejects with the outcome of the
   QUEUED rewrite too, not just the attempt that happened to be running
   when they called - "everything currently pending" is the actual
   contract, not "whatever was already going".
2. **`requestQuit()` is the one shutdown sequence.** Both the dashboard's
   Quit button and the tray menu's `quit-requested` event funnel through
   it. It awaits `flushSave()` and only calls the `quit_app` command if
   that succeeds; on failure it rejects and the app stays open, with a
   toast showing the actual error, so the user can retry, export, or fix
   whatever's wrong. A second Quit press while one is already in flight
   observes the same in-progress attempt rather than starting a redundant
   second shutdown.

`window.addEventListener("beforeunload", ...)` (both windows) is
explicitly NOT this barrier - a webview cannot reliably await async work
before tearing down, so it is best-effort only, documented as such at the
call site.

### The tray-quit handshake

`tray.rs`'s `MENU_QUIT` handler does not sleep-then-exit (a fixed delay is
a guess against the frontend's debounce timer, and races a save that
hasn't landed). It also does not trust `app.emit(...).is_ok()` as proof
anyone received the event - that only means the emit call itself didn't
error.

Instead, `tray::QuitReadiness` is a real handshake flag. The frontend's
`registerQuitListener()` calls the `quit_listener_ready` command once its
`quit-requested` listener is actually registered (in `views/Popover.svelte`,
as early in boot as safely possible). Until that ack lands, `request_quit`
falls back to `app.exit(0)` directly - deliberately, because there is
genuinely nobody who could ever respond, not as a race against one who
might.

## Cross-window compare-and-swap (partial mitigation, not a full redesign)

Each webview holds an independent in-memory store (see
`docs/architecture.md`). Without protection, a stale whole-state snapshot
saved by one window (a popover reminder firing, a checkpoint) could
silently overwrite a newer edit the other window already persisted - the
second write wins, with no signal that anything was lost.

`_rev` (`src/domain/types.ts`) is a revision counter carried inside the
persisted state itself. `save_app_state` (`src-tauri/src/commands.rs`,
`state_io::write_state_cas`) is a compare-and-swap: it only writes if the
caller's `_rev` matches what's currently on disk, and bumps it by exactly
one on success. A mismatch means the OTHER window saved a newer revision
first - Rust rejects the write (`{ stale: true, currentRev }`) rather than
applying it, and the frontend (`flushSave` in `store/persistence.ts`)
reloads the current on-disk state instead of losing either side's data
silently. The rejected caller sees a real error ("Another window saved
changes first") rather than a false "saved" toast.

This is race-free in practice because `commands::SAVE_LOCK` already
serializes every `save_app_state` call across both windows (one process),
so the compare-then-write here never interleaves with another write.

**What this does NOT do**, and is a known, documented gap rather than a
full architectural fix: it protects against silently losing an ENTIRE
save, but does not merge concurrent field-level edits (e.g. window A
renames a task while window B completes a different task in the same
window of time) - whichever save lands second under the SAME starting
revision wins the CAS and the other reloads, so that window's edit must be
manually redone after the reload. A true single-writer or field-level-merge
architecture would close this gap; it is out of scope for this pass.

## Uninstall ("Remove everything") is honest about failure

`reset_and_uninstall_app` (`src-tauri/src/commands.rs`) does not exit the
process before a deletion failure can be communicated - `app.exit` tears
the process down, and a Tauri command's `Result` racing that teardown is
not a reliable way for the frontend to learn what happened. It checks
every collected error FIRST:

- **All clean → exit.** The only case that quits the app.
- **Any failure → `UNINSTALLING` is reset, the app stays open**, and the
  command returns `Err` with every failed path so the user can see the
  complete error, fix the underlying problem (permissions, disk space),
  and retry.

A missing file/folder is success (nothing to remove), never a failure. A
folder that EXISTS but genuinely can't be enumerated (a permission race, a
volume unmounting mid-wipe) is a reported failure, not a silently skipped
"nothing to check here" - individual `DirEntry` read errors inside a
successfully-opened directory are reported the same way, never dropped
via `.flatten()`.

"Remove everything" deletes every artifact prefix Remi itself creates in
the data folder (see `CLEANUP_PREFIXES` in `commands.rs`): `state.json`,
`state.bak`, the recovery directory, `remi-backup-*.json` (manual
exports), `remi-usage-*.json` (opt-in usage-log exports), and both
`.state.json.tmp*` and `.settings.json.tmp*` stale atomic-write temp
files. Anything else in the folder - a user's own file dropped into a
custom `dataFolder` - is left untouched. "Wipe, keep history" removes only
`settings.json`; `state.json`/`state.bak`/the recovery directory and any
exports survive, so a reinstall can recover them.

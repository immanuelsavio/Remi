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

# CLAUDE.md — Remi

Non-negotiable invariants for any future change to this codebase. Full
rationale lives in `docs/timing-and-interruptions.md` and
`docs/data-durability.md`; this file is the compressed version to keep in
context.

## sessionTx

Every mutation that can move, remove, complete, promote, replace, or
delete the currently-timed task or step **must** go through `sessionTx`
in `src/store/state.ts`:

```
bank the running session → mutate → repair dangling refs
  → maybe start the next session → publish + save once
```

Bypassing it silently loses live time or attributes it to the wrong task.
If you add a new action that touches `activeMainId`/`activeSubId`/
`startedAt`, route it through `sessionTx`, not a bare `commit()`.

## Time accounting

- Running time is always `now - startedAt` (absolute epoch ms), never an
  incremented counter.
- On boot, an orphaned session is banked only up to `savedAt`, never to
  `now`. A laptop closed overnight while a task ran must credit zero
  extra time.
- The clock checkpoints (persists) roughly every 20s while a session
  runs.
- A step's elapsed time is its own; it must never be smeared onto the
  parent task.

## Day-rollover idempotence

`endDay()` builds tomorrow's state with `awaitingStart: true` while
keeping today's `dateISO`. `rolloverIfNewDay()` must short-circuit on
`awaitingStart` to _only re-date_, not re-archive. Removing or bypassing
this flag causes the day to roll twice on the next boot — double-
incrementing `dayNum` and discarding every carried task. There is a test
guarding this exact regression
(`is IDEMPOTENT: reopening after End Day does not roll again` in
`src/store/store.test.ts`) — do not let it go red.

## Persistence recovery contract

In `src-tauri/src/state_io.rs`:

1. A malformed file is never deleted or overwritten — it's copied into a
   timestamped recovery folder.
2. Writes are atomic (unique temp file → flush → fsync → rename → fsync
   parent dir).
3. A `.bak` of the last-known-good file is kept and read back on a bad
   load; a corrupt live file never becomes the backup.
4. An empty file is malformed, not `{}`.

`hydrate()` in `src/domain/hydration.ts` is the frontend half: every
value off disk is coerced, clamped, or dropped. Never trust a value you
haven't checked.

## Single effect ownership

The popover calls `startClock({ owner: true })`; the dashboard calls
`startClock({ owner: false })`. Only the owner fires reminders, wellness
nudges, check-ins, break-end notifications, checkpoints, and the tray
title. If you add a new background effect to the clock, gate it behind
`effectOwner` the same way — both windows running effects means duplicate
notifications and check-ins that can fire in a hidden window.

## Module boundaries

- Components import actions from `src/store` (the facade at
  `src/store/index.ts`) and read-only helpers from `src/view.ts`. Never
  import `src/store/state.ts` or another internal store module directly
  from a component.
- Store action modules (`task-actions.ts`, `day.ts`, `break-actions.ts`,
  etc.) never import each other — only `src/store/state.ts`. This keeps
  the module graph a star, not a cycle. If two action modules need to
  call each other's logic, either the shared logic belongs in
  `state.ts`, or the facade (`store/index.ts`) is the right place to
  compose them.
- `src/domain/*` is pure: no Svelte store, no Tauri, no DOM (except
  `theme.ts`'s `applyTheme`). Every time-dependent function takes `now`
  as an explicit parameter — this is what makes the domain tests
  deterministic with no fake timers.

## Legacy migration

`src-tauri/src/migration.rs` migrates data from the old Dopamigo MVP
identity (`com.dopamigo.mvp`, `~/Dopamigo MVP`) into Remi
(`com.immanuelsavio.remi`, `~/Remi`) once, on first boot after upgrade.
It must never read from or write to `com.dopamigo.app` / `~/Dopamigo` —
a separate, unrelated production app. It copies, never moves or deletes,
the legacy data, and never overwrites existing Remi data. See
`docs/data-durability.md` for the full rule set and the 11 tests that pin
it down.

## Before changing any of the above

Run `npm run verify` (frontend tests + type check + build + `cargo test`

- `cargo fmt --check` + `cargo clippy -D warnings`) and confirm it's still
  green. If you're touching `sessionTx`, the day lifecycle, or
  `state_io.rs`, re-read the relevant doc in `docs/` first — these are the
  areas where a "simplification" has broken real user data before.

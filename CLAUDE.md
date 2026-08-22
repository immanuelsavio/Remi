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
   load; a corrupt live file never becomes the backup. A `.bak` that
   cannot be refreshed is REPORTED (via the save's `warning`), never
   silently ignored — but it does not abort the write, because the live
   file is the user's current work.
4. An empty file is malformed, not `{}`.
5. An ordinary save over a malformed live file is REFUSED
   (`CasOutcome::RefusedMalformed`) rather than treated as revision 0.
   Only a caller that passes `over_malformed` may overwrite one — the
   restore path, and "Start today fresh" on the recovery screen. The
   refusal is an outcome, not an error: the quit barrier and the dashboard
   close handler both proceed on it, or a damaged file would leave the app
   unquittable.
6. The frontend never schedules a save from the recovery screen
   (`commitLocal`, not `commit`).

`hydrate()` in `src/domain/hydration.ts` is the frontend half: every
value off disk is coerced, clamped, or dropped. Never trust a value you
haven't checked.

## Single effect ownership

The popover calls `startClock({ owner: true })`; the dashboard calls
`startClock({ owner: false })`. Only the owner fires reminders, wellness
nudges, check-ins, break-end notifications, checkpoints, and the tray
title.

Ownership is a LEASE held by Rust (`scheduler.rs`), not a constant: the
preferred owner renews it every 2s, and a lease unrenewed for 5s expires so
the other window can take over — the case where macOS has suspended the
hidden popover's timers, so it neither works nor yields. A live lease is
never granted to a second claimant, so "exactly one owner" still holds.

The 20s checkpoint has a native counterpart (`state_io::touch_saved_at`,
`savedAt` only, no `_rev` bump) so that time is bounded even when both
webviews are suspended. Do not extend the native side into domain logic:
reminders, wellness, rollover and notification copy have one source of
truth in `src/domain`. If you add a new background effect to the clock, gate it behind
`effectOwner` the same way — both windows running effects means duplicate
notifications and check-ins that can fire in a hidden window.

**`checkDayRollover` is the one deliberate exception, and must stay ABOVE
the gate.** It is state correctness, not an effect: the owner is the
popover, which is hidden almost all the time, and a hidden WKWebView has
its timers throttled or suspended by macOS — so gating rollover behind
ownership let an app left open overnight silently never roll the day,
while the visible dashboard ticked away doing nothing about it. It is safe
in both windows because `rolloverIfNewDay` no-ops once `dateISO === today`
and saves are compare-and-swap. Before adding anything else above the
gate, ask: would running this twice be wrong, or would NOT running it be
wrong?

## Module boundaries

- Components import actions from `src/store` (the facade at
  `src/store/index.ts`) and read-only helpers from `src/view.ts`. Never
  import `src/store/state.ts` or another internal store module directly
  from a component.
- Store action modules (`task-actions.ts`, `day.ts`, `break-actions.ts`,
  `tour.ts`, etc.) never import each other — only `src/store/state.ts`.
  This keeps the module graph a star, not a cycle. If two action modules
  need to call each other's logic, either the shared logic belongs in
  `state.ts`, or the facade (`store/index.ts`) is the right place to
  compose them — see the facade's `addMain`/`startTask`/`switchToMain`
  wrappers, which route a mutation to the tour's sandbox while a tour is
  running and to `task-actions.ts` otherwise, without either module
  importing the other. `store/tour-preview.ts` is a further documented
  exception: it is cross-window presentation infrastructure, imported by
  `tour.ts`, and depends on nothing but `state.ts`.
  `persistence.ts` and `clock.ts` are the documented exceptions: they are
  infrastructure, and several action modules depend on them. Nothing may
  depend on an action module.
- `src/domain/*` is pure: no Svelte store, no Tauri, no DOM (except
  `theme.ts`'s `applyTheme`). Every time-dependent function takes `now`
  as an explicit parameter — this is what makes the domain tests
  deterministic with no fake timers.

## The tour practises in a SANDBOX, never in the store

The tour used to replace `state.mains` with demo tasks and park the real
day in `state.demoRestore`, so practice happened in the production store
and every exit, close, quit, crash, midnight, backup and second window had
to know the app's own state was temporarily fictional. It does not any
more:

- **Practice is an event log, replayed.** `src/domain/tour-sandbox.ts` is a
  pure, deterministic model: `replay(events)` builds the practice world,
  and Back is `truncate(events, destination)` followed by a replay. Do not
  add page-specific Back cleanup — that is what this replaced, and it does
  not compose (a clock page that knows nothing about the End Day flag
  leaves a beat "done" after Back).
- **The store is never touched by practice.** The sandbox is published into
  `tourOverlay` (`state.ts`) and the `app` derived store shows it to
  components. `state` itself keeps the user's real day throughout, so
  ending the tour restores nothing — nothing was borrowed. `tourSeen` is
  the one deliberate write a tour makes.
- **The facade is the boundary.** `addMain`/`addSub`/`addTag` route to the
  sandbox while a tour runs; `startTask`/`switchToMain`/`startSub` become
  the tour clock or a no-op; `completeMain`/`removeMain`/`toggleSubDone`
  are refused. `beginSession` additionally refuses any id that is not in
  the day, so no sandbox id can reach a session by any route.
- **Native effects carry generation tokens.** The tray preview crosses
  windows as exactly `{runId, title, startedAt}` and is never persisted;
  the notification preview carries `runId` plus a per-press sequence. Every
  async result checks its token is still current before acting.
- `tourSeen` is marked when the tour STARTS, so interrupting an onboarding
  does not silently restart it on the next launch.

Boot still un-strands a demo written by an OLDER version (`restoreFromDemo`
in `persistence.ts`); that path is for legacy files only.

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

# Timing and interruptions

These are the non-negotiable behavioral invariants of the app. Ranked
roughly by how much damage getting them wrong does — see the pitfall list
at the end.

## Time is absolute, never counted

A running session is `startedAt`: an **epoch-ms timestamp**. Elapsed is
always `now - startedAt`. Nothing anywhere increments a counter.

```ts
const live = s.activeMainId && s.startedAt ? Math.max(0, now - s.startedAt) : 0;
```

Why: a counter drifts if a tick is missed, and dies on restart. An
absolute stamp survives both. Every timer in the UI is derived at render
time from `$nowMs`, a store that ticks once a second — the state itself
doesn't change while a task runs.

**The consequence you must handle.** Because `startedAt` is absolute, a
process killed mid-task would, on next launch, compute `now - startedAt`
and credit every second the machine was **switched off**. So:

> Time is only ever trusted **up to the last save**.

`bankOrphanSession()` (`src/store/state.ts`) banks `savedAt - startedAt`,
then clears the session. A laptop shut overnight with a task running
credits nothing extra. This is also why `flushSave()` stamps `savedAt` and
mirrors it back into live state, and why the clock **checkpoints every
20s** while a session runs (`src/store/clock.ts`): saves are otherwise
driven by clicks, so an hour of uninterrupted work then a crash would lose
the hour. The checkpoint bounds that loss to one interval.

## `sessionTx` — the session transaction

**Every mutation that can move, remove, complete, promote, replace, or
delete the active timed object must go through `sessionTx`** (defined in
`src/store/state.ts`). No exceptions.

```ts
function sessionTx(mutate) {
  const now = Date.now();
  commit((s) => {
    bankActive(s, now); // 1. bank the running session
    const next = mutate(s, now); // 2. apply the mutation
    repairActiveRefs(s); // 3. drop refs to things now gone
    if (next)
      beginSession(s, next.mainId, next.subId, now); // 4. maybe restart
    else if (!s.activeMainId) {
      s.startedAt = 0;
    }
  }); // 5. publish + save once
}
```

Ordering is the whole thing. Bank _before_ mutating, or the time since the
last save lands on an object you just deleted. Repair _after_, or
`activeMainId` points at nothing.

`bankActive` resolves the target as _step if there is one, else the task_
— so step time lands on the step, never smeared onto the parent:

```ts
const target = (s.activeSubId ? m.subs.find((x) => x.id === s.activeSubId) : undefined) ?? m;
target.accrued += Math.max(0, now - s.startedAt);
```

Tested behaviors that depend on this: deleting the active task; deleting
an active step; promoting an active step without losing unbanked live
time; switching between tasks and steps; completing or reviving tasks;
starting and ending breaks. See `src/store/store.test.ts`.

## Interruption evidence

An interruption is a **record per occurrence**, not a counter — because
the report has to say _what_ interrupted, for _how long_, and _which
task paid_.

```
switchToMain(id, remember: true)   ─┐
startNewMain(title, remember: true) ├─→ openInterruption() → { open: true, durationMs: 0 }
check-in answered "I moved on"     ─┘         pushes onto returnStack

… time passes …

startTask(originalId)  ─┐
completeMain(interrupter) ├─→ closeOpenInterruption()
                         ─┘     durationMs = now − atMs
                                victim.interruptedCount++
                                victim.interruptedMs += durationMs
```

- **`open` is an explicit boolean**, not `durationMs > 0`. A very short
  interruption legitimately rounds to 0 ms; inferring "still open" from a
  zero duration would leave it open forever.
- **Opening a second interruption closes the first.** Without that, one
  interruption absorbs everything after it.
- **`remember` is the semantic distinction.** `switchToMain(id, false)`
  means "I'm moving on" — no record, no return stack. `true` means
  "something pulled me away".

`interruptionStats()` (`src/domain/trainer.ts`) counts an open
interruption (it happened) but adds **no partial duration** to the total
(it isn't over). The **stretch ratio** is `elapsedMs / focusedMs` per
completed task, with a **1.25× noise floor** — below that the "stretch" is
rounding, not a story.

## The day lifecycle, and why rollover must be idempotent

```
      ┌──────────┐  startDay()   ┌───────┐  startTask()  ┌────────┐
      │ startday │──────────────►│ today │──────────────►│ active │
      └──────────┘  seeds carry  └───────┘◄──────────────└────────┘
            ▲       + routines      │  ▲    completeMain()    │
            │                       │  │                      │ startBreak()
            │  endDay()             │  │ resumeFromBreak()    ▼
            └───────────────────────┘  └──────────────────┌───────┐
                                                          │ break │
      ┌──────────┐                                        └───────┘
      │ recovery │ ◄── boot() when load kind === "damaged"
      └──────────┘
```

`endDay()` (`src/store/day.ts`) builds **tomorrow's state** and marks it
`awaitingStart: true`, while keeping **today's** `dateISO`. Next morning
`rolloverIfNewDay()` (`src/store/state.ts`) sees a stale date and would
normally archive + increment — but `awaitingStart` short-circuits it to
_only re-date_:

```ts
if (s.awaitingStart) {
  s.dateISO = today;
  return s;
} // load-bearing
```

Without that flag, ending the day and reopening next morning **rolls
twice**: `dayNum` double-increments and the carry list is rebuilt from an
empty `mains`, silently discarding every task the user marked "Tomorrow".
This is the single nastiest bug in the app's history; there is a test
named `is IDEMPOTENT: reopening after End Day does not roll again`.

**Carrying is a durable snapshot, not a title copy.** `carrySnapshot()`
(`src/domain/tasks.ts`) preserves note, reminder, estimate and open steps
(with _their_ notes), and increments `carries`. Only elapsed time resets.

Rollover also runs **at local midnight while the app is open**
(`checkDayRollover` in `src/store/clock.ts`), banking any running session
first. Boot-only rollover would file tonight's work under yesterday.

**Local dates everywhere.** `todayISO()` (`src/domain/dates.ts`) uses
`getFullYear/Month/Date`, never `toISOString()`. A UTC date rolls the day
mid-afternoon for US users.

## Two windows, one truth

Because each webview has its own store, they must reconcile:

```
window A: mutate → commit() → 250 ms debounce → flushSave()
                                    │
                                    ├─ invoke("save_app_state")   → atomic write
                                    └─ emit("app-state-changed", { from: WINDOW_ID })
                                                     │
window B: listen(...) → payload.from !== WINDOW_ID → reloadFromDisk()
                                                     │
                                          hydrate(), but KEEP local
                                          phase / overlay / subsOpen / ciStage
```

`WINDOW_ID` (`src/store/persistence.ts`) is a random per-instance string
so a window ignores the echo of its own save. `reloadFromDisk`
(`src/store/sync.ts`) deliberately preserves the _transient view_ —
otherwise a background save in one window would yank the user off their
current screen. `onFocusChanged` re-reads as a fallback if the event bus
is unavailable.

Rust serializes the writes themselves with a `SAVE_LOCK` mutex
(`src-tauri/src/commands.rs`), because per-window JS `saving` flags cannot
order writes _between_ windows.

## Single effect owner

The popover runs `startClock({ owner: true })`; the dashboard
`startClock({ owner: false })`. Both tick `nowMs` (display time), but
**only the owner** runs reminders, wellness, check-ins, break-end
notifications, checkpoints and the tray title.

If both ran effects you would get duplicate notifications — and worse, a
bounded check-in could fire in the **hidden** dashboard, advancing
`ciStage` so the visible popover never shows it.

## Pitfalls, ranked

1. **Bypassing `sessionTx`** for a mutation that touches the timed object.
2. **Rolling the day twice** — omit `awaitingStart` and End Day silently
   discards every carried task overnight.
3. **Crediting time from `startedAt` to `now` on boot.** Must be
   `savedAt`.
4. **Deriving "interruption still open" from `durationMs > 0`.**
5. **`toISOString()` for the day date.**
6. **Overwriting or deleting a file you couldn't parse.**
7. **Treating an empty file as `{}`.**
8. **Both windows running effects.**
9. **A per-window counter for ids** — use `crypto.randomUUID` (see
   `src/domain/ids.ts`).
10. **A pid-only temp filename** for state writes — both webviews share
    one process.
11. **Holding the tray mutex across `set_title`** — clone the handle out,
    drop the lock, then call.
12. **`filter(Boolean)` to validate an array of objects** — a bare string
    is truthy and survives as a phantom task.
13. **Reading `s.awaitingStart` after a base-default spread** to decide
    whether to _infer_ it — read from `raw` instead.
14. **One toast per due reminder** — batch into one.
15. **Writing `_last` when snoozing the lunch nudge** — use the separate
    `_snoozedUntil`.
16. **A typed struct for `settings.json`** — erases unknown keys. Read-
    modify-write a generic map (`src-tauri/src/settings.rs`).

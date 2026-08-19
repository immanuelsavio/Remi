# Dopamigo — the complete app in 18 text files

This document is written to be **sufficient**: an agent who has never seen this
repo should be able to rebuild the whole app from this file alone, and understand
*why* each decision was made rather than just copying shapes.

Read it in order. §1–2 are orientation, §3–6 are the concepts you must hold to
write correct code, §7 is the file-by-file build order, §8 is the pitfall list.

---

## 1. What Dopamigo is

A macOS/Windows menu-bar day tracker for people with ADHD. It lives in the menu
bar (no Dock icon), opens as a small popover under its tray icon, and has a
second larger window for planning and evidence.

**The product's real subject is interruptions.** Every other time tracker answers
"how long did you work on this?" Dopamigo also answers "how long did this *take*,
in wall-clock, from first touch to done?" — and the gap between those two numbers
is the whole point:

```
accrued          = focused time actually spent          (2h)
completedAt − firstStartedAt = real elapsed span        (5h)
                                     ↑
                        this gap is what interruptions cost
```

That gap is why someone can estimate a task accurately and still lose the day.
The app captures it as first-class evidence: what interrupted you, for how long,
and **which task paid for it**. Everything else — streaks, nudges, the trainer —
serves the same goal of making invisible time visible.

The three difficulties it is designed around:

| Difficulty | The feature that addresses it |
|---|---|
| **Time blindness** — no felt sense of elapsed time | Live timer in the menu bar itself; nothing to click |
| **Avoidance** — a task silently moves day to day | `carries` counter, and a nudge at 3+ days |
| **Interruption cost is invisible** | Per-occurrence interruption records charged to the victim task |

Tone matters and is part of the spec: the app never scolds. Copy is
"You've moved this 3 days running — are you avoiding it? Try just the first small
step", not "OVERDUE".

---

## 2. Run it

```bash
cd app_packet
npm install          # if esbuild's postinstall is blocked: npm approve-scripts esbuild
npm run app          # tauri dev
```

Look at your **menu bar**, not your Dock. Click the ring icon.

| Command | Does |
|---|---|
| `npm run app` | Dev mode (`tauri dev`) |
| `npm run release` | Bundle a real `.app` / `.dmg` / `.exe` |
| `npm test` | 124 frontend tests |
| `cargo test` | 13 Rust tests |
| `npm run check` | Svelte + TypeScript type check |
| `npm run verify` | Everything above, as CI would |

**Verified 2026-08-19:** 124 frontend + 13 Rust tests pass, 0 type errors,
`clippy -D warnings` clean, `cargo fmt --check` clean, `tauri build` produces a
`Dopamigo.app` that launches as a menu-bar agent. The state file was round-tripped
through the real Rust path *and* re-read by the frontend to confirm both sides
agree on the schema.

**It will not touch production Dopamigo data.** This build uses
`com.dopamigo.mvp` and `~/Dopamigo MVP`, deliberately separate from the full app's
`com.dopamigo.app` and `~/Dopamigo` — otherwise its uninstall would delete your
real settings.

---

## 3. Architecture

```
┌──────────────────────── ONE Tauri process ────────────────────────┐
│                                                                    │
│  popover webview (380×560)        dashboard webview (900×640)      │
│  Popover.svelte                   Dashboard.svelte                 │
│  startClock({owner: true})        startClock({owner: false})       │
│  ── fires notifications           ── display only                  │
│         │                                   │                      │
│         └──── own JS module instance ───────┘                      │
│                  (separate stores!)                                │
│                        │                                           │
│                   invoke() / event bus                             │
│                        ▼                                           │
│  main.rs — paths · atomic state I/O · 15 commands · tray · windows │
│                        ▼                                           │
│     ~/Dopamigo MVP/state.json   (+ .bak, + recovery folder)        │
│     ~/Library/Application Support/com.dopamigo.mvp/settings.json   │
└────────────────────────────────────────────────────────────────────┘
```

**Both windows load the same JS bundle.** `index.html` reads
`getCurrentWindow().label` and mounts `Popover.svelte` for `"popover"` or
`Dashboard.svelte` for `"dashboard"`. Both windows are declared in
`tauri.conf.json` and exist *hidden from launch*, so opening either is instant —
and it means **two independent JS module instances**, each with its own store.
That single fact drives §5's ownership rule and §4.6's sync design.

**Who owns what.** The frontend owns the state *shape*; Rust treats `state.json`
as an opaque `serde_json::Value` and guarantees only the *durability contract*.
So the schema can evolve entirely in TypeScript with no Rust change. Rust owns
paths, atomicity, the tray, and window lifecycle.

### The layer split, and why it's exactly three files

| File | Contains | Rule |
|---|---|---|
| `model.ts` | state shape + **every pure function** | no store, no Tauri, no DOM (except `applyTheme`) |
| `store.ts` | the Svelte store + **everything that mutates** | all writes go through `commit()` |
| `view.ts` | re-export surface for components | 47 lines of imports |

This is the one split I did *not* collapse. Because `model.ts` is pure, all 124
tests are plain function calls — no fake timers, no mocks, `now` passed in
explicitly. Merging it into `store.ts` would give you a test file that can't tell
whether it's testing a calculation or a side effect. Components import *actions*
from `./store` and read-only helpers from `./view`, so a reader never has to guess
which module a name lives in.

---

## 4. The concepts you must get right

These are ordered by how much damage getting them wrong does.

### 4.1 Time is absolute, never counted

A running session is `startedAt`: an **epoch-ms timestamp**. Elapsed is always
`now - startedAt`. Nothing anywhere increments a counter.

```ts
// live elapsed for whatever is being timed
const live = s.activeMainId && s.startedAt ? Math.max(0, now - s.startedAt) : 0;
```

Why: a counter drifts if a tick is missed, and dies on restart. An absolute stamp
survives both. Every timer in the UI is derived at render time from `$nowMs`, a
store that ticks once a second — the state itself doesn't change while a task runs.

**The consequence you must handle.** Because `startedAt` is absolute, a process
killed mid-task would, on next launch, compute `now - startedAt` and credit every
second the machine was **switched off**. So:

> Time is only ever trusted **up to the last save**.

`bankOrphanSession()` banks `savedAt - startedAt`, then clears the session. A
laptop shut overnight with a task running credits nothing extra. This is also why
`flushSave()` stamps `savedAt` and mirrors it back into live state, and why the
clock **checkpoints every 20 s** while a session runs: saves are otherwise driven
by clicks, so an hour of uninterrupted work then a crash would lose the hour. The
checkpoint bounds that loss to one interval.

### 4.2 `sessionTx` — the session transaction

**Every mutation that can move, remove or replace the thing being timed must go
through `sessionTx`.** No exceptions.

```ts
function sessionTx(mutate) {
  const now = Date.now();
  commit((s) => {
    bankActive(s, now);            // 1. bank the running session
    const next = mutate(s, now);   // 2. apply the mutation
    repairActiveRefs(s);           // 3. drop refs to things now gone
    if (next) beginSession(s, next.mainId, next.subId, now);  // 4. maybe restart
    else if (!s.activeMainId) { s.startedAt = 0; /* → phase "today" */ }
  });                              // 5. publish + save once
}
```

Ordering is the whole thing. Bank *before* mutating, or the time since the last
save lands on an object you just deleted. Repair *after*, or `activeMainId` points
at nothing.

Three real bugs this prevents, each pinned by a test:

- **Promote** used to copy only *already-banked* time, silently dropping
  everything since the last save. Now it banks into the step first, then moves the
  full `accrued`.
- **Deleting the active task** left `activeMainId` dangling — a session ticking
  against a nonexistent object.
- **Deleting the active step** orphaned the session instead of falling back to its
  parent task.

`bankActive` resolves the target as *step if there is one, else the task* — so
step time lands on the step, never smeared onto the parent:

```ts
const target = (s.activeSubId ? m.subs.find(x => x.id === s.activeSubId) : undefined) ?? m;
target.accrued += Math.max(0, now - s.startedAt);
```

### 4.3 Interruption evidence

An interruption is a **record per occurrence**, not a counter — because the report
has to say *what* interrupted, for *how long*, and *which task paid*.

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

Three details that are easy to get wrong:

- **`open` is an explicit boolean**, not `durationMs > 0`. A very short
  interruption legitimately rounds to 0 ms; inferring "still open" from a zero
  duration would leave it open forever and let it swallow the rest of the day.
- **Opening a second interruption closes the first.** Without that, one
  interruption absorbs everything after it.
- **`remember` is the semantic distinction.** `switchToMain(id, false)` means "I'm
  moving on" — no record, no return stack. `true` means "something pulled me
  away". Only the second is an interruption.

`interruptionStats()` counts an open interruption (it happened) but adds **no
partial duration** to the total (it isn't over). Being honest in both directions
is the point.

The **stretch ratio** is the headline number: `elapsedMs / focusedMs` per completed
task, with a **1.25× noise floor** — below that the "stretch" is rounding, not a
story. A 2h task that occupied 5h shows as 2.5×.

### 4.4 The day lifecycle, and why rollover must be idempotent

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

`endDay()` builds **tomorrow's state** and marks it `awaitingStart: true`, while
keeping **today's** `dateISO`. Next morning `rolloverIfNewDay()` sees a stale date
and would normally archive + increment — but `awaitingStart` short-circuits it to
*only re-date*:

```ts
if (s.awaitingStart) { s.dateISO = today; return s; }   // ← load-bearing
```

Without that flag, ending the day and reopening next morning **rolls twice**:
`dayNum` double-increments and the carry list is rebuilt from an empty `mains`,
silently discarding every task the user marked "Tomorrow". This is the single
nastiest bug in the app's history; there is a test named
`is IDEMPOTENT: reopening after End Day does not roll again`.

**Carrying is a durable snapshot, not a title copy.** `carrySnapshot()` preserves
note, reminder, estimate and open steps (with *their* notes), and increments
`carries`. Only elapsed time resets — it's a new day's work. The notes UI promises
a note stays attached to its task, so a title-only carry would break that promise.

Rollover also runs **at local midnight while the app is open** (`checkDayRollover`
on the clock), banking any running session first. Boot-only rollover would file
tonight's work under yesterday.

**Local dates everywhere.** `todayISO()` uses `getFullYear/Month/Date`, never
`toISOString()`. A UTC date rolls the day mid-afternoon for US users.

### 4.5 The durability contract

Four rules, in priority order. Rule 1 outranks everything.

1. **A malformed file is NEVER deleted or overwritten.** It is *copied* into a
   timestamped recovery folder, and the UI shows an honest recovery screen. A
   blank day would read as "all my work vanished".
2. **Writes are atomic:** unique same-directory temp → `write` → `flush` →
   `sync_all` → rename → **fsync the parent dir** so the rename itself is durable.
   The temp name includes pid *and* a counter, because both webviews share one
   process and two concurrent saves would otherwise pick the same path.
3. **A `.bak` of the last-known-GOOD file** is taken before each overwrite, and is
   actually *read back* on a bad load. A corrupt live file never becomes the
   backup. The first write seeds `.bak` too, so corruption before the second save
   is still recoverable.
4. **Load outcomes are explicit:** `fresh | loaded | recovered | damaged`. An
   **empty file is malformed**, not `{}` — that's what a truncated write looks
   like, and treating it as an empty object silently loses the day.

On Windows, `MoveFileExW(REPLACE_EXISTING | WRITE_THROUGH)` gives a true
single-step replace. The naive remove-then-rename leaves a window where the live
file doesn't exist at all — a crash there loses data that was already safely
written.

`hydrate()` is the frontend half of the same paranoia. Every value off disk is
coerced, clamped or dropped:

- a bare string in `mains` is **not** a task (`filter(Boolean)` is not enough —
  a truthy string would survive as a phantom "Untitled")
- a reminder with no usable `at` is dropped
- a session pointing at a missing or done task is cleared
- a return-stack entry whose target is gone is dropped
- a history record with no `dateISO` is discarded (it could never be placed on a
  calendar or counted in a streak)
- missing notification prefs default **ON** — absent must not read as "the user
  turned this off" — but `privateNotifications` defaults **OFF**, since it changes
  what banners say

### 4.6 Two windows, one truth

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

`WINDOW_ID` is a random per-instance string so a window ignores the echo of its
own save. `reloadFromDisk` deliberately preserves the *transient view* — otherwise
a background save in one window would yank the user off their current screen.
`onFocusChanged` re-reads as a fallback if the event bus is unavailable.

Rust serializes the writes themselves with a `SAVE_LOCK` mutex, because per-window
JS `saving` flags cannot order writes *between* windows.

### 4.7 Single effect owner

The popover runs `startClock({ owner: true })`; the dashboard
`startClock({ owner: false })`. Both tick `nowMs` (display time), but **only the
owner** runs reminders, wellness, check-ins, break-end notifications, checkpoints
and the tray title.

If both ran effects you would get duplicate notifications — and worse, a bounded
check-in could fire in the **hidden** dashboard, advancing `ciStage` so the
visible popover never shows it.

---

## 5. Feature reference

### Tasks
One level of steps (deliberately — deeper nesting is a planning trap). Notes on
tasks and steps. Estimates. Reminders. Promote a step to its own task keeping all
its time. Delete with undo. Revive a completed task. Prune blanks.

### Working
Start / switch (remembered or not) / interrupt with a brand-new task / work a
specific step. Timed breaks with extend and resume-the-same-work.

**Bounded check-ins:** fire at `pingMin × 1`, `× 2`, `× 4`, then **stop for the
session**. Measured against the *current session* only — using all-time `accrued`
would make a task holding 30 minutes ping the instant it resumes. Mutable for the
day. A simple repeating timer would train the user to dismiss it reflexively;
bounded escalation respects that attention is finite.

### The day
Start Day seeds carried tasks + daily routines (skipping duplicates). End Day
takes a per-task disposition — `done` / `carry` / `backlog` — archives an enriched
snapshot, and awards a revive heart at each 5-day streak multiple. Restart Day
clears today but keeps backlog, history and preferences.

### Streaks
A day counts when it has completed work. **Weekends, PTO and revived days bridge a
gap for free.** The first genuinely missed weekday ends the streak. Dates before
day 1 are never misses (the floor). PTO can only be set for **today or later** —
never retroactively, which would erase a real miss. An unworked *today* is not yet
a miss, so a revive heart can't be spent on it.

### Evidence
Interruption count / total / longest / **per focused hour** (a raw count means
nothing without knowing how long you worked) / top causes by time cost / stretched
tasks. Plus the time-sense trainer: logs estimate-vs-actual on completion when
`trainerOn`, and gives a verdict — accurate ≤1.1×, "a bit over" <1.5×, otherwise
"you underestimate a lot… try estimating, then doubling". Zero estimates are
excluded, never divided by.

### Data
Backlog. Structured text import with a preview and a copyable prompt (accepts
`@ in 1h30m`, `@ by 3pm`, `@ 2026-09-01 09:00`; caps at 500 items / 200-char
titles). JSON backup export + restore through `hydrate`. Opt-in anonymous usage
logging. Reset & Uninstall with a keep-history option.

**Usage logging is content-free by construction.** Counts, settings and
interruption *shape* only — never task titles, notes, backlog text or reminder
text. A test asserts titles never appear in the export. The interesting signals
are **friction**: `tab_thrash` (4 tab switches in 8 s = hunting for something),
`rapid_repeat`, `undo_used`. Each carries a plain-English `means` string, because
a raw counter tells a maintainer nothing.

### Preferences
Light/dark × six accents. Workday target. Check-in interval. Five wellness nudges
(water / stand / walk / lunch / break) with intervals — opt-in, one at a time,
never during a break, and they **never touch the clock**. Daily routines. Seven
toggles including **private notifications**, which keeps task names out of OS
banners — they're visible to everyone in a screen share or on a projector.

---

## 6. The two windows

**Popover (380×560)** routes on `phase`, layers one overlay, and is the effect
owner. Phases: `startday` (one big button, shows what carried) · `today` (the
list) · `active` (hero card with the live timer, Done / Break / "Something came
up") · `break` · `recovery`. Overlays: `checkin` · `switch` · `done-choose` ·
`endday` · `restart` · `backlog`, plus wellness and welcome-back which sit outside
the router because they're interruptions from the clock, not navigation.

Overlay scrims are `position: absolute` inside `.pop`, so they're bounded by the
window rather than escaping it.

**Dashboard (900×640)** — six tabs: **Plan** (the whole day at desk scale, with
notes/estimate/reminder per task) · **Today** (the working view at desk scale, so a
day planned here can be *worked* here) · **Calendar** (click a future day to mark
time off) · **Stats** · **Data** · **Settings**. Tab order is Plan-then-Today
because that's the order you move through a day. The tab strip follows the
WAI-ARIA tabs pattern with roving tabindex.

### Menu-bar behaviour — every bit load-bearing

- **`ActivationPolicy::Accessory` + `LSUIElement`** — both needed. The plist key
  applies at launch, the API call after; without the key the Dock icon visibly
  flashes on every start.
- **The double-handler race.** Clicking the tray icon while the popover is open
  fires *blur → autohide hides it*, **then** the tray click handler runs, sees
  `is_visible() == false`, and re-opens it — so the tray could never *dismiss*.
  `PopoverGuard` swallows a show within 200 ms of a hide. `Instant` is monotonic,
  so this is pure UI timing, exempt from the clock-determinism rule.
- **Manual anchoring** from the tray icon's rect, captured from *every* tray event.
  The positioner plugin's `TrayCenter` returned screen-centre on macOS. With no
  event seen yet (a Spotlight reopen), fall back to top-right where menu-bar
  extras live — never mid-screen, which doesn't read as a popover at all.
- **`RunEvent::Reopen`** — re-opening a running `.app` on macOS doesn't start a
  second process; LaunchServices sends Reopen, so single-instance never fires.
  Without handling it, pressing Enter on Dopamigo in Spotlight appears to do
  nothing, because a tray-only app has no windows to restore.
- **Dashboard close hides, doesn't destroy** (`prevent_close` + `hide`), keeping
  the webview warm so reopening is instant.
- **Tray title at minute granularity.** Per-second would redraw the menu bar 60×
  more often for no readable benefit, and the number would be too jittery to
  glance at. Format: `42m`, then `1:07`. Break shows `☕ 8m`.

---

## 7. Rebuild order

18 files: 8,547 lines of source plus ~1,100 of config and this doc.
Build in this order — each step compiles and tests before
the next.

```
app_packet/
├── INSTRUCTIONS.md      this file
├── package.json         scripts + deps
├── tsconfig.json        strict TS, svelte + vite + vitest types
├── vite.config.ts       Vite + Vitest + Svelte preprocess, merged
├── index.html           entry + window-label router (inlined; no main.ts)
├── Cargo.toml           one [[bin]], no lib target
├── build.rs             tauri_build::build() + the PNG generator
├── tauri.conf.json      two windows, CSP, inline capabilities, bundle
├── Info.plist           LSUIElement (auto-detected beside tauri.conf.json)
├── main.rs              1040 — the whole Rust shell, 13 tests
└── src/
    ├── model.ts         1447 — shape + pure functions
    ├── store.ts         1718 — store, actions, effects
    ├── view.ts            47 — component import surface
    ├── model.test.ts     673 — 57 tests
    ├── store.test.ts    1019 — 67 tests
    ├── Popover.svelte    812
    ├── Dashboard.svelte 1587
    └── global.css         204 — tokens + shared controls
```

**Step 1 — `model.ts`.** Sections: `TYPES` · `CONSTRUCTORS` · `HYDRATE` ·
`FORMATTERS` · `ROLL-UPS` · `STREAKS` · `REMINDERS` ·
`TRAINER + INTERRUPTION ANALYSIS` · `IMPORT` · `USAGE LOGS` · `THEME`. Pure
throughout; every function taking time takes `now` as a parameter.

**Step 2 — `model.test.ts`.** Write these before the store. Fix `T0` to a known
date (`new Date(2026, 7, 12, 10, 0, 0)`) so every assertion is deterministic — no
fake timers needed.

**Step 3 — `main.rs`.** Sections: `PATHS` · `STATE I/O` · `COMMANDS` · `TRAY` ·
`POPOVER + DASHBOARD` · `MAIN` · `TESTS`. The 15 commands:

```rust
load_app_state()                        -> LoadResult   // { kind, state?, message?, paths }
save_app_state(state: Value)            -> ()
get_data_folder()                       -> String
open_data_folder()                      -> ()
get_standard_daily()                    -> Vec<String>
set_standard_daily_list(list)           -> ()
get_auto_update()                       -> bool         // absent = true
set_auto_update(on: bool)               -> ()
notify(title, body)                     -> ()
write_text_file(name, contents)         -> String       // file_name() strips traversal
set_tray_title(title: Option<String>)   -> ()
open_dashboard()                        -> ()
dashboard_closed()                      -> ()
quit_app()                              -> ()           // app.exit(0), not a kill
reset_and_uninstall_app(keep_history)   -> ()
```

Errors are plain `String` so the frontend can toast them — none of these have
partial-mutation paths where a typed error kind would matter. `settings.json` is
read-modify-written through a **generic JSON map**, not a typed struct, so unknown
and forward-compat keys survive.

**Step 4 — `store.ts`.** Sections: `THE STORE` · `PERSISTENCE` ·
`CROSS-WINDOW SYNC` · `THE CLOCK + BACKGROUND EFFECTS` · `THE SESSION TRANSACTION`
· `METRICS` · `UI STATE` · `DAY LIFECYCLE` · `TASKS` · `BREAKS` · `BACKLOG` ·
`IMPORT / EXPORT` · `SETTINGS`.

**Step 5 — `store.test.ts`.** Mock both `@tauri-apps/api/core` and
`/event`. Two techniques matter: (a) the store is a module-level singleton, so
`reset()` must hand `boot()` an explicit `{ kind: "loaded", state: freshDay() }` —
`kind: "fresh"` deliberately does *not* overwrite state, so it won't reset
anything; (b) simulate elapsed time by rewinding `startedAt` rather than waiting.

**Step 6 — `global.css`, then the two components.** Tokens first.

**Step 7 — config.** `Cargo.toml`, `build.rs`, `tauri.conf.json`, `Info.plist`,
`index.html`, `package.json`, `tsconfig.json`, `vite.config.ts`.

### Config specifics worth knowing

- **Capabilities inline** in `tauri.conf.json` under `app.security.capabilities` —
  Tauri's `CapabilityEntry` is an untagged enum accepting an inline object or a
  string reference, so no `capabilities/default.json` file is needed. Permissions:
  `core:default` (which includes `core:event:default`, covering the cross-window
  bus), the window show/hide/focus/position/always-on-top set, and
  `notification:default`.
- **Three configs merged into one.** Vitest reads a `test` key off the same Vite
  config; the Svelte plugin takes `preprocess` inline. So `vitest.config.ts` and
  `svelte.config.js` are unnecessary.
- **`main.ts` inlined** into `index.html` as `<script type="module">` — Vite
  processes it and bundles its imports normally.
- **Rust deps:** `tauri` (feature `tray-icon`), `tauri-plugin-single-instance`,
  `tauri-plugin-notification`, `serde`, `serde_json`, `dirs`; `windows-sys` on
  Windows only; `tempfile` as a dev-dep. Note **no `image-png` feature** — see
  below.

### No binary assets

Tauri's codegen *requires* `icons/icon.png` on disk and offers no opt-out. Rather
than commit a binary, `build.rs` **draws it and hand-rolls a PNG encoder** —
CRC-32, Adler-32, and `stored` (uncompressed) deflate blocks, which are a legal
zlib stream. That avoids a compression dependency for one build artifact whose
size is irrelevant.

The **tray** icon is separate: `tray_image()` in `main.rs` builds an antialiased
ring as an in-memory RGBA buffer via `Image::new_owned`, so it never touches the
filesystem and needs no PNG decoder. It's set `icon_as_template(true)` so macOS
recolours it for light and dark menu bars — which is why only the *shape* matters.

Swap either for designed assets whenever you like; nothing else depends on them.

### CSS token system

Two **independent** theme axes, so one hue drives everything:

```
[data-mode="light"|"dark"]   →  --bg --card --line --ink --ink-soft
[data-accent="amber"|…]      →  --accent
```

Every tint is derived from `--accent` via `color-mix`, so adding a sixth accent
means adding one hex value and nothing else:

```css
--accent-ink: color-mix(in srgb, var(--accent) 78%, #000);
--hero-bg:    color-mix(in srgb, var(--accent) 12%, var(--card));
--pill-bg:    color-mix(in srgb, var(--accent) 18%, var(--card));
```

Full token list: `--bg --card --line --ink --ink-soft --accent --accent-ink
--hero-bg --hero-line --pill-bg --warn-bg --warn-line --warn-ink --break
--break-bg --break-ink --success --danger --r-sm --r-md --r-lg --font-num`.

`user-select: none` on body (a popover is chrome, not a document), re-enabled on
inputs. Visible `:focus-visible` outlines — both windows are keyboard navigable.

---

## 8. Pitfalls

Ranked by how much damage each does. Every one of these was a real bug.

1. **Bypassing `sessionTx`** for a mutation that touches the timed object. Live
   time vanishes or lands on the wrong task.
2. **Rolling the day twice** — omit `awaitingStart` and End Day silently discards
   every carried task overnight.
3. **Crediting time from `startedAt` to `now` on boot.** Must be `savedAt`, or an
   overnight shutdown awards hours nobody worked.
4. **Deriving "interruption still open" from `durationMs > 0`.** A 0 ms
   interruption is legitimate; it would stay open forever.
5. **`toISOString()` for the day date.** Rolls the day mid-afternoon for US users.
6. **Overwriting or deleting a file you couldn't parse.** Rule 1 of §4.5.
7. **Treating an empty file as `{}`.** That's a truncated write; recover the `.bak`.
8. **Both windows running effects.** Duplicate notifications, and check-ins
   consumed by the hidden window.
9. **A per-window counter for ids.** Two module instances both mint `x7`, and one
   item overwrites the other after a cross-window reload. Use `crypto.randomUUID`.
10. **A pid-only temp filename.** Both webviews share one process; two concurrent
    saves truncate each other. Add a counter.
11. **Holding the tray mutex across `set_title`.** A once-a-second update blocks
    the tray's own click handler and the icon stops opening the popover. Clone the
    handle out, drop the lock, then call.
12. **`filter(Boolean)` to validate an array of objects.** A bare string is truthy
    and survives as a phantom task.
13. **Reading `s.awaitingStart` after a base-default spread** to decide whether to
    *infer* it — the spread already put a value there, so the inference never runs.
    Read from `raw`.
14. **One toast per due reminder.** The store holds a single toast, so a loop
    overwrites all but the last while all are marked delivered. Batch into one.
15. **Writing `_last` when snoozing the lunch nudge.** It reads as "already had
    lunch" and mutes it all day. Use the separate `_snoozedUntil`.
16. **A typed struct for `settings.json`.** Erases unknown keys — including
    `deviceId` — on the next write. Read-modify-write a generic map.

### If you extend it

Add a second file before a second folder. The merges here are justified at
~1,500 lines a file; past ~2,500, split `store.ts` along its section banners (they
match the original file boundaries, so it's mechanical) and give `main.rs` its
modules back.

Keep three invariants whatever you do: route every timing mutation through
`sessionTx`; never let a write path delete or overwrite a file it could not parse;
never let `hydrate` trust a value it did not check.

---

## 9. What this build leaves out

Four items, all in the Rust shell. Each is self-contained; the full
implementations are in the parent repo's `app/src-tauri/src/`.

| Dropped | Cost |
|---|---|
| **Silent self-update** (`updater.rs`, 617 lines) | No auto-update; ship builds manually. Needed `semver`, `reqwest`, `zip`. The preference still round-trips. |
| **NSPanel float-over-fullscreen** (`tauri-nspanel`, `objc`) | The popover floats above normal windows but won't appear over *another* app's fullscreen Space. The biggest fidelity gap. |
| **OS sleep/lock/idle reconcile** (`os_signals.rs`, 440) | A laptop closed mid-task banks to the last save (20 s checkpoint) and offers "pick it back up", rather than prompting "you were away 2h — keep or discard?". |
| **Corrupt-file native dialog** (`rfd`) | A damaged state file shows the in-app recovery screen — honest, but only once the webview loads — not a native pre-launch dialog. |

Also absent by choice: the **task-map view** (and its `prevPhase` back-target) and
**PDF export**. Everything else the full app does, this does.

### Note on the parent repo

If you work from the full repo rather than this packet, two things are worth
knowing — both verified by tracing every import and call site:

- **The legacy Rust runtime is already disabled.** `main.rs` says
  `LEGACY RUNTIME DISABLED` and parks `os_signals::install` and
  `nudges::reschedule` behind `let _ = &…`. Of 38 registered commands, the live UI
  calls 15; the other 23 have **zero** callers outside the dead `lib/bridge.ts`.
- **`src/views/`, `src/components/`, `src/lib/`, `src/styles/` are dead code** — 39
  files, still compiled and still tested, but unreachable from `main.ts`. An
  earlier UI generation. Worth deleting.

That's why this packet is 18 files rather than 195, and why nothing was lost:
roughly two-thirds of the original tree was either generated, an earlier
generation, or disabled at runtime.

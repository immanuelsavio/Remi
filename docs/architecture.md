# Architecture

```
┌──────────────────────── ONE Tauri process ────────────────────────┐
│                                                                    │
│  popover webview (380×560)        dashboard webview (900×640)      │
│  views/Popover.svelte             views/Dashboard.svelte           │
│  startClock({owner: true})        startClock({owner: false})       │
│  ── fires notifications           ── display only                  │
│         │                                   │                      │
│         └──── own JS module instance ───────┘                      │
│                  (separate stores!)                                │
│                        │                                           │
│                   invoke() / event bus                             │
│                        ▼                                           │
│  src-tauri/src/ — paths · atomic state I/O · migration · 15        │
│                    commands · tray · windows                       │
│                        ▼                                           │
│     ~/Remi/state.json   (+ .bak, + recovery folder)                │
│     ~/Library/Application Support/com.immanuelsavio.remi/          │
│         settings.json                                              │
└────────────────────────────────────────────────────────────────────┘
```

**Both windows load the same JS bundle.** `src/app/window-router.ts` reads
`getCurrentWindow().label` and mounts `views/Popover.svelte` for
`"popover"` or `views/Dashboard.svelte` for `"dashboard"`. Both windows are
declared in `tauri.conf.json` and exist _hidden from launch_, so opening
either is instant — and it means **two independent JS module instances**,
each with its own store. That single fact drives the effect-ownership rule
and the cross-window sync design.

**Who owns what.** The frontend owns the state _shape_; Rust treats
`state.json` as an opaque `serde_json::Value` and guarantees only the
_durability contract_. So the schema can evolve entirely in TypeScript
with no Rust change. Rust owns paths, atomicity, the tray, window
lifecycle, and the one-time legacy-data migration.

## Frontend layout

```
src/
  main.ts                    entry point
  app/window-router.ts       window-label -> root component
  domain/                    pure functions + types, no store/Tauri/DOM
    types.ts, defaults.ts, ids.ts, dates.ts, time.ts, hydration.ts,
    persistence-shape.ts, tasks.ts, streaks.ts, reminders.ts, trainer.ts,
    imports.ts, usage-logs.ts, theme.ts, tags.ts, search.ts, report.ts,
    tour.ts
  store/                     the Svelte store + everything that mutates
    index.ts                 public facade - the ONLY module components import from
    state.ts                 the writable, sessionTx, commit, snapshot readers
    persistence.ts           debounced atomic save, boot/load
    sync.ts                  cross-window event bus
    clock.ts                 1Hz tick + background effects (reminders, wellness, check-ins)
    day.ts                   Start/End/Restart Day, revive, PTO
    task-actions.ts          task/step CRUD, start/switch/interrupt/complete/promote
    break-actions.ts         start/extend/resume a break
    backlog-actions.ts       backlog CRUD
    telemetry.ts             opt-in usage counters
    ui-state.ts               phase/overlay navigation
    settings-actions.ts      preferences, data folder, quit/uninstall
    import-export.ts         structured-text import, JSON backup export/restore
    report-actions.ts        range/tag selection + writing the work record out
    updates.ts               release check, install, and the what's-new card
  infrastructure/            (Tauri API + notification wrappers, where present)
  components/
    shared/                  RemiMark, Mascot, TagEditor, RemindControl/Sheet,
                              CarryDecisions, ConfirmSubSheet
    popover/phases/          Recovery, Break, StartDay, Active, TaskList, TaskMap
    popover/overlays/        Checkin, Switch, DoneChoose, EndDay, Restart, Backlog, Wellness, WelcomeBack
    dashboard/               Tour, ImportSheet, UpdateCard, WhatsNew
    dashboard/tabs/          Plan, Today, Calendar, Stats, Data, Notes, Settings
  views/
    Popover.svelte           thin router: lifecycle, derived state, phase/overlay dispatch
    Dashboard.svelte         thin router: tab strip (WAI-ARIA), lifecycle, tab dispatch
  styles/
    global.css                tokens + shared controls
```

**Import discipline.** Components import actions from `../store` (the
facade in `store/index.ts`) and read-only helpers from `../view`
(`src/view.ts`). Nothing outside `store/` reaches into `store/state.ts` or
another internal store module directly. Action modules never import each
other — they all import from `store/state.ts`, which is the one shared
core (writable, `commit`, `sessionTx`, and the day-rollover/session
primitives that are mutually referential and would only relocate the
coupling if split further). This star topology is what keeps the module
graph acyclic.

## Rust shell layout

```
src-tauri/
  Cargo.toml            package/bin "remi"
  build.rs               copies assets/icon.png into the generated icons/ dir
  tauri.conf.json        productName "Remi", identifier com.immanuelsavio.remi
  Info.plist              LSUIElement
  assets/
    icon.png              real checked-in app icon (512x512, RGBA)
    tray_mark.rgba         real checked-in tray mark, raw RGBA (64x64), pre-chroma-keyed
  src/
    main.rs                wiring: plugin init, state registration, command
                            registration, run-event dispatch
    paths.rs                config/data-folder path resolution (current + legacy)
    state_io.rs             the durability contract: atomic writes, .bak recovery
    settings.rs              generic JSON settings.json read-modify-write
    migration.rs             one-time legacy Dopamigo MVP -> Remi data migration
    commands.rs               the IPC commands the frontend calls
    tray.rs                   menu-bar icon + tray menu/event handling
    updater.rs                release check, semver compare, detached installer
    windows/                  window lifecycle, split by concern
      mod.rs                   the facade the rest of the shell calls
      popover.rs               placement (a pure, unit-tested function) + show/hide
      dashboard.rs             the ordinary dashboard window
      panel.rs                 NSPanel conversion — what makes the popover
                                draw over other apps' fullscreen Spaces
      anchor.rs                tray-rect anchor + the re-entrancy guard
```

See [data-durability.md](data-durability.md) for the state I/O contract
and migration behavior, and
[timing-and-interruptions.md](timing-and-interruptions.md) for the session
transaction and interruption model.

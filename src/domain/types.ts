/**
 * Remi - the persisted state shape and its constituent types.
 *
 * This shape IS the persisted schema. Rust treats `state.json` as opaque
 * JSON, so this file is the single source of truth for it.
 *
 * Time is REAL: a running session stores an absolute `startedAt` epoch
 * stamp, so elapsed time survives a restart and can never drift from the
 * wall clock.
 */

/** Where the popover is in the daily flow. */
export type Phase = "startday" | "today" | "active" | "break" | "recovery";

/** A modal layered over the current phase. */
export type Overlay =
  null | "checkin" | "switch" | "done-choose" | "restart" | "endday" | "backlog";

/** Dashboard sections, in tab-strip order. */
export type DashTab = "plan" | "today" | "calendar" | "stats" | "data" | "notes" | "settings";

export type Mode = "light" | "dark";
export type Accent = "remi" | "amber" | "coral" | "rose" | "violet" | "teal" | "blue";

/**
 * The accent families and their exact hex values.
 *
 * `remi` is first and is the default: it is sampled from the app icon
 * itself (the coral of the sun behind the mouse, #fd8066, deepened enough
 * that white text on a filled button stays legible). The other six are the
 * showcase's palette, kept so the accent remains the user's choice.
 */
export const ACCENTS: ReadonlyArray<readonly [Accent, string]> = [
  ["remi", "#ec6a4a"],
  ["amber", "#e0762a"],
  ["coral", "#e2543f"],
  ["rose", "#d24d7a"],
  ["violet", "#7a5cd0"],
  ["teal", "#159e8c"],
  ["blue", "#3b7dd8"],
] as const;

export type Costume =
  "none" | "guide" | "planner" | "worker" | "timekeeper" | "detective" | "artist";

/**
 * What Remi can wear, with the label the picker shows.
 *
 * A costume is a layer OVER a pose, never a pose of its own: the mouse
 * still runs, sleeps and holds its pad while dressed. Two axes rather than
 * one combined list, or each new outfit would multiply the poses.
 */
export const COSTUMES: ReadonlyArray<readonly [Costume, string]> = [
  ["none", "No costume"],
  ["guide", "Tour guide"],
  ["planner", "Professor"],
  ["worker", "Construction worker"],
  ["timekeeper", "Timekeeper"],
  ["detective", "Detective"],
  ["artist", "Artist"],
] as const;

/** 8h default workday; drives the "time given back" stat. */
export const DEFAULT_TARGET_MINS = 480;

/** How a reminder was expressed, kept so it can be re-displayed and edited. */
export type RemindKind = "in" | "by" | "on";

export interface Remind {
  kind: RemindKind;
  /** The user's original input (minutes, "HH:MM", or an ISO datetime-local). */
  raw: string;
  /** Absolute epoch ms when it is due. */
  at: number;
  /** Full label, e.g. "Remind by 2pm (tomorrow)". */
  label: string;
  /** Compact badge text, e.g. "by 2pm". */
  short: string;
  /** Set once delivered, so a reminder never fires twice. */
  delivered?: boolean;
}

/** A step inside a main task (one visible level, per the spec). */
export interface Sub {
  id: string;
  title: string;
  /** Banked ms, EXCLUDING any currently-running session. */
  accrued: number;
  done: boolean;
  remind: Remind | null;
  note: string;
}

export interface Main {
  id: string;
  title: string;
  subs: Sub[];
  accrued: number;
  done: boolean;
  /** True when this task was promoted out of a step. */
  fromSub: boolean;
  /**
   * You said "tomorrow" for this at End Day, and then reopened the day.
   *
   * Display only - a deferred task is a perfectly normal task you can start
   * whenever you like. It exists so reopening a day does not silently erase
   * a decision you made deliberately: the label says "you meant to leave
   * this until tomorrow", and starting it clears the label rather than
   * arguing with you.
   *
   * Only set when the choice was EXPLICIT. Ending the day without deciding
   * anything carries everything by default, which is not the same as
   * saying "tomorrow" about each one.
   */
  deferred: boolean;
  /** UI: whether its steps are expanded in the planner. */
  _showSubs: boolean;
  remind: Remind | null;
  note: string;
  /** How many times this task has been carried to a new day (avoidance signal). */
  carries: number;
  /** Time-sense trainer estimate, in ms (0 = none). */
  estMs: number;
  /**
   * Free-form labels: a project, a client, a kind of work.
   *
   * Stored lowercased and de-duplicated so "Coding" and "coding" are one
   * tag rather than two that never quite match when you filter.
   */
  tags: string[];

  /**
   * When it was FIRST started, and when it was completed.
   *
   * `accrued` answers "how long was I actually working?"; the span between
   * these two answers "how long did it take in real time?". The gap between
   * them is what interruptions cost - the number that shows a task
   * estimated at 2h can occupy 5h of the day.
   */
  firstStartedAt: number;
  completedAt: number;
  interruptedCount: number;
  interruptedMs: number;
}

export interface BacklogItem {
  id: string;
  title: string;
  remind: Remind | null;
  note?: string;
}

/**
 * A task preserved across a day boundary.
 *
 * A DURABLE SNAPSHOT, not a title-only reconstruction: notes, reminders and
 * estimates must survive "Tomorrow", because the notes UI promises a note
 * stays attached to its task. Only the elapsed time resets - it is a new
 * day's work.
 */
export interface CarrySnapshot {
  title: string;
  note: string;
  tags?: string[];
  remind: Remind | null;
  estMs: number;
  carries: number;
  subs: { title: string; note: string; remind: Remind | null }[];
}

/** One completed item in a day's history record. */
export interface CompletedRecord {
  title: string;
  kind: "task" | "step";
  /** Focused time actually spent on it. */
  ms: number;
  /** Wall-clock ms from first start to completion. */
  elapsedMs?: number;
  interruptedCount?: number;
  interruptedMs?: number;
  /** The estimate given up front, when the trainer was on. */
  estMs?: number;
  /**
   * The task's tags, copied in at archive time.
   *
   * Denormalised on purpose: the record has to stand on its own. Once a day
   * is archived the `Main` it came from is gone, so a report filtered by
   * tag could not resolve one by looking anything up.
   */
  tags?: string[];
}

/** An unfinished task (with its open steps) left at end of day. */
export interface UnfinishedRecord {
  title: string;
  subs: { title: string; note: string }[];
  tags?: string[];
}

/** A day's immutable record: calendar, stats, streaks and export all read it. */
export interface DayRecord {
  day: number;
  dateISO: string;
  completed: CompletedRecord[];
  unfinished: UnfinishedRecord[];
  totalMs: number;
  interruptions?: InterruptionEvent[];
}

/**
 * One interruption: something pulled you off a task, and how long it took.
 *
 * Recorded per occurrence rather than as a counter so a report can show
 * WHAT interrupted, for HOW long, and WHICH task paid for it - the evidence
 * a person needs when a two-hour estimate turned into a five-hour day.
 */
export interface InterruptionEvent {
  id: string;
  /** Local date it started (YYYY-MM-DD). */
  dateISO: string;
  /**
   * The id of the task that was interrupted, used to attribute the closed
   * duration and increment `interruptedCount`/`interruptedMs` on the RIGHT
   * task. Titles are not unique and can be renamed mid-interruption; the id
   * is the real identity. Empty string only for interruptions hydrated from
   * a file written before this field existed (they degrade to "no victim
   * found", same as an unmatched title used to).
   */
  interruptedId: string;
  /** What was being worked on when it happened - display only. */
  interruptedTitle: string;
  /** What pulled them away - display only. */
  causeTitle: string;
  atMs: number;
  durationMs: number;
  /**
   * Whether the person has come back yet.
   *
   * An explicit flag rather than `durationMs > 0`: a very short interruption
   * can legitimately round to zero ms, and inferring "still open" from a
   * zero duration would leave it open forever, letting it swallow the rest
   * of the day.
   */
  open: boolean;
  /** How it started: the Interrupt button, a switch, or a check-in "no". */
  via: "interrupt" | "switch" | "checkin";
}

/** One estimate-vs-actual data point for the time-sense trainer. */
export interface EstimateEntry {
  estMs: number;
  actualMs: number;
}

export type WellnessKey = "water" | "stand" | "walk" | "lunch" | "breakr";

/** A single wellness nudge's configuration. */
export interface WellnessCfg {
  on: boolean;
  everyMin?: number;
  /** Lunch only: the hour of day to nudge around. */
  atHour?: number;
  /** Epoch ms of the last fire (0 = never). */
  _last: number;
  /**
   * Epoch ms until which this nudge is snoozed.
   *
   * Separate from `_last` on purpose: for the once-a-day lunch nudge,
   * writing `_last` on snooze would read as "already had lunch" and mute it
   * all day.
   */
  _snoozedUntil?: number;
}

export type Wellness = Record<WellnessKey, WellnessCfg>;

/** An entry on the return stack: what to resume after the current work. */
export interface ReturnEntry {
  mainId: string;
  subId: string | null;
}

/**
 * Anonymous, content-free usage counters, bucketed by day number.
 *
 * NEVER contains task titles, notes, backlog text or reminder text - only
 * counts and the shape of what happened. That constraint is what makes it
 * safe to export and hand to someone.
 */
export interface Metrics {
  days: Record<
    string,
    {
      events: Record<string, number>;
      clicks: Record<string, number>;
      friction: Record<string, number>;
    }
  >;
  errors: { at: number; day: number; where: string; msg: string }[];
}

/** A snapshot of the day End Day just closed, so it can be reopened. */
/** What the tour's demo replaces, kept so it can be put back exactly. */
export interface DemoSnapshot {
  mains: Main[];
  interruptions: InterruptionEvent[];
  activeMainId: string | null;
  activeSubId: string | null;
  startedAt: number;
  phase: Phase;
}

export interface ResumableDay {
  dayNum: number;
  dateISO: string;
  mains: Main[];
  interruptions: InterruptionEvent[];
  /** End Day can award a revive at a 5-day streak; undoing takes it back. */
  life: number;
  /**
   * What was chosen per task, so reopening can honour it rather than
   * flatten it: a task sent to the backlog stays there, one marked done
   * stays done, and one marked "tomorrow" comes back wearing that label.
   */
  choices: Record<string, CarryChoice>;
  /**
   * Whether any of that was an actual decision.
   *
   * A plain "wrap up the day" carries everything by default. Reopening
   * after that should hand the day back exactly as it was, with no labels -
   * nobody said "tomorrow" about anything.
   */
  decided: boolean;
}

/** What End Day does with one unfinished task. */
export type CarryChoice = "done" | "carry" | "backlog";

/** The complete persisted product state. */
export interface State {
  /** Schema version, for future migrations. */
  v: number;

  /**
   * The revision last known to be on disk, for cross-window
   * compare-and-swap saves (`_rev` in the persisted JSON - see
   * `src-tauri/src/state_io.rs`'s `write_state_cas`).
   *
   * Each successful save bumps this by exactly one. A save whose `_rev`
   * doesn't match what Rust currently has on disk means the OTHER window
   * saved a newer revision first - Rust rejects it rather than silently
   * overwriting, and the frontend reloads instead of losing that write.
   * Never touched by domain logic directly; only `store/persistence.ts`
   * reads and advances it.
   */
  _rev: number;

  phase: Phase;
  dayNum: number;
  /** The real calendar date this day represents (YYYY-MM-DD). */
  dateISO: string;
  /**
   * True once End Day has run and this state is a fresh, not-yet-started day.
   *
   * Rollover MUST be idempotent: without this flag, ending the day and
   * reopening the app next morning would roll AGAIN - double-incrementing
   * `dayNum` and rebuilding the carry list from an empty `mains`, silently
   * dropping every task the user marked "Tomorrow".
   */
  awaitingStart: boolean;
  /**
   * Whether the user has already decided, task by task, what happens to the
   * work in `carrySeed`.
   *
   * End Day asks; an unattended midnight rollover cannot - nobody is there.
   * Without this flag Start Day could not tell "you already chose to carry
   * these three" from "these three carried because the clock ticked past
   * midnight", and would either re-ask every morning or never ask at all.
   */
  carryDecided: boolean;

  mains: Main[];
  carrySeed: CarrySnapshot[];
  backlog: BacklogItem[];
  history: DayRecord[];
  estimateLog: EstimateEntry[];
  /** Today's interruptions, archived into the day record at End Day. */
  interruptions: InterruptionEvent[];

  // ---- preferences (portable user data) ----
  trainerOn: boolean;
  avoidanceOn: boolean;
  mode: Mode;
  accent: Accent;
  dayTargetMins: number;
  /** Check-in interval in minutes (0 = off). */
  pingMin: number;
  wellness: Wellness;
  /** Tasks seeded fresh into every new day ("standard daily" routines). */
  standardDaily: string[];
  /**
   * Whether the guided tour has been shown.
   *
   * Persisted so it runs exactly once, unprompted, on a first launch - and
   * never again unless asked for from Settings. Nothing is more tiresome
   * than an onboarding flow that forgets it already ran.
   */
  tourSeen: boolean;

  /**
   * Anonymous usage logging. ON by default during the beta.
   *
   * The counters are content-free by construction (see `buildLogs`), so
   * "on" costs the user nothing they would object to, and a beta with no
   * usage signal is a beta nobody learns anything from. It stays a visible
   * one-click switch in Data, and turning it off stops collection
   * immediately.
   *
   * Existing installs keep whatever they had: `hydrate` only treats an
   * ABSENT key as "on", and every file written by an earlier build has the
   * key present.
   */
  loggingOptIn: boolean;

  /**
   * The user's own words about what is wrong - free text, and the ONE
   * place in the export that deliberately carries content.
   *
   * Kept separate from `metrics` precisely so that boundary stays legible:
   * everything under `metrics` is counts, this is prose the user chose to
   * write and chose to send.
   */
  feedback: string;

  // ---- notification preferences ----
  notifyReminders: boolean;
  notifyBreakEnd: boolean;
  /**
   * Offer to pick up where you left off after being away.
   *
   * Time accounting NEVER depends on this: a session running when the app
   * closed is always banked only up to the last save, so the clock cannot
   * credit time nobody worked whether this is on or off. It only controls
   * whether Remi *says something* when you come back.
   */
  welcomeBack: boolean;
  /**
   * Keep task names OUT of OS notifications.
   *
   * Banners are visible to anyone watching your screen - including everyone
   * in a screen share or on a projector. With this on, a reminder says "A
   * task reminder is due" instead of naming the task; the detail stays
   * inside the app, where only you are looking.
   */
  privateNotifications: boolean;
  /**
   * Show the animated mascot.
   *
   * Remi is a mouse - it is on the icon, in the menu bar and on the wordmark
   * - and the animated version of it reports what the app is doing without
   * words: running while the clock runs, asleep during a break, awake and
   * waiting when nothing is timed.
   *
   * It is a preference and not a decoration because motion in the corner of
   * the eye is exactly the kind of thing this app's audience may not want.
   * Defaults ON; `prefers-reduced-motion` already freezes it at the OS level
   * whatever this says, so the two controls compose rather than fight.
   */
  mascotOn: boolean;
  /**
   * Play the wake-up sequence when the day starts.
   *
   * Remi is asleep until you begin: pressing Start wakes it, it rubs its
   * eyes, crosses to its desk and gets to work - and only then does the
   * dashboard open up. It is a deliberate beat between "not started" and
   * "started", which is the one moment in this app where a pause is the
   * point rather than a cost.
   *
   * Separate from `mascotOn` because they are different objections: one is
   * "I don't want a cartoon in my tool", the other is "I don't want to wait
   * three seconds every morning". Either can be true alone. Skipped
   * entirely under `prefers-reduced-motion`, and the sequence is always
   * click-to-skip.
   */
  wakeAnimation: boolean;
  /**
   * Let Remi wander the dashboard, and scurry to wherever you click.
   *
   * Purely for fun - it tracks nothing and reports nothing, which is why it
   * is the one mascot behaviour that defaults OFF. Everything else the
   * mouse does is a readout of real state; this is movement for its own
   * sake, in the periphery, inside an app built for people whose attention
   * is the scarce resource. That is a deliberate choice to opt in to, not
   * one to discover and have to switch off.
   *
   * Also skipped under `prefers-reduced-motion`, which no toggle overrides.
   */
  roamOn: boolean;
  /**
   * What to call you. Empty means "never mind", and every use site treats
   * it that way rather than printing a dangling comma.
   *
   * Clamped to `NAME_MAX` by `normalizeName` on the way in, because it is
   * rendered inside headings, buttons and a popover only as wide as a menu
   * bar, and nothing downstream clamps it.
   */
  userName: string;
  /**
   * The name that appears on an exported work record.
   *
   * Separate from `userName` because they are read by different people:
   * the nickname is what Remi calls you in your own app, and this is what
   * a manager or a client sees at the top of a printed page. "Sam" is right
   * for one and wrong for the other.
   */
  fullName: string;
  /** What Remi wears day to day. The tour dresses itself per page regardless. */
  mascotCostume: Costume;
  /**
   * The real day, held aside while the tour's demo is on screen.
   *
   * The demo lives in ordinary state rather than a parallel preview mode,
   * because a tour that points at a fake screen is not pointing at the app.
   * The price is that quitting mid-tour would otherwise strand someone in
   * someone else's tasks, so this snapshot is PERSISTED and restored on the
   * next boot, not merely held in memory.
   *
   * Non-null means "a demo is currently up". There is no separate flag: two
   * sources of truth for the same fact is how you end up restoring twice or
   * never.
   */
  demoRestore: DemoSnapshot | null;
  /**
   * When the user uninstalled while choosing to keep their history.
   *
   * Written to `state.json` immediately BEFORE the wipe, because the wipe
   * is what makes it meaningful: `keep_history` deletes settings.json and
   * leaves the state file, so this survives into the reinstall and is the
   * only trace that the app was ever gone. 0 means an ordinary launch.
   *
   * Cleared the moment it has been read, so a returning greeting happens
   * once and not on every launch afterwards.
   */
  leftAt: number;
  /**
   * Show the running task's elapsed time next to the menu-bar icon.
   *
   * Ambient time awareness with nothing to click - the single most useful
   * thing an ADHD tool can put on screen, since time blindness is the core
   * difficulty.
   */
  trayTimer: boolean;

  // ---- streak facts ----
  /** Days marked as time off, which bridge a streak gap. */
  pto: string[];
  /** Revive hearts held (0 or 1). */
  life: number;
  /** Days rescued by spending a revive. */
  revived: string[];

  // ---- live session ----
  activeMainId: string | null;
  activeSubId: string | null;
  /** Absolute epoch ms the current session started (0 = none). */
  startedAt: number;
  returnStack: ReturnEntry[];

  // ---- break ----
  breakEndsAt: number;
  breakPausedTitle: string;

  metrics: Metrics;

  /**
   * Everything needed to undo the last End Day.
   *
   * Ending the day empties `mains` and archives the day, which is correct -
   * but it is also the single most destructive-looking thing the app does,
   * and it is one click away with no confirmation of what happened. Without
   * this, a mis-click costs you the shape of your whole day: which tasks
   * were done, what time each had accrued, what interrupted you.
   *
   * A snapshot rather than a derivation because the archive cannot be run
   * backwards - a `CompletedRecord` keeps a title and a duration, not the
   * `Main` it came from, so completed tasks could never be rebuilt from
   * `history` and `carrySeed` alone.
   *
   * Cleared the moment the next day actually starts.
   */
  resumable?: ResumableDay | null;

  /** Wall-clock ms of the last successful save. See `bankOrphanSession`. */
  savedAt: number;

  // ---- transient UI (stripped before persisting) ----
  overlay?: Overlay;
  switchReason?: string;
  subsOpen?: boolean;
  /** Bounded check-in: how many pings have fired this session (0..3, 3 = stop). */
  ciStage?: number;
  /** Mute check-ins for this date (YYYY-MM-DD). */
  ciMutedDate?: string | null;
}

/** Fields that must never be written to disk (pure UI/session scratch). */
export const TRANSIENT_KEYS = ["overlay", "switchReason", "subsOpen"] as const;

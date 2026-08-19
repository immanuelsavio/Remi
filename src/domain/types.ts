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
export type DashTab = "plan" | "today" | "calendar" | "stats" | "data" | "settings";

export type Mode = "light" | "dark";
export type Accent = "amber" | "coral" | "rose" | "violet" | "teal" | "blue";

/** The six accent families and their exact hex values. */
export const ACCENTS: ReadonlyArray<readonly [Accent, string]> = [
  ["amber", "#e0762a"],
  ["coral", "#e2543f"],
  ["rose", "#d24d7a"],
  ["violet", "#7a5cd0"],
  ["teal", "#159e8c"],
  ["blue", "#3b7dd8"],
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
  /** UI: whether its steps are expanded in the planner. */
  _showSubs: boolean;
  remind: Remind | null;
  note: string;
  /** How many times this task has been carried to a new day (avoidance signal). */
  carries: number;
  /** Time-sense trainer estimate, in ms (0 = none). */
  estMs: number;

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
}

/** An unfinished task (with its open steps) left at end of day. */
export interface UnfinishedRecord {
  title: string;
  subs: { title: string; note: string }[];
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
   * Anonymous usage logging. OFF by default: it is described to the user as
   * opt-in, so it must not start collecting before they say yes.
   */
  loggingOptIn: boolean;

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

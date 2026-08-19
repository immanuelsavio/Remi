/**
 * Dopamigo - the state shape and every PURE function over it.
 *
 * Full-repo equivalent: `showcase/lib/model.ts` + `showcase/lib/logic.ts` +
 * `showcase/lib/validate.ts` (~1470 lines). Nothing here touches the Svelte
 * store, the DOM (except `applyTheme`) or Tauri, so all of it is directly
 * testable — which is why the split is model/logic here and store/actions there.
 *
 * This shape IS the persisted schema. Rust treats `state.json` as opaque JSON,
 * so this file is the single source of truth for it.
 *
 * Time is REAL: a running session stores an absolute `startedAt` epoch stamp, so
 * elapsed time survives a restart and can never drift from the wall clock.
 */

// ===========================================================================
// TYPES
// ===========================================================================

/** Where the popover is in the daily flow. */
export type Phase = "startday" | "today" | "active" | "break" | "recovery";

/** A modal layered over the current phase. */
export type Overlay =
  | null
  | "checkin"
  | "switch"
  | "done-choose"
  | "restart"
  | "endday"
  | "backlog";

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
   * `accrued` answers "how long was I actually working?"; the span between these
   * two answers "how long did it take in real time?". The gap between them is
   * what interruptions cost — the number that shows a task estimated at 2h can
   * occupy 5h of the day.
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
 * estimates must survive "Tomorrow", because the notes UI promises a note stays
 * attached to its task. Only the elapsed time resets — it is a new day's work.
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
 * Recorded per occurrence rather than as a counter so a report can show WHAT
 * interrupted, for HOW long, and WHICH task paid for it — the evidence a person
 * needs when a two-hour estimate turned into a five-hour day.
 */
export interface InterruptionEvent {
  id: string;
  /** Local date it started (YYYY-MM-DD). */
  dateISO: string;
  /** What was being worked on when it happened. */
  interruptedTitle: string;
  /** What pulled them away. */
  causeTitle: string;
  atMs: number;
  durationMs: number;
  /**
   * Whether the person has come back yet.
   *
   * An explicit flag rather than `durationMs > 0`: a very short interruption can
   * legitimately round to zero ms, and inferring "still open" from a zero
   * duration would leave it open forever, letting it swallow the rest of the day.
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
   * Separate from `_last` on purpose: for the once-a-day lunch nudge, writing
   * `_last` on snooze would read as "already had lunch" and mute it all day.
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
 * NEVER contains task titles, notes, backlog text or reminder text - only counts
 * and the shape of what happened. That constraint is what makes it safe to
 * export and hand to someone.
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

  phase: Phase;
  dayNum: number;
  /** The real calendar date this day represents (YYYY-MM-DD). */
  dateISO: string;
  /**
   * True once End Day has run and this state is a fresh, not-yet-started day.
   *
   * Rollover MUST be idempotent: without this flag, ending the day and reopening
   * the app next morning would roll AGAIN — double-incrementing `dayNum` and
   * rebuilding the carry list from an empty `mains`, silently dropping every
   * task the user marked "Tomorrow".
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
   * Time accounting NEVER depends on this: a session running when the app closed
   * is always banked only up to the last save, so the clock cannot credit time
   * nobody worked whether this is on or off. It only controls whether Dopamigo
   * *says something* when you come back.
   */
  welcomeBack: boolean;
  /**
   * Keep task names OUT of OS notifications.
   *
   * Banners are visible to anyone watching your screen — including everyone in a
   * screen share or on a projector. With this on, a reminder says "A task
   * reminder is due" instead of naming the task; the detail stays inside the app,
   * where only you are looking.
   */
  privateNotifications: boolean;
  /**
   * Show the running task's elapsed time next to the menu-bar icon.
   *
   * Ambient time awareness with nothing to click — the single most useful thing
   * an ADHD tool can put on screen, since time blindness is the core difficulty.
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

// ===========================================================================
// CONSTRUCTORS
// ===========================================================================

/**
 * A collision-free id.
 *
 * Deliberately NOT a per-window counter: the popover and dashboard are separate
 * JS module instances, so two counters would both mint "x7" and one item could
 * overwrite the other after a cross-window reload. `crypto.randomUUID` exists in
 * every webview Tauri ships; the fallback keeps tests and odd runtimes working.
 */
export function nid(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function mkSub(title: string): Sub {
  return { id: nid(), title, accrued: 0, done: false, remind: null, note: "" };
}

export function mkMain(title: string, subs: Sub[] = []): Main {
  return {
    id: nid(),
    title,
    subs,
    accrued: 0,
    done: false,
    fromSub: false,
    _showSubs: false,
    remind: null,
    note: "",
    carries: 0,
    estMs: 0,
    firstStartedAt: 0,
    completedAt: 0,
    interruptedCount: 0,
    interruptedMs: 0,
  };
}

/** Today's LOCAL date as YYYY-MM-DD. A UTC date would roll the day mid-evening. */
export function todayISO(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function freshWellness(): Wellness {
  return {
    water: { on: false, everyMin: 60, _last: 0 },
    stand: { on: false, everyMin: 45, _last: 0 },
    walk: { on: false, everyMin: 120, _last: 0 },
    lunch: { on: false, atHour: 13, _last: 0 },
    breakr: { on: false, everyMin: 90, _last: 0 },
  };
}

/**
 * A brand-new day. `carry` seeds the tasks shown on the Start Day screen.
 * Preferences and cross-day facts are copied over by `endDay`, not here.
 */
export function freshDay(dayNum = 1, carry: CarrySnapshot[] = []): State {
  return {
    v: 1,
    phase: "startday",
    dayNum,
    dateISO: todayISO(),
    awaitingStart: true,
    mains: [],
    carrySeed: carry,
    backlog: [],
    history: [],
    estimateLog: [],
    interruptions: [],
    trainerOn: false,
    avoidanceOn: true,
    mode: "light",
    accent: "amber",
    dayTargetMins: DEFAULT_TARGET_MINS,
    pingMin: 15,
    wellness: freshWellness(),
    standardDaily: [],
    loggingOptIn: false,
    notifyReminders: true,
    notifyBreakEnd: true,
    welcomeBack: true,
    privateNotifications: false,
    trayTimer: true,
    pto: [],
    life: 1,
    revived: [],
    activeMainId: null,
    activeSubId: null,
    startedAt: 0,
    returnStack: [],
    breakEndsAt: 0,
    breakPausedTitle: "",
    metrics: { days: {}, errors: [] },
    savedAt: 0,
    overlay: null,
    switchReason: "",
    subsOpen: false,
    ciStage: 0,
    ciMutedDate: null,
  };
}

// ===========================================================================
// HYDRATE - never trust what came off disk
// ===========================================================================

/**
 * Merge a loaded (possibly older, partial or hostile) state over a fresh default
 * so a missing field can never crash the app, and unknown future fields survive.
 *
 * Every collection is repaired and every number coerced, because a single bad
 * value would otherwise wedge the app on boot with no way back in.
 */
export function hydrate(raw: unknown): State {
  const base = freshDay();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const s = { ...base, ...(raw as Partial<State>) } as State;

  // Only real objects are tasks. `filter(Boolean)` is NOT enough: a bare string
  // in the array is truthy and would survive as a phantom "Untitled" task.
  const isObj = (x: unknown): x is Record<string, unknown> =>
    !!x && typeof x === "object" && !Array.isArray(x);
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const num = (v: unknown, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
  const str = (v: unknown, f = "") => (typeof v === "string" ? v : f);

  s.mains = arr<unknown>(s.mains)
    .filter(isObj)
    .map((m) => {
      const out = mkMain(str(m.title, "Untitled"));
      out.id = str(m.id) || out.id;
      out.accrued = Math.max(0, num(m.accrued));
      out.done = m.done === true;
      out.fromSub = m.fromSub === true;
      out._showSubs = false;
      out.note = str(m.note);
      out.remind = normalizeRemind(m.remind);
      out.carries = Math.max(0, num(m.carries));
      out.estMs = Math.max(0, num(m.estMs));
      out.firstStartedAt = Math.max(0, num(m.firstStartedAt));
      out.completedAt = Math.max(0, num(m.completedAt));
      out.interruptedCount = Math.max(0, num(m.interruptedCount));
      out.interruptedMs = Math.max(0, num(m.interruptedMs));
      out.subs = arr<unknown>(m.subs)
        .filter(isObj)
        .map((x) => {
          const sub = mkSub(str(x.title, "Untitled"));
          sub.id = str(x.id) || sub.id;
          sub.accrued = Math.max(0, num(x.accrued));
          sub.done = x.done === true;
          sub.note = str(x.note);
          sub.remind = normalizeRemind(x.remind);
          return sub;
        });
      return out;
    });

  s.backlog = arr<unknown>(s.backlog)
    .filter(isObj)
    .map((b) => ({
      id: str(b.id) || nid(),
      title: str(b.title, "Untitled"),
      remind: normalizeRemind(b.remind),
      note: str(b.note),
    }));

  s.carrySeed = arr<unknown>(s.carrySeed)
    .filter(isObj)
    .map((c) => ({
      title: str(c.title, "Untitled"),
      note: str(c.note),
      remind: normalizeRemind(c.remind),
      estMs: Math.max(0, num(c.estMs)),
      carries: Math.max(0, num(c.carries)),
      subs: arr<unknown>(c.subs)
        .filter(isObj)
        .map((x) => ({
          title: str(x.title, "Untitled"),
          note: str(x.note),
          remind: normalizeRemind(x.remind),
        })),
    }));

  s.history = arr<unknown>(s.history)
    .filter(isObj)
    .map((h) => ({
      day: num(h.day, 1),
      dateISO: str(h.dateISO),
      totalMs: Math.max(0, num(h.totalMs)),
      completed: arr<unknown>(h.completed)
        .filter(isObj)
        .map((c) => ({
          title: str(c.title, "Untitled"),
          kind: c.kind === "step" ? ("step" as const) : ("task" as const),
          ms: Math.max(0, num(c.ms)),
          elapsedMs: c.elapsedMs === undefined ? undefined : Math.max(0, num(c.elapsedMs)),
          interruptedCount:
            c.interruptedCount === undefined ? undefined : Math.max(0, num(c.interruptedCount)),
          interruptedMs:
            c.interruptedMs === undefined ? undefined : Math.max(0, num(c.interruptedMs)),
          estMs: c.estMs === undefined ? undefined : Math.max(0, num(c.estMs)),
        })),
      unfinished: arr<unknown>(h.unfinished)
        .filter(isObj)
        .map((u) => ({
          title: str(u.title, "Untitled"),
          subs: arr<unknown>(u.subs)
            .filter(isObj)
            .map((x) => ({ title: str(x.title, "Untitled"), note: str(x.note) })),
        })),
      interruptions: Array.isArray(h.interruptions)
        ? arr<unknown>(h.interruptions).filter(isObj).map(normalizeInterruption)
        : undefined,
    }))
    // A record with no date can never be placed on a calendar or in a streak.
    .filter((h) => !!h.dateISO);

  s.estimateLog = arr<unknown>(s.estimateLog)
    .filter(isObj)
    .map((e) => ({ estMs: Math.max(0, num(e.estMs)), actualMs: Math.max(0, num(e.actualMs)) }));

  s.interruptions = arr<unknown>(s.interruptions).filter(isObj).map(normalizeInterruption);

  // A return entry pointing at a task that no longer exists would send the user
  // "back" to nothing when they finish what interrupted them.
  s.returnStack = arr<unknown>(s.returnStack)
    .filter(isObj)
    .map((r) => ({ mainId: str(r.mainId), subId: typeof r.subId === "string" ? r.subId : null }))
    .filter((r) => {
      const rm = s.mains.find((m) => m.id === r.mainId);
      if (!rm || rm.done) return false;
      return !r.subId || rm.subs.some((x) => x.id === r.subId);
    });

  // Metrics: counters only. A malformed bucket becomes an empty one rather than
  // failing the load, and the error list is capped so a crash loop can't grow the
  // state file without bound.
  const rawM = (s.metrics ?? {}) as Partial<Metrics>;
  const days: Metrics["days"] = {};
  if (rawM.days && typeof rawM.days === "object") {
    Object.entries(rawM.days).forEach(([k, v]) => {
      const b = (v ?? {}) as Record<string, unknown>;
      const counts = (x: unknown): Record<string, number> => {
        const out: Record<string, number> = {};
        if (x && typeof x === "object") {
          Object.entries(x as Record<string, unknown>).forEach(([kk, vv]) => {
            if (Number.isFinite(Number(vv))) out[kk] = Number(vv);
          });
        }
        return out;
      };
      days[k] = { events: counts(b.events), clicks: counts(b.clicks), friction: counts(b.friction) };
    });
  }
  s.metrics = {
    days,
    errors: arr<unknown>(rawM.errors)
      .filter(isObj)
      .map((e) => ({
        at: Math.max(0, num(e.at)),
        day: Math.max(0, num(e.day)),
        where: str(e.where).slice(0, 80),
        msg: str(e.msg).slice(0, 200),
      }))
      .slice(-50),
  };
  s.loggingOptIn = s.loggingOptIn === true; // opt-in: absent means NO

  s.pto = arr<unknown>(s.pto).filter((x): x is string => typeof x === "string");
  s.revived = arr<unknown>(s.revived).filter((x): x is string => typeof x === "string");
  s.standardDaily = arr<unknown>(s.standardDaily).filter(
    (x): x is string => typeof x === "string",
  );

  // Wellness: merge over the defaults so a new nudge key is never missing.
  const w = freshWellness();
  const rawW = (s.wellness ?? {}) as Partial<Wellness>;
  (Object.keys(w) as WellnessKey[]).forEach((k) => {
    const c = rawW[k];
    if (c && typeof c === "object") {
      w[k] = {
        on: c.on === true,
        everyMin: c.everyMin === undefined ? w[k].everyMin : Math.max(1, num(c.everyMin, 60)),
        atHour: c.atHour === undefined ? w[k].atHour : Math.min(23, Math.max(0, num(c.atHour, 13))),
        _last: Math.max(0, num(c._last)),
        _snoozedUntil: c._snoozedUntil ? Math.max(0, num(c._snoozedUntil)) : undefined,
      };
    }
  });
  s.wellness = w;

  // Scalars.
  s.v = num(s.v, 1);
  s.dayNum = Math.max(1, num(s.dayNum, 1));
  s.startedAt = Math.max(0, num(s.startedAt));
  s.savedAt = Math.max(0, num(s.savedAt));
  s.breakEndsAt = Math.max(0, num(s.breakEndsAt));
  s.breakPausedTitle = str(s.breakPausedTitle);
  s.dayTargetMins = Math.max(30, num(s.dayTargetMins, DEFAULT_TARGET_MINS));
  s.pingMin = Math.max(0, num(s.pingMin, 15));
  s.life = Math.max(0, Math.min(1, num(s.life, 1)));
  s.trainerOn = s.trainerOn === true;
  s.avoidanceOn = s.avoidanceOn !== false;
  s.mode = s.mode === "dark" ? "dark" : "light";
  s.accent = ACCENTS.some(([k]) => k === s.accent) ? s.accent : "amber";
  s.activeMainId = typeof s.activeMainId === "string" ? s.activeMainId : null;
  s.activeSubId = typeof s.activeSubId === "string" ? s.activeSubId : null;

  // Older files predate these keys; default them ON rather than silently
  // disabling notifications the user never turned off.
  s.notifyReminders = s.notifyReminders !== false;
  s.notifyBreakEnd = s.notifyBreakEnd !== false;
  s.welcomeBack = s.welcomeBack !== false;
  s.trayTimer = s.trayTimer !== false;
  s.privateNotifications = s.privateNotifications === true;

  const PHASES: Phase[] = ["startday", "today", "active", "break", "recovery"];
  s.phase = PHASES.includes(s.phase) ? s.phase : "today";
  if (!s.dateISO) s.dateISO = todayISO();

  // Older files predate the flag. Infer it: a day with no tasks sitting on the
  // Start-day screen has effectively not begun.
  //
  // Read from `raw`, NOT from `s`: the base-default spread above already put a
  // `true` there, so testing `s` would always take the explicit branch and never
  // infer anything.
  const rawAwaiting = (raw as Record<string, unknown>).awaitingStart;
  s.awaitingStart =
    typeof rawAwaiting === "boolean"
      ? rawAwaiting
      : s.mains.length === 0 && s.phase === "startday";

  // Transient fields always start clean.
  s.overlay = null;
  s.switchReason = "";
  s.subsOpen = false;
  s.ciStage = Math.max(0, num(s.ciStage));
  s.ciMutedDate = typeof s.ciMutedDate === "string" ? s.ciMutedDate : null;

  // A session pointing at a task that no longer exists would tick forever and
  // bank into nothing.
  const m = s.activeMainId ? s.mains.find((x) => x.id === s.activeMainId) : null;
  if (!m || m.done) {
    s.activeMainId = null;
    s.activeSubId = null;
    s.startedAt = 0;
    if (s.phase === "active") s.phase = "today";
  } else if (s.activeSubId && !m.subs.some((x) => x.id === s.activeSubId)) {
    s.activeSubId = null;
  }
  return s;
}

function normalizeRemind(v: unknown): Remind | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const at = Number(r.at);
  if (!Number.isFinite(at) || at <= 0) return null;
  const kind: RemindKind = r.kind === "in" || r.kind === "by" ? r.kind : "on";
  return {
    kind,
    raw: typeof r.raw === "string" ? r.raw : "",
    at,
    label: typeof r.label === "string" ? r.label : "Reminder",
    short: typeof r.short === "string" ? r.short : "due",
    delivered: r.delivered === true,
  };
}

function normalizeInterruption(e: Record<string, unknown>): InterruptionEvent {
  const via = e.via === "switch" || e.via === "checkin" ? e.via : "interrupt";
  return {
    id: typeof e.id === "string" ? e.id : nid(),
    dateISO: typeof e.dateISO === "string" ? e.dateISO : todayISO(),
    interruptedTitle: typeof e.interruptedTitle === "string" ? e.interruptedTitle : "a task",
    causeTitle: typeof e.causeTitle === "string" ? e.causeTitle : "something else",
    atMs: Math.max(0, Number(e.atMs) || 0),
    durationMs: Math.max(0, Number(e.durationMs) || 0),
    open: e.open === true,
    via,
  };
}

/**
 * Strip transient UI fields so only durable product state is written, and stamp
 * `savedAt`.
 *
 * `savedAt` is what lets a session still running at quit be credited honestly on
 * the next launch: time is banked up to the LAST SAVE, not up to "now", so a
 * machine left off overnight cannot award hours nobody worked.
 */
export function forPersist(s: State, now: number = Date.now()): Record<string, unknown> {
  const out: Record<string, unknown> = { ...s, savedAt: now };
  for (const k of TRANSIENT_KEYS) delete out[k];
  return out;
}

// ===========================================================================
// FORMATTERS
// ===========================================================================

/** `h:mm:ss` for a live timer. */
export function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** Compact `2h 15m` / `45m` for an estimate or a total. */
export function fmtEst(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins}m`;
}

/** Alias kept because both names read better in different places. */
export const hoursStr = fmtEst;

export const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function prettyDate(d: Date): string {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** Parse YYYY-MM-DD as a LOCAL date (not UTC, which would shift the day). */
export function dateFromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isoOf(d: Date): string {
  return todayISO(d);
}

/** Shift an ISO date by whole days, staying in local time. */
export function addDays(iso: string, delta: number): string {
  const d = dateFromISO(iso);
  d.setDate(d.getDate() + delta);
  return isoOf(d);
}

/** 12-hour clock label: `2pm`, `9:05am`. */
export function clockLabel(hh: number, mm: number): string {
  const ap = hh >= 12 ? "pm" : "am";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")}${ap}` : `${h12}${ap}`;
}

function fmtHM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

// ===========================================================================
// ROLL-UPS
// ===========================================================================

/** Live elapsed for one item: its banked time plus any running session. */
export function elapsedOf(
  item: Main | Sub | null,
  isActive: boolean,
  startedAt: number,
  now: number,
): number {
  if (!item) return 0;
  return item.accrued + (isActive && startedAt > 0 ? Math.max(0, now - startedAt) : 0);
}

/** A task's total: its own time plus every step's, plus the live session. */
export function mainTotal(m: Main, s: State, now: number): number {
  let base = m.accrued + m.subs.reduce((a, x) => a + x.accrued, 0);
  if (s.activeMainId === m.id && s.startedAt > 0) base += Math.max(0, now - s.startedAt);
  return base;
}

/** Total tracked today across every task (banked + live). */
export function todayTrackedMs(s: State, now: number): number {
  let t = 0;
  s.mains.forEach((m) => {
    t += m.accrued + m.subs.reduce((a, x) => a + x.accrued, 0);
  });
  if (s.activeMainId && s.startedAt > 0) t += Math.max(0, now - s.startedAt);
  return t;
}

/** Everything finished today, tasks and steps alike. */
export function completedToday(s: State): CompletedRecord[] {
  const out: CompletedRecord[] = [];
  s.mains.forEach((m) => {
    if (m.done) {
      out.push({
        title: m.title,
        kind: "task",
        ms: m.accrued + m.subs.reduce((a, x) => a + x.accrued, 0),
      });
    }
    m.subs.forEach((x) => {
      if (x.done) out.push({ title: x.title, kind: "step", ms: x.accrued });
    });
  });
  return out;
}

/** Unfinished tasks with their still-open steps (carry-forward + calendar). */
export function unfinishedToday(s: State): UnfinishedRecord[] {
  return s.mains
    .filter((m) => !m.done)
    .map((m) => ({
      title: m.title,
      subs: m.subs.filter((x) => !x.done).map((x) => ({ title: x.title, note: x.note })),
    }));
}

/** Build the immutable record archived at End Day. */
export function daySnapshot(s: State, now: number): DayRecord {
  return {
    day: s.dayNum,
    dateISO: s.dateISO,
    completed: completedToday(s),
    unfinished: unfinishedToday(s),
    totalMs: todayTrackedMs(s, now),
  };
}

/** Snapshot an unfinished task so "Tomorrow" keeps notes, reminders, estimate. */
export function carrySnapshot(m: Main): CarrySnapshot {
  return {
    title: m.title,
    note: m.note,
    remind: m.remind,
    estMs: m.estMs,
    carries: (m.carries || 0) + 1,
    subs: m.subs
      .filter((x) => !x.done)
      .map((x) => ({ title: x.title, note: x.note, remind: x.remind })),
  };
}

/** Attach interruption evidence to a day's archived record. */
export function enrichSnapshot(s: State, snap: DayRecord): DayRecord {
  const byTitle = new Map(s.mains.map((m) => [m.title, m]));
  return {
    ...snap,
    interruptions: [...s.interruptions],
    completed: snap.completed.map((c) => {
      const m = c.kind === "task" ? byTitle.get(c.title) : undefined;
      if (!m) return c;
      return {
        ...c,
        elapsedMs:
          m.firstStartedAt && m.completedAt
            ? Math.max(0, m.completedAt - m.firstStartedAt)
            : undefined,
        interruptedCount: m.interruptedCount || undefined,
        interruptedMs: m.interruptedMs || undefined,
        estMs: m.estMs || undefined,
      };
    }),
  };
}

/** Today's in-progress numbers, shaped like a day record so stats can reuse it. */
export function todayAsRecord(s: State, now: number) {
  const byTitle = new Map(s.mains.map((m) => [m.title, m]));
  return {
    completed: completedToday(s).map((c) => {
      const m = c.kind === "task" ? byTitle.get(c.title) : undefined;
      if (!m) return c;
      return {
        ...c,
        elapsedMs:
          m.firstStartedAt && m.completedAt
            ? Math.max(0, m.completedAt - m.firstStartedAt)
            : undefined,
        interruptedCount: m.interruptedCount || undefined,
        interruptedMs: m.interruptedMs || undefined,
        estMs: m.estMs || undefined,
      };
    }),
    totalMs: todayTrackedMs(s, now),
    interruptions: s.interruptions,
  };
}

// ===========================================================================
// STREAKS
// ===========================================================================
//
// Rules, exactly as specified:
//   - a day counts when it has completed work
//   - weekends, PTO and revived days BRIDGE a gap for free
//   - the first real missed weekday ends the streak
//   - dates before day 1 are never counted as misses (the floor)

export function isWeekend(iso: string): boolean {
  const dow = dateFromISO(iso).getDay();
  return dow === 0 || dow === 6;
}

export function activeDaySet(s: State): Set<string> {
  const set = new Set<string>();
  s.history.forEach((h) => {
    if (h.dateISO && h.completed?.length) set.add(h.dateISO);
  });
  if (completedToday(s).length) set.add(s.dateISO);
  return set;
}

/** The earliest date the streak walk may consider (day 1's date). */
export function floorISO(s: State): string {
  return (s.history.length ? s.history[0].dateISO : s.dateISO) || s.dateISO;
}

function bridges(s: State, iso: string): boolean {
  return isWeekend(iso) || s.pto.includes(iso) || s.revived.includes(iso);
}

export function streakEndingAt(s: State, startISO: string, active: Set<string>): number {
  const floor = floorISO(s);
  let iso = startISO;
  let len = 0;
  for (let guard = 0; guard < 3650; guard++) {
    if (iso < floor) break;
    if (active.has(iso)) len++;
    else if (bridges(s, iso)) {
      /* free bridge */
    } else break;
    iso = addDays(iso, -1);
  }
  return len;
}

/** The most recent genuinely-missed weekday a revive heart could bridge. */
export function firstBrokenDayISO(s: State): string | null {
  const floor = floorISO(s);
  const active = activeDaySet(s);
  // Start from YESTERDAY: today isn't over, so an unworked today is not yet a
  // missed day and a revive heart must not be spendable on it.
  let iso = addDays(s.dateISO, -1);
  for (let guard = 0; guard < 3650; guard++) {
    if (iso < floor) return null;
    if (!active.has(iso) && !bridges(s, iso)) return iso;
    if (active.has(iso) && iso !== s.dateISO) break;
    iso = addDays(iso, -1);
  }
  return null;
}

export interface Streaks {
  current: number;
  longest: number;
  life: number;
  broken: string | null;
  activeCount: number;
}

export function computeStreaks(s: State): Streaks {
  const active = activeDaySet(s);
  const start = active.has(s.dateISO) || bridges(s, s.dateISO) ? s.dateISO : addDays(s.dateISO, -1);
  const current = streakEndingAt(s, start, active);
  let longest = current;
  active.forEach((iso) => {
    longest = Math.max(longest, streakEndingAt(s, iso, active));
  });
  return {
    current,
    longest,
    life: Math.max(0, Math.min(1, s.life || 0)),
    broken: firstBrokenDayISO(s),
    activeCount: active.size,
  };
}

/** PTO may only be set for today or the future - never to erase a past miss. */
export function canMarkPto(iso: string, todayIso: string): boolean {
  return iso >= todayIso;
}

// ===========================================================================
// REMINDERS
// ===========================================================================

/**
 * Build a reminder from user input, anchored to REAL time.
 *   in : minutes from now
 *   by : a clock time today, rolling to tomorrow when already past
 *   on : an absolute datetime-local value
 */
export function makeRemind(
  kind: RemindKind | "clear",
  raw: string | number,
  now: number = Date.now(),
): Remind | null {
  if (kind === "clear") return null;

  if (kind === "in") {
    const mins = Math.max(1, Math.round(Number(raw)));
    if (!Number.isFinite(mins)) return null;
    const short = `in ${fmtHM(mins)}`;
    return { kind, raw: String(mins), at: now + mins * 60000, label: `Remind ${short}`, short };
  }

  if (kind === "by") {
    const [hhRaw, mmRaw] = String(raw).split(":");
    const hh = Number(hhRaw);
    const mm = Number(mmRaw || 0);
    if (!Number.isFinite(hh) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    const d = new Date(now);
    d.setHours(hh, mm, 0, 0);
    let rolled = false;
    if (d.getTime() <= now) {
      d.setDate(d.getDate() + 1);
      rolled = true;
    }
    const lab = clockLabel(hh, mm);
    return {
      kind,
      raw: String(raw),
      at: d.getTime(),
      label: `Remind by ${lab}${rolled ? " (tomorrow)" : ""}`,
      short: `by ${lab}`,
    };
  }

  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return null;
  const short = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${clockLabel(
    d.getHours(),
    d.getMinutes(),
  )}`;
  return { kind: "on", raw: String(raw), at: d.getTime(), label: `Remind on ${short}`, short };
}

/** Reminders that are due and not yet delivered, with where each lives. */
export function dueReminders(
  s: State,
  now: number,
): { title: string; remind: Remind; where: string }[] {
  const out: { title: string; remind: Remind; where: string }[] = [];
  s.mains.forEach((m) => {
    if (m.remind && !m.remind.delivered && m.remind.at <= now) {
      out.push({ title: m.title, remind: m.remind, where: `main|${m.id}` });
    }
    m.subs.forEach((x) => {
      if (x.remind && !x.remind.delivered && x.remind.at <= now) {
        out.push({ title: x.title, remind: x.remind, where: `sub|${m.id}~${x.id}` });
      }
    });
  });
  s.backlog.forEach((b) => {
    if (b.remind && !b.remind.delivered && b.remind.at <= now) {
      out.push({ title: b.title, remind: b.remind, where: `backlog|${b.id}` });
    }
  });
  return out;
}

// ===========================================================================
// TRAINER + INTERRUPTION ANALYSIS
// ===========================================================================

export interface TimeSense {
  count: number;
  avgRatio: number;
  under: number;
  over: number;
  verdict: string;
  recent: EstimateEntry[];
}

/** Estimate-vs-actual summary. Zero estimates are excluded, not divided by. */
export function timeSense(log: EstimateEntry[]): TimeSense | null {
  const clean = (log || []).filter((e) => e && e.estMs > 0 && Number.isFinite(e.actualMs));
  if (!clean.length) return null;
  const ratios = clean.map((e) => e.actualMs / e.estMs);
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const under = clean.filter((e) => e.actualMs <= e.estMs).length;
  const verdict =
    avg <= 1.1
      ? "Your estimates are pretty accurate."
      : avg < 1.5
        ? `You tend to run a bit over - pad your estimates ~${Math.round((avg - 1) * 100)}%.`
        : `You underestimate a lot - tasks take about ${avg.toFixed(1)}x your guess. Try estimating, then doubling.`;
  return {
    count: clean.length,
    avgRatio: avg,
    under,
    over: clean.length - under,
    verdict,
    recent: clean.slice(-5).reverse(),
  };
}

export interface InterruptionStats {
  count: number;
  totalMs: number;
  longestMs: number;
  /** Focused time on real tasks in the same period. */
  focusedMs: number;
  /**
   * Interruptions per hour of focused work - the comparable rate. A raw count
   * means little without knowing how long the person was working.
   */
  perFocusHour: number;
  topCauses: { title: string; count: number; totalMs: number }[];
  /** Tasks whose wall-clock ran well past their focused time. */
  stretched: {
    title: string;
    estMs?: number;
    focusedMs: number;
    elapsedMs: number;
    interruptedCount: number;
    interruptedMs: number;
    /** elapsed / focused - "a 2h task occupied 5h of my day" is 2.5x. */
    stretchRatio: number;
  }[];
}

/**
 * Summarise interruptions across day records (optionally including today).
 *
 * This is the evidence layer for the case that an estimate can be accurate while
 * the day still runs long: `focusedMs` is the work, the stretch ratio is what the
 * interruptions did to it.
 */
export function interruptionStats(
  days: { completed: CompletedRecord[]; totalMs: number; interruptions?: InterruptionEvent[] }[],
): InterruptionStats {
  const events: InterruptionEvent[] = [];
  let focusedMs = 0;
  const stretched: InterruptionStats["stretched"] = [];

  days.forEach((d) => {
    focusedMs += d.totalMs || 0;
    (d.interruptions ?? []).forEach((e) => events.push(e));
    (d.completed ?? []).forEach((c) => {
      // Only tasks carry the span, and only when both ends are known.
      if (c.kind !== "task" || !c.elapsedMs || !c.ms) return;
      const ratio = c.elapsedMs / c.ms;
      // 1.25x is the noise floor: below it the "stretch" is rounding, not a story.
      if (ratio < 1.25) return;
      stretched.push({
        title: c.title,
        estMs: c.estMs,
        focusedMs: c.ms,
        elapsedMs: c.elapsedMs,
        interruptedCount: c.interruptedCount ?? 0,
        interruptedMs: c.interruptedMs ?? 0,
        stretchRatio: ratio,
      });
    });
  });

  // An interruption still open has no final duration yet; counting it is honest,
  // adding a partial duration to the total is not.
  const totalMs = events.reduce((a, e) => a + (e.open ? 0 : e.durationMs || 0), 0);
  const longestMs = events.reduce((a, e) => Math.max(a, e.durationMs || 0), 0);

  const causes = new Map<string, { count: number; totalMs: number }>();
  events.forEach((e) => {
    const key = e.causeTitle || "something else";
    const cur = causes.get(key) ?? { count: 0, totalMs: 0 };
    cur.count++;
    cur.totalMs += e.durationMs || 0;
    causes.set(key, cur);
  });

  return {
    count: events.length,
    totalMs,
    longestMs,
    focusedMs,
    perFocusHour: focusedMs > 0 ? events.length / (focusedMs / 3600000) : 0,
    topCauses: [...causes.entries()]
      .map(([title, v]) => ({ title, ...v }))
      .sort((a, b) => b.totalMs - a.totalMs || b.count - a.count)
      .slice(0, 10),
    stretched: stretched.sort((a, b) => b.stretchRatio - a.stretchRatio).slice(0, 25),
  };
}

// ===========================================================================
// IMPORT - paste a plan from an assistant or a notes app
// ===========================================================================

/** The copyable prompt that makes an assistant emit the importable format. */
export const IMPORT_PROMPT = `After your task list, output it in EXACTLY this format so I can import it (nothing else, no bullets, no numbering):

Main Task 1
    Subtask 1 @ 2026-08-14 10:00
    Subtask 2 @ by 3pm
Main Task 2
    Subtask 1 @ in 1h30m
Main Task 3

Backlog:
    Backlog item 1 @ 2026-09-01 09:00
    Backlog item 2

Rules:
- One task per line. Main tasks start at the left margin.
- Subtasks are indented (4 spaces or a tab) under their main task.
- A reminder is optional: add " @ " then one of:
    @ 2026-08-14 10:00   (specific date & time, 24h)
    @ by 3pm             (a time today; rolls to tomorrow if already past)
    @ in 1h30m           (relative: 30m, 2h, 1h30m)
- Put a line "Backlog:" then indented items to add things I'll do later.`;

export interface ParsedImport {
  mains: {
    title: string;
    subs: { title: string; remind: Remind | null }[];
    remind: Remind | null;
  }[];
  backlog: { title: string; remind: Remind | null }[];
  errors: string[];
}

/** "@ <when>" -> a reminder. Accepts "in 1h30m", "by 3pm", "2026-08-14 10:00". */
export function parseWhen(w: string, now: number = Date.now()): Remind | null {
  const t = w.trim();
  let m: RegExpExecArray | null;

  m = /^in\s+(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/i.exec(t);
  if (m && (m[1] || m[2])) {
    return makeRemind("in", Number(m[1] || 0) * 60 + Number(m[2] || 0), now);
  }

  m = /^by\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(t);
  if (m) {
    let h = Number(m[1]);
    const mm = m[2] ? Number(m[2]) : 0;
    const ap = (m[3] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h > 23 || mm > 59) return null;
    return makeRemind("by", `${h}:${String(mm).padStart(2, "0")}`, now);
  }

  m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(t);
  if (m) {
    const p = (n: string | number) => String(Number(n)).padStart(2, "0");
    const iso = `${m[1]}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${m[5]}`;
    if (isNaN(new Date(iso).getTime())) return null;
    return makeRemind("on", iso, now);
  }
  return null;
}

/** Guards against pathological pasted input. */
export const IMPORT_LIMITS = { maxItems: 500, maxTitle: 200 };

/** Parse the structured text format into tasks, steps and backlog items. */
export function parseImport(text: string, now: number = Date.now()): ParsedImport {
  const mains: ParsedImport["mains"] = [];
  const backlog: ParsedImport["backlog"] = [];
  const errors: string[] = [];
  let inBacklog = false;
  let curMain: ParsedImport["mains"][number] | null = null;
  let count = 0;

  const lines = text.replace(/\r/g, "").split("\n");
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    if (!raw.trim()) continue;
    if (count >= IMPORT_LIMITS.maxItems) {
      errors.push(`Stopped at ${IMPORT_LIMITS.maxItems} items - the rest was ignored.`);
      break;
    }
    const indented = /^(\s{2,}|\t)/.test(raw);
    const line = raw.trim().replace(/^([-*•]|\d+[.)])\s+/, "");

    if (/^backlog\s*:?$/i.test(line)) {
      inBacklog = true;
      curMain = null;
      continue;
    }

    let remind: Remind | null = null;
    let title = line;
    const at = line.split(/\s+@\s+/);
    if (at.length >= 2) {
      title = at[0].trim();
      const parsed = parseWhen(at.slice(1).join(" @ ").trim(), now);
      if (parsed) remind = parsed;
      else errors.push(`Line ${idx + 1}: couldn't read reminder "${at[1]}"`);
    }
    if (!title) continue;
    if (title.length > IMPORT_LIMITS.maxTitle) {
      title = title.slice(0, IMPORT_LIMITS.maxTitle);
      errors.push(`Line ${idx + 1}: title was shortened.`);
    }

    count++;
    if (inBacklog) {
      backlog.push({ title, remind });
      continue;
    }
    if (indented && curMain) {
      curMain.subs.push({ title, remind });
    } else {
      const nm = { title, subs: [] as { title: string; remind: Remind | null }[], remind };
      mains.push(nm);
      curMain = nm;
    }
  }
  return { mains, backlog, errors };
}

// ===========================================================================
// USAGE LOGS - opt-in, and content-free by construction
// ===========================================================================

const FRICTION_MEANING: Record<string, string> = {
  rapid_repeat: "clicked the same control repeatedly - it may not be doing what they expect",
  tab_thrash: "bounced between screens/tabs a lot - may be hunting for something",
  interrupt_cancelled: "opened the switch/interrupt dialog then backed out - unsure what to pick",
  import_abandoned: "started an import then cancelled - the format or flow may be unclear",
  undo_used: "undid an action - a click did something unintended",
  error: "a runtime error occurred",
};

/**
 * The exportable usage payload: counts and settings only.
 *
 * NEVER includes task titles, notes, backlog text or reminder text. The
 * interruption section carries SHAPE only - how many, how long, how they started
 * - because the cause text is the user's own words about their work.
 */
export function buildLogs(s: State) {
  const days: Metrics["days"] = {};
  Object.keys(s.metrics.days).forEach((dn) => {
    const b = s.metrics.days[dn];
    days[dn] = { events: { ...b.events }, clicks: { ...b.clicks }, friction: { ...b.friction } };
  });
  const totals: Record<string, number> = {};
  Object.values(s.metrics.days).forEach((d) =>
    Object.entries(d.friction || {}).forEach(([k, v]) => (totals[k] = (totals[k] || 0) + v)),
  );
  return {
    app: "dopamigo",
    kind: "usage-logs",
    schema: 2,
    containsNoContent: true,
    currentDay: s.dayNum,
    settings: {
      checkinMin: s.pingMin,
      wellnessEnabled: (Object.keys(s.wellness) as WellnessKey[]).filter((k) => s.wellness[k].on),
      trainerOn: s.trainerOn,
      avoidanceOn: s.avoidanceOn,
    },
    byDay: days,
    interruptions: {
      todayCount: s.interruptions.length,
      todayTotalMs: s.interruptions.reduce((a, e) => a + (e.open ? 0 : e.durationMs || 0), 0),
      byVia: s.interruptions.reduce<Record<string, number>>((acc, e) => {
        acc[e.via] = (acc[e.via] || 0) + 1;
        return acc;
      }, {}),
    },
    frictionSummary: Object.entries(totals).map(([k, v]) => ({
      signal: k,
      count: v,
      means: FRICTION_MEANING[k] || k,
    })),
    errors: s.metrics.errors.slice(),
  };
}

// ===========================================================================
// THEME
// ===========================================================================

/** Apply both theme axes to the document root. */
export function applyTheme(mode: Mode, accent: Accent): void {
  const root = document.documentElement;
  root.setAttribute("data-mode", mode === "dark" ? "dark" : "light");
  root.setAttribute("data-accent", ACCENTS.some(([k]) => k === accent) ? accent : "amber");
}

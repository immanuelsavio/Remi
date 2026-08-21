/**
 * HYDRATE - never trust what came off disk.
 *
 * Merge a loaded (possibly older, partial or hostile) state over a fresh
 * default so a missing field can never crash the app, and unknown future
 * fields survive.
 *
 * Every collection is repaired and every number coerced, because a single
 * bad value would otherwise wedge the app on boot with no way back in.
 */

import { freshDay, freshWellness, mkMain, mkSub } from "./defaults";
import { todayISO } from "./dates";
import { nid } from "./ids";
import { normalizeTags } from "./tags";
import { ACCENTS } from "./types";
import type {
  BacklogItem,
  CarryChoice,
  InterruptionEvent,
  Main,
  Metrics,
  Phase,
  Remind,
  RemindKind,
  State,
  Wellness,
  WellnessKey,
} from "./types";

/**
 * Structural check that `raw` is plausibly a Remi state export, BEFORE
 * calling `hydrate`.
 *
 * `hydrate()` always returns a valid `State` - including for `{}` or any
 * other object, which spreads over `freshDay()` and comes out with a real
 * `dateISO` by construction. A post-hydrate check (e.g. "does `dateISO`
 * exist?") can therefore never reject anything: it is always true. Callers
 * that let a user paste arbitrary text (like a backup restore) must
 * validate the RAW, untrusted input against real structural markers that
 * only a genuine Remi export would have.
 */
export function looksLikeRemiState(raw: unknown): raw is Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.v === "number" &&
    typeof r.dayNum === "number" &&
    typeof r.dateISO === "string" &&
    Array.isArray(r.mains)
  );
}

// Only real objects are tasks. `filter(Boolean)` is NOT enough: a bare
// string in the array is truthy and would survive as a phantom
// "Untitled" task.
const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
const str = (v: unknown, f = "") => (typeof v === "string" ? v : f);

/**
 * Coerce anything into a well-formed task list.
 *
 * Module-level and exported because the resume snapshot holds a second
 * `Main[]` off disk, and a value that is only validated in one of the two
 * places it is read is not validated at all.
 */
export function normalizeMains(v: unknown): Main[] {
  return arr<unknown>(v)
    .filter(isObj)
    .map((m) => {
      const out = mkMain(str(m.title, "Untitled"));
      out.id = str(m.id) || out.id;
      out.accrued = Math.max(0, num(m.accrued));
      out.done = m.done === true;
      out.fromSub = m.fromSub === true;
      out.deferred = m.deferred === true;
      out._showSubs = false;
      out.note = str(m.note);
      out.remind = normalizeRemind(m.remind);
      out.carries = Math.max(0, num(m.carries));
      out.estMs = Math.max(0, num(m.estMs));
      out.tags = normalizeTags(m.tags);
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
}

/** Coerce anything into a well-formed backlog. */
export function normalizeBacklog(v: unknown): BacklogItem[] {
  return arr<unknown>(v)
    .filter(isObj)
    .map((b) => ({
      id: str(b.id) || nid(),
      title: str(b.title, "Untitled"),
      remind: normalizeRemind(b.remind),
      note: str(b.note),
    }));
}

export function hydrate(raw: unknown): State {
  const base = freshDay();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const s = { ...base, ...(raw as Partial<State>) } as State;

  s.mains = normalizeMains(s.mains);
  s.backlog = normalizeBacklog(s.backlog);

  s.carrySeed = arr<unknown>(s.carrySeed)
    .filter(isObj)
    .map((c) => ({
      title: str(c.title, "Untitled"),
      note: str(c.note),
      remind: normalizeRemind(c.remind),
      estMs: Math.max(0, num(c.estMs)),
      tags: normalizeTags(c.tags),
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

  // A return entry pointing at a task that no longer exists would send the
  // user "back" to nothing when they finish what interrupted them.
  s.returnStack = arr<unknown>(s.returnStack)
    .filter(isObj)
    .map((r) => ({ mainId: str(r.mainId), subId: typeof r.subId === "string" ? r.subId : null }))
    .filter((r) => {
      const rm = s.mains.find((m) => m.id === r.mainId);
      if (!rm || rm.done) return false;
      return !r.subId || rm.subs.some((x) => x.id === r.subId);
    });

  // Metrics: counters only. A malformed bucket becomes an empty one rather
  // than failing the load, and the error list is capped so a crash loop
  // can't grow the state file without bound.
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
      days[k] = {
        events: counts(b.events),
        clicks: counts(b.clicks),
        friction: counts(b.friction),
      };
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
  // Absent means ON (a fresh install during the beta); an explicit `false`
  // is always honoured, so nobody who turned it off gets silently re-opted-in.
  s.loggingOptIn = s.loggingOptIn !== false;
  s.tourSeen = s.tourSeen === true;
  s.feedback = typeof s.feedback === "string" ? s.feedback.slice(0, 4000) : "";

  s.pto = arr<unknown>(s.pto).filter((x): x is string => typeof x === "string");
  s.revived = arr<unknown>(s.revived).filter((x): x is string => typeof x === "string");
  s.standardDaily = arr<unknown>(s.standardDaily).filter((x): x is string => typeof x === "string");

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
  // Absent on backups/state files written before cross-window CAS existed -
  // 0 matches a fresh save's starting expectation.
  s._rev = Math.max(0, num(s._rev, 0));
  s.dayNum = Math.max(1, num(s.dayNum, 1));
  s.startedAt = Math.max(0, num(s.startedAt));
  s.savedAt = Math.max(0, num(s.savedAt));
  s.breakEndsAt = Math.max(0, num(s.breakEndsAt));
  s.breakPausedTitle = str(s.breakPausedTitle);
  s.dayTargetMins = Math.max(30, num(s.dayTargetMins, 480));
  s.pingMin = Math.max(0, num(s.pingMin, 15));
  s.life = Math.max(0, Math.min(1, num(s.life, 1)));
  s.trainerOn = s.trainerOn === true;
  s.avoidanceOn = s.avoidanceOn !== false;
  s.mode = s.mode === "dark" ? "dark" : "light";
  s.accent = ACCENTS.some(([k]) => k === s.accent) ? s.accent : "remi";
  s.activeMainId = typeof s.activeMainId === "string" ? s.activeMainId : null;
  s.activeSubId = typeof s.activeSubId === "string" ? s.activeSubId : null;

  // Older files predate these keys; default them ON rather than silently
  // disabling notifications the user never turned off.
  s.notifyReminders = s.notifyReminders !== false;
  s.notifyBreakEnd = s.notifyBreakEnd !== false;
  s.welcomeBack = s.welcomeBack !== false;
  s.trayTimer = s.trayTimer !== false;
  s.mascotOn = s.mascotOn !== false;
  s.wakeAnimation = s.wakeAnimation !== false;
  s.privateNotifications = s.privateNotifications === true;

  const PHASES: Phase[] = ["startday", "today", "active", "break", "recovery"];
  s.phase = PHASES.includes(s.phase) ? s.phase : "today";
  if (!s.dateISO) s.dateISO = todayISO();

  // Older files predate the flag. Infer it: a day with no tasks sitting on
  // the Start-day screen has effectively not begun.
  //
  // Read from `raw`, NOT from `s`: the base-default spread above already
  // put a `true` there, so testing `s` would always take the explicit
  // branch and never infer anything.
  const rawAwaiting = (raw as Record<string, unknown>).awaitingStart;
  s.awaitingStart =
    typeof rawAwaiting === "boolean" ? rawAwaiting : s.mains.length === 0 && s.phase === "startday";

  // Absent means "not decided": a file written before this field existed
  // came from a build that never asked, so asking once is the safe default.
  s.carryDecided = (raw as Record<string, unknown>).carryDecided === true;

  // The resume snapshot is a convenience, not durable work: anything that
  // does not look right is dropped rather than repaired.
  const rawResume = (raw as Record<string, unknown>).resumable;
  s.resumable = isObj(rawResume)
    ? {
        dayNum: Math.max(1, num(rawResume.dayNum, 1)),
        dateISO: str(rawResume.dateISO),
        mains: normalizeMains(rawResume.mains),
        interruptions: arr<unknown>(rawResume.interruptions)
          .filter(isObj)
          .map(normalizeInterruption),
        life: Math.max(0, Math.min(1, num(rawResume.life))),
        choices: isObj(rawResume.choices)
          ? (Object.fromEntries(
              Object.entries(rawResume.choices).filter(
                ([, v]) => v === "done" || v === "carry" || v === "backlog",
              ),
            ) as Record<string, CarryChoice>)
          : {},
        decided: rawResume.decided === true,
      }
    : null;

  // Transient fields always start clean.
  s.overlay = null;
  s.switchReason = "";
  s.subsOpen = false;
  s.ciStage = Math.max(0, num(s.ciStage));
  s.ciMutedDate = typeof s.ciMutedDate === "string" ? s.ciMutedDate : null;

  // A session pointing at a task that no longer exists would tick forever
  // and bank into nothing.
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

export function normalizeRemind(v: unknown): Remind | null {
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

export function normalizeInterruption(e: Record<string, unknown>): InterruptionEvent {
  const via = e.via === "switch" || e.via === "checkin" ? e.via : "interrupt";
  return {
    id: typeof e.id === "string" ? e.id : nid(),
    dateISO: typeof e.dateISO === "string" ? e.dateISO : todayISO(),
    // Absent on a file written before `interruptedId` existed - degrades to
    // "no victim found by id", same outcome an unmatched title used to give.
    interruptedId: typeof e.interruptedId === "string" ? e.interruptedId : "",
    interruptedTitle: typeof e.interruptedTitle === "string" ? e.interruptedTitle : "a task",
    causeTitle: typeof e.causeTitle === "string" ? e.causeTitle : "something else",
    atMs: Math.max(0, Number(e.atMs) || 0),
    durationMs: Math.max(0, Number(e.durationMs) || 0),
    open: e.open === true,
    via,
  };
}

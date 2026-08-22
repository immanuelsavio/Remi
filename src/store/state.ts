/**
 * THE STORE core: the writable, snapshot readers, `commit`, and THE SESSION
 * TRANSACTION.
 *
 * Every other store/* module imports from HERE, never from each other -
 * that is what keeps this a star topology instead of a cycle. Anything that
 * touches `sessionTx`, `bankActive`, or the day-rollover primitives lives in
 * this one file because they are mutually referential and splitting them
 * further would only relocate the coupling, not remove it.
 *
 * THE SESSION TRANSACTION is the one rule you cannot bend. Every mutation
 * that can move, remove or replace the thing being timed goes through
 * `sessionTx`:
 *
 *     bank the running session -> mutate -> repair dangling refs
 *       -> maybe start the next session -> publish + save once
 *
 * Bypassing it is how live time gets silently lost or misattributed.
 */

import { writable, get, type Readable } from "svelte/store";
import { daySnapshot, enrichSnapshot, carrySnapshot } from "../domain/tasks";
import { freshDay } from "../domain/defaults";
import { nid } from "../domain/ids";
import { todayISO } from "../domain/dates";
import type { DashTab, DayRecord, Main, State, Sub } from "../domain/types";

export const state = writable<State>(freshDay());

/** Read-only view for components. */
export const app: Readable<State> = { subscribe: state.subscribe };

/** A monotonically increasing tick so live timers re-render each second. */
export const nowMs = writable<number>(Date.now());

/** How the last load resolved, for the recovery banner/screen. */
export const loadKind = writable<"fresh" | "loaded" | "recovered" | "damaged">("fresh");
export const loadMessage = writable<string>("");
export const damagedPaths = writable<string[]>([]);

/** Which dashboard tab is showing (window-local, not persisted). */
export const dashTab = writable<DashTab>("plan");

export interface Toast {
  msg: string;
  actionLabel?: string;
  action?: () => void;
}
export const toast = writable<Toast | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Set when the app reopens after a session was left running, so the
 * popover can offer to pick that work back up.
 *
 * Purely an offer: the time was already banked honestly (only up to the
 * last save) before this is set, so accepting or ignoring it cannot change
 * any number.
 */
/**
 * True when this launch follows an uninstall that kept the history.
 *
 * A one-shot: `boot` sets it and clears the stored marker in the same
 * breath, so the greeting appears once rather than on every launch for the
 * rest of time.
 */
export const returning = writable(false);

export const welcomeBack = writable<{
  mainId: string;
  subId: string | null;
  title: string;
} | null>(null);

/** An offered Undo gets longer on screen, because it must be reachable. */
export function showToast(msg: string, actionLabel?: string, action?: () => void): void {
  toast.set({ msg, actionLabel, action });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.set(null), actionLabel ? 6000 : 2800);
}

/** Snapshot of current state, for reads outside a subscription. */
export function S(): State {
  return get(state);
}

export function M(id: string | null): Main | null {
  if (!id) return null;
  return S().mains.find((m) => m.id === id) ?? null;
}

export function activeMain(): Main | null {
  return M(S().activeMainId);
}

export function activeSub(): Sub | null {
  const s = S();
  if (!s.activeSubId) return null;
  return activeMain()?.subs.find((x) => x.id === s.activeSubId) ?? null;
}

/** Whatever is being timed right now: a step if there is one, else the task. */
export function activeThing(): Main | Sub | null {
  return activeSub() ?? activeMain();
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
type SaveScheduler = () => void;
let scheduleSaveImpl: SaveScheduler = () => {};

/** Wired once by `store/persistence.ts` at module init, avoiding a cycle:
 * `state.ts` needs to trigger a save, but the save implementation needs
 * `S()`/`state` from here. */
export function registerSaveScheduler(fn: SaveScheduler): void {
  scheduleSaveImpl = fn;
}

function scheduleSave(): void {
  scheduleSaveImpl();
}

/** Publish a mutation and schedule a save. The single write path. */
export function commit(patch?: (s: State) => void): void {
  state.update((s) => {
    patch?.(s);
    return s;
  });
  scheduleSave();
}

/** Replace the whole state (day boundaries) and schedule a save. */
export function setState(next: State): void {
  state.set(next);
  scheduleSave();
}

// Exposed so save-debounce internals in persistence.ts can clear/reuse the
// same timer handle without a second competing timer.
export function getSaveTimerHandle(): ReturnType<typeof setTimeout> | null {
  return saveTimer;
}
export function setSaveTimerHandle(t: ReturnType<typeof setTimeout> | null): void {
  saveTimer = t;
}

/**
 * Copy everything that must OUTLIVE a single day onto a freshly created
 * state.
 *
 * Every new-day path (rollover, End Day, Restart Day) funnels through here,
 * so a preference can never be silently reset by one path but preserved by
 * another - the bug that quietly re-enabled notification toggles at each
 * day boundary.
 */
export function copyDurablePreferences(old: State, next: State): void {
  // NOT a preference - but this is the one funnel every new-day path goes
  // through, which is exactly why it belongs here.
  //
  // `_rev` is what the compare-and-swap in `state_io.rs` checks: it must
  // keep describing the revision this window last saw on disk. Every path
  // that builds tomorrow starts from `freshDay(...)`, and `freshDay` sets
  // `_rev: 0`. Dropping it meant the new day's very first write sent 0
  // against a disk revision of hundreds, was rejected as stale, and
  // `flushSave` reloaded YESTERDAY back off disk - so the next tick rolled
  // again, forever. That is a save that can never land, on the one write
  // that matters most: the day boundary.
  next._rev = old._rev;
  next.trainerOn = old.trainerOn;
  next.avoidanceOn = old.avoidanceOn;
  next.mode = old.mode;
  next.accent = old.accent;
  next.dayTargetMins = old.dayTargetMins;
  next.pingMin = old.pingMin;
  next.wellness = old.wellness;
  next.standardDaily = old.standardDaily;
  next.loggingOptIn = old.loggingOptIn;
  next.tourSeen = old.tourSeen;
  next.notifyReminders = old.notifyReminders;
  next.notifyBreakEnd = old.notifyBreakEnd;
  next.welcomeBack = old.welcomeBack;
  next.privateNotifications = old.privateNotifications;
  next.mascotOn = old.mascotOn;
  next.wakeAnimation = old.wakeAnimation;
  next.roamOn = old.roamOn;
  next.userName = old.userName;
  next.fullName = old.fullName;
  next.mascotCostume = old.mascotCostume;
  next.leftAt = old.leftAt;
  next.lastAutoBackup = old.lastAutoBackup;
  next.trayTimer = old.trayTimer;
  next.backlog = old.backlog;
  next.estimateLog = old.estimateLog;
  next.pto = old.pto;
  next.life = old.life;
  next.revived = old.revived;
  next.reviveCredit = old.reviveCredit;
  next.reviveAnchor = old.reviveAnchor;
  next.history = old.history;
  next.metrics = old.metrics;
}

/** Replace any record for the same date, then keep the list date-sorted. */
export function mergeHistory(history: DayRecord[], snap: DayRecord): DayRecord[] {
  return [...history.filter((h) => h.dateISO !== snap.dateISO), snap].sort((a, b) =>
    a.dateISO < b.dateISO ? -1 : 1,
  );
}

/** A new calendar day archives yesterday and seeds carried work + routines. */
export function rolloverIfNewDay(s: State, todayOverride?: string): State {
  const today = todayOverride ?? todayISO();
  if (s.dateISO === today) return s;

  // ALREADY ENDED: End Day built this state; it just hasn't been started
  // yet. Rolling again would re-increment dayNum and rebuild carry from an
  // empty `mains`, discarding everything the user marked "Tomorrow". Only
  // re-date it.
  if (s.awaitingStart) {
    s.dateISO = today;
    return s;
  }

  // MID-TOUR: `mains` is the sample day, and the user's real one is parked
  // in `demoRestore`. A roll here would archive the DEMO as their history
  // and rebuild from a fresh day whose `demoRestore` is null - so the day
  // held aside would be gone for good. Re-date only; `restoreFromDemo` puts
  // the real day back and the next check no-ops on the matching date.
  if (s.demoRestore) {
    s.dateISO = today;
    return s;
  }

  const snap = enrichSnapshot(s, daySnapshot(s, Date.now()));
  const hadWork = snap.completed.length > 0 || snap.unfinished.length > 0;
  const carry = s.mains.filter((m) => !m.done).map(carrySnapshot);

  const next = freshDay(s.dayNum + 1, carry);
  next.dateISO = today;
  copyDurablePreferences(s, next);
  next.history = hadWork ? mergeHistory(s.history, snap) : s.history;
  return next;
}

/**
 * If the app closed with a session running, bank the time up to the LAST
 * SAVE rather than up to now - otherwise a machine left off overnight would
 * credit hours of "work" nobody did.
 */
export function bankOrphanSession(
  s: State,
  onOrphan?: (info: { mainId: string; subId: string | null; title: string }) => void,
): State {
  if (!s.activeMainId || !s.startedAt) return s;
  const m = s.mains.find((x) => x.id === s.activeMainId);
  if (!m) {
    s.activeMainId = null;
    s.activeSubId = null;
    s.startedAt = 0;
    return s;
  }
  const target: Main | Sub =
    (s.activeSubId ? m.subs.find((x) => x.id === s.activeSubId) : undefined) ?? m;
  const savedAt = s.savedAt || s.startedAt; // fall back to zero credit
  target.accrued += Math.max(0, savedAt - s.startedAt);
  // Remember what was interrupted BEFORE clearing, so boot() can offer to
  // resume it. An offer only - the banking above is already final.
  onOrphan?.({ mainId: m.id, subId: s.activeSubId, title: target.title });
  s.activeMainId = null;
  s.activeSubId = null;
  s.startedAt = 0;
  if (s.phase === "active") s.phase = "today";
  return s;
}

/** Bank the running session's time into whatever it belonged to. */
export function bankActive(s: State, now: number): void {
  if (!s.activeMainId || !s.startedAt) return;
  const m = s.mains.find((x) => x.id === s.activeMainId);
  if (!m) return;
  const target: Main | Sub =
    (s.activeSubId ? m.subs.find((x) => x.id === s.activeSubId) : undefined) ?? m;
  target.accrued += Math.max(0, now - s.startedAt);
}

/**
 * Give the real day back, exactly as it was.
 *
 * Safe to call when no demo is up, which is what lets both the boot path
 * and every tour exit share one route out.
 */
export function restoreFromDemo(): void {
  if (!S().demoRestore) return;
  sessionTx((s) => {
    const d = s.demoRestore!;
    s.mains = d.mains;
    s.interruptions = d.interruptions;
    s.activeMainId = d.activeMainId;
    s.activeSubId = d.activeSubId;
    s.phase = d.phase;
    s.awaitingStart = d.awaitingStart;
    s.demoRestore = null;
    // `sessionTx` re-stamps `startedAt` itself; handing back the old
    // absolute value would bank the whole tour as worked time.
    return d.activeMainId ? { mainId: d.activeMainId, subId: d.activeSubId } : null;
  });
}

/**
 * Merge a state that came off disk with what THIS window is looking at.
 *
 * `phase` was being treated as purely window-local, and it is not. It
 * carries two different facts at once: which screen this window sits on
 * (local, and worth preserving - the popover being on its task list is no
 * business of the dashboard's), and whether a task is on the clock
 * (`"active"`), which is shared and belongs to the session.
 *
 * Preserving it wholesale corrupted the file. Start a task in the
 * dashboard: disk gets `phase: "active"`. The popover reloads, re-imposes
 * its own `"today"`, and now holds a running session on a screen that says
 * nothing is running - and its next checkpoint WRITES that contradiction
 * back over the truth. The visible symptom is a popover offering "Switch"
 * on every row (the session is real) while showing the idle task list (the
 * phase is not), and a `state.json` where `activeMainId` and `phase`
 * disagree.
 *
 * So the clock wins, always: if a session came off disk, this is the
 * active screen no matter where the window thought it was. That both
 * prevents the contradiction and heals a file that already has one.
 */
export function keepLocalView(next: State, cur: State): void {
  next.overlay = cur.overlay;
  next.subsOpen = cur.subsOpen;
  next.ciStage = cur.ciStage;

  // Recovery is not a view of the day - it is "this window could not read
  // your data". Nothing arriving off disk should pull a window out of it.
  if (cur.phase === "recovery") {
    next.phase = "recovery";
    return;
  }

  const running = !!next.activeMainId && next.startedAt > 0;
  if (running) next.phase = "active";
  // Not running, and this window still says "active": its view is stale,
  // so take the one from disk rather than re-imposing a stopped clock.
  else if (cur.phase !== "active") next.phase = cur.phase;
}

/** Drop active/return-stack references to things that no longer exist. */
export function repairActiveRefs(s: State): void {
  const m = s.activeMainId ? s.mains.find((x) => x.id === s.activeMainId) : null;
  if (!m || m.done) {
    s.activeMainId = null;
    s.activeSubId = null;
    s.startedAt = 0;
    if (s.phase === "active") s.phase = "today";
  } else if (s.activeSubId && !m.subs.some((x) => x.id === s.activeSubId)) {
    // The step vanished (deleted or promoted): fall back to its parent task.
    s.activeSubId = null;
  }
  s.returnStack = s.returnStack.filter((r) => {
    const rm = s.mains.find((x) => x.id === r.mainId);
    if (!rm || rm.done) return false;
    return !r.subId || rm.subs.some((x) => x.id === r.subId);
  });
}

export function beginSession(s: State, mainId: string, subId: string | null, now: number): void {
  const m = s.mains.find((x) => x.id === mainId);
  if (m && !m.firstStartedAt) m.firstStartedAt = now;
  s.activeMainId = mainId;
  s.activeSubId = subId;
  s.startedAt = now;
  s.subsOpen = false;
  s.ciStage = 0; // a new episode restarts the bounded check-in sequence
  s.phase = "active";
  // The "you were on X" offer is stale the instant anything is genuinely
  // on the clock - taking it then would switch you OFF the work you just
  // started. Cleared here rather than in each action, because every start
  // path funnels through this function. Cross-window staleness is handled
  // separately in the overlay: `welcomeBack` is a per-window store and is
  // deliberately NOT part of State, so it does not sync.
  welcomeBack.set(null);
  // Starting work ENDS a break, whatever time was left on it. Every start
  // path funnels through here, so this is the one place that has to know.
  // Without it the clock ran while the app still believed it was on a
  // break: `phase` said "active" but `breakEndsAt` sat in the future, so
  // the break-over notification fired later at a task that had been
  // running for minutes.
  s.breakEndsAt = 0;
}

/** THE session transaction. See the file header; do not bypass it. */
export function sessionTx(
  mutate: (s: State, now: number) => { mainId: string; subId: string | null } | null | void,
): void {
  const now = Date.now();
  commit((s) => {
    // Capture whether a session was GENUINELY running before this
    // transaction - `activeMainId` alone is not proof: during a break (or
    // recovery, or awaiting-start) `activeMainId` is deliberately kept so
    // the break can resume the same work, while `startedAt` is 0 because
    // nothing is actually accruing. No `mutate` callback ever sets
    // `startedAt` itself (that's `sessionTx`'s job alone), so if it was 0
    // going in, the timer was paused for a reason outside this
    // transaction and must stay paused.
    const wasRunning = s.startedAt > 0;
    bankActive(s, now);
    const next = mutate(s, now) ?? null;
    repairActiveRefs(s);
    if (next) {
      beginSession(s, next.mainId, next.subId, now);
    } else if (!s.activeMainId) {
      s.startedAt = 0;
      if (s.phase === "active") s.phase = "today";
    } else if (wasRunning) {
      // A running session survived this transaction, possibly RETARGETED
      // (e.g. an active step was deleted and the session fell back to its
      // parent task) but still genuinely ticking. `bankActive` above
      // already folded [startedAt, now) into whatever it was targeting at
      // that moment; re-stamp `startedAt` to `now` so that interval is
      // never banked a second time by the next sessionTx, regardless of
      // whether the target changed.
      s.startedAt = now;
    }
    // Otherwise: activeMainId survived but was NOT a running session
    // (break/paused) - leave startedAt exactly as it was (0), never
    // invent a start time for a timer that wasn't ticking.
  });
}

/**
 * Record that work was interrupted.
 *
 * Opens an interruption with a 0 duration; the return closes it and fills
 * that in, which is what turns a click count into "interrupted 7 times for
 * 3h 10m".
 */
export function openInterruption(
  s: State,
  interruptedId: string,
  interruptedTitle: string,
  causeTitle: string,
  via: "interrupt" | "switch" | "checkin",
  now: number,
): void {
  // Close any already-open one first, or a single interruption could
  // absorb the whole rest of the day.
  closeOpenInterruption(s, now);
  s.interruptions.push({
    id: nid(),
    dateISO: s.dateISO,
    interruptedId,
    interruptedTitle,
    causeTitle,
    atMs: now,
    durationMs: 0,
    open: true,
    via,
  });
}

/** Close the open interruption and charge its time to the task it stole from. */
export function closeOpenInterruption(s: State, now: number): void {
  for (let i = s.interruptions.length - 1; i >= 0; i--) {
    const ev = s.interruptions[i];
    if (!ev.open) continue;
    ev.open = false;
    ev.durationMs = Math.max(0, now - ev.atMs);
    // Matched by id, not title: titles are not unique and a task can be
    // renamed while it's the interrupted party.
    const victim = s.mains.find((m) => m.id === ev.interruptedId);
    if (victim) {
      victim.interruptedCount = (victim.interruptedCount || 0) + 1;
      victim.interruptedMs = (victim.interruptedMs || 0) + ev.durationMs;
    }
    return;
  }
}

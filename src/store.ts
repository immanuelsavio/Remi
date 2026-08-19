/**
 * Dopamigo - the Svelte store, every action, and the background effects.
 *
 * Full-repo equivalent: `showcase/lib/store.ts` (~1930 lines). Pure functions and
 * the state shape live in `model.ts`; this file is everything that MUTATES.
 *
 * Design rules:
 *   - components never mutate state directly; they call actions here
 *   - every action ends in `commit()`, which publishes to subscribers and
 *     schedules a debounced atomic save
 *   - a successful save broadcasts to the other window, so popover and dashboard
 *     stay in sync without waiting for focus
 *   - time is REAL: a running session stores an absolute `startedAt`
 *
 * THE SESSION TRANSACTION is the one rule you cannot bend. Every mutation that
 * can move, remove or replace the thing being timed goes through `sessionTx`:
 *
 *     bank the running session -> mutate -> repair dangling refs
 *       -> maybe start the next session -> publish + save once
 *
 * Bypassing it is how live time gets silently lost or misattributed.
 */

import { writable, get, type Readable } from "svelte/store";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  applyTheme,
  buildLogs,
  carrySnapshot,
  computeStreaks,
  daySnapshot,
  dueReminders,
  enrichSnapshot,
  forPersist,
  freshDay,
  hydrate,
  mainTotal,
  makeRemind,
  mkMain,
  mkSub,
  nid,
  todayISO,
  type BacklogItem,
  type CarrySnapshot,
  type DashTab,
  type DayRecord,
  type Main,
  type Overlay,
  type ParsedImport,
  type Phase,
  type Remind,
  type RemindKind,
  type State,
  type Sub,
  type WellnessKey,
} from "./model";

// ===========================================================================
// THE STORE
// ===========================================================================

const state = writable<State>(freshDay());

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

/** An offered Undo gets longer on screen, because it must be reachable. */
export function showToast(msg: string, actionLabel?: string, action?: () => void): void {
  toast.set({ msg, actionLabel, action });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.set(null), actionLabel ? 6000 : 2800);
}

/** The wellness nudge currently on screen (at most one). */
export const wellnessNudge = writable<WellnessKey | null>(null);

/**
 * Set when the app reopens after a session was left running, so the popover can
 * offer to pick that work back up.
 *
 * Purely an offer: the time was already banked honestly (only up to the last
 * save) before this is set, so accepting or ignoring it cannot change any number.
 */
export const welcomeBack = writable<{
  mainId: string;
  subId: string | null;
  title: string;
} | null>(null);

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

// ===========================================================================
// PERSISTENCE
// ===========================================================================

/** Identifies THIS window, so it can ignore the echo of its own save. */
const WINDOW_ID = Math.random().toString(36).slice(2);

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving = false;
let dirtyAgain = false;
let revision = 0;

/** Publish a mutation and schedule a save. The single write path. */
function commit(patch?: (s: State) => void): void {
  state.update((s) => {
    patch?.(s);
    return s;
  });
  scheduleSave();
}

/** Debounced so a burst of edits collapses into one write. */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushSave(), 250);
}

/**
 * Write now.
 *
 * If a save is already in flight, mark it dirty and re-schedule rather than
 * interleaving two writes: the loser would otherwise silently drop its edit.
 */
export async function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (saving) {
    dirtyAgain = true;
    return;
  }
  saving = true;
  try {
    const now = Date.now();
    const payload = forPersist(S(), now);
    await invoke("save_app_state", { state: payload });
    // Mirror the stamp we just persisted, so `bankOrphanSession` and the
    // checkpoint both measure against the real last-save time.
    state.update((s) => ({ ...s, savedAt: now }));
    revision++;
    try {
      await emit("app-state-changed", { revision, from: WINDOW_ID });
    } catch {
      /* no event bus - the other window still refreshes on focus */
    }
  } catch (e) {
    showToast(`Couldn't save: ${String(e)}`);
  } finally {
    saving = false;
    if (dirtyAgain) {
      dirtyAgain = false;
      scheduleSave();
    }
  }
}

/** Scratch handoff from `bankOrphanSession` to `boot`. */
let pendingWelcomeBack: { mainId: string; subId: string | null; title: string } | null = null;

/**
 * If the app closed with a session running, bank the time up to the LAST SAVE
 * rather than up to now - otherwise a machine left off overnight would credit
 * hours of "work" nobody did.
 */
function bankOrphanSession(s: State): State {
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
  // Remember what was interrupted BEFORE clearing, so boot() can offer to resume
  // it. An offer only - the banking above is already final.
  pendingWelcomeBack = { mainId: m.id, subId: s.activeSubId, title: target.title };
  s.activeMainId = null;
  s.activeSubId = null;
  s.startedAt = 0;
  if (s.phase === "active") s.phase = "today";
  return s;
}

/**
 * Copy everything that must OUTLIVE a single day onto a freshly created state.
 *
 * Every new-day path (rollover, End Day, Restart Day) funnels through here, so a
 * preference can never be silently reset by one path but preserved by another -
 * the bug that quietly re-enabled notification toggles at each day boundary.
 */
function copyDurablePreferences(old: State, next: State): void {
  // Preferences.
  next.trainerOn = old.trainerOn;
  next.avoidanceOn = old.avoidanceOn;
  next.mode = old.mode;
  next.accent = old.accent;
  next.dayTargetMins = old.dayTargetMins;
  next.pingMin = old.pingMin;
  next.wellness = old.wellness;
  next.standardDaily = old.standardDaily;
  next.loggingOptIn = old.loggingOptIn;
  next.notifyReminders = old.notifyReminders;
  next.notifyBreakEnd = old.notifyBreakEnd;
  next.welcomeBack = old.welcomeBack;
  next.privateNotifications = old.privateNotifications;
  next.trayTimer = old.trayTimer;
  // Cross-day facts.
  next.backlog = old.backlog;
  next.estimateLog = old.estimateLog;
  next.pto = old.pto;
  next.life = old.life;
  next.revived = old.revived;
  next.history = old.history;
  next.metrics = old.metrics;
}

/** A new calendar day archives yesterday and seeds carried work + routines. */
function rolloverIfNewDay(s: State, todayOverride?: string): State {
  const today = todayOverride ?? todayISO();
  if (s.dateISO === today) return s;

  // ALREADY ENDED: End Day built this state; it just hasn't been started yet.
  // Rolling again would re-increment dayNum and rebuild carry from an empty
  // `mains`, discarding everything the user marked "Tomorrow". Only re-date it.
  if (s.awaitingStart) {
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

/** Replace any record for the same date, then keep the list date-sorted. */
function mergeHistory(history: DayRecord[], snap: DayRecord): DayRecord[] {
  return [...history.filter((h) => h.dateISO !== snap.dateISO), snap].sort((a, b) =>
    a.dateISO < b.dateISO ? -1 : 1,
  );
}

/** Load from disk, applying the day rollover and banking an orphaned session. */
export async function boot(): Promise<void> {
  let res: {
    kind: "fresh" | "loaded" | "recovered" | "damaged";
    state?: unknown;
    message?: string;
    paths?: string[];
  };
  try {
    res = await invoke("load_app_state");
  } catch (e) {
    // A backend failure must NOT silently start an empty day - that would look
    // exactly like "all my work vanished".
    loadKind.set("damaged");
    loadMessage.set(`Couldn't read your data: ${String(e)}`);
    state.update((s) => ({ ...s, phase: "recovery" }));
    return;
  }

  loadKind.set(res.kind);
  loadMessage.set(res.message ?? "");
  damagedPaths.set(res.paths ?? []);

  if (res.kind === "damaged") {
    // Rust preserved the user's files; show the recovery screen, not a blank day.
    state.update((s) => ({ ...s, phase: "recovery" }));
    return;
  }

  if (res.state) {
    let s = hydrate(res.state);
    s = bankOrphanSession(s);
    s = rolloverIfNewDay(s);
    state.set(s);
  }

  // Adopt the standard-daily list from settings.json (the shared source of truth).
  try {
    const list = await invoke<string[]>("get_standard_daily");
    if (Array.isArray(list) && list.length) {
      commit((s) => void (s.standardDaily = list));
    }
  } catch {
    /* settings unreadable - keep whatever the state file had */
  }

  const s = S();
  applyTheme(s.mode, s.accent);
  if (res.kind === "recovered" && res.message) showToast(res.message);

  if (pendingWelcomeBack && s.welcomeBack) welcomeBack.set(pendingWelcomeBack);
  pendingWelcomeBack = null;
}

/** Take the offer: resume the work that was interrupted. */
export function resumeWelcomeBack(): void {
  const offer = get(welcomeBack);
  welcomeBack.set(null);
  if (!offer) return;
  const m = M(offer.mainId);
  if (!m || m.done) {
    showToast("That task isn't open any more");
    return;
  }
  if (offer.subId) startSub(offer.mainId, offer.subId);
  else startTask(offer.mainId);
}

export function dismissWelcomeBack(): void {
  welcomeBack.set(null);
}

// ===========================================================================
// CROSS-WINDOW SYNC
// ===========================================================================

let unlistenState: UnlistenFn | null = null;

/** Refresh from disk when the OTHER window persists a change. */
export async function initSync(): Promise<void> {
  try {
    unlistenState = await listen<{ revision: number; from: string }>(
      "app-state-changed",
      async (ev) => {
        if (ev.payload?.from === WINDOW_ID) return; // ignore our own echo
        await reloadFromDisk();
      },
    );
  } catch {
    /* no event bus - refresh-on-focus remains the fallback */
  }
}

/** Pull the authoritative persisted snapshot (sync + focus fallback). */
export async function reloadFromDisk(): Promise<void> {
  try {
    const res = await invoke<{ kind: string; state?: unknown }>("load_app_state");
    if (!res.state) return;
    const cur = S();
    const next = hydrate(res.state);
    // Keep THIS window's transient view so a background save in the other window
    // can't yank the user off their screen.
    next.phase = cur.phase;
    next.overlay = cur.overlay;
    next.subsOpen = cur.subsOpen;
    next.ciStage = cur.ciStage;
    state.set(next);
    applyTheme(next.mode, next.accent);
  } catch {
    /* leave the current snapshot in place */
  }
}

export function teardownSync(): void {
  unlistenState?.();
  unlistenState = null;
}

// ===========================================================================
// THE CLOCK + BACKGROUND EFFECTS
// ===========================================================================

let tickTimer: ReturnType<typeof setInterval> | null = null;
/** How often a running session is checkpointed to disk. */
const CHECKPOINT_MS = 20_000;
let lastCheckpoint = 0;
/** Whether THIS window runs background effects. */
let effectOwner = true;

/**
 * Start the 1 Hz clock.
 *
 * `owner` decides whether this window runs BACKGROUND EFFECTS (reminders,
 * wellness, check-ins, break-end notifications, checkpoints) or is display-only.
 *
 * Both webviews exist from launch - even while hidden - and each has its own JS
 * module instance. If both ran effects there would be two independent
 * schedulers: duplicate notifications, and a check-in that fires in the HIDDEN
 * dashboard, advancing the bounded sequence so the visible popover never shows
 * it. The popover is the single owner; the dashboard only ticks its timers.
 */
export function startClock(opts: { owner: boolean } = { owner: true }): void {
  if (tickTimer) return;
  effectOwner = opts.owner;
  tickTimer = setInterval(() => {
    const now = Date.now();
    nowMs.set(now); // display time: always, in both windows
    if (!effectOwner) return;
    checkDayRollover(now);
    checkReminders(now);
    checkWellness(now);
    checkCheckin(now);
    checkBreakEnd(now);
    checkpoint(now);
    updateTrayTitle(now);
  }, 1000);
}

export function stopClock(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

/**
 * Roll the day while the app is RUNNING at local midnight.
 *
 * Rollover otherwise only happens at boot, so an app left open overnight would
 * keep filing today's work under yesterday's date.
 */
function checkDayRollover(now: number): void {
  const today = todayISO(new Date(now));
  const s = S();
  if (s.dateISO === today) return;
  // Don't interrupt a running session at midnight: bank it first so the archive
  // gets the time, exactly as End Day would.
  const next = rolloverIfNewDay(bankOrphanSession({ ...s }), today);
  pendingWelcomeBack = null;
  state.set(next);
  scheduleSave();
  if (next.dayNum !== s.dayNum) showToast("A new day - starting fresh");
}

/**
 * Periodically persist while a session runs.
 *
 * `bankOrphanSession` credits time only up to the last save, so without this a
 * crash after an hour of uninterrupted work (no clicks = no saves) would credit
 * almost none of it. A cheap periodic save bounds that loss to one interval.
 */
function checkpoint(now: number): void {
  const s = S();
  if (!s.activeMainId || !s.startedAt) return;
  if (now - lastCheckpoint < CHECKPOINT_MS) return;
  lastCheckpoint = now;
  void flushSave();
}

/** Last title pushed to the tray, so we only cross the IPC when it changes. */
let lastTrayTitle: string | null = null;

/**
 * Mirror the running task's elapsed time next to the menu-bar icon.
 *
 * MINUTE granularity, not per second: a per-second title would redraw the menu
 * bar 60x more often for no readable benefit, and the number would be too
 * jittery to glance at.
 */
function updateTrayTitle(now: number): void {
  const s = S();
  let title: string | null = null;

  if (s.trayTimer && s.phase === "break" && s.breakEndsAt) {
    const left = Math.max(0, s.breakEndsAt - now);
    title = left > 0 ? `☕ ${Math.ceil(left / 60000)}m` : "☕ up";
  } else if (s.trayTimer && s.activeMainId && s.startedAt) {
    const t = activeThing();
    const ms = (t?.accrued ?? 0) + Math.max(0, now - s.startedAt);
    const mins = Math.floor(ms / 60000);
    title =
      mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
  }

  if (title === lastTrayTitle) return;
  lastTrayTitle = title;
  void invoke("set_tray_title", { title }).catch(() => {
    /* unsupported platform or no tray yet */
  });
}

/**
 * Redact a notification body when the user asked for private notifications.
 *
 * `detail` is the part that could name their work; `generic` is a safe stand-in.
 */
function safeBody(detail: string, generic: string): string {
  return S().privateNotifications ? generic : detail;
}

async function nativeNotify(title: string, body: string): Promise<void> {
  try {
    await invoke("notify", { title, body });
  } catch {
    /* notifications unavailable - the in-app UI still shows the prompt */
  }
}

/** Fire any due reminder exactly once. */
function checkReminders(now: number): void {
  const due = dueReminders(S(), now);
  if (!due.length) return;
  // Mark delivered FIRST, so a slow notification can't cause a second fire.
  commit((s) => {
    due.forEach((d) => {
      const [kind, rest] = d.where.split("|");
      if (kind === "main") {
        const m = s.mains.find((x) => x.id === rest);
        if (m?.remind) m.remind.delivered = true;
      } else if (kind === "sub") {
        const [mid, sid] = rest.split("~");
        const sub = s.mains.find((x) => x.id === mid)?.subs.find((x) => x.id === sid);
        if (sub?.remind) sub.remind.delivered = true;
      } else {
        const b = s.backlog.find((x) => x.id === rest);
        if (b?.remind) b.remind.delivered = true;
      }
    });
  });

  if (S().notifyReminders) {
    if (S().privateNotifications) {
      // One neutral banner; the titles stay inside the app.
      void nativeNotify(
        "Dopamigo reminder",
        due.length === 1 ? "A task reminder is due." : `${due.length} task reminders are due.`,
      );
    } else {
      due.forEach((d) => void nativeNotify("Dopamigo reminder", d.title));
    }
  }
  // ONE toast for the batch: the store holds a single toast, so a per-reminder
  // loop would overwrite every earlier one and the user would see only the last
  // - while all of them are already marked delivered.
  showToast(
    due.length === 1
      ? `⏲ ${due[0].title}`
      : `⏲ ${due.length} reminders due: ${due.map((d) => d.title).join(", ")}`,
  );
}

const WELLNESS_COPY: Record<WellnessKey, { icon: string; title: string; msg: string }> = {
  water: { icon: "💧", title: "Water break", msg: "Take a sip of water." },
  stand: { icon: "🧍", title: "Stand up", msg: "Stand and stretch for a moment." },
  walk: { icon: "🚶", title: "Take a walk", msg: "A short walk resets your focus." },
  lunch: { icon: "🍽️", title: "Lunch time", msg: "Have you eaten? Step away for lunch." },
  breakr: { icon: "☕", title: "Take a break", msg: "You've been at it a while, take a breather." },
};

export function wellnessCopy(k: WellnessKey) {
  return WELLNESS_COPY[k];
}

/** Opt-in, one at a time, never during a break, and never touches the clock. */
function checkWellness(now: number): void {
  const s = S();
  if (s.phase === "startday" || s.phase === "break" || s.phase === "recovery") return;
  if (get(wellnessNudge)) return;
  for (const key of Object.keys(WELLNESS_COPY) as WellnessKey[]) {
    const c = s.wellness[key];
    if (!c?.on) continue;
    if (c._snoozedUntil && now < c._snoozedUntil) continue;

    if (key === "lunch") {
      const hr = new Date(now).getHours();
      const firedToday =
        c._last > 0 && new Date(c._last).toDateString() === new Date(now).toDateString();
      if (hr >= (c.atHour ?? 13) && !firedToday) return fireWellness(key, now);
    } else {
      const every = (c.everyMin ?? 60) * 60000;
      if (c._last === 0) {
        // Start the interval from now rather than firing immediately on enable.
        commit((st) => void (st.wellness[key]._last = now));
      } else if (now >= c._last + every) {
        return fireWellness(key, now);
      }
    }
  }
}

function fireWellness(key: WellnessKey, now: number): void {
  commit((s) => void (s.wellness[key]._last = now));
  wellnessNudge.set(key);
  const c = WELLNESS_COPY[key];
  void nativeNotify(c.title, c.msg);
}

export function dismissWellness(): void {
  wellnessNudge.set(null);
}

export function snoozeWellness(): void {
  const key = get(wellnessNudge);
  if (!key) return;
  const now = Date.now();
  commit((s) => {
    const c = s.wellness[key];
    // A dedicated field, so snoozing never reads as "already fired" - which for
    // the once-a-day lunch nudge would mute it for the rest of the day.
    c._snoozedUntil = now + 15 * 60000;
  });
  wellnessNudge.set(null);
  showToast("Snoozed 15 min");
}

/** Bounded check-in: fires at 1x, 2x, 4x the interval, then stops. */
function checkCheckin(now: number): void {
  const s = S();
  if (s.phase !== "active" || s.overlay) return;
  if (!s.pingMin || s.pingMin <= 0) return;
  if (s.ciMutedDate === s.dateISO) return;
  const stage = s.ciStage ?? 0;
  if (stage >= 3 || !s.startedAt) return;
  // Measure only the CURRENT session. Using all-time `accrued` would make a task
  // that already holds 30 minutes ping the instant it is resumed.
  const on = now - s.startedAt;
  if (on >= s.pingMin * 60000 * Math.pow(2, stage)) {
    const title = activeThing()?.title ?? "your task";
    commit((st) => {
      st.ciStage = stage + 1;
      st.overlay = "checkin";
    });
    void nativeNotify("Still on this?", safeBody(title, "Check in on what you're working on."));
  }
}

/** Mute check-ins for the rest of today. */
export function muteCheckins(): void {
  commit((s) => {
    s.ciMutedDate = s.dateISO;
    s.overlay = null;
  });
  showToast("Check-ins muted for today");
}

/** Notify once when a timed break's clock runs out. */
let breakNotified = false;
function checkBreakEnd(now: number): void {
  const s = S();
  if (s.phase !== "break" || !s.breakEndsAt) {
    breakNotified = false;
    return;
  }
  if (!breakNotified && now >= s.breakEndsAt) {
    breakNotified = true;
    if (s.notifyBreakEnd) {
      void nativeNotify(
        "Break's up",
        safeBody(s.breakPausedTitle || "Ready when you are.", "Ready when you are."),
      );
    }
  }
}

// ===========================================================================
// THE SESSION TRANSACTION
// ===========================================================================

/** Bank the running session's time into whatever it belonged to. */
function bankActive(s: State, now: number): void {
  if (!s.activeMainId || !s.startedAt) return;
  const m = s.mains.find((x) => x.id === s.activeMainId);
  if (!m) return;
  const target: Main | Sub =
    (s.activeSubId ? m.subs.find((x) => x.id === s.activeSubId) : undefined) ?? m;
  target.accrued += Math.max(0, now - s.startedAt);
}

/** Drop active/return-stack references to things that no longer exist. */
function repairActiveRefs(s: State): void {
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

function beginSession(s: State, mainId: string, subId: string | null, now: number): void {
  const m = s.mains.find((x) => x.id === mainId);
  if (m && !m.firstStartedAt) m.firstStartedAt = now;
  s.activeMainId = mainId;
  s.activeSubId = subId;
  s.startedAt = now;
  s.subsOpen = false;
  s.ciStage = 0; // a new episode restarts the bounded check-in sequence
  s.phase = "active";
}

/** THE session transaction. See the file header; do not bypass it. */
function sessionTx(
  mutate: (s: State, now: number) => { mainId: string; subId: string | null } | null | void,
): void {
  const now = Date.now();
  commit((s) => {
    bankActive(s, now);
    const next = mutate(s, now) ?? null;
    repairActiveRefs(s);
    if (next) beginSession(s, next.mainId, next.subId, now);
    else if (!s.activeMainId) {
      s.startedAt = 0;
      if (s.phase === "active") s.phase = "today";
    }
  });
}

/**
 * Record that work was interrupted.
 *
 * Opens an interruption with a 0 duration; the return closes it and fills that
 * in, which is what turns a click count into "interrupted 7 times for 3h 10m".
 */
function openInterruption(
  s: State,
  interruptedTitle: string,
  causeTitle: string,
  via: "interrupt" | "switch" | "checkin",
  now: number,
): void {
  // Close any already-open one first, or a single interruption could absorb the
  // whole rest of the day.
  closeOpenInterruption(s, now);
  s.interruptions.push({
    id: nid(),
    dateISO: s.dateISO,
    interruptedTitle,
    causeTitle,
    atMs: now,
    durationMs: 0,
    open: true,
    via,
  });
}

/** Close the open interruption and charge its time to the task it stole from. */
function closeOpenInterruption(s: State, now: number): void {
  for (let i = s.interruptions.length - 1; i >= 0; i--) {
    const ev = s.interruptions[i];
    if (!ev.open) continue;
    ev.open = false;
    ev.durationMs = Math.max(0, now - ev.atMs);
    const victim = s.mains.find((m) => m.title === ev.interruptedTitle);
    if (victim) {
      victim.interruptedCount = (victim.interruptedCount || 0) + 1;
      victim.interruptedMs = (victim.interruptedMs || 0) + ev.durationMs;
    }
    return;
  }
}

// ===========================================================================
// METRICS - opt-in usage counters, never content
// ===========================================================================

/** The current day's counter bucket, created on demand. */
function bucket(s: State) {
  const d = String(s.dayNum);
  if (!s.metrics.days[d]) s.metrics.days[d] = { events: {}, clicks: {}, friction: {} };
  return s.metrics.days[d];
}

/** Count a product event. A no-op unless the user opted in. */
export function track(name: string): void {
  if (!S().loggingOptIn) return;
  commit((s) => {
    const b = bucket(s);
    b.events[name] = (b.events[name] || 0) + 1;
  });
}

/** Count a UI click by key. */
export function trackClick(key: string): void {
  if (!S().loggingOptIn) return;
  commit((s) => {
    const b = bucket(s);
    b.clicks[key] = (b.clicks[key] || 0) + 1;
  });
}

/**
 * Count a FRICTION signal - a hint the interface confused someone.
 *
 * These are the interesting ones: they say where the design failed, which raw
 * click counts never do.
 */
export function friction(name: string): void {
  if (!S().loggingOptIn) return;
  commit((s) => {
    const b = bucket(s);
    b.friction[name] = (b.friction[name] || 0) + 1;
  });
}

/** Timestamps of recent tab switches, for the thrash signal below. */
let tabHops: number[] = [];

/**
 * Count a dashboard tab switch, and detect TAB THRASH.
 *
 * Four switches inside eight seconds means the person is hunting for something
 * they cannot find - a design failure a plain per-tab click count would hide
 * completely, since each individual click looks perfectly intentional.
 */
export function trackTab(tab: string): void {
  if (!S().loggingOptIn) return;
  commit((s) => {
    const b = bucket(s);
    b.clicks[`tab:${tab}`] = (b.clicks[`tab:${tab}`] || 0) + 1;
    const now = Date.now();
    tabHops = [...tabHops, now].filter((t) => now - t < 8000);
    if (tabHops.length >= 4) {
      b.friction.tab_thrash = (b.friction.tab_thrash || 0) + 1;
      tabHops = [];
    }
  });
}

/**
 * Record a runtime error, so a crash shows up in the usage log instead of only
 * in a console nobody is watching.
 *
 * Message + location only, both truncated - never user content. Recorded even
 * when logging is off, because an error the user can report is worth more than
 * the privacy of its own stack location; the counter bump stays opt-in.
 */
export function trackError(msg: string, where: string): void {
  commit((s) => {
    s.metrics.errors.push({
      at: Date.now(),
      day: s.dayNum,
      where: String(where).slice(0, 80),
      msg: String(msg).slice(0, 200),
    });
    // Cap it: an error loop must not grow the state file without bound.
    if (s.metrics.errors.length > 50) s.metrics.errors.shift();
    if (s.loggingOptIn) {
      const b = bucket(s);
      b.friction.error = (b.friction.error || 0) + 1;
    }
  });
}

/** Route uncaught errors and rejections into `trackError`. */
export function initErrorCapture(): void {
  window.addEventListener("error", (e) => {
    trackError(e.message || "error", e.filename || "window");
  });
  window.addEventListener("unhandledrejection", (e) => {
    trackError(String((e as PromiseRejectionEvent).reason ?? "rejection"), "promise");
  });
}

/** Export the anonymous usage log as JSON into the data folder. */
export async function exportLogs(): Promise<void> {
  if (!S().loggingOptIn) {
    showToast("Turn usage logging on first");
    return;
  }
  try {
    const path = await invoke<string>("write_text_file", {
      name: `dopamigo-usage-${todayISO()}.json`,
      contents: JSON.stringify(
        { ...buildLogs(S()), generatedAt: new Date().toISOString() },
        null,
        2,
      ),
    });
    showToast(`Saved to ${path}`);
  } catch (e) {
    showToast(`Export failed: ${String(e)}`);
  }
}

// ===========================================================================
// UI STATE
// ===========================================================================

export function setPhase(phase: Phase): void {
  commit((s) => void (s.phase = phase));
}

export function setOverlay(overlay: Overlay): void {
  commit((s) => void (s.overlay = overlay));
}

export function closeOverlay(): void {
  commit((s) => void (s.overlay = null));
}

export function toggleSubsOpen(): void {
  commit((s) => void (s.subsOpen = !s.subsOpen));
}

/** Open the dashboard on a given tab. */
export function openDashboard(tab: DashTab = "plan"): void {
  dashTab.set(tab);
  void invoke("open_dashboard").catch(() => {
    /* not in Tauri */
  });
}

// ===========================================================================
// DAY LIFECYCLE
// ===========================================================================

/** Start Day: seed carried tasks + standard-daily routines, then open planning. */
export function startDay(): void {
  commit((s) => {
    const seeded: Main[] = [];
    (s.carrySeed || []).forEach((c) => {
      // Rebuild from the durable snapshot so notes/reminders/estimate come back.
      const m = mkMain(
        c.title,
        (c.subs || []).map((x) => {
          const sub = mkSub(x.title);
          sub.note = x.note ?? "";
          sub.remind = x.remind ?? null;
          return sub;
        }),
      );
      m.carries = c.carries || 0;
      m.note = c.note ?? "";
      m.remind = c.remind ?? null;
      m.estMs = c.estMs || 0;
      seeded.push(m);
    });
    // Standard daily routines are added fresh every day, skipping duplicates.
    (s.standardDaily || []).forEach((title) => {
      const t = title.trim();
      if (!t) return;
      if (seeded.some((m) => m.title.trim().toLowerCase() === t.toLowerCase())) return;
      seeded.push(mkMain(t));
    });
    s.mains = seeded;
    s.carrySeed = [];
    s.dateISO = todayISO();
    s.awaitingStart = false; // the day has begun; rollover may act normally again
    s.phase = "today";
  });
}

/** Remove blank tasks/steps, whatever created them. */
export function pruneEmpty(): void {
  commit((s) => {
    s.mains.forEach((m) => {
      m.subs = m.subs.filter((x) => x.title?.trim());
    });
    s.mains = s.mains.filter((m) => m.title?.trim());
  });
}

export type CarryChoice = "done" | "carry" | "backlog";

/**
 * End Day: apply each pending task's disposition, archive the day, award a
 * revive at each 5-day streak multiple, and seed tomorrow. One atomic swap.
 */
export function endDay(choices: Record<string, CarryChoice> = {}): void {
  const now = Date.now();
  const s0 = S();
  const pending = s0.mains.filter((m) => !m.done);

  const carry: CarrySnapshot[] = [];
  const backlogAdds: BacklogItem[] = [];
  const doneIds = new Set<string>();
  pending.forEach((m) => {
    const c = choices[m.id] ?? "carry";
    if (c === "done") doneIds.add(m.id);
    else if (c === "backlog") backlogAdds.push({ id: nid(), title: m.title, remind: m.remind });
    else carry.push(carrySnapshot(m));
  });

  commit((s) => {
    bankActive(s, now);
    // An interruption still open at End Day would archive with a 0 duration.
    closeOpenInterruption(s, now);
    s.mains.forEach((m) => {
      if (doneIds.has(m.id)) {
        m.done = true;
        if (!m.completedAt) m.completedAt = now;
      }
    });
    s.backlog = [...s.backlog, ...backlogAdds];
    s.activeMainId = null;
    s.activeSubId = null;
    s.startedAt = 0;
  });

  const s1 = S();
  const snap = enrichSnapshot(s1, daySnapshot(s1, now));
  const history = mergeHistory(s1.history, snap);

  // Revive earn-back: refill to 1 at each 5-day streak multiple (max 1).
  const st = computeStreaks(s1);
  let life = s1.life || 0;
  let earned = false;
  if (life < 1 && st.current > 0 && st.current % 5 === 0) {
    life = 1;
    earned = true;
  }

  const endedDay = s1.dayNum;
  const next = freshDay(s1.dayNum + 1, carry);
  copyDurablePreferences(s1, next);
  next.history = history;
  next.life = life;
  // Keep the ENDED day's date. The next launch's rollover re-dates this state to
  // the real today; combined with `awaitingStart` that happens exactly once, so
  // the day number advances once and the carried tasks survive.
  next.dateISO = s1.dateISO;
  next.awaitingStart = true;

  state.set(next);
  scheduleSave();
  showToast(
    (carry.length
      ? `Day ${endedDay} ended · ${carry.length} task${carry.length > 1 ? "s" : ""} waiting for tomorrow`
      : `Day ${endedDay} ended - see you tomorrow`) + (earned ? " · ❤️ revive earned!" : ""),
  );
}

/** Restart the day: clear today's work, keep backlog, history and preferences. */
export function restartDay(): void {
  const s1 = S();
  const next = freshDay(s1.dayNum, []);
  copyDurablePreferences(s1, next);
  next.dateISO = s1.dateISO;
  next.awaitingStart = false;
  next.phase = "today";
  state.set(next);
  scheduleSave();
  showToast("Fresh day");
}

/** Spend the revive heart to bridge the most recent genuinely-missed day. */
export function useRevive(): void {
  const s = S();
  const st = computeStreaks(s);
  if (!st.broken) {
    showToast("Nothing to revive");
    return;
  }
  if ((s.life || 0) < 1) {
    showToast("No revive left - earn one with a 5-day streak");
    return;
  }
  const day = st.broken;
  commit((d) => {
    d.life = 0;
    if (!d.revived.includes(day)) d.revived.push(day);
  });
  showToast(`❤️ ${day} revived - your streak is safe`);
}

/** Mark a day as time off, which bridges a streak gap. Today or future only. */
export function togglePto(iso: string): void {
  commit((s) => {
    s.pto = s.pto.includes(iso) ? s.pto.filter((x) => x !== iso) : [...s.pto, iso];
  });
}

// ===========================================================================
// TASKS
// ===========================================================================

export function addMain(title: string): void {
  const t = title.trim();
  if (!t) return;
  commit((s) => void s.mains.push(mkMain(t)));
}

export function setMainTitle(id: string, title: string): void {
  commit((s) => {
    const m = s.mains.find((x) => x.id === id);
    if (m) m.title = title;
  });
}

export function removeMain(id: string): void {
  const m0 = M(id);
  // Via sessionTx: deleting the ACTIVE task must bank its time first and clear
  // the dangling reference, not leave a session pointing at nothing.
  sessionTx((s) => {
    s.mains = s.mains.filter((m) => m.id !== id);
  });
  if (m0) {
    showToast(`Removed "${m0.title}"`, "Undo", () => {
      commit((s) => void s.mains.push(m0));
    });
  }
}

export function addSub(mainId: string, title: string): void {
  const t = title.trim();
  if (!t) return;
  commit((s) => {
    const m = s.mains.find((x) => x.id === mainId);
    if (m) {
      m.subs.push(mkSub(t));
      m._showSubs = true;
    }
  });
}

export function setSubTitle(mainId: string, subId: string, title: string): void {
  commit((s) => {
    const sub = s.mains.find((x) => x.id === mainId)?.subs.find((x) => x.id === subId);
    if (sub) sub.title = title;
  });
}

export function removeSub(mainId: string, subId: string): void {
  sessionTx((s) => {
    const m = s.mains.find((x) => x.id === mainId);
    if (m) m.subs = m.subs.filter((x) => x.id !== subId);
  });
}

export function toggleShowSubs(mainId: string): void {
  commit((s) => {
    const m = s.mains.find((x) => x.id === mainId);
    if (m) m._showSubs = !m._showSubs;
  });
}

/** Set a note on a task (`subId === null`) or one of its steps. */
export function setNote(mainId: string, subId: string | null, note: string): void {
  commit((s) => {
    const m = s.mains.find((x) => x.id === mainId);
    if (!m) return;
    if (subId) {
      const sub = m.subs.find((x) => x.id === subId);
      if (sub) sub.note = note;
    } else {
      m.note = note;
    }
  });
}

/** Set the trainer estimate, in hours + minutes. */
export function setEstimate(id: string, hours: number, mins: number): void {
  const ms = Math.max(0, Math.round(hours) * 3600000 + Math.round(mins) * 60000);
  commit((s) => {
    const m = s.mains.find((x) => x.id === id);
    if (m) m.estMs = ms;
  });
}

/** Attach or clear a reminder on a task, step or backlog item. */
export function setRemind(
  target: { kind: "main" | "sub" | "backlog"; mainId?: string; id: string },
  kind: RemindKind | "clear",
  raw: string | number,
): void {
  const remind: Remind | null = kind === "clear" ? null : makeRemind(kind, raw);
  if (kind !== "clear" && !remind) {
    showToast("That time didn't make sense");
    return;
  }
  commit((s) => {
    if (target.kind === "main") {
      const m = s.mains.find((x) => x.id === target.id);
      if (m) m.remind = remind;
    } else if (target.kind === "sub") {
      const sub = s.mains.find((x) => x.id === target.mainId)?.subs.find((x) => x.id === target.id);
      if (sub) sub.remind = remind;
    } else {
      const b = s.backlog.find((x) => x.id === target.id);
      if (b) b.remind = remind;
    }
  });
  showToast(remind ? remind.label : "Reminder cleared");
}

/** Start (or restart) a task. */
export function startTask(mainId: string): void {
  sessionTx((s, now) => {
    // Coming back to something on the return stack closes the interruption and
    // charges its time to the task it stole from.
    const idx = s.returnStack.findIndex((r) => r.mainId === mainId);
    if (idx >= 0) {
      s.returnStack = s.returnStack.slice(0, idx);
      closeOpenInterruption(s, now);
    }
    return { mainId, subId: null };
  });
  const m = M(mainId);
  if (m) showToast(`Started "${m.title}"`);
}

/** Work a step of a task. */
export function startSub(mainId: string, subId: string): void {
  sessionTx(() => ({ mainId, subId }));
}

/**
 * Switch to another task, remembering where to come back to.
 *
 * `remember` is the difference between "I'm moving on" and "something pulled me
 * away" - only the latter records an interruption and pushes a return.
 */
export function switchToMain(mainId: string, remember: boolean): void {
  const cur = S();
  if (cur.activeMainId === mainId && !cur.activeSubId) {
    closeOverlay();
    showToast("Continuing this task");
    return;
  }
  const via = cur.switchReason === "checkin" ? "checkin" : remember ? "interrupt" : "switch";
  sessionTx((s, now) => {
    if (remember && s.activeMainId) {
      const from = s.mains.find((x) => x.id === s.activeMainId);
      const to = s.mains.find((x) => x.id === mainId);
      if (from) openInterruption(s, from.title, to?.title ?? "another task", via, now);
      s.returnStack.push({ mainId: s.activeMainId, subId: s.activeSubId });
    }
    s.overlay = null;
    s.switchReason = "";
    return { mainId, subId: null };
  });
  const m = M(mainId);
  showToast(`Switched to "${m?.title ?? ""}"${remember ? " · saved your place" : ""}`);
}

/** Switch to a step, remembering the place when leaving a different task. */
export function switchToSub(mainId: string, subId: string, remember: boolean): void {
  const cur = S();
  if (cur.activeMainId === mainId && cur.activeSubId === subId) {
    closeOverlay();
    showToast("Continuing this step");
    return;
  }
  sessionTx((s, now) => {
    if (remember && s.activeMainId && s.activeMainId !== mainId) {
      const from = s.mains.find((x) => x.id === s.activeMainId);
      const to = s.mains.find((x) => x.id === mainId);
      if (from) openInterruption(s, from.title, to?.title ?? "another task", "switch", now);
      s.returnStack.push({ mainId: s.activeMainId, subId: s.activeSubId });
    }
    s.overlay = null;
    return { mainId, subId };
  });
  showToast("Switched to a step");
}

/** Add a brand-new task and start it - the textbook interruption. */
export function startNewMain(title: string, remember: boolean): void {
  const t = title.trim();
  if (!t) return;
  sessionTx((s, now) => {
    if (remember && s.activeMainId) {
      const from = s.mains.find((x) => x.id === s.activeMainId);
      if (from) openInterruption(s, from.title, t, "interrupt", now);
      s.returnStack.push({ mainId: s.activeMainId, subId: s.activeSubId });
    }
    const m = mkMain(t);
    s.mains.push(m);
    s.overlay = null;
    return { mainId: m.id, subId: null };
  });
  showToast(`Started "${t}"${remember ? " · saved your place" : ""}`);
}

/** Toggle a step's done state. */
export function toggleSubDone(mainId: string, subId: string): void {
  const s0 = S();
  const m0 = s0.mains.find((x) => x.id === mainId);
  const sub0 = m0?.subs.find((x) => x.id === subId);
  if (!m0 || !sub0) return;
  const wasActive = s0.activeSubId === subId && s0.activeMainId === mainId;

  if (sub0.done) {
    commit((s) => {
      const sub = s.mains.find((x) => x.id === mainId)?.subs.find((x) => x.id === subId);
      if (sub) sub.done = false;
    });
    return;
  }

  // Finishing the step you were timing banks it and returns you to the parent.
  sessionTx((s) => {
    const sub = s.mains.find((x) => x.id === mainId)?.subs.find((x) => x.id === subId);
    if (sub) sub.done = true;
    return wasActive ? { mainId, subId: null } : undefined;
  });

  if (wasActive) {
    showToast(`Step done · back to "${m0.title}"`, "Undo", () => {
      sessionTx((s) => {
        const sub = s.mains.find((x) => x.id === mainId)?.subs.find((x) => x.id === subId);
        if (sub) sub.done = false;
        return { mainId, subId };
      });
    });
  }
}

/**
 * Complete the active task: record the estimate outcome, then resume whatever it
 * interrupted - or ask what's next.
 */
export function completeMain(mainId: string): void {
  const now = Date.now();
  const s0 = S();
  const m0 = s0.mains.find((x) => x.id === mainId);
  if (!m0) return;
  const actual = mainTotal(m0, s0, now);
  const estMs = m0.estMs;

  sessionTx((s) => {
    const m = s.mains.find((x) => x.id === mainId);
    if (m) {
      m.done = true;
      m.completedAt = now; // with firstStartedAt this gives the elapsed span
    }
    if (s.trainerOn && estMs > 0) s.estimateLog.push({ estMs, actualMs: actual });
    closeOpenInterruption(s, now);

    // Resume the most recent still-open place on the return stack.
    for (let i = s.returnStack.length - 1; i >= 0; i--) {
      const r = s.returnStack[i];
      const rm = s.mains.find((x) => x.id === r.mainId);
      if (!rm || rm.done) continue;
      const rs = r.subId ? rm.subs.find((x) => x.id === r.subId) : null;
      if (r.subId && (!rs || rs.done)) continue;
      s.returnStack = s.returnStack.slice(0, i);
      return { mainId: rm.id, subId: rs ? rs.id : null };
    }
  });

  if (S().trainerOn && estMs > 0) {
    const ratio = actual / estMs;
    const msg =
      ratio <= 1
        ? "Nice - done under your estimate."
        : ratio < 1.5
          ? "Close to your estimate."
          : `That took about ${ratio.toFixed(1)}x your estimate - worth noting.`;
    setTimeout(() => showToast(msg), 400);
  }

  const s2 = S();
  const back = activeThing();
  if (s2.activeMainId && back) {
    showToast(`"${m0.title}" done · back to "${back.title}"`);
  } else {
    // Nothing waiting -> ask what's next.
    commit((s) => void (s.overlay = "done-choose"));
  }
}

/** Un-complete a finished task. */
export function reviveMain(mainId: string): void {
  commit((s) => {
    const m = s.mains.find((x) => x.id === mainId);
    if (m) {
      m.done = false;
      m.completedAt = 0;
    }
  });
}

/** Promote a step into its own task, keeping ALL of its time. */
export function promoteSub(mainId: string, subId: string): void {
  const s0 = S();
  const m0 = s0.mains.find((x) => x.id === mainId);
  const sub0 = m0?.subs.find((x) => x.id === subId);
  if (!m0 || !sub0) return;
  const wasActive = s0.activeSubId === subId && s0.activeMainId === mainId;
  let newId = "";

  // Through the transaction so the live session is banked into the step FIRST -
  // otherwise the time since the last save would be dropped on the floor.
  sessionTx((s) => {
    const m = s.mains.find((x) => x.id === mainId);
    const sub = m?.subs.find((x) => x.id === subId);
    if (!m || !sub) return;
    m.subs = m.subs.filter((x) => x.id !== subId);
    const nm = mkMain(sub.title);
    nm.accrued = sub.accrued; // banked above, so this is the full elapsed time
    nm.fromSub = true;
    nm.note = sub.note;
    nm.remind = sub.remind;
    newId = nm.id;
    const idx = s.mains.findIndex((x) => x.id === mainId);
    s.mains.splice(idx + 1, 0, nm);
    return wasActive ? { mainId: nm.id, subId: null } : undefined;
  });

  showToast(`"${sub0.title}" is now its own task`, "Undo", () => {
    // Undo also banks first, so time worked during the undo window isn't lost.
    sessionTx((s) => {
      const promoted = s.mains.find((x) => x.id === newId);
      const parent = s.mains.find((x) => x.id === mainId);
      if (!promoted || !parent) return;
      s.mains = s.mains.filter((x) => x.id !== newId);
      const back = mkSub(promoted.title);
      back.accrued = promoted.accrued;
      back.note = promoted.note;
      back.remind = promoted.remind;
      parent.subs.push(back);
      return wasActive ? { mainId: parent.id, subId: back.id } : undefined;
    });
  });
}

// ===========================================================================
// BREAKS
// ===========================================================================

/** Take a timed break; the task clock stops. */
export function startBreak(minutes = 15): void {
  const now = Date.now();
  commit((s) => {
    const t = activeThing();
    bankActive(s, now);
    s.breakPausedTitle = t?.title ?? "your work";
    s.breakEndsAt = now + minutes * 60000;
    // Keep activeMainId so the break can resume the same work, but stop the
    // clock: startedAt = 0 means nothing is accruing.
    s.startedAt = 0;
    s.phase = "break";
    s.overlay = null;
  });
}

export function extendBreak(minutes = 5): void {
  commit((s) => void (s.breakEndsAt += minutes * 60000));
  showToast(`${minutes} more minutes`);
}

/** Resume after a break, returning to the paused task when there was one. */
export function resumeFromBreak(): void {
  const now = Date.now();
  commit((s) => {
    s.breakEndsAt = 0;
    if (s.activeMainId && s.mains.some((m) => m.id === s.activeMainId && !m.done)) {
      s.startedAt = now;
      s.ciStage = 0;
      s.phase = "active";
    } else {
      s.activeMainId = null;
      s.activeSubId = null;
      s.phase = "today";
    }
  });
  showToast("Back to work");
}

// ===========================================================================
// BACKLOG
// ===========================================================================

export function addBacklog(title: string): void {
  const t = title.trim();
  if (!t) return;
  commit((s) => void s.backlog.push({ id: nid(), title: t, remind: null }));
  showToast("Added to backlog");
}

export function deleteBacklog(id: string): void {
  const item = S().backlog.find((x) => x.id === id);
  commit((s) => void (s.backlog = s.backlog.filter((x) => x.id !== id)));
  if (item) {
    showToast("Removed from backlog", "Undo", () => {
      commit((s) => void s.backlog.push(item));
    });
  }
}

/** Move a backlog item into today - always an explicit user action. */
export function backlogToToday(id: string): void {
  const item = S().backlog.find((x) => x.id === id);
  if (!item) return;
  commit((s) => {
    const m = mkMain(item.title);
    m.remind = item.remind;
    m.note = item.note ?? "";
    s.mains.push(m);
    s.backlog = s.backlog.filter((x) => x.id !== id);
  });
  showToast(`"${item.title}" added to today`);
}

// ===========================================================================
// IMPORT / EXPORT
// ===========================================================================

/** Apply a parsed import: tasks with their steps, plus backlog items. */
export function applyImport(parsed: ParsedImport): void {
  commit((s) => {
    parsed.mains.forEach((pm) => {
      const m = mkMain(
        pm.title,
        pm.subs.map((x) => {
          const sub = mkSub(x.title);
          sub.remind = x.remind;
          return sub;
        }),
      );
      m.remind = pm.remind;
      s.mains.push(m);
    });
    parsed.backlog.forEach((b) => {
      s.backlog.push({ id: nid(), title: b.title, remind: b.remind });
    });
  });
  const n = parsed.mains.length;
  const b = parsed.backlog.length;
  showToast(
    `Imported ${n} task${n === 1 ? "" : "s"}${b ? ` and ${b} backlog item${b === 1 ? "" : "s"}` : ""}`,
  );
}

/** Write a timestamped JSON backup into the data folder. */
export async function exportBackup(): Promise<void> {
  try {
    const path = await invoke<string>("write_text_file", {
      name: `dopamigo-backup-${todayISO()}.json`,
      contents: JSON.stringify(forPersist(S()), null, 2),
    });
    showToast(`Saved to ${path}`);
  } catch (e) {
    showToast(`Export failed: ${String(e)}`);
  }
}

/**
 * Restore from a backup file's text.
 *
 * Goes through `hydrate`, so a hand-edited or foreign file can't inject a shape
 * the app can't run. The data folder is machine-local and deliberately NOT
 * restored - a backup made on another machine would point at a path that may not
 * exist here.
 */
export function restoreBackup(text: string): void {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    showToast("That file isn't valid JSON");
    return;
  }
  const next = hydrate(raw);
  if (!next.dateISO) {
    showToast("That file doesn't look like a Dopamigo backup");
    return;
  }
  state.set(rolloverIfNewDay(bankOrphanSession(next)));
  applyTheme(S().mode, S().accent);
  void flushSave();
  showToast("Backup restored");
}

// ===========================================================================
// SETTINGS
// ===========================================================================

export function setMode(mode: State["mode"]): void {
  commit((s) => void (s.mode = mode));
  applyTheme(S().mode, S().accent);
}

export function setAccent(accent: State["accent"]): void {
  commit((s) => void (s.accent = accent));
  applyTheme(S().mode, S().accent);
}

export function setDayTarget(mins: number): void {
  commit((s) => void (s.dayTargetMins = Math.max(30, Math.round(mins))));
}

export function setPingMin(mins: number): void {
  commit((s) => void (s.pingMin = Math.max(0, Math.round(mins))));
}

/** Flip a boolean preference by key, so the UI needs one handler not eight. */
export type BoolPref =
  | "trainerOn"
  | "avoidanceOn"
  | "notifyReminders"
  | "notifyBreakEnd"
  | "welcomeBack"
  | "privateNotifications"
  | "trayTimer"
  | "loggingOptIn";

export function setFlag(key: BoolPref, on: boolean): void {
  commit((s) => void (s[key] = on));
  // Clearing the tray title immediately makes the toggle feel real, instead of
  // waiting for the next tick to notice.
  if (key === "trayTimer" && !on) {
    lastTrayTitle = null;
    void invoke("set_tray_title", { title: null }).catch(() => {});
  }
}

export function toggleWellness(key: WellnessKey, on: boolean): void {
  commit((s) => {
    s.wellness[key].on = on;
    // Reset the interval so enabling doesn't instantly fire from a stale stamp.
    s.wellness[key]._last = on ? Date.now() : 0;
    s.wellness[key]._snoozedUntil = undefined;
  });
}

export function setWellnessEvery(key: WellnessKey, mins: number): void {
  commit((s) => void (s.wellness[key].everyMin = Math.max(1, Math.round(mins))));
}

export function setWellnessHour(key: WellnessKey, hour: number): void {
  commit((s) => void (s.wellness[key].atHour = Math.min(23, Math.max(0, Math.round(hour)))));
}

/**
 * Replace the standard-daily list.
 *
 * Written to BOTH state.json and settings.json: settings is the portable source
 * of truth that survives a state restore, and `boot` reads it back.
 */
export async function setStandardDaily(list: string[]): Promise<void> {
  const clean = list.map((x) => x.trim()).filter(Boolean);
  commit((s) => void (s.standardDaily = clean));
  try {
    await invoke("set_standard_daily_list", { list: clean });
  } catch {
    /* settings unwritable - state.json still has it */
  }
}

export async function getAutoUpdate(): Promise<boolean> {
  try {
    return await invoke<boolean>("get_auto_update");
  } catch {
    return false;
  }
}

export async function setAutoUpdate(on: boolean): Promise<void> {
  try {
    await invoke("set_auto_update", { on });
  } catch (e) {
    showToast(`Couldn't save that: ${String(e)}`);
  }
}

export async function getDataFolder(): Promise<string> {
  try {
    return await invoke<string>("get_data_folder");
  } catch {
    return "";
  }
}

export function openDataFolder(): void {
  void invoke("open_data_folder").catch((e) => showToast(String(e)));
}

export function quitApp(): void {
  void flushSave().then(() => invoke("quit_app").catch(() => {}));
}

export async function resetAndUninstall(keepHistory: boolean): Promise<void> {
  await invoke("reset_and_uninstall_app", { keepHistory }).catch((e) => showToast(String(e)));
}

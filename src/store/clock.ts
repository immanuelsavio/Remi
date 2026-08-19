/**
 * THE CLOCK + BACKGROUND EFFECTS.
 *
 * `owner` decides whether this window runs BACKGROUND EFFECTS (reminders,
 * wellness, check-ins, break-end notifications, checkpoints) or is
 * display-only.
 *
 * Both webviews exist from launch - even while hidden - and each has its
 * own JS module instance. If both ran effects there would be two
 * independent schedulers: duplicate notifications, and a check-in that
 * fires in the HIDDEN dashboard, advancing the bounded sequence so the
 * visible popover never shows it. The popover is the single owner; the
 * dashboard only ticks its timers.
 */

import { invoke } from "@tauri-apps/api/core";
import { get, writable } from "svelte/store";

import { dueReminders } from "../domain/reminders";
import { todayISO } from "../domain/dates";
import type { WellnessKey } from "../domain/types";
import { flushSave, showSaveError } from "./persistence";
import {
  S,
  activeThing,
  bankOrphanSession,
  commit,
  nowMs,
  rolloverIfNewDay,
  setState,
  showToast,
} from "./state";

/** The wellness nudge currently on screen (at most one). */
export const wellnessNudge = writable<WellnessKey | null>(null);

let tickTimer: ReturnType<typeof setInterval> | null = null;
/** How often a running session is checkpointed to disk. */
const CHECKPOINT_MS = 20_000;
let lastCheckpoint = 0;
/** Whether THIS window runs background effects. */
let effectOwner = true;

/** Start the 1 Hz clock. */
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
 * Rollover otherwise only happens at boot, so an app left open overnight
 * would keep filing today's work under yesterday's date.
 */
function checkDayRollover(now: number): void {
  const today = todayISO(new Date(now));
  const s = S();
  if (s.dateISO === today) return;
  // Don't interrupt a running session at midnight: bank it first so the
  // archive gets the time, exactly as End Day would.
  const next = rolloverIfNewDay(bankOrphanSession({ ...s }), today);
  setState(next);
  if (next.dayNum !== s.dayNum) showToast("A new day - starting fresh");
}

/**
 * Periodically persist while a session runs.
 *
 * `bankOrphanSession` credits time only up to the last save, so without
 * this a crash after an hour of uninterrupted work (no clicks = no saves)
 * would credit almost none of it. A cheap periodic save bounds that loss
 * to one interval.
 */
function checkpoint(now: number): void {
  const s = S();
  if (!s.activeMainId || !s.startedAt) return;
  if (now - lastCheckpoint < CHECKPOINT_MS) return;
  lastCheckpoint = now;
  // Fire-and-forget: a failed checkpoint still shows a toast and the next
  // tick or edit retries. `flushSave` now rejects on a real write failure
  // instead of swallowing it, so this catch is required to avoid an
  // unhandled-rejection warning. On a StaleWriteError, `flushSave` already
  // reloaded the current state - the next checkpoint simply persists that,
  // it does not re-apply any mutation.
  void flushSave().catch((e) => showSaveError(e));
}

/** Last title pushed to the tray, so we only cross the IPC when it changes. */
let lastTrayTitle: string | null = null;

export function resetTrayTitleCache(): void {
  lastTrayTitle = null;
}

/**
 * Mirror the running task's elapsed time next to the menu-bar icon.
 *
 * MINUTE granularity, not per second: a per-second title would redraw the
 * menu bar 60x more often for no readable benefit, and the number would be
 * too jittery to glance at.
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
 * Redact a notification body when the user asked for private
 * notifications.
 *
 * `detail` is the part that could name their work; `generic` is a safe
 * stand-in.
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
        "Remi reminder",
        due.length === 1 ? "A task reminder is due." : `${due.length} task reminders are due.`,
      );
    } else {
      due.forEach((d) => void nativeNotify("Remi reminder", d.title));
    }
  }
  // ONE toast for the batch: the store holds a single toast, so a
  // per-reminder loop would overwrite every earlier one and the user would
  // see only the last - while all of them are already marked delivered.
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
    // A dedicated field, so snoozing never reads as "already fired" - which
    // for the once-a-day lunch nudge would mute it for the rest of the day.
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
  // Measure only the CURRENT session. Using all-time `accrued` would make a
  // task that already holds 30 minutes ping the instant it is resumed.
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

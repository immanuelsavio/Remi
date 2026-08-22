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
import { listen } from "@tauri-apps/api/event";
import { get, writable } from "svelte/store";

import { dueReminders } from "../domain/reminders";
import { todayISO } from "../domain/dates";
import type { WellnessKey } from "../domain/types";
import { WELLNESS_COPY, wellnessCopy } from "../domain/wellness";
import { autoBackup, flushSave, showSaveError } from "./persistence";
import {
  S,
  tourOverlay,
  tourRunningAnywhere,
  activeThing,
  bankOrphanSession,
  commit,
  nowMs,
  rolloverIfNewDay,
  setState,
  showToast,
  wellnessNudge,
} from "./state";

/** The wellness nudge currently on screen (at most one). */
// Re-exported: it lives in `state.ts` so the tour can cancel a preview
// without one action module importing another.
export { wellnessNudge };
export { wellnessCopy };

let tickTimer: ReturnType<typeof setInterval> | null = null;
/** Dropped when the clock stops, so a native tick cannot outlive it. */
let unlistenTick: (() => void) | null = null;
/** How often a running session is checkpointed to disk. */
const CHECKPOINT_MS = 20_000;
let lastCheckpoint = 0;
/**
 * Whether THIS window runs background effects.
 *
 * A LEASE now, not a constant. It used to be decided at the call site - the
 * popover always, the dashboard never - which meant that when macOS
 * suspended the hidden popover's timers, NOBODY ran reminders, wellness,
 * break-end notifications or the tray title, while a perfectly awake
 * dashboard sat there doing none of it on purpose. Rust holds the lease
 * (`scheduler.rs`); this is the last answer it gave.
 */
let effectOwner = true;
/** Which window this is, for the lease. */
let leaseName = "popover";
/** The window that PREFERS to own effects still asks first. */
let preferOwner = true;
let lastLeaseCheck = 0;
/** How often to ask about the lease. Well inside its 5s expiry. */
const LEASE_RENEW_MS = 2000;

/**
 * Ask Rust whether this window owns effects, and remember the answer.
 *
 * Both windows ask. The preferred owner (the popover) asks every renewal
 * interval, so it keeps the lease while it is awake; the other asks too, and
 * gets it only once the lease has EXPIRED - which is exactly the case where
 * the preferred owner has stopped running.
 */
function renewLease(now: number): void {
  if (now - lastLeaseCheck < LEASE_RENEW_MS) return;
  lastLeaseCheck = now;
  void invoke<boolean>("claim_effect_owner", { window: leaseName })
    .then((mine) => {
      effectOwner = mine;
    })
    .catch(() => {
      // No backend (browser dev, or the command is unavailable): fall back
      // to the static preference rather than leaving the app with no owner
      // at all.
      effectOwner = preferOwner;
    });
}

/** Start the 1 Hz clock. */
export function startClock(opts: { owner: boolean } = { owner: true }): void {
  if (tickTimer) return;
  effectOwner = opts.owner;
  preferOwner = opts.owner;
  leaseName = opts.owner ? "popover" : "dashboard";
  lastLeaseCheck = 0;
  // A fresh clock beats immediately: the de-duplication below is about two
  // SOURCES landing in the same second, not about a previous run.
  lastTick = 0;

  // The native heartbeat (`scheduler.rs`) is the primary tick: it runs on a
  // real OS thread, and the IPC it delivers wakes a throttled webview
  // promptly where its own coalesced timer would not. The interval below
  // stays as a fallback for a browser dev build and for any moment the
  // event bus is unavailable; `tick` is idempotent within a second, so both
  // firing costs nothing.
  void listen<number>("remi-tick", (ev) => tick(ev.payload || Date.now()))
    .then((un) => {
      unlistenTick = un;
    })
    .catch(() => {
      /* no event bus - the interval below is the whole clock */
    });

  tickTimer = setInterval(() => tick(Date.now()), 1000);
}

/** One beat of the clock, from whichever source got here first. */
let lastTick = 0;
function tick(at: number): void {
  // Two sources, one beat: the native heartbeat and the local interval both
  // arrive about once a second, and doing the work twice would double-fire
  // notifications.
  if (at - lastTick < 500) return;
  lastTick = at;
  runTick(at);
}

function runTick(now: number): void {
  renewLease(now);
  nowMs.set(now); // display time: always, in both windows
  // DELIBERATELY ABOVE the effect-owner gate. Rolling the day is state
  // CORRECTNESS, not a background effect: getting it wrong files today's
  // work under yesterday's date. The owner is the POPOVER, which is
  // hidden almost all the time, and a hidden WKWebView has its timers
  // throttled or suspended by macOS - so gating this behind ownership
  // meant an app left open overnight could silently never roll, while the
  // visible dashboard ticked away doing nothing about it.
  //
  // Safe to run in both windows: `rolloverIfNewDay` no-ops once
  // `dateISO === today`, and saves are compare-and-swap, so if both
  // windows roll at once one write is rejected and that window reloads
  // the already-rolled state rather than rolling again.
  checkDayRollover(now);
  if (!effectOwner) return;
  // NOTHING that reaches outside the app fires while the tour is on
  // screen. The user is being introduced to Remi; a check-in asking how a
  // real task is going, or a wellness nudge about a day they are not
  // looking at, arrives with no context to read it by.
  //
  // Read from a CROSS-WINDOW signal, not from this window's own state: the
  // tour runs in the dashboard and these effects run in the popover, so a
  // window-local flag would be false in the only window that fires
  // anything - which is what silently disabled this guard.
  //
  // The checkpoint still runs, so a real session left running is still
  // banked while the user takes the tour.
  if (get(tourRunningAnywhere) || get(tourOverlay)) {
    checkpoint(now);
    return;
  }
  // Once a day, quietly. Owner-only: two windows racing would write the
  // same snapshot twice and prune each other's.
  void autoBackup();
  checkReminders(now);
  checkWellness(now);
  checkCheckin(now);
  checkBreakEnd(now);
  checkpoint(now);
  updateTrayTitle(now);
}

export function stopClock(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  unlistenTick?.();
  unlistenTick = null;
  // Hand the lease back rather than making the other window wait for it to
  // expire - a window that is going away is not "quiet for a moment".
  void invoke("release_effect_owner", { window: leaseName }).catch(() => {});
}

/**
 * Roll the day while the app is RUNNING at local midnight.
 *
 * Rollover otherwise only happens at boot, so an app left open overnight
 * would keep filing today's work under yesterday's date. Runs in BOTH
 * windows - see the note at the call site.
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

/**
 * Send the user one of each notification, on request, from the tour.
 *
 * A real banner, not a drawing of one. Two reasons it has to be real: the
 * first native notification is what triggers macOS's permission prompt, and
 * onboarding is the honest moment to ask - the alternative is the request
 * arriving unexplained, hours later, attached to something they actually
 * needed to see. And a mock cannot tell them whether notifications work on
 * THIS machine, which is the only thing worth knowing.
 *
 * Both halves fire, because both exist: the native banner and the in-app
 * card. `nativeNotify` already swallows a refusal, so a denied permission
 * leaves the in-app nudge doing its job and nothing looks broken.
 */
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

/** METRICS - opt-in usage counters, never content. */

import { invoke } from "@tauri-apps/api/core";

import { buildLogs } from "../domain/usage-logs";
import { todayISO } from "../domain/dates";
import type { State } from "../domain/types";
import { S, commit, showToast } from "./state";

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
 * These are the interesting ones: they say where the design failed, which
 * raw click counts never do.
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
 * Four switches inside eight seconds means the person is hunting for
 * something they cannot find - a design failure a plain per-tab click
 * count would hide completely, since each individual click looks
 * perfectly intentional.
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
 * Record a runtime error, so a crash shows up in the usage log instead of
 * only in a console nobody is watching.
 *
 * Message + location only, both truncated - never user content. Recorded
 * even when logging is off, because an error the user can report is worth
 * more than the privacy of its own stack location; the counter bump stays
 * opt-in.
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
      name: `remi-usage-${todayISO()}.json`,
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

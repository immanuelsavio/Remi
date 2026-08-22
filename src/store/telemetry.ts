/** METRICS - opt-in usage counters, never content. */

import { invoke } from "@tauri-apps/api/core";

import { buildLogs } from "../domain/usage-logs";
import { classifyError, redactWhere } from "../domain/error-kinds";
import { todayISO } from "../domain/dates";
import { exportSuffix } from "../domain/ids";
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
 * **What is recorded depends on consent**, because an exception message is
 * arbitrary text: it routinely carries a file path (which contains the
 * user's account name), a URL, or a fragment of whatever the code was
 * handling - which can be their own task titles or notes. The old
 * behaviour stored that raw text regardless of `loggingOptIn`, which
 * contradicted PRIVACY.md's promise that turning logging off stops
 * collection.
 *
 * - Logging OFF: the fixed KIND only (`domain/error-kinds.ts`), no raw
 *   message, no location. That is a closed set written by us, not
 *   anything the user typed - enough to know something is breaking
 *   without recording what.
 * - Logging ON: the kind plus the truncated message and a redacted
 *   location (file name, no directories).
 */
export function trackError(msg: string, where: string): void {
  const kind = classifyError(msg);
  commit((s) => {
    const optedIn = s.loggingOptIn;
    s.metrics.errors.push({
      at: Date.now(),
      day: s.dayNum,
      kind,
      ...(optedIn ? { where: redactWhere(where), msg: String(msg).slice(0, 200) } : {}),
    });
    // Cap it: an error loop must not grow the state file without bound.
    if (s.metrics.errors.length > 50) s.metrics.errors.shift();
    if (optedIn) {
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

/**
 * Record what the user wants to tell us.
 *
 * Stored, not sent: it rides along in the next log export, which the user
 * performs and hands over deliberately. Nothing here reaches the network.
 */
export function setFeedback(text: string): void {
  commit((s) => void (s.feedback = String(text).slice(0, 4000)));
}

/** Export the usage log as JSON into the data folder. */
export async function exportLogs(): Promise<void> {
  const s0 = S();
  // Feedback alone is worth exporting: someone who turned logging off can
  // still file a complaint, and refusing would just lose the report.
  if (!s0.loggingOptIn && !s0.feedback.trim()) {
    showToast("Turn usage logging on, or write a note first");
    return;
  }
  try {
    const path = await invoke<string>("write_text_file", {
      name: `remi-usage-${todayISO()}-${exportSuffix()}.json`,
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

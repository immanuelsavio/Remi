/** UI STATE: phase/overlay navigation and opening the dashboard. */

import { invoke } from "@tauri-apps/api/core";
import { get, writable } from "svelte/store";

import type { DashTab, Overlay, Phase } from "../domain/types";
import { S, commit, dashTab, restoreFromDemo, sessionTx } from "./state";
import { demoDay } from "../domain/demo";
import { nextShown, TOUR_STEPS } from "../domain/tour";

/**
 * Which task/step/backlog item the reminder sheet is currently editing, or
 * `null` when it is closed.
 *
 * Purely transient window-local UI - it never reaches `state.json`, and each
 * window has its own, so opening the picker in the dashboard does not pop a
 * sheet in the popover. It lives here rather than in a component because the
 * sheet is opened from six different places (Today cards, step rows, the map,
 * the planner, the backlog) and rendered once at the window root.
 */
export type RemindTarget =
  | { kind: "main"; id: string; title: string }
  | { kind: "sub"; mainId: string; id: string; title: string }
  | { kind: "backlog"; id: string; title: string };

export const remindTarget = writable<RemindTarget | null>(null);

/** Open the reminder picker for a task, step or backlog item. */
export function openRemind(target: RemindTarget): void {
  remindTarget.set(target);
}

export function closeRemind(): void {
  remindTarget.set(null);
}

/**
 * The guided tour's position, or `null` when it is not running.
 *
 * Window-local: the tour is a thing happening in front of one person, not
 * state about their work, so it never reaches `state.json`. Only the
 * "already seen" flag is persisted.
 */
export { restoreFromDemo };

export const tourStep = writable<number | null>(null);

/**
 * Put the demo day on screen and hold the real one aside.
 *
 * Routed through `sessionTx` and not a bare `commit`, because replacing
 * `mains` while a task is on the clock is exactly the mutation that
 * transaction exists for: the running session has to be banked to the
 * user's OWN task before the list is swapped, or its time is either lost or
 * credited to a demo task that does not exist.
 *
 * The snapshot is written to state rather than kept in a module variable,
 * so quitting mid-tour is recoverable - see `restoreFromDemo` on boot.
 */
function enterDemo(): void {
  if (S().demoRestore) return; // already in it; never snapshot the demo
  sessionTx((s, now) => {
    const { mains, interruptions } = demoDay(now, s.dateISO);
    s.demoRestore = JSON.parse(
      JSON.stringify({
        mains: s.mains,
        interruptions: s.interruptions,
        activeMainId: s.activeMainId,
        activeSubId: s.activeSubId,
        startedAt: s.startedAt,
        phase: s.phase,
        awaitingStart: s.awaitingStart,
      }),
    );
    s.mains = mains;
    s.interruptions = interruptions;
    s.activeMainId = null;
    s.activeSubId = null;
    // Lift the Start-day gate for the duration.
    //
    // This is what makes the tour INTERACTIVE rather than a slideshow. On a
    // first launch the day has not begun, and behind that gate the tab strip
    // is disabled and the panel renders the gate instead of any tab - so the
    // demo tasks the tour exists to point at were on screen for nobody, and
    // every "try adding a step" was an instruction you could not follow.
    // `restoreFromDemo` puts the gate back, so the user is still asked to
    // start their own day when the tour ends.
    s.awaitingStart = false;
    s.phase = "today";
    return null;
  });
}

export function startTour(): void {
  enterDemo();
  tourStep.set(0);
  dashTab.set(TOUR_STEPS[0].tab ?? get(dashTab));
}

/**
 * Move to the next step the user is actually being shown.
 *
 * Steps can opt out of a tour (see `skipWhen`), so this walks forward past
 * any that no longer apply rather than landing on one and bouncing off it.
 * Running out of steps forwards is what finishes the tour.
 */
export function tourNext(): void {
  const at = get(tourStep);
  if (at === null) return;
  const next = nextShown(at, 1, S());
  if (next === null) {
    endTour();
    return;
  }
  tourStep.set(next);
  const tab = TOUR_STEPS[next].tab;
  if (tab) dashTab.set(tab);
}

export function tourBack(): void {
  const at = get(tourStep);
  if (at === null) return;
  const prev = nextShown(at, -1, S());
  if (prev === null) return;
  tourStep.set(prev);
  const tab = TOUR_STEPS[prev].tab;
  if (tab) dashTab.set(tab);
}

/**
 * Close the tour and remember that it ran, however it ended.
 *
 * Finishing, skipping and the close button all land here, which is the
 * point: there is exactly one way out, so the demo cannot survive an exit
 * nobody thought about.
 */
export function endTour(): void {
  tourStep.set(null);
  restoreFromDemo();
  commit((s) => void (s.tourSeen = true));
}

export function setPhase(phase: Phase): void {
  commit((s) => void (s.phase = phase));
}

export function setOverlay(overlay: Overlay): void {
  commit((s) => void (s.overlay = overlay));
}

export function closeOverlay(): void {
  commit((s) => void (s.overlay = null));
}

/**
 * Open the switch sheet, recording WHY it was opened.
 *
 * `switchToMain` reads `switchReason` to stamp the interruption's `via`
 * field, which is what lets the Stats tab separate "I chose to switch" from
 * "a check-in caught me having already drifted". Opening the sheet with a
 * bare `setOverlay("switch")` leaves the reason stale, so every switch would
 * be filed as a deliberate interrupt.
 */
export function openSwitch(reason: "interrupt" | "checkin" | "switch"): void {
  commit((s) => {
    s.switchReason = reason;
    s.overlay = "switch";
  });
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

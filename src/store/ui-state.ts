/** UI STATE: phase/overlay navigation and opening the dashboard. */

import { invoke } from "@tauri-apps/api/core";
import { writable } from "svelte/store";

import type { DashTab, Overlay, Phase } from "../domain/types";
import { commit, dashTab, showToast } from "./state";

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

/**
 * Drop the menu-bar popover open.
 *
 * Used by the tour, which can ring anything inside its own window but not
 * an icon in the menu bar - the one part of Remi it cannot point at.
 */
export async function openPopover(): Promise<void> {
  try {
    await invoke("open_popover");
  } catch (e) {
    // A button labelled "open it" that quietly does nothing is worse than
    // one that says why. Swallowed failures here were flagged in review.
    showToast(`Couldn't open the menu-bar window: ${String(e)}`);
  }
}

/** Open the dashboard on a given tab. */
export function openDashboard(tab: DashTab = "plan"): void {
  dashTab.set(tab);
  void invoke("open_dashboard").catch(() => {
    /* not in Tauri */
  });
}

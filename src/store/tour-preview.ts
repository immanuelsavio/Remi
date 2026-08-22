/**
 * The tour's notification preview.
 *
 * Lives with the tour rather than the clock because it is a tour feature
 * and, more practically, because the tour has to be able to CANCEL it -
 * and an action module may only depend on `state.ts`, never on another
 * action module.
 *
 * The notifications are real, not drawings. Two reasons: the first native
 * notification is what triggers macOS's permission prompt, and onboarding
 * is the honest moment for that rather than it arriving unexplained hours
 * later attached to something that mattered; and a mock cannot tell anyone
 * whether notifications actually work on THIS machine, which is the only
 * thing worth knowing.
 */
import { invoke } from "@tauri-apps/api/core";
import { get } from "svelte/store";

import { wellnessCopy } from "../domain/wellness";
import { wellnessNudge } from "./state";

let previewTimer: ReturnType<typeof setTimeout> | null = null;

async function nativeNotify(title: string, body: string): Promise<void> {
  try {
    await invoke("notify", { title, body });
  } catch {
    /* refused or unavailable - the in-app card still does its job */
  }
}

/** Send one of each, on request. */
export function previewNotifications(): void {
  // One sequence at a time. Pressing the button twice queued a second
  // delayed pair on top of the first.
  cancelNotificationPreview();
  void nativeNotify("Draft the quarterly update", "This is what a deadline looks like.");
  // Staggered so they do not stack into one indistinguishable pile.
  previewTimer = setTimeout(() => {
    previewTimer = null;
    const c = wellnessCopy("water");
    void nativeNotify(c.title, c.msg);
    wellnessNudge.set("water");
  }, 1400);
}

/**
 * Drop a preview that has not fired, and any card it already raised.
 *
 * Leaving the tour is the case that matters: a wellness card appearing a
 * second later, over an app that has stopped explaining anything, is a
 * nudge the user never turned on.
 */
export function cancelNotificationPreview(): void {
  if (previewTimer) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
  if (get(wellnessNudge) === "water") wellnessNudge.set(null);
}

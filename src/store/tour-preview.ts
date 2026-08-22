/**
 * THE TRAY PREVIEW - what the popover shows while the tour explains it.
 *
 * The menu-bar lesson has to point at something the tour cannot draw: the
 * other window. Opening the real popover mid-tour used to show whatever the
 * popover genuinely had - on a first run, the "start my day" screen - so
 * the lesson about "your task, still on the clock, one click away" pointed
 * at a screen with no task and no clock on it.
 *
 * The obvious fix would be to put the practice task into shared state so
 * the popover sees it. That is exactly the mistake the tour refactor
 * exists to undo: the demo would become authoritative, reach `state.json`
 * and outlive the tour.
 *
 * So the preview travels as an EVENT PAYLOAD instead. It is presentation
 * state, it lives in each window's memory for as long as the lesson is on
 * screen, and it is never written anywhere. The popover renders it INSTEAD
 * of its own screens while it is set, and drops it when the tour says so.
 */

import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { writable, type Readable } from "svelte/store";

/** Everything the preview screen needs. Deliberately tiny and flat. */
export interface TrayPreview {
  /** Which tour run raised it, so a stale one can be recognised. */
  runId: number;
  /** The practice task's EXACT title - not a placeholder. */
  title: string;
  /** The tour clock's absolute start, so the timer is derived, not counted. */
  startedAt: number;
}

const preview = writable<TrayPreview | null>(null);

/** Read-only: the popover renders this instead of its own screens. */
export const trayPreview: Readable<TrayPreview | null> = { subscribe: preview.subscribe };

const EVENT = "tour-tray-preview";

/**
 * Show (or update) the preview in the other window.
 *
 * Emitted rather than stored. `emit` reaches every window including this
 * one, which is what keeps the two in step without a shared writable.
 */
export function showTrayPreview(p: TrayPreview): void {
  preview.set(p);
  void emit(EVENT, p).catch(() => {
    /* no event bus - the popover simply shows its ordinary screens */
  });
}

/** Take it down - the lesson is over, or the tour is. */
export function clearTrayPreview(): void {
  preview.set(null);
  void emit(EVENT, null).catch(() => {});
}

let unlisten: UnlistenFn | null = null;

/** Listen for the dashboard raising or dropping a preview. */
export async function initTrayPreview(): Promise<void> {
  try {
    unlisten = await listen<TrayPreview | null>(EVENT, (ev) => {
      preview.set(ev.payload ?? null);
    });
  } catch {
    /* no event bus - the popover shows its ordinary screens */
  }
}

export function teardownTrayPreview(): void {
  unlisten?.();
  unlisten = null;
  preview.set(null);
}

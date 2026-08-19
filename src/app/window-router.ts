/**
 * Both windows load the SAME bundle; the window LABEL decides which root
 * component mounts.
 *
 * `getCurrentWindow().label` is a synchronous property in @tauri-apps/api v2.
 * The try/catch means the bundle still renders under a plain `vite dev` in a
 * browser, where the Tauri API is absent - handy for styling work.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import Popover from "../views/Popover.svelte";
import Dashboard from "../views/Dashboard.svelte";

/** Mount the root component for the current window onto `target`. */
export function mountForWindow(target: HTMLElement) {
  let label = "popover";
  try {
    label = getCurrentWindow().label;
  } catch {
    /* not inside Tauri - keep the popover view */
  }

  return new (label === "dashboard" ? Dashboard : Popover)({
    target,
  });
}

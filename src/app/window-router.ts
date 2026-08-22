/**
 * Both windows load the SAME bundle; the window LABEL decides which root
 * component mounts.
 *
 * `getCurrentWindow().label` is a synchronous property in @tauri-apps/api v2.
 * The try/catch means the bundle still renders under a plain `vite dev` in a
 * browser, where the Tauri API is absent - handy for styling work.
 */
import { mount } from "svelte";

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

  // `mount` rather than `new Component(...)`: the class-like component API
  // was removed in Svelte 5.
  return mount(label === "dashboard" ? Dashboard : Popover, { target });
}

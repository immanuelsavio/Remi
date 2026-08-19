/** SETTINGS: theme, targets, preference toggles, wellness config, data folder,
 * quit/uninstall. */

import { invoke } from "@tauri-apps/api/core";

import { applyTheme } from "../domain/theme";
import type { State, WellnessKey } from "../domain/types";
import { resetTrayTitleCache } from "./clock";
import { requestQuit, StaleWriteError } from "./persistence";
import { S, commit, showToast } from "./state";

export function setMode(mode: State["mode"]): void {
  commit((s) => void (s.mode = mode));
  applyTheme(S().mode, S().accent);
}

export function setAccent(accent: State["accent"]): void {
  commit((s) => void (s.accent = accent));
  applyTheme(S().mode, S().accent);
}

export function setDayTarget(mins: number): void {
  commit((s) => void (s.dayTargetMins = Math.max(30, Math.round(mins))));
}

export function setPingMin(mins: number): void {
  commit((s) => void (s.pingMin = Math.max(0, Math.round(mins))));
}

/** Flip a boolean preference by key, so the UI needs one handler not eight. */
export type BoolPref =
  | "trainerOn"
  | "avoidanceOn"
  | "notifyReminders"
  | "notifyBreakEnd"
  | "welcomeBack"
  | "privateNotifications"
  | "trayTimer"
  | "loggingOptIn";

export function setFlag(key: BoolPref, on: boolean): void {
  commit((s) => void (s[key] = on));
  // Clearing the tray title immediately makes the toggle feel real, instead
  // of waiting for the next tick to notice.
  if (key === "trayTimer" && !on) {
    resetTrayTitleCache();
    void invoke("set_tray_title", { title: null }).catch(() => {});
  }
}

export function toggleWellness(key: WellnessKey, on: boolean): void {
  commit((s) => {
    s.wellness[key].on = on;
    // Reset the interval so enabling doesn't instantly fire from a stale stamp.
    s.wellness[key]._last = on ? Date.now() : 0;
    s.wellness[key]._snoozedUntil = undefined;
  });
}

export function setWellnessEvery(key: WellnessKey, mins: number): void {
  commit((s) => void (s.wellness[key].everyMin = Math.max(1, Math.round(mins))));
}

export function setWellnessHour(key: WellnessKey, hour: number): void {
  commit((s) => void (s.wellness[key].atHour = Math.min(23, Math.max(0, Math.round(hour)))));
}

/**
 * Replace the standard-daily list.
 *
 * Written to BOTH state.json and settings.json: settings is the portable
 * source of truth that survives a state restore, and `boot` reads it back.
 */
export async function setStandardDaily(list: string[]): Promise<void> {
  const clean = list.map((x) => x.trim()).filter(Boolean);
  commit((s) => void (s.standardDaily = clean));
  try {
    await invoke("set_standard_daily_list", { list: clean });
  } catch {
    /* settings unwritable - state.json still has it */
  }
}

export async function getAutoUpdate(): Promise<boolean> {
  try {
    return await invoke<boolean>("get_auto_update");
  } catch {
    return false;
  }
}

export async function setAutoUpdate(on: boolean): Promise<void> {
  try {
    await invoke("set_auto_update", { on });
  } catch (e) {
    showToast(`Couldn't save that: ${String(e)}`);
  }
}

export async function getDataFolder(): Promise<string> {
  try {
    return await invoke<string>("get_data_folder");
  } catch {
    return "";
  }
}

export function openDataFolder(): void {
  void invoke("open_data_folder").catch((e) => showToast(String(e)));
}

/**
 * Quit through the real persistence barrier (`requestQuit`): flushes first,
 * and only actually quits if that succeeds. On failure the app stays open
 * and shows why, so a caller that doesn't specifically need to observe the
 * rejection (e.g. a plain `on:click`) still gets a visible error rather
 * than a silent no-op or an unhandled rejection. Also re-thrown, for
 * callers (tests, the tray listener) that DO want to observe it directly.
 */
export async function quitApp(): Promise<void> {
  try {
    await requestQuit();
  } catch (e) {
    if (e instanceof StaleWriteError) {
      // Do NOT auto-retry: the reload already replaced this window's
      // pending state with the other window's, so quitting again right
      // away could quit without ever saving what THIS window had.
      showToast(e.message);
    } else {
      showToast(`Couldn't save before quitting: ${String(e)}. Remi stayed open.`);
    }
    throw e;
  }
}

export async function resetAndUninstall(keepHistory: boolean): Promise<void> {
  await invoke("reset_and_uninstall_app", { keepHistory }).catch((e) => showToast(String(e)));
}

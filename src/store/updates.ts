/**
 * UPDATES: check for a newer release, show its notes, and hand the install
 * off to Rust.
 *
 * All the network and process work lives in `src-tauri/src/updater.rs`. The
 * webview's CSP has no `connect-src` for GitHub on purpose - the app makes
 * no outbound requests of its own, and adding one here would widen that for
 * every page in both windows.
 */

import { invoke } from "@tauri-apps/api/core";
import { writable } from "svelte/store";

import { showToast } from "./state";
import { flushSave } from "./persistence";

export interface UpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  notes: string;
  url: string;
}

/** The running version, resolved once at boot. */
export const appVersion = writable<string>("");

/** The last check's result, or `null` if we have not looked yet. */
export const updateInfo = writable<UpdateInfo | null>(null);

/** True while a check is in flight, so the button can say so. */
export const updateChecking = writable(false);

/**
 * Release notes to show ONCE, because the app just changed version under
 * the user. `null` when there is nothing to say.
 */
export const whatsNew = writable<{ version: string; notes: string } | null>(null);

export async function loadAppVersion(): Promise<void> {
  try {
    appVersion.set(await invoke<string>("get_app_version"));
  } catch {
    /* not in Tauri (browser dev) - the badge just stays blank */
  }
}

/**
 * Look for a newer release.
 *
 * `silent` suppresses the "you're up to date" toast, for the automatic
 * check at boot: nobody asked, so nobody should be told nothing happened.
 */
export async function checkForUpdate(silent = false): Promise<void> {
  updateChecking.set(true);
  try {
    const info = await invoke<UpdateInfo>("check_for_update");
    updateInfo.set(info);
    if (info.available) {
      showToast(`Remi ${info.latest} is available`);
    } else if (!silent) {
      // An empty `latest` means we could not reach GitHub, could not read
      // the repo, or no release exists yet - all indistinguishable from
      // here, and all "we don't know" rather than "you're current".
      showToast(info.latest ? "You're on the latest version" : "Couldn't check for updates");
    }
  } catch (e) {
    updateInfo.set(null);
    if (!silent) showToast(`Couldn't check for updates: ${String(e)}`);
  } finally {
    updateChecking.set(false);
  }
}

/**
 * Install a version and quit so the detached helper can replace the app.
 *
 * The save happens BEFORE the helper is spawned and before the quit: the
 * helper is waiting on this process to exit, and an update that loses the
 * day's work would be far worse than no update at all.
 */
export async function installUpdate(version: string): Promise<void> {
  try {
    await flushSave();
  } catch (e) {
    showToast(`Not updating - couldn't save your day first: ${String(e)}`);
    return;
  }
  try {
    await invoke("install_update", { version });
    showToast("Updating - Remi will quit and reopen…");
    // Give the toast a beat, then go through the normal quit path.
    setTimeout(() => void invoke("quit_app").catch(() => {}), 1200);
  } catch (e) {
    showToast(`Update failed to start: ${String(e)}`);
  }
}

/**
 * Decide whether to show "what's new", and record that we did.
 *
 * Only fires on a version CHANGE, never on a fresh install: someone opening
 * Remi for the first time does not want a changelog, they want the app.
 */
export async function checkWhatsNew(): Promise<void> {
  let current = "";
  let seen = "";
  try {
    current = await invoke<string>("get_app_version");
    seen = await invoke<string>("get_seen_version");
  } catch {
    return; // not in Tauri
  }
  if (!current) return;

  if (seen && seen !== current) {
    // Reuse the release-notes fetch, but never block the UI on it: if the
    // network is down the panel still appears, just without the notes.
    let notes = "";
    try {
      const info = await invoke<UpdateInfo>("check_for_update");
      if (info.latest === current) notes = info.notes;
    } catch {
      /* notes are a nicety, the version bump is the message */
    }
    whatsNew.set({ version: current, notes });
  }
  if (seen !== current) {
    try {
      await invoke("set_seen_version", { version: current });
    } catch {
      /* settings unwritable; it will simply offer again next launch */
    }
  }
}

export function dismissWhatsNew(): void {
  whatsNew.set(null);
}

/**
 * PERSISTENCE: debounced atomic save, and boot/load from disk.
 */

import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

import { applyTheme } from "../domain/theme";
import { forPersist } from "../domain/persistence-shape";
import { hydrate } from "../domain/hydration";
import {
  S,
  bankOrphanSession,
  commit,
  damagedPaths,
  getSaveTimerHandle,
  loadKind,
  loadMessage,
  registerSaveScheduler,
  rolloverIfNewDay,
  setSaveTimerHandle,
  setState,
  showToast,
  state,
  welcomeBack,
} from "./state";

/** Identifies THIS window, so it can ignore the echo of its own save. */
const WINDOW_ID = Math.random().toString(36).slice(2);

let saving = false;
let dirtyAgain = false;
let revision = 0;

/** Debounced so a burst of edits collapses into one write. */
function scheduleSave(): void {
  const existing = getSaveTimerHandle();
  if (existing) clearTimeout(existing);
  setSaveTimerHandle(setTimeout(() => void flushSave(), 250));
}
registerSaveScheduler(scheduleSave);

/**
 * Write now.
 *
 * If a save is already in flight, mark it dirty and re-schedule rather
 * than interleaving two writes: the loser would otherwise silently drop
 * its edit.
 */
export async function flushSave(): Promise<void> {
  const existing = getSaveTimerHandle();
  if (existing) {
    clearTimeout(existing);
    setSaveTimerHandle(null);
  }
  if (saving) {
    dirtyAgain = true;
    return;
  }
  saving = true;
  try {
    const now = Date.now();
    const payload = forPersist(S(), now);
    await invoke("save_app_state", { state: payload });
    // Mirror the stamp we just persisted, so `bankOrphanSession` and the
    // checkpoint both measure against the real last-save time.
    state.update((s) => ({ ...s, savedAt: now }));
    revision++;
    try {
      await emit("app-state-changed", { revision, from: WINDOW_ID });
    } catch {
      /* no event bus - the other window still refreshes on focus */
    }
  } catch (e) {
    showToast(`Couldn't save: ${String(e)}`);
  } finally {
    saving = false;
    if (dirtyAgain) {
      dirtyAgain = false;
      scheduleSave();
    }
  }
}

export function windowId(): string {
  return WINDOW_ID;
}

/** Scratch handoff from `bankOrphanSession` to `boot`. */
let pendingWelcomeBack: { mainId: string; subId: string | null; title: string } | null = null;

/** Load from disk, applying the day rollover and banking an orphaned session. */
export async function boot(): Promise<void> {
  let res: {
    kind: "fresh" | "loaded" | "recovered" | "damaged";
    state?: unknown;
    message?: string;
    paths?: string[];
  };
  try {
    res = await invoke("load_app_state");
  } catch (e) {
    // A backend failure must NOT silently start an empty day - that would
    // look exactly like "all my work vanished".
    loadKind.set("damaged");
    loadMessage.set(`Couldn't read your data: ${String(e)}`);
    commit((s) => void (s.phase = "recovery"));
    return;
  }

  loadKind.set(res.kind);
  loadMessage.set(res.message ?? "");
  damagedPaths.set(res.paths ?? []);

  if (res.kind === "damaged") {
    // Rust preserved the user's files; show the recovery screen, not a
    // blank day.
    commit((s) => void (s.phase = "recovery"));
    return;
  }

  if (res.state) {
    let s = hydrate(res.state);
    s = bankOrphanSession(s, (info) => void (pendingWelcomeBack = info));
    s = rolloverIfNewDay(s);
    setState(s);
  }

  // Adopt the standard-daily list from settings.json (the shared source of
  // truth).
  try {
    const list = await invoke<string[]>("get_standard_daily");
    if (Array.isArray(list) && list.length) {
      commit((s) => void (s.standardDaily = list));
    }
  } catch {
    /* settings unreadable - keep whatever the state file had */
  }

  const s = S();
  applyTheme(s.mode, s.accent);
  if (res.kind === "recovered" && res.message) showToast(res.message);

  if (pendingWelcomeBack && s.welcomeBack) welcomeBack.set(pendingWelcomeBack);
  pendingWelcomeBack = null;
}

export function dismissWelcomeBack(): void {
  welcomeBack.set(null);
}

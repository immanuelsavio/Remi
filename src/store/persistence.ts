/**
 * PERSISTENCE: debounced atomic save, and boot/load from disk.
 */

import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

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
/**
 * When a save is already in flight, `flushSave()` cannot start a second
 * write (that would interleave two `save_app_state` calls) - but a caller
 * that needs to know the data is REALLY down before proceeding (quitting)
 * must not just fire-and-forget either. This tracks the in-flight chain so
 * a later caller can await "everything currently queued has landed",
 * including any dirty re-write the in-flight save schedules on its way out.
 */
let inFlight: Promise<void> | null = null;

/** Debounced so a burst of edits collapses into one write. */
function scheduleSave(): void {
  const existing = getSaveTimerHandle();
  if (existing) clearTimeout(existing);
  setSaveTimerHandle(setTimeout(() => void flushSave(), 250));
}
registerSaveScheduler(scheduleSave);

/**
 * Write now, and resolve once the write (and any write it queued while it
 * was running) has actually landed - never before.
 *
 * If a save is already in flight, this does NOT start a second, interleaved
 * write: it marks the in-flight one dirty (so it re-runs once) and awaits
 * that same chain instead.
 */
export async function flushSave(): Promise<void> {
  const existing = getSaveTimerHandle();
  if (existing) {
    clearTimeout(existing);
    setSaveTimerHandle(null);
  }
  if (saving) {
    dirtyAgain = true;
    // `inFlight` is guaranteed set whenever `saving` is true.
    return inFlight ?? undefined;
  }
  saving = true;
  const run = (async () => {
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
        // Chain the re-write so awaiters of THIS call see it too, rather
        // than resolving before the dirty edit is actually saved.
        inFlight = flushSave();
        await inFlight;
      }
    }
  })();
  inFlight = run;
  await run;
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

let unlistenQuitRequest: UnlistenFn | null = null;

/**
 * Listen for the tray menu's `quit-requested` event (see `tray.rs`'s
 * `MENU_QUIT` handler) and drive the SAME flush-then-quit path the
 * dashboard's Quit button uses, instead of Rust guessing a fixed delay
 * against the frontend's debounce timer.
 *
 * Only the effect owner (the popover) should register this - it is always
 * mounted, so the tray menu always has someone listening.
 */
export async function registerQuitListener(): Promise<void> {
  try {
    unlistenQuitRequest = await listen("quit-requested", () => {
      void flushSave().finally(() => {
        void invoke("quit_app").catch(() => {});
      });
    });
  } catch {
    /* no event bus - the tray handler falls back to exiting directly */
  }
}

export function teardownQuitListener(): void {
  unlistenQuitRequest?.();
  unlistenQuitRequest = null;
}

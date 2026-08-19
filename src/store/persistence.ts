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
  setSaveTimerHandle(
    setTimeout(() => {
      // Fire-and-forget: a failure here still shows the user a toast (see
      // below) and the NEXT edit or checkpoint retries. Only callers that
      // need a real barrier (quit, restore) await flushSave() directly and
      // handle its rejection themselves.
      void flushSave().catch((e) => showToast(`Couldn't save: ${String(e)}`));
    }, 250),
  );
}
registerSaveScheduler(scheduleSave);

/**
 * Write now, and resolve once the write (and any write it queued while it
 * was running) has actually landed - or REJECT if it failed.
 *
 * This is a real persistence barrier: callers that need to know the data
 * is genuinely down before proceeding (quitting, reporting "Backup
 * restored") must be able to tell success from failure, not just get a
 * promise that always resolves. Fire-and-forget callers (the debounced
 * auto-save, the periodic checkpoint) explicitly swallow the rejection
 * themselves - see `scheduleSave` and `clock.ts`'s `checkpoint` - so a
 * transient failure there still shows the user a toast and retries on the
 * next edit/tick, exactly as before.
 *
 * If a save is already in flight, this does NOT start a second,
 * interleaved write: it marks the in-flight one dirty (so it re-runs once)
 * and awaits that same chain instead, so a failure in the QUEUED rewrite
 * still propagates to every caller awaiting this call.
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
    let writeError: unknown;
    try {
      const now = Date.now();
      const payload = forPersist(S(), now);
      const res = await invoke<{ rev?: number; stale?: boolean; currentRev?: number }>(
        "save_app_state",
        { state: payload },
      );
      if (res?.stale) {
        // The OTHER window saved a newer revision first. Rust rejected
        // this write rather than silently overwriting it - reload from
        // disk to pick up their change instead of losing it, and surface
        // that this attempt did not go through as asked. (Inlined rather
        // than importing `sync.ts`'s `reloadFromDisk` - that module
        // already imports FROM this one for `windowId()`, and importing
        // back would create a cycle.)
        try {
          const fresh = await invoke<{ kind: string; state?: unknown }>("load_app_state");
          if (fresh.state) {
            const cur = S();
            const next = hydrate(fresh.state);
            next.phase = cur.phase;
            next.overlay = cur.overlay;
            next.subsOpen = cur.subsOpen;
            next.ciStage = cur.ciStage;
            state.set(next);
            applyTheme(next.mode, next.accent);
          }
        } catch {
          /* leave the current snapshot in place */
        }
        throw new Error(
          "Another window saved changes first - reloaded the latest version. Please retry your edit.",
        );
      }
      // Mirror the stamp AND the new revision we just persisted, so
      // `bankOrphanSession`/the checkpoint measure against the real
      // last-save time, and the NEXT save's CAS check compares against
      // what's actually on disk now. Only on SUCCESS - a failed write
      // must not make the live state believe it was saved.
      const newRev = res?.rev ?? 0;
      state.update((s) => ({ ...s, savedAt: now, _rev: newRev }));
      revision++;
      try {
        await emit("app-state-changed", { revision, from: WINDOW_ID });
      } catch {
        /* no event bus - the other window still refreshes on focus */
      }
    } catch (e) {
      writeError = e;
    } finally {
      saving = false;
    }

    if (dirtyAgain) {
      dirtyAgain = false;
      // A mutation arrived WHILE this write was running. Chain the
      // re-write so awaiters of THIS call see it land too, rather than
      // resolving/rejecting before that edit is actually saved. The
      // rewrite's own outcome is what matters now - if it SUCCEEDS, the
      // current state (including whatever this attempt's payload was
      // missing) is genuinely down, so this attempt's earlier failure (if
      // any) is superseded, not still an open problem. If the rewrite
      // itself fails, that rejection propagates naturally.
      const rewrite = flushSave();
      inFlight = rewrite;
      await rewrite;
      return;
    }

    if (writeError) throw writeError;
  })();
  inFlight = run;
  return run;
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
 * Only one shutdown sequence may run at a time. Pressing Quit twice (tray
 * menu, Cmd+Q, the dashboard button, all in quick succession) must not
 * start a second overlapping flush-then-quit - it should just observe the
 * one already in progress.
 */
let quitInFlight: Promise<void> | null = null;

/**
 * THE quit barrier: flush, and only invoke `quit_app` if that flush
 * actually succeeded. Both the tray menu's `quit-requested` event and the
 * dashboard's Quit button funnel through this ONE function, so there is
 * exactly one shutdown sequence no matter how many times the user asks.
 *
 * On failure: rejects with the save's error, `quit_app` is never called,
 * and the app stays open so the user can see the error and retry (export,
 * copy their work, fix the disk, whatever the failure calls for).
 */
export async function requestQuit(): Promise<void> {
  if (quitInFlight) return quitInFlight;
  const run = (async () => {
    try {
      await flushSave();
    } finally {
      // Whether this attempt succeeds or fails, the NEXT quit request
      // (e.g. a retry after fixing the problem) must be allowed to start
      // its own attempt, not be stuck observing this failed one forever.
      quitInFlight = null;
    }
    await invoke("quit_app");
  })();
  quitInFlight = run;
  return run;
}

/**
 * Listen for the tray menu's `quit-requested` event (see `tray.rs`'s
 * `MENU_QUIT` handler) and drive the SAME flush-then-quit path the
 * dashboard's Quit button uses (`requestQuit`), instead of Rust guessing a
 * fixed delay against the frontend's debounce timer.
 *
 * Registered as early as `onMount` safely allows (see `views/Popover.svelte`
 * - right after `boot()`/`initSync()`, before the rest of setup), so a
 * Quit chosen immediately after launch is still heard. Only the effect
 * owner (the popover) registers this - it is always mounted, so the tray
 * menu always has someone listening once boot has reached this point.
 *
 * Once the listener is actually registered, this calls `quit_listener_ready`
 * so Rust knows a real handshake partner exists - see `tray::QuitReadiness`.
 * Without that ack, `MENU_QUIT` falls back to exiting directly rather than
 * emitting `quit-requested` into a void nobody is listening to.
 */
export async function registerQuitListener(): Promise<void> {
  try {
    unlistenQuitRequest = await listen("quit-requested", () => {
      void requestQuit().catch((e) => {
        showToast(`Couldn't save before quitting: ${String(e)}. Remi stayed open.`);
      });
    });
    await invoke("quit_listener_ready");
  } catch {
    /* no event bus - the tray handler falls back to exiting directly */
  }
}

export function teardownQuitListener(): void {
  unlistenQuitRequest?.();
  unlistenQuitRequest = null;
}

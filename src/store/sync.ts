/**
 * CROSS-WINDOW SYNC: refresh from disk when the OTHER window persists a
 * change, ignoring the echo of our own save.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { applyTheme } from "../domain/theme";
import { hydrate } from "../domain/hydration";
import { S, state } from "./state";
import { windowId } from "./persistence";

let unlistenState: UnlistenFn | null = null;

/** Refresh from disk when the OTHER window persists a change. */
export async function initSync(): Promise<void> {
  try {
    unlistenState = await listen<{ revision: number; from: string }>(
      "app-state-changed",
      async (ev) => {
        if (ev.payload?.from === windowId()) return; // ignore our own echo
        await reloadFromDisk();
      },
    );
  } catch {
    /* no event bus - refresh-on-focus remains the fallback */
  }
}

/** Pull the authoritative persisted snapshot (sync + focus fallback). */
export async function reloadFromDisk(): Promise<void> {
  try {
    const res = await invoke<{ kind: string; state?: unknown }>("load_app_state");
    if (!res.state) return;
    const cur = S();
    const next = hydrate(res.state);
    // Keep THIS window's transient view so a background save in the other
    // window can't yank the user off their screen.
    next.phase = cur.phase;
    next.overlay = cur.overlay;
    next.subsOpen = cur.subsOpen;
    next.ciStage = cur.ciStage;
    state.set(next);
    applyTheme(next.mode, next.accent);
  } catch {
    /* leave the current snapshot in place */
  }
}

export function teardownSync(): void {
  unlistenState?.();
  unlistenState = null;
}

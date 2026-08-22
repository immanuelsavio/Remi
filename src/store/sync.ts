/**
 * CROSS-WINDOW SYNC: refresh from disk when the OTHER window persists a
 * change, ignoring the echo of our own save.
 *
 * The reload itself lives in `reload.ts` - the ONE guarded implementation,
 * shared with `flushSave()`'s stale-write handler. See the note there.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { reloadFromDisk } from "./reload";
import { windowId } from "./persistence";

export { reloadFromDisk } from "./reload";

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

export function teardownSync(): void {
  unlistenState?.();
  unlistenState = null;
}

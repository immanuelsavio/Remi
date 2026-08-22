/**
 * CROSS-WINDOW SYNC: refresh from disk when the OTHER window persists a
 * change, ignoring the echo of our own save.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { applyTheme } from "../domain/theme";
import { hydrate } from "../domain/hydration";
import { keepLocalView, mutationGeneration, S, state } from "./state";
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

/**
 * Which reload is the current one.
 *
 * Two can be in flight at once - a focus event and a save event arriving
 * together - and they resolve in whatever order the backend answers. Only
 * the newest may apply, or an older snapshot wins simply by finishing last.
 */
let reloadSeq = 0;

/** Pull the authoritative persisted snapshot (sync + focus fallback). */
export async function reloadFromDisk(): Promise<void> {
  const seq = ++reloadSeq;
  const genBefore = mutationGeneration();
  try {
    const res = await invoke<{ kind: string; state?: unknown }>("load_app_state");
    if (!res.state) return;
    // Superseded while we waited: a newer read of the same file is already
    // on its way or applied.
    if (seq !== reloadSeq) return;
    // The user changed something DURING the load. What came back predates
    // that edit, so applying it would erase work they just did. Leave it:
    // their own save follows, and the compare-and-swap is the place where
    // a genuine conflict gets resolved.
    if (mutationGeneration() !== genBefore) return;
    const cur = S();
    const next = hydrate(res.state);
    // Never go backwards. An older revision is a stale read, not news.
    if (next._rev < cur._rev) return;
    // Keep THIS window's transient view so a background save in the other
    // window can't yank the user off their screen - but ONLY within the
    // same day.
    //
    // Across a day boundary that preservation is fatal. `checkDayRollover`
    // runs in BOTH windows on purpose, so at midnight both roll and one
    // loses the compare-and-swap. If the loser reloads the winner's state
    // and then stamps its OWN phase/overlay back on top, its state never
    // equals disk: it stays dirty, saves, makes the winner stale, and the
    // two ping-pong forever - the day never converges, "A new day -
    // starting fresh" repeats, and the tray flips between the End Day
    // sheet and the Start-day screen.
    //
    // When the persisted day is not the day this window is looking at, the
    // local view belongs to a day that no longer exists. Take theirs.
    // `awaitingStart` is part of the identity here, not a detail: when the
    // OTHER window starts the day, this one must stop offering to start it.
    // That is a change of what the day IS, not a background edit within it.
    const sameDay =
      next.dateISO === cur.dateISO &&
      next.dayNum === cur.dayNum &&
      next.awaitingStart === cur.awaitingStart;
    if (sameDay) {
      keepLocalView(next, cur);
    }
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

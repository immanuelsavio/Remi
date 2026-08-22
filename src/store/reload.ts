/**
 * THE authoritative reload.
 *
 * There is exactly one way to replace this window's in-memory state with
 * what is on disk, and this is it. Both callers - the cross-window sync
 * listener (`sync.ts`) and the stale-write handler inside `flushSave()`
 * (`persistence.ts`) - go through here.
 *
 * That single-implementation rule is the point of this module. The stale
 * handler used to inline its own `load_app_state` + `state.set(...)`,
 * which meant it carried NONE of the guards `reloadFromDisk` had grown:
 * an edit made while that nested load was in flight was overwritten
 * wholesale, and the debounced save afterwards persisted its absence.
 *
 * It lives in its own module rather than in `sync.ts` because `sync.ts`
 * imports `windowId()` from `persistence.ts`; having `persistence.ts`
 * import back from `sync.ts` would close a cycle. This module imports
 * only `state.ts` and the domain, so both may depend on it.
 *
 * The three guards, all of which apply to EVERY reload:
 *
 * - a **sequence number**, so of two reloads in flight only the newest
 *   applies. An older snapshot cannot win by finishing last.
 * - a **mutation generation**, captured before the await. If the user
 *   edited anything while the load was in flight, the reload declines -
 *   the snapshot predates their edit, and their own save follows, where
 *   the compare-and-swap resolves a genuine conflict.
 * - a **revision floor**: an older `_rev` is a stale read, not news.
 */

import { invoke } from "@tauri-apps/api/core";

import { applyTheme } from "../domain/theme";
import { hydrate } from "../domain/hydration";
import { keepLocalView, mutationGeneration, S, state } from "./state";

/**
 * What actually happened, so a caller can tell the user the truth.
 *
 * `flushSave`'s stale path used to claim "the latest version was reloaded
 * here" unconditionally - including when the nested load had just thrown
 * and left the old snapshot exactly where it was.
 *
 * - `applied` - disk state is now this window's state.
 * - `declined` - a guard refused it: a newer reload superseded this one,
 *   the user edited during the load, or the snapshot was older than what
 *   we already hold. Nothing was lost; nothing changed here.
 * - `failed` - the backend could not be read. The current snapshot stands.
 */
export type ReloadOutcome = "applied" | "declined" | "failed";

/**
 * Which reload is the current one.
 *
 * Two can be in flight at once - a focus event and a save event arriving
 * together, or a sync listener and a stale-write handler - and they
 * resolve in whatever order the backend answers.
 */
let reloadSeq = 0;

/** Pull the authoritative persisted snapshot, guarded. */
export async function reloadFromDisk(): Promise<ReloadOutcome> {
  const seq = ++reloadSeq;
  const genBefore = mutationGeneration();
  let res: { kind: string; state?: unknown };
  try {
    res = await invoke<{ kind: string; state?: unknown }>("load_app_state");
  } catch {
    // Leave the current snapshot in place - and SAY so, rather than
    // letting a caller report a reload that did not happen.
    return "failed";
  }
  if (!res.state) return "declined";
  // Superseded while we waited: a newer read of the same file is already
  // on its way or applied.
  if (seq !== reloadSeq) return "declined";
  // The user changed something DURING the load. What came back predates
  // that edit, so applying it would erase work they just did. Leave it:
  // their own save follows, and the compare-and-swap is the place where
  // a genuine conflict gets resolved.
  if (mutationGeneration() !== genBefore) return "declined";
  const cur = S();
  const next = hydrate(res.state);
  // Never go backwards. An older revision is a stale read, not news.
  if (next._rev < cur._rev) return "declined";
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
  return "applied";
}

/**
 * WHERE THE TOUR POINTS: a registry, not a search.
 *
 * The tour used to find its targets with `document.querySelector` on a
 * `data-tour` attribute, retried across animation frames and re-checked on
 * a 400ms interval. That is polling for something the DOM already knows,
 * and it failed in ways that were invisible until someone hit them:
 *
 *   - an element that had not rendered yet was "not found", and the step
 *     silently degraded to a centred card
 *   - an element replaced by another with the same name (the "add steps"
 *     link becoming the box it opens) kept the stale node until a tick
 *     happened to notice
 *   - a search superseded mid-flight could leave a new instruction sitting
 *     beside the PREVIOUS step's control
 *
 * An element registers itself when it mounts and unregisters when it goes.
 * There is nothing to poll and nothing to miss: the tour reads the current
 * element for a key, or `null`, and re-reads when that changes.
 */
import { writable, type Readable } from "svelte/store";

const registry = writable<Record<string, HTMLElement>>({});

/** Read-only view of everything currently on screen and marked. */
export const tourAnchors: Readable<Record<string, HTMLElement>> = registry;

/**
 * Svelte action: mark this element as the tour's target for `key`.
 *
 * `use:tourAnchor={undefined}` is a no-op, so a caller can mark one item in
 * a list conditionally without branching its markup.
 */
export function tourAnchor(node: HTMLElement, key: string | undefined) {
  let current = key;
  const add = (k: string | undefined) => {
    if (!k) return;
    registry.update((all) => ({ ...all, [k]: node }));
  };
  const remove = (k: string | undefined) => {
    if (!k) return;
    registry.update((all) => {
      // Only if it is still OURS. A replacement element registering the
      // same key before this one tears down must not be unregistered by
      // the outgoing node's cleanup.
      if (all[k] !== node) return all;
      const { [k]: _gone, ...rest } = all;
      return rest;
    });
  };
  add(current);
  return {
    update(next: string | undefined) {
      if (next === current) return;
      remove(current);
      current = next;
      add(current);
    },
    destroy() {
      remove(current);
    },
  };
}

import { TRANSIENT_KEYS } from "./types";
import type { State } from "./types";

/**
 * Strip transient UI fields so only durable product state is written, and
 * stamp `savedAt`.
 *
 * `savedAt` is what lets a session still running at quit be credited
 * honestly on the next launch: time is banked up to the LAST SAVE, not up
 * to "now", so a machine left off overnight cannot award hours nobody
 * worked.
 */
export function forPersist(s: State, now: number = Date.now()): Record<string, unknown> {
  const out: Record<string, unknown> = { ...s, savedAt: now };
  for (const k of TRANSIENT_KEYS) delete out[k];
  return out;
}

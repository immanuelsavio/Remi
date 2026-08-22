import { TRANSIENT_KEYS } from "./types";
import type { State } from "./types";

/**
 * The state with the tour's demo day PROJECTED BACK OUT.
 *
 * The tour puts a sample day on screen and holds the user's real one in
 * `demoRestore`. That demo used to be ordinary state: persisted, backed
 * up, exported, and synced to the popover - which is why every exit,
 * close, quit, crash, midnight and second-window path had to know the tour
 * existed, and why each fix to one of them opened a hole in another.
 *
 * The demo is a VIEW. This is the single boundary where that becomes true:
 * anything leaving this window for disk or for another window is the real
 * day, whatever is on screen here. The tour cannot write sample tasks over
 * someone's work because sample tasks never leave the window.
 *
 * Only the DAY is projected. Settings a person deliberately changes during
 * onboarding - the mascot, a wellness toggle - are theirs and persist
 * normally; they live outside the snapshot.
 */
export function realDay(s: State): State {
  const d = s.demoRestore;
  if (!d) return s;
  return {
    ...s,
    mains: d.mains,
    interruptions: d.interruptions,
    activeMainId: d.activeMainId,
    activeSubId: d.activeSubId,
    // `startedAt` comes back with the session it belongs to. The demo never
    // runs a real clock: `enterDemo` banks whatever was running into the
    // user's own task before the sample day goes up.
    startedAt: d.startedAt,
    phase: d.phase,
    awaitingStart: d.awaitingStart,
    dateISO: d.dateISO || s.dateISO,
    dayNum: d.dayNum || s.dayNum,
    demoRestore: null,
  };
}

/**
 * Strip transient UI fields so only durable product state is written, and
 * stamp `savedAt`.
 *
 * `savedAt` is what lets a session still running at quit be credited
 * honestly on the next launch: time is banked up to the LAST SAVE, not up
 * to "now", so a machine left off overnight cannot award hours nobody
 * worked.
 *
 * The demo is projected out FIRST - see `realDay`. Every persisted payload
 * in the app goes through here (the save, the automatic backup, a manual
 * export, the factory-reset seed), which is what makes "sample tasks never
 * reach disk" one rule rather than a guard in each of them.
 */
export function forPersist(s: State, now: number = Date.now()): Record<string, unknown> {
  const out: Record<string, unknown> = { ...realDay(s), savedAt: now };
  for (const k of TRANSIENT_KEYS) delete out[k];
  return out;
}

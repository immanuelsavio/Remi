/**
 * DAY-STATE - questions about where the day sits, asked of the archive.
 *
 * Pure, and `today` is always a parameter, like everything else in
 * `domain/`.
 *
 * The subtle bit these exist for: `endDay` builds TOMORROW's state (with
 * `dayNum + 1` and `awaitingStart: true`) while deliberately keeping
 * TODAY's `dateISO`, and `rolloverIfNewDay` later re-dates it exactly once.
 * That design is load-bearing for rollover idempotence - but it means
 * neither `dayNum` nor `dateISO` can answer "has today already been wrapped
 * up?", because both look the same the morning after as they do ten minutes
 * after pressing End Day.
 *
 * The archive can answer it, and it is the honest source: a day that was
 * ended has a record.
 */

import type { DayRecord, State } from "./types";

/** The most recently dated archived day, or null if nothing is archived. */
export function lastLoggedDay(s: State): DayRecord | null {
  let best: DayRecord | null = null;
  for (const h of s.history) {
    if (!h?.dateISO) continue;
    if (!best || h.dateISO > best.dateISO) best = h;
  }
  return best;
}

/**
 * Has `today` already been archived - i.e. did the user wrap up and come
 * back the same day?
 *
 * When true there is no new day to start, only the closed one to reopen.
 * Offering "Start my day" here means offering to skip to tomorrow while it
 * is still today, which silently strands everything that was just filed.
 *
 * Deliberately an equality test, not `>=`. A record dated in the FUTURE (a
 * clock change, or a restored backup from another machine) must not
 * permanently suppress starting a day; the question is "is today logged",
 * not "is anything newer than today".
 */
export function endedOn(s: State, today: string): boolean {
  return s.history.some((h) => h?.dateISO === today);
}

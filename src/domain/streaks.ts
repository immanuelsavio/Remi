/**
 * STREAKS
 *
 * Rules, exactly as specified:
 *   - a day counts when it has completed work
 *   - weekends, PTO and revived days BRIDGE a gap for free
 *   - the first real missed weekday ends the streak
 *   - dates before day 1 are never counted as misses (the floor)
 *
 * A REVIVE does not rewrite history. It banks the streak that broke as a
 * NUMBER (`reviveCredit`) and marks the day counting starts again from
 * (`reviveAnchor`). The missed days stay missed on the calendar - what you
 * get back is the count, added to whatever you build from the anchor on.
 * Filling the gap in instead would have the calendar claim you worked days
 * you did not, which is the one thing a record must never do.
 */

import { addDays, isWeekend } from "./dates";
import { completedToday } from "./tasks";
import type { State } from "./types";

/** How long after a streak breaks a revive can still reach back for it. */
export const REVIVE_WINDOW_DAYS = 7;
/**
 * A new streak this many days long closes the window for good.
 *
 * One day is a start, not a streak - reviving there stitches the old count
 * onto something you have barely begun and costs nothing. Two days in, the
 * new streak is its own thing and the old one is genuinely over.
 */
export const NEW_STREAK_LOCKOUT = 2;

export function activeDaySet(s: State): Set<string> {
  const set = new Set<string>();
  s.history.forEach((h) => {
    if (h.dateISO && h.completed?.length) set.add(h.dateISO);
  });
  if (completedToday(s).length) set.add(s.dateISO);
  return set;
}

/** The earliest date the streak walk may consider (day 1's date). */
export function floorISO(s: State): string {
  return (s.history.length ? s.history[0].dateISO : s.dateISO) || s.dateISO;
}

function bridges(s: State, iso: string): boolean {
  return isWeekend(iso) || s.pto.includes(iso) || s.revived.includes(iso);
}

/** The banked half of a spent revive, or nothing if none is in play. */
function reviveBank(s: State): { anchor: string; credit: number } | null {
  const anchor = s.reviveAnchor || "";
  const credit = Math.max(0, Math.floor(s.reviveCredit || 0));
  return anchor && credit > 0 ? { anchor, credit } : null;
}

export function streakEndingAt(s: State, startISO: string, active: Set<string>): number {
  const floor = floorISO(s);
  const bank = reviveBank(s);
  let iso = startISO;
  let len = 0;
  for (let guard = 0; guard < 3650; guard++) {
    if (iso < floor) break;
    if (active.has(iso)) len++;
    else if (bridges(s, iso)) {
      /* free bridge */
    } else break;
    // The anchor is where the revived count was stitched on. Everything
    // before it is already inside `credit`, so stop rather than walk into
    // the gap the revive deliberately left un-filled.
    if (bank && iso === bank.anchor) return len + bank.credit;
    iso = addDays(iso, -1);
  }
  return len;
}

/** The most recent genuinely-missed weekday a revive heart could bridge. */
export function firstBrokenDayISO(s: State): string | null {
  const floor = floorISO(s);
  const active = activeDaySet(s);
  // Start from YESTERDAY: today isn't over, so an unworked today is not yet
  // a missed day and a revive heart must not be spendable on it.
  let iso = addDays(s.dateISO, -1);
  for (let guard = 0; guard < 3650; guard++) {
    if (iso < floor) return null;
    if (!active.has(iso) && !bridges(s, iso)) return iso;
    iso = addDays(iso, -1);
  }
  return null;
}

/**
 * What spending the revive right now would actually buy.
 *
 * `null` when there is nothing to rescue: no break, the break is older than
 * the window, a new streak has already taken hold, or the streak that broke
 * was empty to begin with.
 */
export interface ReviveOffer {
  /** The missed day that ended the old streak. */
  brokenISO: string;
  /** Where the revived count gets stitched on and counting resumes. */
  anchorISO: string;
  /** Days the old streak had reached - what you get back. */
  credit: number;
  /** Days already worked since the break, folded in from the anchor on. */
  sinceBreak: number;
}

export function reviveOffer(s: State): ReviveOffer | null {
  const brokenISO = firstBrokenDayISO(s);
  if (!brokenISO) return null;
  // Older than the window: the streak is gone, and pretending otherwise a
  // fortnight later makes the number meaningless.
  if (brokenISO < addDays(s.dateISO, -REVIVE_WINDOW_DAYS)) return null;

  const active = activeDaySet(s);
  // Days worked between the break and now. The first of them is the anchor;
  // with none, counting restarts today.
  const worked: string[] = [];
  for (let iso = addDays(brokenISO, 1); iso <= s.dateISO; iso = addDays(iso, 1)) {
    if (active.has(iso)) worked.push(iso);
  }
  if (worked.length >= NEW_STREAK_LOCKOUT) return null;

  const credit = streakEndingAt(s, addDays(brokenISO, -1), active);
  if (credit < 1) return null;

  return {
    brokenISO,
    anchorISO: worked[0] ?? s.dateISO,
    credit,
    sinceBreak: worked.length,
  };
}

export interface Streaks {
  current: number;
  longest: number;
  life: number;
  broken: string | null;
  activeCount: number;
  /** What a revive would buy right now, or `null` if it would buy nothing. */
  offer: ReviveOffer | null;
}

export function computeStreaks(s: State): Streaks {
  const active = activeDaySet(s);
  const start = active.has(s.dateISO) || bridges(s, s.dateISO) ? s.dateISO : addDays(s.dateISO, -1);
  const current = streakEndingAt(s, start, active);
  let longest = current;
  active.forEach((iso) => {
    longest = Math.max(longest, streakEndingAt(s, iso, active));
  });
  return {
    current,
    longest,
    life: Math.max(0, Math.min(1, s.life || 0)),
    broken: firstBrokenDayISO(s),
    activeCount: active.size,
    offer: reviveOffer(s),
  };
}

/** PTO may only be set for today or the future - never to erase a past miss. */
export function canMarkPto(iso: string, todayIso: string): boolean {
  return iso >= todayIso;
}

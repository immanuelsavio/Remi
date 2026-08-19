/**
 * STREAKS
 *
 * Rules, exactly as specified:
 *   - a day counts when it has completed work
 *   - weekends, PTO and revived days BRIDGE a gap for free
 *   - the first real missed weekday ends the streak
 *   - dates before day 1 are never counted as misses (the floor)
 */

import { addDays, isWeekend } from "./dates";
import { completedToday } from "./tasks";
import type { State } from "./types";

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

export function streakEndingAt(s: State, startISO: string, active: Set<string>): number {
  const floor = floorISO(s);
  let iso = startISO;
  let len = 0;
  for (let guard = 0; guard < 3650; guard++) {
    if (iso < floor) break;
    if (active.has(iso)) len++;
    else if (bridges(s, iso)) {
      /* free bridge */
    } else break;
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
    if (active.has(iso) && iso !== s.dateISO) break;
    iso = addDays(iso, -1);
  }
  return null;
}

export interface Streaks {
  current: number;
  longest: number;
  life: number;
  broken: string | null;
  activeCount: number;
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
  };
}

/** PTO may only be set for today or the future - never to erase a past miss. */
export function canMarkPto(iso: string, todayIso: string): boolean {
  return iso >= todayIso;
}

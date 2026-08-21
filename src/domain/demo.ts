/**
 * DEMO - the sample day the tour runs on.
 *
 * The tour used to describe an empty app, which is the worst possible time
 * to explain a task tracker: every screen it points at is a blank slate.
 * This gives it a real day to point at, so "here is where a step lives" has
 * an actual step underneath it.
 *
 * Two properties matter, and both come from this being FIXED DATA rather
 * than generated:
 *
 *   1. Everyone sees the same tour. Randomised ids or timestamps would mean
 *      no two runs matched, and a screenshot in a support thread would not
 *      match what the person reporting it saw.
 *   2. Retaking the tour shows exactly what it showed the first time.
 *
 * Ids are literal and prefixed `demo-` rather than produced by `nid()`, so
 * they are stable across runs AND obvious in a state file if one ever
 * escapes. Times are relative to a `now` passed in, because a hard-coded
 * epoch would show "started 4 years ago" and the elapsed numbers are part
 * of what the tour is explaining.
 */

import { mkMain } from "./defaults";
import type { InterruptionEvent, Main, Sub } from "./types";

const MIN = 60_000;

function sub(id: string, title: string, accrued: number, done: boolean): Sub {
  return { id, title, accrued, done, remind: null, note: "" };
}

/** The tasks the tour walks through. */
export function demoMains(now: number): Main[] {
  // Built on top of `mkMain` so a new required field on `Main` cannot leave
  // the demo half-shaped; only the ids are overridden, to stay stable.
  const a: Main = {
    ...mkMain("Draft the quarterly update", [
      sub("demo-1a", "Pull the numbers", 22 * MIN, true),
      sub("demo-1b", "Write the summary", 14 * MIN, false),
      sub("demo-1c", "Send it round for comments", 0, false),
    ]),
    id: "demo-1",
    accrued: 36 * MIN,
    carries: 2,
    estMs: 90 * MIN,
    note: "Ask Priya for last quarter's figures before writing the summary.",
    tags: ["reporting", "acme"],
    firstStartedAt: now - 140 * MIN,
    interruptedCount: 2,
    interruptedMs: 24 * MIN,
  };
  const b: Main = {
    ...mkMain("Fix the login redirect bug"),
    id: "demo-2",
    accrued: 52 * MIN,
    done: true,
    estMs: 45 * MIN,
    tags: ["coding"],
    firstStartedAt: now - 200 * MIN,
    completedAt: now - 90 * MIN,
    interruptedCount: 1,
    interruptedMs: 25 * MIN,
  };
  const c: Main = {
    ...mkMain("Book the team offsite"),
    id: "demo-3",
    // Three carries is the threshold the avoidance nudge fires at, so the
    // tour can point at a real one instead of describing it.
    carries: 3,
  };
  return [a, b, c];
}

/** Interruption evidence, so the Stats step has something to show. */
export function demoInterruptions(now: number, dateISO: string): InterruptionEvent[] {
  const ev = (
    id: string,
    causeTitle: string,
    interruptedId: string,
    interruptedTitle: string,
    agoMin: number,
    durMin: number,
    via: InterruptionEvent["via"],
  ): InterruptionEvent => ({
    id,
    dateISO,
    interruptedId,
    interruptedTitle,
    causeTitle,
    atMs: now - agoMin * MIN,
    durationMs: durMin * MIN,
    open: false,
    via,
  });
  return [
    ev(
      "demo-i1",
      "Slack thread about pricing",
      "demo-1",
      "Draft the quarterly update",
      120,
      18,
      "interrupt",
    ),
    ev("demo-i2", "Unplanned standup", "demo-2", "Fix the login redirect bug", 75, 25, "interrupt"),
    ev("demo-i3", "Someone at the door", "demo-1", "Draft the quarterly update", 40, 6, "checkin"),
  ];
}

/** Everything the tour needs, in one call. */
export function demoDay(now: number, dateISO: string) {
  return { mains: demoMains(now), interruptions: demoInterruptions(now, dateISO) };
}

/** True if a task id belongs to the demo. Used to prove cleanup worked. */
export function isDemoId(id: string): boolean {
  return typeof id === "string" && id.startsWith("demo-");
}

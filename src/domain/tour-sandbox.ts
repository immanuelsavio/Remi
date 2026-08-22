/**
 * THE TOUR SANDBOX - practice as an event log, replayed.
 *
 * Two problems this exists for, and they are the same problem twice.
 *
 * The tour used to REPLACE the user's task list with demo tasks and park
 * the real day in `demoRestore`. Practice then happened in the production
 * store: the practice task was a real task, its step was a real step, and
 * every exit, close, quit, midnight, backup and second window had to know
 * that the app's own state was temporarily fictional.
 *
 * And Back was implemented per page: "on Build One, delete these; on the
 * clock page, stop that; on End Day, unset this flag". Page-specific
 * cleanup does not compose - the permutation tests found `work → next ×4 →
 * back` landing on an End Day beat that was still done, because the clock
 * page's cleanup knew nothing about the End Day page's flag. Every new
 * beat would need a new clause, and the clause it forgot would be a bug
 * nobody found until someone pressed the buttons in a new order.
 *
 * So: practice is a LOG of what the user did, and the sandbox is that log
 * REPLAYED. Back truncates the log to the destination beat and replays
 * what is left. There is nothing to clean up, and no page knows anything
 * about another page - which is what makes "returning to a beat gives a
 * clean beat" true by construction rather than by vigilance.
 *
 * Everything here is pure and deterministic: same events, same sandbox.
 * Ids are fixed rather than generated, so a replay produces the identical
 * object graph every time.
 */

import { mkMain } from "./defaults";
import { demoMains, demoInterruptions } from "./demo";
import type { InterruptionEvent, Main } from "./types";

/** The practice task's id. Fixed, so replay is deterministic. */
export const PRACTICE_ID = "tour-practice";

/** Where an event happened, which is also the order events are kept in. */
export interface BeatAddress {
  step: number;
  beat: number;
}

/**
 * Something the user did during practice.
 *
 * Deliberately a description of the ACT, not of the resulting state: "they
 * added a tag", not "tags are now [x]". Replaying acts is what makes
 * truncation meaningful.
 */
export type TourEvent = BeatAddress &
  (
    | { kind: "task"; title: string }
    | { kind: "step"; title: string }
    | { kind: "tag"; tag: string }
    | { kind: "clock"; startedAt: number }
    | { kind: "endday" }
    | { kind: "search" }
  );

/** The whole practice world. Nothing here is ever persisted. */
export interface Sandbox {
  /** The demo day, plus the practice task once it has been made. */
  mains: Main[];
  interruptions: InterruptionEvent[];
  /** The practice task's id, or null before it exists. */
  practiceId: string | null;
  /** The TOUR clock - never the production session. */
  clockTaskId: string | null;
  clockStartedAt: number;
  /** The End Day rehearsal was confirmed. No real day ended. */
  endDayDone: boolean;
  /** A search was run during this run of the tour. */
  searched: boolean;
}

/** Is this id something the tour made up? */
export function isSandboxId(id: string): boolean {
  return typeof id === "string" && (id.startsWith("demo-") || id.startsWith("tour-"));
}

/** The world before anybody has practised anything. */
export function baseSandbox(now: number, dateISO: string): Sandbox {
  return {
    mains: demoMains(now),
    interruptions: demoInterruptions(now, dateISO),
    practiceId: null,
    clockTaskId: null,
    clockStartedAt: 0,
    endDayDone: false,
    searched: false,
  };
}

/** Order events by where they happened, so truncation has a meaning. */
export function beforeBeat(e: BeatAddress, at: BeatAddress): boolean {
  return e.step < at.step || (e.step === at.step && e.beat < at.beat);
}

/**
 * Keep only what happened before `at` - the whole of Back.
 *
 * Everything from the destination beat onwards is dropped, including every
 * later page, which is why no page needs to know how to undo another's
 * work.
 */
export function truncate(events: TourEvent[], at: BeatAddress): TourEvent[] {
  return events.filter((e) => beforeBeat(e, at));
}

/**
 * Rebuild the sandbox from nothing by replaying the log.
 *
 * `now`/`dateISO` are passed in rather than read, so this is a pure
 * function of its arguments and a test can replay the same log at the same
 * instant twice and get the same thing.
 */
export function replay(events: TourEvent[], now: number, dateISO: string): Sandbox {
  const sb = baseSandbox(now, dateISO);
  let stepSeq = 0;

  for (const e of events) {
    switch (e.kind) {
      case "task": {
        // One practice task per run. A second "task" event replaces the
        // title rather than adding a task - the log is the user's intent,
        // and they only ever meant to have one.
        const existing = sb.mains.find((m) => m.id === PRACTICE_ID);
        if (existing) {
          existing.title = e.title;
        } else {
          // Built from `mkMain` so a new required field on `Main` cannot
          // leave the practice task half-shaped; only the id is overridden,
          // to keep replay deterministic.
          sb.mains = [...sb.mains, { ...mkMain(e.title), id: PRACTICE_ID }];
        }
        sb.practiceId = PRACTICE_ID;
        break;
      }
      case "step": {
        const m = sb.mains.find((x) => x.id === sb.practiceId);
        if (!m) break; // a step with no task cannot have happened
        m.subs = [
          ...m.subs,
          {
            id: `tour-step-${++stepSeq}`,
            title: e.title,
            accrued: 0,
            done: false,
            remind: null,
            note: "",
          },
        ];
        break;
      }
      case "tag": {
        const m = sb.mains.find((x) => x.id === sb.practiceId);
        if (!m) break;
        if (!m.tags.includes(e.tag)) m.tags = [...m.tags, e.tag];
        break;
      }
      case "clock":
        if (!sb.practiceId) break; // nothing to put on the clock
        sb.clockTaskId = sb.practiceId;
        sb.clockStartedAt = e.startedAt;
        break;
      case "endday":
        sb.endDayDone = true;
        break;
      case "search":
        sb.searched = true;
        break;
    }
  }
  return sb;
}

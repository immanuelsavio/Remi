import { describe, expect, it } from "vitest";

import {
  PRACTICE_ID,
  baseSandbox,
  isSandboxId,
  replay,
  truncate,
  type TourEvent,
} from "./tour-sandbox";

const NOW = 1_700_000_000_000;
const DATE = "2026-08-22";

/** The Build One checklist, then the clock, then the End Day rehearsal. */
const LOG: TourEvent[] = [
  { step: 6, beat: 0, kind: "task", title: "Prepare customer notes" },
  { step: 6, beat: 1, kind: "step", title: "First step" },
  { step: 6, beat: 2, kind: "tag", tag: "example" },
  { step: 7, beat: 0, kind: "clock", startedAt: NOW },
  { step: 9, beat: 0, kind: "endday" },
];

const practice = (log: TourEvent[]) =>
  replay(log, NOW, DATE).mains.find((m) => m.id === PRACTICE_ID) ?? null;

describe("the tour sandbox", () => {
  it("starts as the demo day with nothing practised", () => {
    const sb = baseSandbox(NOW, DATE);
    expect(sb.mains.length).toBeGreaterThan(0);
    expect(sb.mains.every((m) => m.id.startsWith("demo-"))).toBe(true);
    expect(sb.practiceId).toBeNull();
    expect(sb.clockStartedAt).toBe(0);
    expect(sb.endDayDone).toBe(false);
  });

  it("replays the whole checklist into one task with one step and one tag", () => {
    const sb = replay(LOG, NOW, DATE);
    const m = practice(LOG)!;
    expect(m.title).toBe("Prepare customer notes");
    expect(m.subs).toHaveLength(1);
    expect(m.tags).toEqual(["example"]);
    expect(sb.clockTaskId).toBe(PRACTICE_ID);
    expect(sb.endDayDone).toBe(true);
  });

  it("is DETERMINISTIC - the same log replays to the same thing", () => {
    expect(replay(LOG, NOW, DATE)).toEqual(replay(LOG, NOW, DATE));
  });

  it("truncating to a beat drops that beat and everything after it", () => {
    // Back onto the tag beat: the tag goes, and so does the clock and the
    // End Day rehearsal that happened later - without either page knowing
    // the other exists.
    const sb = replay(truncate(LOG, { step: 6, beat: 2 }), NOW, DATE);
    const m = sb.mains.find((x) => x.id === PRACTICE_ID)!;
    expect(m.tags, "the tag survived Back").toHaveLength(0);
    expect(m.subs, "the step should still be there").toHaveLength(1);
    expect(sb.clockStartedAt, "a later page's clock survived Back").toBe(0);
    expect(sb.endDayDone, "a later page's rehearsal survived Back").toBe(false);
  });

  it("truncating to the step beat removes the step and the tag", () => {
    const sb = replay(truncate(LOG, { step: 6, beat: 1 }), NOW, DATE);
    const m = sb.mains.find((x) => x.id === PRACTICE_ID)!;
    expect(m.subs).toHaveLength(0);
    expect(m.tags).toHaveLength(0);
    expect(m.title, "the task itself should survive").toBe("Prepare customer notes");
  });

  it("truncating to the task beat removes the practice task entirely", () => {
    const sb = replay(truncate(LOG, { step: 6, beat: 0 }), NOW, DATE);
    expect(sb.practiceId).toBeNull();
    expect(sb.mains.some((m) => m.id === PRACTICE_ID)).toBe(false);
  });

  it("truncating to a LATER page keeps everything before it", () => {
    const sb = replay(truncate(LOG, { step: 9, beat: 0 }), NOW, DATE);
    expect(sb.endDayDone).toBe(false);
    expect(sb.clockStartedAt, "an earlier page's clock was dropped").toBe(NOW);
  });

  it("never builds a second task, however many task events arrive", () => {
    // Pressing Next repeatedly on the first beat is one intent, not five.
    const many: TourEvent[] = [
      { step: 6, beat: 0, kind: "task", title: "One" },
      { step: 6, beat: 0, kind: "task", title: "Two" },
      { step: 6, beat: 0, kind: "task", title: "Three" },
    ];
    const sb = replay(many, NOW, DATE);
    expect(sb.mains.filter((m) => m.id === PRACTICE_ID)).toHaveLength(1);
    expect(sb.mains.find((m) => m.id === PRACTICE_ID)!.title).toBe("Three");
  });

  it("never duplicates a tag", () => {
    const sb = replay(
      [
        { step: 6, beat: 0, kind: "task", title: "T" },
        { step: 6, beat: 2, kind: "tag", tag: "example" },
        { step: 6, beat: 2, kind: "tag", tag: "example" },
      ],
      NOW,
      DATE,
    );
    expect(sb.mains.find((m) => m.id === PRACTICE_ID)!.tags).toEqual(["example"]);
  });

  it("ignores work that cannot have happened", () => {
    // A step or a tag with no task, a clock with nothing to run: replaying
    // a truncated log must never invent the thing they refer to.
    const sb = replay(
      [
        { step: 6, beat: 1, kind: "step", title: "orphan" },
        { step: 6, beat: 2, kind: "tag", tag: "orphan" },
        { step: 7, beat: 0, kind: "clock", startedAt: NOW },
      ],
      NOW,
      DATE,
    );
    expect(sb.practiceId).toBeNull();
    expect(sb.clockTaskId).toBeNull();
    expect(sb.mains.every((m) => m.id.startsWith("demo-"))).toBe(true);
  });

  it("knows its own ids, so leakage can be asserted on", () => {
    expect(isSandboxId(PRACTICE_ID)).toBe(true);
    expect(isSandboxId("demo-1")).toBe(true);
    expect(isSandboxId("real-task-id")).toBe(false);
  });
});

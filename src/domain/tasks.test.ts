import { describe, expect, it } from "vitest";

import { freshDay, mkMain, mkSub } from "./defaults";
import { makeRemind } from "./reminders";
import {
  carrySnapshot,
  completedToday,
  daySnapshot,
  elapsedOf,
  enrichSnapshot,
  isTiming,
  mainTotal,
  todayAsRecord,
  todayTrackedMs,
  unfinishedToday,
} from "./tasks";
import type { State } from "./types";

const T0 = new Date(2026, 7, 12, 10, 0, 0).getTime(); // Wed 12 Aug 2026, 10:00

describe("roll-ups", () => {
  function dayWith(): State {
    const s = freshDay();
    const a = mkMain("Alpha");
    a.accrued = 600_000; // 10m
    a.subs = [mkSub("step one"), mkSub("step two")];
    a.subs[0].accrued = 60_000;
    a.subs[0].done = true;
    const b = mkMain("Beta");
    b.accrued = 300_000;
    b.done = true;
    s.mains = [a, b];
    return s;
  }

  it("rolls a task's total up from its steps", () => {
    const s = dayWith();
    expect(mainTotal(s.mains[0], s, T0)).toBe(660_000);
  });

  it("includes the LIVE session in the active task's total only", () => {
    const s = dayWith();
    s.activeMainId = s.mains[0].id;
    s.startedAt = T0 - 30_000;
    expect(mainTotal(s.mains[0], s, T0)).toBe(690_000);
    expect(mainTotal(s.mains[1], s, T0)).toBe(300_000); // untouched
    expect(todayTrackedMs(s, T0)).toBe(660_000 + 300_000 + 30_000);
  });

  it("computes one item's elapsed time with and without a live session", () => {
    const sub = mkSub("x");
    sub.accrued = 1000;
    expect(elapsedOf(sub, false, 0, T0)).toBe(1000);
    expect(elapsedOf(sub, true, T0 - 500, T0)).toBe(1500);
    expect(elapsedOf(null, true, T0 - 500, T0)).toBe(0);
  });

  it("separates completed tasks and steps from unfinished work", () => {
    const s = dayWith();
    const done = completedToday(s);
    expect(done).toEqual([
      { title: "step one", kind: "step", ms: 60_000 },
      { title: "Beta", kind: "task", ms: 300_000 },
    ]);
    const open = unfinishedToday(s);
    expect(open).toHaveLength(1);
    expect(open[0].title).toBe("Alpha");
    // Only the OPEN step carries forward.
    expect(open[0].subs.map((x) => x.title)).toEqual(["step two"]);
  });

  it("snapshots the day for the archive", () => {
    const s = dayWith();
    const snap = daySnapshot(s, T0);
    expect(snap.day).toBe(s.dayNum);
    expect(snap.dateISO).toBe(s.dateISO);
    expect(snap.totalMs).toBe(960_000);
  });

  it("enriches the snapshot with the interruption evidence", () => {
    const s = dayWith();
    s.mains[1].firstStartedAt = T0 - 3_600_000;
    s.mains[1].completedAt = T0;
    s.mains[1].interruptedCount = 2;
    s.mains[1].interruptedMs = 600_000;
    s.mains[1].estMs = 300_000;
    const snap = enrichSnapshot(s, daySnapshot(s, T0));
    const beta = snap.completed.find((c) => c.title === "Beta")!;
    // 5m focused, but an hour of wall clock: that gap IS the product's subject.
    expect(beta.elapsedMs).toBe(3_600_000);
    expect(beta.interruptedCount).toBe(2);
    expect(beta.estMs).toBe(300_000);
    // Steps never carry a span.
    expect(snap.completed.find((c) => c.kind === "step")!.elapsedMs).toBeUndefined();
  });

  it("carries an unfinished task WITH its notes, reminder and estimate", () => {
    const m = mkMain("Carry me");
    m.note = "remember the context";
    m.estMs = 900_000;
    m.carries = 2;
    m.remind = makeRemind("in", 30, T0);
    m.subs = [mkSub("open step"), mkSub("finished step")];
    m.subs[0].note = "step note";
    m.subs[1].done = true;

    const snap = carrySnapshot(m);
    expect(snap.carries).toBe(3); // incremented, driving the avoidance nudge
    expect(snap.note).toBe("remember the context");
    expect(snap.estMs).toBe(900_000);
    expect(snap.remind?.kind).toBe("in");
    // Only the open step carries, and it keeps its note.
    expect(snap.subs).toEqual([{ title: "open step", note: "step note", remind: null }]);
  });

  it("shapes today as a record so stats can reuse the same code", () => {
    const s = dayWith();
    const rec = todayAsRecord(s, T0);
    expect(rec.totalMs).toBe(960_000);
    expect(rec.interruptions).toEqual([]);
  });
});

describe("isTiming", () => {
  it("is true only when a task is assigned AND the clock has a start", () => {
    const s = freshDay();
    s.activeMainId = "a";
    s.startedAt = T0;
    expect(isTiming(s)).toBe(true);
  });

  it("is FALSE during a break, which parks the task but stops the clock", () => {
    // `startBreak` deliberately keeps `activeMainId` so the same work can be
    // resumed, and sets `startedAt = 0`. Anything that asks "is something
    // running?" by looking at `activeMainId` alone gets this backwards - and
    // that is exactly the bug this exists to prevent: every task in the list
    // offering "Switch" (which files an interruption) while nothing at all
    // was on the clock.
    const s = freshDay();
    s.activeMainId = "a";
    s.startedAt = 0;
    s.breakEndsAt = T0 + 600_000;
    expect(isTiming(s)).toBe(false);
  });

  it("is false with no task assigned", () => {
    const s = freshDay();
    s.startedAt = T0;
    expect(isTiming(s)).toBe(false);
  });

  it("is false on a fresh day", () => {
    expect(isTiming(freshDay())).toBe(false);
  });
});

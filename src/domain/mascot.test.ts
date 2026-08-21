import { describe, it, expect } from "vitest";

import { mascotMood } from "./mascot";
import { freshDay } from "./defaults";
import type { Main, State } from "./types";

const NOW = 1_700_000_000_000;

function mkMain(title: string, done: boolean): Main {
  return {
    ...(freshDay().mains[0] ?? {}),
    id: title,
    title,
    done,
    accrued: 0,
    subs: [],
    carries: 0,
    estMs: 0,
    remind: null,
    note: "",
    tags: [],
    firstStartedAt: 0,
    completedAt: 0,
    deferred: false,
  } as Main;
}

function base(patch: Partial<State> = {}): State {
  return { ...freshDay(), ...patch };
}

describe("mascotMood", () => {
  it("runs while a task is on the clock", () => {
    const s = base({ activeMainId: "a", startedAt: NOW - 60_000 });
    expect(mascotMood(s, NOW)).toBe("run");
  });

  it("sleeps during a break, even though a task is still assigned", () => {
    // A break parks the task rather than clearing it, so "a task is set"
    // must not outrank "the clock is paused" - the whole point of the pose
    // is that it agrees with whether time is accruing.
    const s = base({
      activeMainId: "a",
      startedAt: NOW - 60_000,
      breakEndsAt: NOW + 5 * 60_000,
    });
    expect(mascotMood(s, NOW)).toBe("sleep");
  });

  it("stops sleeping once the break has elapsed", () => {
    const s = base({ breakEndsAt: NOW - 1 });
    expect(mascotMood(s, NOW)).toBe("idle");
  });

  it("cheers when every task on the list is finished", () => {
    const s = base({ mains: [mkMain("a", true), mkMain("b", true)] });
    expect(mascotMood(s, NOW)).toBe("cheer");
  });

  it("does NOT cheer for an empty list", () => {
    // An empty day is not an achievement. A mascot that celebrates nothing
    // is a mascot nobody believes.
    expect(mascotMood(base({ mains: [] }), NOW)).toBe("idle");
  });

  it("does not cheer while one task is still open", () => {
    const s = base({ mains: [mkMain("a", true), mkMain("b", false)] });
    expect(mascotMood(s, NOW)).toBe("idle");
  });

  it("prefers running over cheering when the list is done but work resumed", () => {
    // Reviving a finished task and starting it again means time is
    // accruing; the clock always wins over the celebration.
    const s = base({
      mains: [mkMain("a", true)],
      activeMainId: "a",
      startedAt: NOW - 1000,
    });
    expect(mascotMood(s, NOW)).toBe("run");
  });

  it("is idle on a fresh day with nothing happening", () => {
    expect(mascotMood(freshDay(), NOW)).toBe("idle");
  });

  it("does not run for a task id with no start time", () => {
    // `activeMainId` set with `startedAt` of 0 is a banked/parked session,
    // not a running one.
    const s = base({ activeMainId: "a", startedAt: 0 });
    expect(mascotMood(s, NOW)).toBe("idle");
  });
});

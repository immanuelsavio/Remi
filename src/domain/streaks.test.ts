import { describe, expect, it } from "vitest";

import { freshDay } from "./defaults";
import { isWeekend } from "./dates";
import { canMarkPto, computeStreaks, firstBrokenDayISO } from "./streaks";
import type { DayRecord, State } from "./types";

describe("streaks", () => {
  /** Build a state whose history has completed work on each given date. */
  function withDays(dates: string[], today: string): State {
    const s = freshDay();
    s.dateISO = today;
    s.history = dates.map((dateISO, i): DayRecord => ({
      day: i + 1,
      dateISO,
      completed: [{ title: "t", kind: "task", ms: 1000 }],
      unfinished: [],
      totalMs: 1000,
    }));
    return s;
  }

  it("knows weekends", () => {
    expect(isWeekend("2026-08-15")).toBe(true); // Saturday
    expect(isWeekend("2026-08-16")).toBe(true); // Sunday
    expect(isWeekend("2026-08-17")).toBe(false); // Monday
  });

  it("counts consecutive worked days", () => {
    // Mon-Wed worked, today is Wednesday.
    const s = withDays(["2026-08-10", "2026-08-11", "2026-08-12"], "2026-08-12");
    expect(computeStreaks(s).current).toBe(3);
  });

  it("bridges a WEEKEND for free", () => {
    // Fri worked, Sat+Sun off, Mon worked -> a 3-day streak, not two 1-day ones.
    const s = withDays(["2026-08-14", "2026-08-17"], "2026-08-17");
    expect(computeStreaks(s).current).toBe(2);
    expect(computeStreaks(s).broken).toBeNull();
  });

  it("breaks on a genuinely missed WEEKDAY", () => {
    // Mon worked, Tue missed, Wed worked -> only Wed counts.
    const s = withDays(["2026-08-10", "2026-08-12"], "2026-08-12");
    expect(computeStreaks(s).current).toBe(1);
    expect(firstBrokenDayISO(s)).toBe("2026-08-11");
  });

  it("bridges a PTO day", () => {
    const s = withDays(["2026-08-10", "2026-08-12"], "2026-08-12");
    s.pto = ["2026-08-11"];
    expect(computeStreaks(s).current).toBe(2);
    expect(computeStreaks(s).broken).toBeNull();
  });

  it("bridges a REVIVED day", () => {
    const s = withDays(["2026-08-10", "2026-08-12"], "2026-08-12");
    s.revived = ["2026-08-11"];
    expect(computeStreaks(s).current).toBe(2);
  });

  it("never counts dates before day 1 as misses", () => {
    const s = withDays(["2026-08-12"], "2026-08-12");
    // The walk stops at the floor rather than marching back through all history.
    expect(computeStreaks(s).current).toBe(1);
    expect(firstBrokenDayISO(s)).toBeNull();
  });

  it("does not treat an unworked TODAY as a missed day", () => {
    // Today isn't over; a revive heart must not be spendable on it.
    const s = withDays(["2026-08-11"], "2026-08-12");
    expect(firstBrokenDayISO(s)).toBeNull();
    expect(computeStreaks(s).current).toBe(1);
  });

  it("reports the longest streak alongside the current one", () => {
    const s = withDays(
      ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-12"],
      "2026-08-12",
    );
    const st = computeStreaks(s);
    expect(st.current).toBe(1);
    expect(st.longest).toBe(5);
  });

  it("allows PTO only for today or the future", () => {
    expect(canMarkPto("2026-08-12", "2026-08-12")).toBe(true);
    expect(canMarkPto("2026-08-13", "2026-08-12")).toBe(true);
    // Never retroactively, which would erase a real miss.
    expect(canMarkPto("2026-08-11", "2026-08-12")).toBe(false);
  });
});

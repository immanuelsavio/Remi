import { describe, expect, it } from "vitest";

import { freshDay, mkMain, mkSub } from "./defaults";
import { dueReminders, makeRemind } from "./reminders";

const T0 = new Date(2026, 7, 12, 10, 0, 0).getTime(); // Wed 12 Aug 2026, 10:00

describe("reminders", () => {
  it("builds a relative reminder", () => {
    const r = makeRemind("in", 90, T0)!;
    expect(r.at).toBe(T0 + 90 * 60_000);
    expect(r.short).toBe("in 1h 30m");
  });

  it("builds a clock-time reminder for later today", () => {
    const r = makeRemind("by", "14:30", T0)!; // now is 10:00
    expect(new Date(r.at).getHours()).toBe(14);
    expect(r.short).toBe("by 2:30pm");
    expect(r.label).not.toContain("tomorrow");
  });

  it("ROLLS a past clock time to tomorrow", () => {
    const r = makeRemind("by", "09:00", T0)!; // 9am already passed
    expect(r.at).toBeGreaterThan(T0);
    expect(r.label).toContain("tomorrow");
    expect(new Date(r.at).getDate()).toBe(13);
  });

  it("rejects nonsense times and clears on demand", () => {
    expect(makeRemind("by", "99:99", T0)).toBeNull();
    expect(makeRemind("by", "abc", T0)).toBeNull();
    expect(makeRemind("on", "not-a-date", T0)).toBeNull();
    expect(makeRemind("clear", "", T0)).toBeNull();
  });

  it("finds only reminders that are due AND undelivered", () => {
    const s = freshDay();
    const m = mkMain("has one");
    m.remind = makeRemind("in", 1, T0 - 120_000); // due a minute ago
    const already = mkMain("delivered");
    already.remind = { ...makeRemind("in", 1, T0 - 120_000)!, delivered: true };
    const future = mkMain("later");
    future.remind = makeRemind("in", 60, T0);
    s.mains = [m, already, future];
    s.backlog = [{ id: "b1", title: "backlog item", remind: makeRemind("in", 1, T0 - 120_000) }];

    const due = dueReminders(s, T0);
    expect(due.map((d) => d.title).sort()).toEqual(["backlog item", "has one"]);
    expect(due.find((d) => d.title === "has one")!.where).toBe(`main|${m.id}`);
  });

  it("locates a step's reminder so it can be marked delivered", () => {
    const s = freshDay();
    const m = mkMain("parent", [mkSub("child")]);
    m.subs[0].remind = makeRemind("in", 1, T0 - 120_000);
    s.mains = [m];
    expect(dueReminders(s, T0)[0].where).toBe(`sub|${m.id}~${m.subs[0].id}`);
  });
});

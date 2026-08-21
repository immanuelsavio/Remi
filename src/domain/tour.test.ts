import { describe, expect, it } from "vitest";

import { stepAt, TOUR_LENGTH, TOUR_STEPS } from "./tour";

describe("the guided tour script", () => {
  it("covers the features someone has to be shown", () => {
    // A tour that silently loses a step is the kind of regression nobody
    // notices until a new user is confused, so the shape is pinned here.
    const ids = TOUR_STEPS.map((s) => s.id);
    for (const required of [
      "plan-task",
      "plan-steps",
      "plan-tags",
      "today-start",
      "interrupt",
      "endday",
      "calendar",
      "report",
      "settings",
    ]) {
      expect(ids).toContain(required);
    }
  });

  it("has no duplicate ids", () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_LENGTH);
  });

  it("gives every step something to say", () => {
    for (const s of TOUR_STEPS) {
      expect(s.title.trim().length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(0);
      expect(s.body.every((p) => p.trim().length > 0)).toBe(true);
    }
  });

  it("only points at tabs that exist", () => {
    const tabs = ["plan", "today", "calendar", "stats", "data", "notes", "settings"];
    for (const s of TOUR_STEPS) {
      if (s.tab) expect(tabs).toContain(s.tab);
    }
  });

  it("ends on Settings, where the tour can be restarted", () => {
    expect(TOUR_STEPS[TOUR_LENGTH - 1].id).toBe("settings");
  });

  it("asks for a name and for the on/off preferences", () => {
    // These are the steps that WRITE something. If either disappears, a
    // first run silently stops asking and the settings are never seen.
    const asks = TOUR_STEPS.filter((s) => s.ask).map((s) => s.ask);
    expect(asks).toContain("name");
    expect(asks).toContain("prefs");
  });

  it("asks for the name early, before the walkthrough proper", () => {
    // The name is used in the copy the rest of the tour shows, so asking
    // late means the tour addresses you by name only after it stops
    // talking to you.
    const nameAt = TOUR_STEPS.findIndex((s) => s.ask === "name");
    expect(nameAt).toBeGreaterThanOrEqual(0);
    expect(nameAt).toBeLessThanOrEqual(2);
  });

  it("clamps an out-of-range index instead of returning undefined", () => {
    expect(stepAt(-5)).toBe(TOUR_STEPS[0]);
    expect(stepAt(9999)).toBe(TOUR_STEPS[TOUR_LENGTH - 1]);
    expect(stepAt(1.7)).toBe(TOUR_STEPS[1]);
  });
});

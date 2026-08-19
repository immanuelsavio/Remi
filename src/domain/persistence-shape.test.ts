import { describe, expect, it } from "vitest";

import { freshDay, mkMain } from "./defaults";
import { hydrate } from "./hydration";
import { forPersist } from "./persistence-shape";

const T0 = new Date(2026, 7, 12, 10, 0, 0).getTime();

describe("forPersist", () => {
  it("strips transient UI fields and stamps savedAt", () => {
    const s = freshDay();
    s.overlay = "endday";
    s.subsOpen = true;
    s.switchReason = "checkin";
    const out = forPersist(s, T0);
    expect(out.overlay).toBeUndefined();
    expect(out.subsOpen).toBeUndefined();
    expect(out.switchReason).toBeUndefined();
    expect(out.savedAt).toBe(T0);
    // Durable product state survives.
    expect(out.dayNum).toBe(1);
    expect(out.mains).toEqual([]);
  });

  it("round-trips through hydrate without losing durable fields", () => {
    const s = freshDay(3);
    s.mains = [mkMain("keep me")];
    s.mains[0].accrued = 5000;
    const back = hydrate(JSON.parse(JSON.stringify(forPersist(s, T0))));
    expect(back.dayNum).toBe(3);
    expect(back.mains[0].title).toBe("keep me");
    expect(back.mains[0].accrued).toBe(5000);
    expect(back.savedAt).toBe(T0);
  });
});

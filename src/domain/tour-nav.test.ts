import { describe, expect, it } from "vitest";

import {
  beatIndex,
  canAutoAdvance,
  enterStep,
  INACTIVE,
  reduce,
  type NavContext,
  type NavState,
} from "./tour-nav";

/** A four-beat step in the middle of the tour. */
const ctx = (over: Partial<NavContext> = {}): NavContext => ({
  beats: 4,
  autoIdx: 0,
  nextStep: 8,
  prevStep: 6,
  ...over,
});
const nav = (over: Partial<NavState> = {}): NavState => ({
  step: 7,
  cursor: null,
  armed: true,
  ...over,
});

describe("tour navigation", () => {
  describe("which beat is showing", () => {
    it("follows what is outstanding while the tour drives", () => {
      expect(beatIndex(ctx({ autoIdx: 2 }), nav())).toBe(2);
      expect(beatIndex(ctx({ autoIdx: 4 }), nav())).toBe(4);
    });

    it("stays put once someone takes the wheel", () => {
      expect(beatIndex(ctx({ autoIdx: 3 }), nav({ cursor: 1 }))).toBe(1);
    });

    it("never leaves the checklist", () => {
      expect(beatIndex(ctx(), nav({ cursor: -5 }))).toBe(0);
      expect(beatIndex(ctx(), nav({ cursor: 99 }))).toBe(4);
    });
  });

  describe("NEXT", () => {
    it("does the outstanding beat and moves to the next one", () => {
      const r = reduce(ctx({ autoIdx: 0 }), nav(), { type: "NEXT" });
      expect(r.effect).toEqual({ do: "fill", beat: 0 });
      expect(r.state.cursor).toBe(1);
    });

    it("does NOT redo a beat stepped back onto", () => {
      // Three done, Back pressed twice, then Next: it must not create a
      // second task, a second step or a second tag.
      const r = reduce(ctx({ autoIdx: 3 }), nav({ cursor: 1 }), { type: "NEXT" });
      expect(r.effect).toEqual({ do: "none" });
      expect(r.state.cursor).toBe(2);
    });

    it("turns the page only once the checklist is finished", () => {
      const r = reduce(ctx({ autoIdx: 4 }), nav({ cursor: 4 }), { type: "NEXT" });
      expect(r.effect).toEqual({ do: "goto", step: 8 });
    });

    it("ends the tour at the last step", () => {
      const r = reduce(ctx({ beats: 0, autoIdx: 0, nextStep: null }), nav(), { type: "NEXT" });
      expect(r.effect).toEqual({ do: "exit" });
      expect(r.state).toEqual(INACTIVE);
    });
  });

  describe("BACK", () => {
    it("walks the checklist before it leaves the page", () => {
      const r = reduce(ctx({ autoIdx: 3 }), nav(), { type: "BACK" });
      expect(r.state.cursor).toBe(2);
      expect(r.effect).toEqual({ do: "none" });
    });

    it("leaves the page from the first beat", () => {
      const r = reduce(ctx({ autoIdx: 0 }), nav(), { type: "BACK" });
      expect(r.effect).toEqual({ do: "goto", step: 6 });
    });

    it("does nothing at the very start of the tour", () => {
      const r = reduce(ctx({ beats: 0, prevStep: null }), nav({ step: 0 }), { type: "BACK" });
      expect(r.effect).toEqual({ do: "none" });
      expect(r.state.step).toBe(0);
    });
  });

  describe("the automatic page turn", () => {
    it("fires when the tour is driving and the list was unfinished on arrival", () => {
      expect(canAutoAdvance(ctx({ autoIdx: 4 }), nav())).toBe(true);
    });

    it("NEVER competes with a manual move", () => {
      // The regression that kept coming back: Back during the hold, and the
      // timer turning the page anyway.
      expect(canAutoAdvance(ctx({ autoIdx: 4 }), nav({ cursor: 3 }))).toBe(false);
    });

    it("does not bounce you off a list that was already done on arrival", () => {
      const arrived = enterStep(7, ctx({ autoIdx: 4 }));
      expect(arrived.armed).toBe(false);
      expect(canAutoAdvance(ctx({ autoIdx: 4 }), arrived)).toBe(false);
    });

    it("arms on a step that still has work", () => {
      expect(enterStep(7, ctx({ autoIdx: 1 })).armed).toBe(true);
    });

    it("leaves a step with no beats alone", () => {
      expect(canAutoAdvance(ctx({ beats: 0, autoIdx: 0 }), nav())).toBe(false);
    });
  });

  it("does nothing at all once the tour is over", () => {
    const r = reduce(ctx(), INACTIVE, { type: "NEXT" });
    expect(r.state).toEqual(INACTIVE);
    expect(r.effect).toEqual({ do: "none" });
  });

  it("progress alone never moves someone who is driving", () => {
    const driving = nav({ cursor: 1 });
    expect(reduce(ctx({ autoIdx: 3 }), driving, { type: "PROGRESS" }).state).toEqual(driving);
  });
});

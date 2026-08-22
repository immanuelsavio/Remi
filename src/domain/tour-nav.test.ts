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

/**
 * A four-beat step in the middle of the tour.
 *
 * `done` defaults to the contiguous prefix `autoIdx` describes - the
 * ordinary case, where the checklist has been worked through in order.
 * Tests that care about OUT-OF-ORDER completion pass their own.
 */
const ctx = (over: Partial<NavContext> = {}): NavContext => {
  const beats = over.beats ?? 4;
  const autoIdx = over.autoIdx ?? 0;
  return {
    beats,
    autoIdx,
    done: Array.from({ length: beats }, (_, i) => i < autoIdx),
    nextStep: 8,
    prevStep: 6,
    ...over,
  };
};
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
    it("walks the checklist before it leaves the page, REWINDING as it goes", () => {
      // Back used to move a cursor over state that still said the beat was
      // done: stepping back onto "add a step" showed the instruction with
      // the step already there, the checklist still read 2 of 3, and Next
      // skipped straight past it.
      const r = reduce(ctx({ autoIdx: 3 }), nav(), { type: "BACK" });
      expect(r.state.cursor).toBe(2);
      expect(r.effect).toEqual({ do: "rewind", toBeat: 2 });
    });

    it("leaves the page from the first beat, marked as a BACKWARD arrival", () => {
      // The caller resets the step being returned to; without the marker,
      // arriving backwards at a finished checklist reopened it at 3 of 3
      // with nothing left to do.
      const r = reduce(ctx({ autoIdx: 0 }), nav(), { type: "BACK" });
      expect(r.effect).toEqual({ do: "goto", step: 6, back: true });
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

describe("beats completed OUT OF ORDER", () => {
  // The old rule inferred "already done" from `at < autoIdx` - a contiguous
  // prefix. A person who does the third thing themselves and then presses
  // Next on the first leaves a hole in that prefix, and every beat past the
  // hole reads as outstanding: Next carries them out again, and the tour
  // adds a duplicate step, tag or reminder to their task.
  const holed = ctx({ beats: 4, autoIdx: 1, done: [true, false, true, false] });

  it("does not redo a beat that is done but sits past an outstanding one", () => {
    const r = reduce(holed, nav({ cursor: 2 }), { type: "NEXT" });
    expect(r.effect).toEqual({ do: "none" });
    expect(r.state.cursor).toBe(3);
  });

  it("still does the beat that is genuinely outstanding", () => {
    const r = reduce(holed, nav({ cursor: 1 }), { type: "NEXT" });
    expect(r.effect).toEqual({ do: "fill", beat: 1 });
    expect(r.state.cursor).toBe(2);
  });

  it("the last beat is done by its own control, so Next only moves the cursor", () => {
    const r = reduce(ctx({ beats: 2, autoIdx: 0, done: [false, true] }), nav({ cursor: 1 }), {
      type: "NEXT",
    });
    expect(r.effect).toEqual({ do: "none" });
  });

  it("a missing flag is treated as NOT done - it never silently skips work", () => {
    const r = reduce(ctx({ beats: 2, autoIdx: 0, done: [] }), nav({ cursor: 0 }), { type: "NEXT" });
    expect(r.effect).toEqual({ do: "fill", beat: 0 });
  });
});

describe("the ends of the tour", () => {
  it("BACK on the first visible step does nothing at all", () => {
    const r = reduce(
      ctx({ beats: 0, autoIdx: 0, done: [], prevStep: null }),
      nav({ cursor: null }),
      {
        type: "BACK",
      },
    );
    expect(r.effect).toEqual({ do: "none" });
    expect(r.state).toEqual(nav({ cursor: null }));
  });

  it("BACK from the first BEAT of the first step still does nothing", () => {
    const r = reduce(ctx({ autoIdx: 0, prevStep: null }), nav({ cursor: 0 }), { type: "BACK" });
    expect(r.effect).toEqual({ do: "none" });
    expect(r.state.cursor).toBe(0);
  });

  it("NEXT past the last step exits", () => {
    const r = reduce(ctx({ beats: 0, autoIdx: 0, done: [], nextStep: null }), nav(), {
      type: "NEXT",
    });
    expect(r.effect).toEqual({ do: "exit" });
    expect(r.state).toEqual(INACTIVE);
  });

  it("rapid repeated NEXT walks the checklist once, one beat per press", () => {
    // Each press moves the cursor, so pressing four times does four
    // different beats rather than the same one four times.
    let state = nav({ cursor: null });
    const effects = [];
    for (let i = 0; i < 4; i++) {
      const r = reduce(ctx({ autoIdx: 0 }), state, { type: "NEXT" });
      state = r.state;
      effects.push(r.effect);
    }
    expect(effects).toEqual([
      { do: "fill", beat: 0 },
      { do: "fill", beat: 1 },
      { do: "fill", beat: 2 },
      { do: "fill", beat: 3 },
    ]);
  });
});

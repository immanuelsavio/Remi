import { describe, expect, it } from "vitest";

import {
  beatIndexFor,
  clampCursor,
  nextShown,
  shouldAutoAdvance,
  stepAt,
  stepShown,
  TOUR_LENGTH,
  TOUR_STEPS,
  tourProgress,
} from "./tour";
import { freshDay } from "./defaults";
import { demoMains } from "./demo";

describe("the guided tour script", () => {
  it("covers the features someone has to be shown", () => {
    // A tour that silently loses a step is the kind of regression nobody
    // notices until a new user is confused, so the shape is pinned here.
    // Updated deliberately when the tour was condensed from sixteen pages
    // to eight: the SUBJECTS are what must survive, not the page count, so
    // this pins the merged step that now covers each of them.
    const ids = TOUR_STEPS.map((s) => s.id);
    for (const required of [
      "welcome",
      "plan",
      "work",
      "endday",
      "calendar",
      "evidence",
      "look",
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
    expect(TOUR_STEPS[TOUR_LENGTH - 1].tab).toBe("settings");
  });

  it("asks for a name, for the look, and for the on/off preferences", () => {
    // These are the steps that WRITE something. If one disappears, a first
    // run silently stops asking and those settings are never seen.
    const asks = TOUR_STEPS.filter((s) => s.ask).map((s) => s.ask);
    for (const required of [
      "look",
      "nick",
      "fullname",
      "mascot",
      "mouse",
      "tray",
      "wellness",
      "prefs",
    ]) {
      expect(asks).toContain(required);
    }
  });

  it("puts exactly ONE control on each page that asks", () => {
    // The point of the split: a page holding four decisions is four
    // decisions to hold at once. Nothing here enforces the markup, but
    // pinning one `ask` per step stops two being merged back onto one page.
    const asking = TOUR_STEPS.filter((s) => s.ask);
    expect(new Set(asking.map((s) => s.ask)).size).toBe(asking.length);
  });

  it("asks for the name early, before the walkthrough proper", () => {
    // The name is used in the copy the rest of the tour shows, so asking
    // late means the tour addresses you by name only after it stops
    // talking to you. It is no longer step 0 - step 0 is the greeting - but
    // it must still come before the first thing Remi walks to.
    const nameAt = TOUR_STEPS.findIndex((s) => s.ask === "nick");
    const firstWalk = TOUR_STEPS.findIndex((s) => s.anchor);
    expect(nameAt).toBeGreaterThanOrEqual(0);
    expect(nameAt).toBeLessThan(firstWalk);
  });

  it("asks about the theme immediately, before anything else is read", () => {
    // It changes how every page after it looks. Asked at the end, the
    // whole tour is read in a theme the user did not choose.
    expect(TOUR_STEPS[1].ask).toBe("look");
  });

  it("says its piece in a line or two, never a wall", () => {
    // The reason the tour is many small pages rather than a few big ones.
    // A paragraph on a card is the thing that gets skipped, and a skipped
    // page teaches nothing.
    for (const s of TOUR_STEPS) {
      expect(s.body.length).toBeLessThanOrEqual(2);
      for (const para of s.body) expect(para.length).toBeLessThanOrEqual(150);
      if (s.aside) expect(s.aside.length).toBeLessThanOrEqual(150);
    }
  });

  it("stays short enough that people actually finish it", () => {
    // Sixteen pages was too many, but the fix was never "fewer pages" - it
    // was less on each. The cap went back up when the fat ask pages were
    // split one-control-per-page, which is easier to get through than the
    // eight pages it replaced despite the higher number. What is pinned is
    // that nobody re-merges pages to chase the old count, or lets it drift
    // back towards sixteen.
    expect(TOUR_LENGTH).toBeLessThanOrEqual(17);
  });

  it("walks for the walkthrough and uses a card for the questions", () => {
    // The two shapes are not interchangeable: a speech bubble has nowhere
    // to put a form, and a centred card has nothing to point at. Pinning
    // the split stops a later edit from asking for a name inside a bubble.
    for (const s of TOUR_STEPS) {
      if (s.ask) expect(s.anchor).toBeUndefined();
    }
    const walking = TOUR_STEPS.filter((s) => s.anchor).map((s) => s.id);
    expect(walking).toEqual(["plan", "work", "endday", "calendar", "search", "evidence"]);
  });

  it("drops the pages about the mouse when there is no mouse", () => {
    // A greyed-out "what should I wear" is still a question you have to
    // read, decide is not for you, and dismiss. Off means gone.
    const on = { ...freshDay(), mascotOn: true };
    const off = { ...freshDay(), mascotOn: false };
    const shown = (s: typeof on) => TOUR_STEPS.filter((st) => stepShown(st, s)).map((st) => st.id);

    expect(shown(on)).toContain("mouse");
    expect(shown(off)).not.toContain("mouse");
    // The switch that causes it must survive, or it can never be undone.
    expect(shown(off)).toContain("mascot");
  });

  it("walks navigation OVER a skipped page rather than landing on it", () => {
    const off = { ...freshDay(), mascotOn: false };
    const at = TOUR_STEPS.findIndex((s) => s.id === "mascot");
    const forward = nextShown(at, 1, off);
    expect(forward === null ? null : TOUR_STEPS[forward].id).toBe("plan");
    // ...and back again, so turning the mouse on is still reachable.
    const back = nextShown(
      TOUR_STEPS.findIndex((s) => s.id === "plan"),
      -1,
      off,
    );
    expect(back === null ? null : TOUR_STEPS[back].id).toBe("mascot");
  });

  it("counts progress over the tour you are actually being given", () => {
    // "Step 8 of 14" on the last page is a lie, and a bar that never
    // reaches the end is worse than no bar.
    const off = { ...freshDay(), mascotOn: false };
    const last = TOUR_LENGTH - 1;
    const p = tourProgress(last, off);
    expect(p.total).toBe(TOUR_LENGTH - 1);
    expect(p.pos).toBe(p.total);
  });

  it("makes the doing steps DOING, not reading", () => {
    // The whole reason the plan step has beats: "add a task, a step, a tag
    // and a deadline" as one paragraph is four things to hold at once.
    const plan = TOUR_STEPS.find((s) => s.id === "plan");
    expect(plan?.beats?.map((b) => b.id)).toEqual(["task", "step", "tag", "remind"]);
    for (const s of TOUR_STEPS) {
      for (const b of s.beats ?? []) {
        // Every beat must be able to tell it is finished, or the tour
        // strands the user on an instruction it cannot acknowledge.
        expect(typeof b.done).toBe("function");
        expect(b.text.trim().length).toBeGreaterThan(0);
        expect(b.cheer.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("reads the beats off real state, not off the demo tasks", () => {
    // The demo tasks already carry steps, tags and a title, so a beat that
    // did not look past them would read as done before the user typed
    // anything - and the tour would skip the thing it exists to teach.
    const plan = TOUR_STEPS.find((s) => s.id === "plan");
    const demoOnly = { ...freshDay(), mains: demoMains(Date.now()) };
    for (const b of plan?.beats ?? []) {
      expect(b.done(demoOnly, null)).toBe(false);
    }
  });

  it("only points at anchors that something actually marks", () => {
    // The failure this catches is silent and ugly: a step names an anchor
    // no element carries, `findAnchor` gives up after its frames, and the
    // step quietly degrades to a centred card - so a walkthrough step about
    // a specific control just stops pointing at it, and nothing errors.
    // Vite's glob rather than node:fs - this project's tsconfig deliberately
    // carries no node types, and the bundler resolves this at build time.
    const sources = import.meta.glob("../components/**/*.svelte", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;

    const marked = new Set<string>();
    for (const src of Object.values(sources)) {
      // `use:tourAnchor={...}` - the name may be a literal or hidden inside
      // a conditional, so take every anchor-shaped string in a file that
      // uses the action at all.
      if (!src.includes("tourAnchor")) continue;
      for (const m of src.matchAll(/"((?:plan|today|cal|stats)-[a-z]+)"/g)) marked.add(m[1]);
    }

    for (const s of TOUR_STEPS) {
      if (s.anchor) expect(marked, `step "${s.id}" anchor`).toContain(s.anchor);
      for (const b of s.beats ?? []) {
        if (b.anchor) expect(marked, `beat "${b.id}" anchor`).toContain(b.anchor);
      }
    }
  });

  it("gives every typing beat an example Next can commit", () => {
    // Next has to mean the same thing on every beat. On the ones that want
    // input it commits what is in the box, so there has to be something in
    // the box for someone who would rather watch than type.
    const plan = TOUR_STEPS.find((s) => s.id === "plan");
    const typing = (plan?.beats ?? []).filter((b) => b.id !== "remind");
    expect(typing.length).toBeGreaterThan(0);
    for (const b of typing) expect(b.fill?.kind).toBeTruthy();
  });

  it("only lets a beat without its own anchor be the first one", () => {
    // A beat with `fill` gets that example TYPED into whatever it is
    // pointing at. A beat with no anchor of its own points at the step's,
    // which is only the right control for the beat that opens the step -
    // for any later one it is a different box entirely, and seeding there
    // wrote the step's example into the add-a-TASK field, making a
    // top-level task called "First step".
    for (const s of TOUR_STEPS) {
      (s.beats ?? []).forEach((b, at) => {
        if (b.fill && !b.anchor) expect(at).toBe(0);
      });
    }
  });

  describe("the checklist's two drivers", () => {
    // Exactly one is in charge at a time. Mixing them is what turned the
    // page out from under someone who had just pressed Back.
    it("follows what is outstanding while the tour is driving", () => {
      expect(beatIndexFor(4, null, 0)).toBe(0);
      expect(beatIndexFor(4, null, 2)).toBe(2);
      // Past the end is the "all done" position, not a beat.
      expect(beatIndexFor(4, null, 4)).toBe(4);
    });

    it("stays where it was put once someone takes the wheel", () => {
      // Three beats done, but Back was pressed twice: the bubble stays on
      // the beat they asked for, not the one still outstanding.
      expect(beatIndexFor(4, 1, 3)).toBe(1);
      expect(beatIndexFor(4, 0, 4)).toBe(0);
    });

    it("never lets a cursor leave the checklist", () => {
      expect(clampCursor(4, -3)).toBe(0);
      expect(clampCursor(4, 99)).toBe(4);
      expect(beatIndexFor(4, 99, 0)).toBe(4);
    });

    it("turns the page by itself ONLY while the tour is driving", () => {
      // All four done arms the auto-advance; pressing Back during the hold
      // set a cursor, and the timer fired anyway and threw the user off the
      // beat they had just gone back to.
      expect(shouldAutoAdvance(4, 4, null, true)).toBe(true);
      expect(shouldAutoAdvance(4, 4, 3, true)).toBe(false);
      expect(shouldAutoAdvance(4, 4, 0, true)).toBe(false);
    });

    it("does not turn the page on a list that is not finished", () => {
      expect(shouldAutoAdvance(4, 3, null, true)).toBe(false);
    });

    it("does not bounce you forward off a list that was ALREADY done", () => {
      // Pressing Back onto a finished checklist is arriving at it, not
      // finishing it. Re-arming there threw the user forward a moment
      // later, which made Back look broken when it had worked perfectly.
      expect(shouldAutoAdvance(4, 4, null, false)).toBe(false);
    });

    it("leaves a step with no beats alone entirely", () => {
      expect(shouldAutoAdvance(0, 0, null, true)).toBe(false);
      expect(beatIndexFor(0, null, 0)).toBe(0);
    });
  });

  it("clamps an out-of-range index instead of returning undefined", () => {
    expect(stepAt(-5)).toBe(TOUR_STEPS[0]);
    expect(stepAt(9999)).toBe(TOUR_STEPS[TOUR_LENGTH - 1]);
    expect(stepAt(1.7)).toBe(TOUR_STEPS[1]);
  });
});

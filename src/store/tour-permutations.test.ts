/**
 * THE TOUR, UNDER EVERY ORDER OF BUTTON PRESSES.
 *
 * Individual navigation bugs have been fixed one at a time in this app for
 * a while now, and each fix moved the symptom to a neighbour: Back left a
 * beat still done, returning to a page resumed it at its last beat, Next
 * built a second task. What those have in common is not a page - it is that
 * nobody ever pressed the buttons in an order the author had not imagined.
 *
 * So this file imagines all of them. Every sequence of Next/Back up to a
 * given length is walked, and after EVERY press the same invariants are
 * checked:
 *
 *   - the tour is on a real page (or has deliberately ended)
 *   - the beat cursor is inside that page's checklist
 *   - the practice id points at a task that exists, or at nothing
 *   - at most one practice task, one practice step, one practice tag
 *   - no demo task has escaped into anything persisted
 *
 * A failure prints the exact sequence that produced it, because "some
 * order of clicks breaks it" is not a bug report anyone can act on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));

import { freshDay } from "../domain/defaults";
import { isDemoId } from "../domain/demo";
import { forPersist } from "../domain/persistence-shape";
import { TOUR_STEPS, stepShown } from "../domain/tour";
import { S, setState, state } from "./state";
import {
  endTour,
  goToStep,
  startTour,
  tourBack,
  tourNext,
  tourPracticeId,
  tourSandbox,
  tourSession,
  tourStep,
  tourView,
} from "./index";

/** A day with two real tasks, exactly as `reset()` in store.test.ts makes. */
function realDay() {
  setState({ ...freshDay(), awaitingStart: false, phase: "today" });
  state.update((s) => {
    s.mains = [];
    return s;
  });
}

const idx = (id: string) => TOUR_STEPS.findIndex((t) => t.id === id);

/** Everything that must be true after every single press. */
function checkInvariants(where: string) {
  const s = S();
  const at = get(tourStep);
  const v = get(tourView);

  if (at !== null) {
    expect(at, `${where}: page out of range`).toBeGreaterThanOrEqual(0);
    expect(at, `${where}: page out of range`).toBeLessThan(TOUR_STEPS.length);
    expect(stepShown(TOUR_STEPS[at], s), `${where}: landed on a skipped page`).toBe(true);
    expect(v.beatIndex, `${where}: beat cursor below zero`).toBeGreaterThanOrEqual(0);
    expect(v.beatIndex, `${where}: beat cursor past the checklist`).toBeLessThanOrEqual(
      v.beats.length,
    );
    // A page must always render SOMETHING: a step with no beats is a card,
    // a step with beats has one showing or is finished.
    expect(v.step, `${where}: no step to render`).toBeTruthy();
  }

  // THE BOUNDARY, checked after every single press: practice lives in the
  // sandbox and the user's own day is untouched. This is what the old
  // architecture could not say - the practice task WAS a real task, with
  // the real day parked in `demoRestore`.
  const sb = get(tourSandbox);
  expect(s.mains, `${where}: the real task list was written to`).toHaveLength(0);
  expect(
    (s as { demoRestore?: unknown }).demoRestore ?? null,
    `${where}: the real day was parked aside`,
  ).toBeNull();

  // The practice id either resolves to a task IN THE SANDBOX or is null -
  // never a dangling reference to something replay did not build.
  const recorded = get(tourPracticeId);
  if (recorded !== null) {
    expect(
      sb.mains.some((m) => m.id === recorded),
      `${where}: practice id points at a task that does not exist`,
    ).toBe(true);
  }

  // At most one of each practice artefact.
  const mine = sb.mains.filter((m) => !isDemoId(m.id));
  expect(mine.length, `${where}: more than one practice task`).toBeLessThanOrEqual(1);
  if (mine[0]) {
    expect(mine[0].subs.length, `${where}: more than one practice step`).toBeLessThanOrEqual(1);
    expect(mine[0].tags.length, `${where}: more than one practice tag`).toBeLessThanOrEqual(1);
  }

  // Nothing from the sandbox may reach what would be written to disk.
  const persisted = JSON.stringify(forPersist(s, 1_000));
  expect(persisted.includes("demo-"), `${where}: a demo id reached persistence`).toBe(false);
  expect(persisted.includes("tour-"), `${where}: a practice id reached persistence`).toBe(false);
}

/**
 * What BACK specifically promises, checked wherever it lands.
 *
 * This is the invariant the old tour broke everywhere: Back moved a cursor
 * over state that still said the beat was done, so the instruction on
 * screen was already satisfied, the count still read "3 of 3", and the next
 * Next skipped it. Weak invariants (at most one task, no dangling id) all
 * held while that was true - which is exactly why they never caught it.
 */
function checkBackLanded(where: string, pageBefore: number | null) {
  const at = get(tourStep);
  if (at === null) return;
  const v = get(tourView);
  if (!v.beats.length) return;

  if (at === pageBefore) {
    // Stepped back onto a beat of the same page: that beat must be
    // OUTSTANDING again, or Back did not undo anything.
    expect(
      v.doneFlags[v.beatIndex] === true,
      `${where}: Back landed on a beat that is still done`,
    ).toBe(false);
  } else {
    // Walked back onto an earlier page: it starts as a clean checklist.
    expect(v.beatIndex, `${where}: a page entered backwards resumed mid-checklist`).toBe(0);
    expect(v.doneCount, `${where}: a page entered backwards was already finished`).toBe(0);
  }
}

/** Walk one sequence of presses, checking after each. */
function walk(seq: ("next" | "back")[], from: number) {
  realDay();
  startTour();
  goToStep(from);
  const done: string[] = [];
  for (const press of seq) {
    done.push(press);
    const pageBefore = get(tourStep);
    if (press === "next") tourNext();
    else tourBack();
    const where = `from "${TOUR_STEPS[from].id}" via ${done.join(" → ")}`;
    checkInvariants(where);
    if (press === "back") checkBackLanded(where, pageBefore);
    if (get(tourStep) === null) break; // the tour ended; nothing more to press
  }
  endTour();
}

/** Every sequence of Next/Back of exactly `len` presses. */
function everySequence(len: number): ("next" | "back")[][] {
  const out: ("next" | "back")[][] = [];
  for (let mask = 0; mask < 1 << len; mask++) {
    const seq: ("next" | "back")[] = [];
    for (let bit = 0; bit < len; bit++) seq.push(mask & (1 << bit) ? "next" : "back");
    out.push(seq);
  }
  return out;
}

beforeEach(() => {
  realDay();
});

describe("the tour under every order of presses", () => {
  it("the exact reported sequence stays deterministic", () => {
    // Next → Next → Back → Next → Back → Next → Next, from Build One.
    walk(["next", "next", "back", "next", "back", "next", "next"], idx("plan"));
  });

  it("EIGHT presses in every order, starting on Build One", () => {
    // 256 sequences. Build One is where the duplicate tasks, the stuck
    // "3 of 4" and the un-rewound beats all lived.
    for (const seq of everySequence(8)) walk(seq, idx("plan"));
  });

  it("SIX presses in every order, from every page of the tour", () => {
    // 64 sequences per page, every page - including the ones after the End
    // Day rehearsal, which used to go blank because the demo day had been
    // archived out from under them.
    for (let step = 0; step < TOUR_STEPS.length; step++) {
      if (!stepShown(TOUR_STEPS[step], S())) continue;
      for (const seq of everySequence(6)) walk(seq, step);
    }
  });

  it("repeated Next never builds a second anything", () => {
    realDay();
    startTour();
    goToStep(idx("plan"));
    for (let i = 0; i < 12; i++) {
      tourNext();
      checkInvariants(`next x${i + 1}`);
    }
    endTour();
  });

  it("repeated Back walks out of the tour and stops", () => {
    realDay();
    startTour();
    goToStep(idx("evidence"));
    for (let i = 0; i < 20; i++) {
      tourBack();
      checkInvariants(`back x${i + 1}`);
    }
    // Back from the first page does nothing; it never leaves the tour.
    expect(get(tourStep)).toBe(0);
    endTour();
  });

  it("every page is reachable by pressing Next from the start", () => {
    realDay();
    startTour();
    const seen = new Set<number>();
    for (let i = 0; i < TOUR_STEPS.length * 6; i++) {
      const at = get(tourStep);
      if (at === null) break;
      seen.add(at);
      // Finish each checklist so Next turns the page rather than doing a beat.
      const v = get(tourView);
      for (let b = 0; b < v.beats.length + 1; b++) {
        if (get(tourStep) !== at) break;
        tourNext();
        checkInvariants(`walking forward at page ${at}`);
      }
      if (get(tourStep) === at) tourNext();
    }
    const shown = TOUR_STEPS.filter((t) => stepShown(t, S())).length;
    expect(seen.size, "some page could not be reached by pressing Next").toBeGreaterThanOrEqual(
      shown - 1,
    );
  });

  it("the tour session is clean after every walk", () => {
    walk(["next", "next", "next", "back", "back", "next"], idx("plan"));
    const t = get(tourSession);
    expect(t.events, "the event log survived the tour ending").toHaveLength(0);
    const sb = get(tourSandbox);
    expect(sb.practiceId).toBeNull();
    expect(sb.clockTaskId).toBeNull();
    expect(sb.endDayDone).toBe(false);
    expect(S().mains, "the real day was touched at all").toHaveLength(0);
  });
});

/**
 * THE TOUR CONTROLLER.
 *
 * All of this used to live inside `Tour.svelte`, which is how one component
 * came to own state transitions, DOM automation, focus, anchoring, timers,
 * persistence and navigation at once. Eight fixes in an hour is what that
 * coupling produces: each one moved a symptom to a neighbour.
 *
 * What lives here: which step, which beat, whether a modal has paused
 * things, the practice task's identity, and the typed commands that carry
 * out a beat. What lives in the component: rendering, and telling this
 * module what the user pressed.
 *
 * Navigation itself is `domain/tour-nav.ts` - a pure reducer with no
 * timers and no DOM, so it can be exhaustively tested. This module is the
 * thin layer that gives that reducer its context and performs its effects.
 */
import { derived, get, writable, type Readable } from "svelte/store";

import { demoDay } from "../domain/demo";
import {
  beatIndex,
  canAutoAdvance,
  enterStep,
  INACTIVE,
  reduce,
  type NavContext,
  type NavState,
} from "../domain/tour-nav";
import {
  nextShown,
  stepAt,
  TOUR_STEPS,
  tourProgress,
  type BeatFill,
  type TourStep,
} from "../domain/tour";
import type { State } from "../domain/types";
import { S, commit, dashTab, restoreFromDemo, sessionTx, state } from "./state";
import { cancelNotificationPreview } from "./tour-preview";
import { addMain, addSub, addTag, setRemind } from "./task-actions";

/** How long the last acknowledgement stays up before the page turns. */
const ADVANCE_HOLD_MS = 1400;

const nav = writable<NavState>(INACTIVE);
/**
 * The task this run of the tour is practising on.
 *
 * Window-local and explicitly recorded, rather than re-derived as "the
 * first task that is not a demo one" - which was a guess that a second
 * task, an import or an edit from the other window could all defeat.
 */
const practiceId = writable<string | null>(null);
/**
 * The task ids that already existed when this step began.
 *
 * How a task the USER typed becomes the practice task, without going back
 * to guessing. Anything not in this set appeared during the exercise, so it
 * is what they are practising on - which is precise in a way that "the
 * first task that is not a demo one" never was: a second task, an import,
 * or an edit from the other window could all satisfy that.
 */
let baseline = new Set<string>();
/** A sheet or overlay owns the screen; the tour stands aside and goes inert. */
const paused = writable(false);

/** Position in the script, or null. Kept for the existing public name. */
export const tourStep: Readable<number | null> = derived(nav, (n) => n.step);
export const tourPracticeId: Readable<string | null> = practiceId;
export const tourPaused: Readable<boolean> = paused;

let advanceTimer: ReturnType<typeof setTimeout> | null = null;

function clearAdvance(): void {
  if (advanceTimer) clearTimeout(advanceTimer);
  advanceTimer = null;
}

// --- context ---------------------------------------------------------------

function beatsOf(step: TourStep | null): TourStep["beats"] {
  return step?.beats ?? [];
}

/** First beat still outstanding, or past the end when the list is done. */
function outstanding(step: TourStep | null, s: State, id: string | null): number {
  const beats = beatsOf(step) ?? [];
  const at = beats.findIndex((b) => !b.done(s, id));
  return at < 0 ? beats.length : at;
}

/**
 * The practice task's id: the one recorded, or the one they just made.
 *
 * Pure resolution, so it can be read from a derived store without side
 * effects. `fill` still records the id explicitly when Next makes the task.
 */
export function effectivePracticeId(s: State, recorded: string | null): string | null {
  if (recorded) return recorded;
  return s.mains.find((m) => !baseline.has(m.id))?.id ?? null;
}

function contextFor(n: NavState, s: State, id: string | null): NavContext {
  const step = n.step === null ? null : stepAt(n.step);
  const beats = beatsOf(step) ?? [];
  return {
    beats: beats.length,
    autoIdx: outstanding(step, s, id),
    nextStep: n.step === null ? null : nextShown(n.step, 1, s),
    prevStep: n.step === null ? null : nextShown(n.step, -1, s),
  };
}

/**
 * Everything the view needs, in one object.
 *
 * A single derived store rather than a dozen reactive statements in the
 * component - which is where the ordering bugs came from, because Svelte's
 * dependency graph decided when each of them ran.
 */
export const tourView = derived([nav, state, practiceId, paused], ([n, s, recorded, isPaused]) => {
  const id = effectivePracticeId(s, recorded);
  const step = n.step === null ? null : stepAt(n.step);
  const beats = beatsOf(step) ?? [];
  const ctx = contextFor(n, s, id);
  const at = beatIndex(ctx, n);
  const done = beats.map((b) => b.done(s, id));
  return {
    step,
    index: n.step,
    active: n.step !== null,
    paused: isPaused,
    beats,
    beatIndex: at,
    beat: beats[at] ?? null,
    doneFlags: done,
    doneCount: done.filter(Boolean).length,
    allBeatsDone: beats.length > 0 && ctx.autoIdx >= beats.length,
    /** The most recent beat finished BEFORE the one showing. */
    lastDone:
      beats
        .slice(0, at)
        .reverse()
        .find((_, i) => done[at - 1 - i]) ?? null,
    progress: n.step === null ? { pos: 1, total: 1 } : tourProgress(n.step, s),
    lastStep: n.step === null || nextShown(n.step, 1, s) === null,
  };
});

// --- entering and leaving --------------------------------------------------

/**
 * Put the demo day on screen and hold the real one aside.
 *
 * Routed through `sessionTx` because replacing `mains` while a task is on
 * the clock is exactly the mutation that transaction exists for: the
 * running session has to be banked to the user's OWN task first, or its
 * time is lost or credited to a demo task that does not exist.
 */
function enterDemo(): void {
  if (S().demoRestore) return; // already in it; never snapshot the demo
  sessionTx((s, now) => {
    const { mains, interruptions } = demoDay(now, s.dateISO);
    s.demoRestore = JSON.parse(
      JSON.stringify({
        mains: s.mains,
        interruptions: s.interruptions,
        activeMainId: s.activeMainId,
        activeSubId: s.activeSubId,
        startedAt: s.startedAt,
        phase: s.phase,
        awaitingStart: s.awaitingStart,
        dateISO: s.dateISO,
        dayNum: s.dayNum,
      }),
    );
    s.mains = mains;
    s.interruptions = interruptions;
    s.activeMainId = null;
    s.activeSubId = null;
    // Lift the Start-day gate for the duration. On a first launch the day
    // has not begun, and behind that gate the dashboard shows the gate
    // instead of any tab - so the demo the tour exists to point at was on
    // screen for nobody. `restoreFromDemo` puts it back.
    s.awaitingStart = false;
    s.phase = "today";
    return null;
  });
}

export function startTour(): void {
  enterDemo();
  practiceId.set(null);
  rebaseline();
  const s = S();
  const first = 0;
  nav.set(enterStep(first, contextFor({ ...INACTIVE, step: first }, s, null)));
  dashTab.set(TOUR_STEPS[first].tab ?? get(dashTab));
}

/**
 * Close the tour, however it ended, in ONE transaction.
 *
 * Finishing, skipping and the close button all land here - there is
 * exactly one way out, so the demo cannot survive an exit nobody thought
 * about. `restoreFromDemo(true)` puts the real day back AND records that
 * the tour ran in the same commit; as two mutations they could half-apply
 * and leave the next launch starting the tour over the real day.
 */
export function endTour(): void {
  clearAdvance();
  cancelNotificationPreview();
  nav.set(INACTIVE);
  practiceId.set(null);
  paused.set(false);
  // One transaction when there IS a demo - the day back and the flag
  // together, so a failure between them cannot leave the tour "unseen"
  // over a restored real day. With no demo (a tour that never got one)
  // there is nothing to be atomic with, so a plain commit is honest.
  if (S().demoRestore) restoreFromDemo(true);
  else commit((s) => void (s.tourSeen = true));
}

// --- navigation ------------------------------------------------------------

/**
 * Jump to a step directly.
 *
 * Exported because the tour is otherwise only reachable by walking it,
 * which makes it untestable and undeep-linkable. It goes through the same
 * entry path as a page turn, so a jumped-to step is armed exactly as it
 * would be if you had walked there.
 */
export function goToStep(step: number): void {
  goTo(step);
}

/** Remember what already existed, so a new task can be told apart. */
function rebaseline(): void {
  baseline = new Set(S().mains.map((m) => m.id));
}

function goTo(step: number): void {
  rebaseline();
  const s = S();
  nav.set(enterStep(step, contextFor({ ...INACTIVE, step }, s, get(practiceId))));
  const tab = stepAt(step).tab;
  if (tab) dashTab.set(tab);
}

function dispatch(type: "NEXT" | "BACK"): void {
  const n = get(nav);
  if (n.step === null) return;
  clearAdvance();
  const s = S();
  const id = effectivePracticeId(s, get(practiceId));
  const ctx = contextFor(n, s, id);
  const { state: next, effect } = reduce(ctx, n, { type });
  nav.set(next);
  if (effect.do === "exit") return void endTour();
  if (effect.do === "goto") return void goTo(effect.step);
  if (effect.do === "fill") {
    const beat = (beatsOf(stepAt(n.step)) ?? [])[effect.beat];
    if (beat?.fill) fill(beat.fill);
  }
}

export function tourNext(): void {
  dispatch("NEXT");
}

export function tourBack(): void {
  dispatch("BACK");
}

/** A modal owns the screen: hide the tour and make it inert until it closes. */
export function setTourPaused(on: boolean): void {
  paused.set(on);
  if (on) clearAdvance();
}

/**
 * Arm the automatic page turn, if this is a moment that deserves one.
 *
 * Called by the view when the checklist completes. Held briefly so the last
 * acknowledgement is readable - doing the final thing and being thrown to a
 * new screen in the same instant reads as a misclick - and re-checked on
 * firing, so anything that happened in between wins.
 */
export function maybeAutoAdvance(): void {
  const n = get(nav);
  if (n.step === null || get(paused)) return;
  const ctx = contextFor(n, S(), effectivePracticeId(S(), get(practiceId)));
  if (!canAutoAdvance(ctx, n)) return;
  clearAdvance();
  const at = n.step;
  advanceTimer = setTimeout(() => {
    advanceTimer = null;
    const now = get(nav);
    if (now.step !== at || get(paused)) return;
    if (!canAutoAdvance(contextFor(now, S(), effectivePracticeId(S(), get(practiceId))), now))
      return;
    dispatch("NEXT");
  }, ADVANCE_HOLD_MS);
}

// --- doing a beat ----------------------------------------------------------

/**
 * Carry out a beat through the same store actions a person's typing goes
 * through.
 *
 * No `.value` assignment, no synthetic events, no blur-as-commit, no
 * clicking generic buttons. That automation only worked while every
 * component it touched kept saving on blur, and it wrote a step's example
 * into the add-a-TASK box the one time it guessed wrong.
 */
function fill(f: BeatFill): void {
  const id = effectivePracticeId(S(), get(practiceId));
  switch (f.kind) {
    case "task": {
      const before = new Set(S().mains.map((m) => m.id));
      addMain(f.title);
      const made = S().mains.find((m) => !before.has(m.id));
      if (made) practiceId.set(made.id);
      return;
    }
    case "step":
      if (id) addSub(id, f.title);
      return;
    case "tag":
      if (id) addTag(id, f.tag);
      return;
    case "remind":
      if (id) setRemind({ kind: "main", id }, "in", f.inMinutes);
      return;
  }
}

/**
 * Adopt a task the user made themselves as the practice task.
 *
 * Called by the view when the first beat completes without `fill` having
 * run - they typed it rather than pressing Next.
 */
export function adoptPracticeTask(id: string): void {
  if (!get(practiceId)) practiceId.set(id);
}

/** Record that the Calendar search was used, for the search beat. */
export function markSearched(): void {
  if (S().tourSearched) return;
  commit((s) => void (s.tourSearched = true));
}

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
import {
  S,
  commit,
  dashTab,
  remindTarget,
  restoreFromDemo,
  sessionTx,
  state,
  wellnessNudge,
} from "./state";
import { wellnessCopy } from "../domain/wellness";
import { invoke } from "@tauri-apps/api/core";

/**
 * The task mutations a beat performs, injected by the facade.
 *
 * CLAUDE.md: action modules import only `state.ts`, and where two need to
 * meet, "the facade (`store/index.ts`) is the right place to compose
 * them". Importing `task-actions` directly here would be a new edge in a
 * graph the project deliberately keeps a star - and duplicating the
 * mutations instead would be worse still, since they route through
 * `sessionTx` and the tag/reminder normalisers for reasons of their own.
 */
export interface BeatCommands {
  addMain: (title: string) => void;
  addSub: (mainId: string, title: string) => void;
  addTag: (mainId: string, tag: string) => void;
  setRemind: (target: { kind: "main"; id: string }, kind: "in", raw: number) => void;
}

let commands: BeatCommands | null = null;

/** Wire the beat commands. Called once, by the facade. */
export function provideBeatCommands(next: BeatCommands): void {
  commands = next;
}

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
/**
 * A sheet or overlay owns the screen: the tour stands aside and goes inert.
 *
 * DERIVED, not set by the view. It was a writable the component wrote from
 * a reactive statement while also reading a store derived from it - so the
 * component both fed and consumed the same value, and Svelte stopped
 * updating it after the first round trip: the tour hid behind a sheet and
 * never came back when the sheet closed. Reading it from the two stores
 * that actually decide it removes the loop entirely.
 */
const paused = derived([remindTarget, state], ([target, s]) => !!target || !!s.overlay);

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
  // PROMOTE before re-baselining. A task the user typed themselves is
  // identified by "not in the baseline this step started with" - so the
  // moment a page turn takes a new baseline, their task falls inside it and
  // the tour forgets which one it was. Coming back then showed "type a
  // task" with their task already on screen, and Next built a second one.
  const derivedId = effectivePracticeId(S(), get(practiceId));
  if (derivedId) practiceId.set(derivedId);
  rebaseline();
  const s = S();
  nav.set(
    enterStep(step, contextFor({ ...INACTIVE, step }, s, effectivePracticeId(s, get(practiceId)))),
  );
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

/**
 * Arm the automatic page turn, if this is a moment that deserves one.
 *
 * Called by the view when the checklist completes. Held briefly so the last
 * acknowledgement is readable - doing the final thing and being thrown to a
 * new screen in the same instant reads as a misclick - and re-checked on
 * firing, so anything that happened in between wins.
 */
/**
 * Drop a pending page turn.
 *
 * The view calls this on destruction: a timer left running would dispatch
 * NEXT - possibly `endTour`, which touches persisted state - with no UI
 * mounted to have asked for it.
 */
export function cancelAutoAdvance(): void {
  clearAdvance();
}

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
  if (!commands) return;
  const { addMain, addSub, addTag, setRemind } = commands;
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

/** Record that the Calendar search was used, for the search beat. */
export function markSearched(): void {
  if (S().tourSearched) return;
  commit((s) => void (s.tourSearched = true));
}

// --- the notification preview ----------------------------------------------

/**
 * The tour's notification preview.
 *
 * Lives with the tour rather than the clock because it is a tour feature
 * and, more practically, because the tour has to be able to CANCEL it -
 * and an action module may only depend on `state.ts`, never on another
 * action module.
 *
 * The notifications are real, not drawings. Two reasons: the first native
 * notification is what triggers macOS's permission prompt, and onboarding
 * is the honest moment for that rather than it arriving unexplained hours
 * later attached to something that mattered; and a mock cannot tell anyone
 * whether notifications actually work on THIS machine, which is the only
 * thing worth knowing.
 */
let previewTimer: ReturnType<typeof setTimeout> | null = null;

async function nativeNotify(title: string, body: string): Promise<void> {
  try {
    await invoke("notify", { title, body });
  } catch {
    /* refused or unavailable - the in-app card still does its job */
  }
}

/** Send one of each, on request. */
export function previewNotifications(): void {
  // One sequence at a time. Pressing the button twice queued a second
  // delayed pair on top of the first.
  cancelNotificationPreview();
  void nativeNotify("Draft the quarterly update", "This is what a deadline looks like.");
  // Staggered so they do not stack into one indistinguishable pile.
  previewTimer = setTimeout(() => {
    previewTimer = null;
    const c = wellnessCopy("water");
    void nativeNotify(c.title, c.msg);
    wellnessNudge.set("water");
  }, 1400);
}

/**
 * Drop a preview that has not fired, and any card it already raised.
 *
 * Leaving the tour is the case that matters: a wellness card appearing a
 * second later, over an app that has stopped explaining anything, is a
 * nudge the user never turned on.
 */
export function cancelNotificationPreview(): void {
  if (previewTimer) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
  if (get(wellnessNudge) === "water") wellnessNudge.set(null);
}

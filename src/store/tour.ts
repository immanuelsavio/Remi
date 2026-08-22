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

import { demoHistory } from "../domain/demo";
import {
  PRACTICE_ID,
  replay,
  truncate,
  type BeatAddress,
  type Sandbox,
  type TourEvent,
} from "../domain/tour-sandbox";
import { clearTrayPreview, showTrayPreview } from "./tour-preview";
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
  type TourFacts,
  type TourStep,
} from "../domain/tour";
import type { DayRecord, State } from "../domain/types";
import {
  S,
  commit,
  dashTab,
  planTaskDraft,
  remindTarget,
  state,
  tourOverlay,
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
  /** Returns the id of the task it created - see `fill`. */
  addMain: (title: string) => string | null;
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

/**
 * THE TOUR SESSION - everything temporary, in one object, owned here.
 *
 * The tour used to read its own progress out of mutated application state:
 * whether a beat was done, whether the clock was running, whether the day
 * had ended. That is why Back could not undo anything (the state said the
 * beat was done, so it was), why revisiting Build One resumed at 3 of 4,
 * and why the End Day step - which ran the PRODUCTION `endDay()` over the
 * demo day - destroyed the restore checkpoint and left the tour walking
 * over tasks that no longer existed.
 *
 * Anything in here is:
 *
 *   - window-local: it never reaches `state.json`, a backup, an export,
 *     history, carry-forward or the other window;
 *   - fresh per run: `startTour` builds a new one, so a retake never
 *     inherits a finished search or a started clock;
 *   - cancellable: `endTour` clears it and everything it started.
 *
 * `runId` is the generation token. Every timer and promise that can outlive
 * a page captures it and checks it before acting, so a notification
 * resolving after the tour closed cannot touch the next run.
 */
export interface TourSession {
  runId: number;
  /**
   * WHAT THE USER DID, in order. The practice world is this replayed.
   *
   * Back truncates this to the destination beat and replays what is left,
   * which is why no page needs to know how to undo another page's work -
   * see `domain/tour-sandbox.ts`.
   */
  events: TourEvent[];
  /**
   * The instant this run began, used as `now` for every replay.
   *
   * Fixed per run so replaying the same log twice produces exactly the
   * same sandbox; the demo tasks' relative times would otherwise drift by
   * however long the render took.
   */
  bornAt: number;
  /** Bumped to force the search UI back to an empty query. */
  searchToken: number;
  /** The menu-bar panel was opened from the tour. */
  trayOpened: boolean;
  /** Where the notification preview got to, and what to say about it. */
  preview: "idle" | "asking" | "sending" | "sent" | "denied" | "failed";
  previewMsg: string;
  /** Was the tour already seen when this run STARTED? */
  retake: boolean;
}

let runSeq = 0;

function freshSession(retake: boolean): TourSession {
  return {
    runId: ++runSeq,
    events: [],
    bornAt: Date.now(),
    searchToken: 0,
    trayOpened: false,
    preview: "idle",
    previewMsg: "",
    retake,
  };
}

const session = writable<TourSession>(freshSession(false));

/** Read-only for the view. */
export const tourSession: Readable<TourSession> = { subscribe: session.subscribe };

/**
 * THE PRACTICE WORLD: the event log, replayed.
 *
 * Derived, so there is exactly one way for it to change - append an event,
 * or truncate the log - and no way for it to drift from what the user did.
 */
export const tourSandbox: Readable<Sandbox> = derived([session, state], ([t, s]) =>
  replay(t.events, t.bornAt, s.dateISO),
);

function sandboxNow(): Sandbox {
  return get(tourSandbox);
}

/** Where the tour is, as an address events can be filed under. */
function addressNow(): BeatAddress {
  const n = get(nav);
  if (n.step === null) return { step: -1, beat: 0 };
  const s = S();
  const sb = sandboxNow();
  const step = stepAt(n.step);
  const beats = step.beats ?? [];
  const ctx = {
    beats: beats.length,
    autoIdx: outstanding(step, s, sb),
    done: beats.map((b) => b.done(sb)),
    nextStep: nextShown(n.step, 1, s),
    prevStep: nextShown(n.step, -1, s),
  };
  return { step: n.step, beat: beatIndex(ctx, n) };
}

/**
 * Record something the user practised.
 *
 * The ONLY way the sandbox changes. Filed at the beat it happened on, so
 * Back can drop it by truncating rather than by knowing what it was.
 */
type EventBody = TourEvent extends infer E
  ? E extends BeatAddress
    ? Omit<E, "step" | "beat">
    : never
  : never;

function record(e: EventBody, at: BeatAddress = addressNow()): void {
  if (get(nav).step === null) return;
  session.update((t) => ({ ...t, events: [...t.events, { ...at, ...e } as TourEvent] }));
}

const nav = writable<NavState>(INACTIVE);

/**
 * Show the sandbox to the components, or stop showing it.
 *
 * `state.ts` cannot import this module (action modules depend on it, not
 * the reverse), so the practice world is published INTO a store there and
 * `app` reads it. Nothing about the real state changes either way - which
 * is the whole boundary in two lines.
 *
 * One derived subscription rather than two: `nav` and the sandbox both
 * decide what should be on screen, and separate subscriptions would let a
 * stale one of them win depending on which fired last.
 */
derived([nav, tourSandbox], ([n, sb]) =>
  n.step === null ? null : { mains: sb.mains, interruptions: sb.interruptions },
).subscribe((overlay) => tourOverlay.set(overlay));

/**
 * The finished days the tour SHOWS, without ever recording them.
 *
 * Calendar, Search and Stats all describe days that are over, and on a
 * fresh install there are none - so those steps pointed at an empty grid
 * and a search that could not find anything. Projected here and merged by
 * the views while the tour runs; `demoHistory` never touches `s.history`,
 * so nothing reaches an export, a backup, a streak or a report.
 *
 * Empty when no tour is running, which is what makes the merge a no-op the
 * rest of the time.
 */
export const tourHistory: Readable<DayRecord[]> = derived([nav, state], ([n, s]) =>
  n.step === null ? [] : demoHistory(Date.now(), s.dayNum),
);
/** The task this run is practising on - a view onto the sandbox. */
const practiceId: Readable<string | null> = derived(tourSandbox, (sb) => sb.practiceId);

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
function outstanding(step: TourStep | null, _s: State, sb: Sandbox): number {
  const beats = beatsOf(step) ?? [];
  const at = beats.findIndex((b) => !b.done(sb));
  return at < 0 ? beats.length : at;
}

/**
 * The practice task's id, or null if there isn't one yet.
 *
 * Nothing is inferred. It used to fall back to "the first task that is not
 * in the baseline this step started with" - a guess that an import, or a
 * task the popover added while the tour was open, could satisfy before the
 * task the user actually typed. A task becomes the practice task by being
 * CLAIMED (`claimPracticeTask`), which only ever happens for a task created
 * in this window while the tour is running.
 *
 * A claimed task that has since been deleted stops being the practice task:
 * a beat asking "add a step to it" must not point at something gone.
 */
export function effectivePracticeId(s: State, recorded: string | null): string | null {
  if (!recorded) return null;
  return s.mains.some((m) => m.id === recorded) ? recorded : null;
}

/**
 * The user typed a task themselves, in the Plan tab, during the tour.
 *
 * Recorded as an event like any other practice, which is what makes it
 * survive Back correctly and prevents a second one existing. There is no
 * "claim" any more: the log is the claim, and it cannot be confused with
 * an import or a task the other window added, because neither of those
 * goes through here.
 */
export function sandboxAddTask(title: string): void {
  const t = title.trim();
  if (!t) return;
  record({ kind: "task", title: t });
}

export function sandboxAddStep(mainId: string, title: string): void {
  const t = title.trim();
  if (!t || mainId !== sandboxNow().practiceId) return;
  record({ kind: "step", title: t });
}

export function sandboxAddTag(mainId: string, tag: string): void {
  const t = tag.trim();
  if (!t || mainId !== sandboxNow().practiceId) return;
  record({ kind: "tag", tag: t });
}

function contextFor(n: NavState, s: State, sb: Sandbox): NavContext {
  const step = n.step === null ? null : stepAt(n.step);
  const beats = beatsOf(step) ?? [];
  return {
    beats: beats.length,
    autoIdx: outstanding(step, s, sb),
    // The actual per-beat truth, not a contiguous prefix inferred from
    // `autoIdx`: beats can be completed out of order, and a beat wrongly
    // read as outstanding is carried out twice.
    done: beats.map((b) => b.done(sb)),
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
export const tourView = derived(
  [nav, state, session, paused, tourSandbox],
  ([n, s, run, isPaused, sb]) => {
    const step = n.step === null ? null : stepAt(n.step);
    const beats = beatsOf(step) ?? [];
    const ctx = contextFor(n, s, sb);
    const at = beatIndex(ctx, n);
    const done = beats.map((b) => b.done(sb));
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
      /**
       * Is there anywhere for Back to go?
       *
       * False on the first visible step with the cursor at its first beat -
       * where Back was rendered, enabled, and did nothing at all. A control
       * that silently does nothing teaches people their input is being
       * ignored.
       */
      canBack: n.step !== null && (at > 0 || ctx.prevStep !== null),
      /**
       * What to say when the checklist is finished.
       *
       * Per step. One hardcoded line used to congratulate you on building a
       * task after you had started a clock or ended a day.
       */
      finished: step?.finished ?? "",
      /** The tour's own runtime, for the handful of views that need it. */
      run,
      /** Is this the FIRST time through, as of when this run started? */
      firstRun: !run.retake,
      /** The practice world, for the views that draw it. */
      sandbox: sb,
    };
  },
);

// --- entering and leaving --------------------------------------------------

export function startTour(): void {
  // Mark it seen HERE, when it starts, not when it finishes.
  //
  // The demo is window-local and never persisted, so a quit or crash
  // mid-tour strands nothing that needs recovering - but it also leaves no
  // trace that the tour ran, and the dashboard starts the tour whenever
  // `tourSeen` is false. Without this, interrupting an onboarding would
  // silently restart it from page one on every launch until someone
  // happened to reach the end. Interrupting is a decision; Settings -> Help
  // is how to ask for it again.
  //
  // This is a real preference, not day state, so it persists normally even
  // though the day around it does not.
  // Captured BEFORE the flag is written: `firstRun` copy read
  // `!state.tourSeen`, which `startTour` had already set to true - so the
  // first-run wording never appeared on a first run.
  const retake = S().tourSeen === true;
  commit((s) => void (s.tourSeen = true));
  // A completely fresh runtime. A retake used to inherit the previous
  // run's finished search, and any clock or End Day rehearsal with it.
  session.set(freshSession(retake));
  const s = S();
  const first = 0;
  nav.set(enterStep(first, contextFor({ ...INACTIVE, step: first }, s, sandboxNow())));
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
/**
 * Close the tour, however it ended.
 *
 * Finishing, skipping, the close button and the dashboard closing all land
 * here - one way out, so nothing can survive an exit nobody thought about.
 *
 * There is no day to RESTORE any more, and that is the point of the
 * sandbox: the user's tasks were never replaced, so ending the tour is a
 * matter of dropping the practice world and cancelling whatever it started.
 * The old version had to put the real day back atomically, and every path
 * that forgot to (a crash, a close, a quit, midnight) left demo tasks
 * looking like the user's own.
 */
export function endTour(): void {
  clearAdvance();
  cancelNotificationPreview();
  closeTrayPreview();
  nav.set(INACTIVE);
  // Everything temporary goes at once, and the run id moves on - so a
  // timer or a promise still in flight from this run cannot act on the
  // next one, or on an app that is no longer being toured.
  session.set(freshSession(true));
  commit((s) => void (s.tourSeen = true));
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

/**
 * Enter a step.
 *
 * `back` means the user WALKED BACKWARDS into it, which is the case that
 * used to reopen a finished checklist at its last beat with nothing left
 * to do. Arriving backwards resets that step's practice completely, so it
 * begins at beat one, genuinely outstanding.
 */
function goTo(step: number, back = false): void {
  // Leaving the tray lesson at all - forwards, backwards, by any route -
  // takes its preview down with it. This is a native side effect, not
  // practice: there is nothing in the log to replay it back.
  if (
    get(nav).step !== null &&
    stepAt(get(nav).step!).id === "tray" &&
    stepAt(step).id !== "tray"
  ) {
    closeTrayPreview();
  }
  // Walking BACKWARDS into a page truncates the log to that page's first
  // beat, so it opens as a clean checklist. One rule, every page.
  if (back) rewindTo({ step, beat: 0 });
  const s = S();
  nav.set(enterStep(step, contextFor({ ...INACTIVE, step }, s, sandboxNow())));
  const tab = stepAt(step).tab;
  if (tab) dashTab.set(tab);
}

/**
 * BACK, in one operation, for every page and every beat.
 *
 * Truncate the log to the destination and let the sandbox be whatever
 * replaying the remainder produces. There is nothing to undo, because
 * nothing was ever done to the application - and no page knows about any
 * other page's work, which is what page-specific cleanup could never
 * manage: the permutation tests found `work → next ×4 → back` landing on
 * an End Day beat that was still done, because the clock page's cleanup
 * had never heard of the End Day flag.
 *
 * The search UI is asked to empty itself as well. That is presentation
 * living in a component, not practice, so replay cannot reach it.
 */
function rewindTo(at: BeatAddress): void {
  session.update((t) => {
    const kept = truncate(t.events, at);
    if (kept.length === t.events.length) return t;
    return { ...t, events: kept, searchToken: t.searchToken + 1 };
  });
}

function dispatch(type: "NEXT" | "BACK"): void {
  const n = get(nav);
  if (n.step === null) return;
  // ONE transition per event. A pending auto-advance is dropped first, so
  // a timer armed a moment ago cannot undo the Back that is happening now.
  clearAdvance();
  const s = S();
  const ctx = contextFor(n, s, sandboxNow());
  const { state: next, effect } = reduce(ctx, n, { type });
  nav.set(next);
  if (effect.do === "exit") return void endTour();
  if (effect.do === "goto") return void goTo(effect.step, effect.back === true);
  if (effect.do === "rewind") return void rewindTo({ step: n.step, beat: effect.toBeat });
  if (effect.do === "fill") {
    const beat = (beatsOf(stepAt(n.step)) ?? [])[effect.beat];
    if (beat?.fill) fill(beat.fill, { step: n.step, beat: effect.beat });
  }
}

// --- the tour's own clock --------------------------------------------------

/**
 * Start the TOUR clock on the practice task.
 *
 * Not `startTask`. The production clock stamps `activeMainId`/`startedAt`
 * into real state, checkpoints it to disk and banks it on the next
 * transition - all against a task that stops existing the moment the tour
 * ends. The tour needs the APPEARANCE of a running clock, which is a fact
 * about the tour, so it lives in the tour's runtime.
 */
export function startTourClock(): void {
  const sb = sandboxNow();
  if (!sb.practiceId) return;
  // Already running: pressing Start twice, or Start and then Next, is one
  // clock. Recording a second event would restart it.
  if (sb.clockTaskId && sb.clockStartedAt > 0) return;
  record({ kind: "clock", startedAt: Date.now() });
}

// --- the End Day rehearsal -------------------------------------------------

/**
 * Complete the tour's End Day, WITHOUT ending a day.
 *
 * The step demonstrates the real confirmation, and confirming it used to
 * call the production `endDay()` over the demo state: a new day replaced
 * the demo one, `demoRestore` was invalidated, sample tasks became a real
 * `resumable` day, `dayNum`/`awaitingStart`/carry/history all moved, and
 * the tour carried on walking over anchors that no longer existed. That is
 * the blank screen, the repeated Back pages, the leaked tour tasks and the
 * "Reopen day" after onboarding, all from one call.
 */
export function completeTourEndDay(): void {
  if (get(nav).step === null) return;
  if (sandboxNow().endDayDone) return; // confirming twice is one rehearsal
  record({ kind: "endday" });
}

/**
 * The menu-bar panel opened from the tour - a fact about this run, shown in
 * the tour card rather than a toast that would draw behind its own scrim.
 */
/**
 * Is a tour running?
 *
 * A store, because the controls the tour REHEARSES - the Start button, the
 * End Day confirmation - have to behave differently while it is, and they
 * are components. `tourIsActive()` is the same answer for callers that are
 * not.
 */
export const tourActive: Readable<boolean> = derived(nav, (n) => n.step !== null);

export function markTrayOpened(): void {
  if (get(nav).step === null) return;
  session.update((t) => (t.trayOpened ? t : { ...t, trayOpened: true }));
}

/**
 * Which "open the panel" request is the current one.
 *
 * `open_popover` crosses to the backend and comes back, and in that time
 * the user may have pressed Back, Next or Skip. A result arriving after
 * that must not raise a preview for a lesson nobody is on - so the stale
 * result closes the panel again instead.
 */
let trayOpenSeq = 0;

/**
 * The two window commands the tray lesson needs.
 *
 * Invoked here rather than through `store/ui-state.ts`: action modules may
 * depend on `state.ts` and infrastructure only, never on each other. These
 * are one IPC call apiece, which is infrastructure by any reading.
 */
async function openPopoverWindow(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await invoke("open_popover");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Couldn't open the menu-bar window: ${String(e)}` };
  }
}

async function closePopoverWindow(): Promise<void> {
  await invoke("close_popover").catch(() => {
    /* already closed, or no backend - either way it is not showing */
  });
}

/**
 * Open the menu-bar panel for the tray lesson, showing the practice task.
 *
 * The preview is presentation state passed as an event payload - see
 * `store/tour-preview.ts` - never shared state. Opening the REAL popover
 * mid-tour used to show whatever the popover genuinely had, which on a
 * first run is the "start my day" screen: a lesson about "your task, still
 * on the clock" pointing at a screen with neither.
 */
export async function openTrayPreview(): Promise<{ ok: true } | { ok: false; error: string }> {
  const runId = get(session).runId;
  const seq = ++trayOpenSeq;
  const sb = sandboxNow();
  const task = sb.practiceId ? sb.mains.find((m) => m.id === sb.practiceId) : null;

  const res = await openPopoverWindow();
  // Back/Next/Skip happened while that was in flight. Do not resurrect the
  // lesson: close what we just opened and say nothing.
  if (seq !== trayOpenSeq || get(session).runId !== runId || get(nav).step === null) {
    void closePopoverWindow();
    clearTrayPreview();
    return { ok: false, error: "" };
  }
  if (!res.ok) return res;

  // EXACTLY three things cross to the other window: which run raised it,
  // the practice task's real title, and the tour clock's absolute start.
  // No task object, no day, nothing that could be mistaken for state.
  showTrayPreview({
    runId,
    title: task?.title ?? "Your task",
    startedAt: sb.clockStartedAt,
  });
  markTrayOpened();
  return { ok: true };
}

/**
 * Leave the tray lesson: cancel anything in flight and take the panel down.
 *
 * Called on every way out of that step - Back, Next, Skip, and ending the
 * tour - so the preview cannot outlive the lesson it belongs to.
 */
export function closeTrayPreview(): void {
  trayOpenSeq++; // supersede an open that has not landed yet
  clearTrayPreview();
  void closePopoverWindow();
}

export function tourIsActive(): boolean {
  return get(nav).step !== null;
}

// --- search ----------------------------------------------------------------

/**
 * Forget that a search happened, and ask the search UI to empty itself.
 *
 * `tourSearched` used to live in persisted state, so it survived a retake
 * in the same process and the search step opened already finished. The
 * token is what makes Calendar's own query and tag selection reset without
 * depending on the component happening to be destroyed.
 */
function resetSearch(): void {
  session.update((t) => ({ ...t, searched: false, searchToken: t.searchToken + 1 }));
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
  const ctx = contextFor(n, S(), sandboxNow());
  if (!canAutoAdvance(ctx, n)) return;
  clearAdvance();
  const at = n.step;
  advanceTimer = setTimeout(() => {
    advanceTimer = null;
    const now = get(nav);
    if (now.step !== at || get(paused)) return;
    if (!canAutoAdvance(contextFor(now, S(), sandboxNow()), now)) return;
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
/**
 * Carry out a beat.
 *
 * Every one of these is an EVENT appended to the log. Nothing here touches
 * the application: the practice task, its step and its tag exist only in
 * the replayed sandbox, which is why ending the tour restores nothing -
 * there was never anything to restore.
 */
function fill(f: BeatFill, at: BeatAddress): void {
  switch (f.kind) {
    case "clock":
      return void startTourClock();
    case "endday":
      return void completeTourEndDay();
    case "task": {
      // THE TYPED TITLE WINS. Someone who has written "Prepare customer
      // notes" and pressed Next meant that, not the tour's example - and
      // waiting for the input's blur to commit it first would make the
      // outcome depend on click ordering. The draft is published as it is
      // typed (`planTaskDraft`), so this reads it rather than racing it.
      const typed = get(planTaskDraft).trim();
      if (sandboxNow().practiceId) return; // one practice task per run
      record({ kind: "task", title: typed || f.title }, at);
      if (typed) planTaskDraft.set(""); // it is a task now, not a draft
      return;
    }
    case "step":
      if (!sandboxNow().practiceId) return;
      record({ kind: "step", title: f.title }, at);
      return;
    case "tag":
      if (!sandboxNow().practiceId) return;
      record({ kind: "tag", tag: f.tag }, at);
      return;
    case "remind":
      // The reminder beat is gone from the script; nothing to do if a
      // future step brings it back as practice.
      return;
  }
}

/**
 * Record that the Calendar search was used, for the search beat.
 *
 * An event like any other, so walking back past the search step drops it
 * with everything else. It used to be written to `state.json`, where it
 * survived not just Back but the whole tour and the next launch.
 */
export function markSearched(): void {
  if (get(nav).step === null) return;
  if (sandboxNow().searched) return;
  record({ kind: "search" });
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

/** How long between the two previews, so they do not stack into one pile. */
const PREVIEW_GAP_MS = 1400;

/**
 * Which press of the button this is.
 *
 * TWO tokens are needed, because there are two ways for work to become
 * stale. `runId` catches a promise that outlives the whole tour; this
 * catches a second press within the same run - three presses meant three
 * chains each awaiting their own permission call and each arming their own
 * delayed notification, and clearing "the" pending timer only ever cleared
 * the most recent one.
 */
let previewSeq = 0;

/** Is this promise/timer still the work anyone is waiting for? */
function stillCurrent(runId: number, seq: number): boolean {
  const t = get(session);
  return t.runId === runId && seq === previewSeq && get(nav).step !== null;
}

function setPreview(runId: number, seq: number, preview: TourSession["preview"], msg = ""): void {
  if (!stillCurrent(runId, seq)) return;
  session.update((t) => ({ ...t, preview, previewMsg: msg }));
}

/**
 * Send the two preview notifications, in order, reporting what happened.
 *
 * The old version invoked `notify` and swallowed every error, then raised
 * the ordinary in-app wellness card - which appeared BEHIND the tour's own
 * scrim, blurred, while the button that raised it claimed success. On a
 * machine that had never granted permission (every first run) nothing
 * arrived and nothing said why.
 *
 * Now: permission is asked for once by the backend, the two notifications
 * are sent SEQUENTIALLY, and the outcome - sent, denied, or a real error -
 * is reported in the tour card itself, unblurred, where the button is.
 */
export function previewNotifications(): void {
  const runId = get(session).runId;
  // One sequence at a time. Pressing the button twice queued a second
  // delayed pair on top of the first. `cancelNotificationPreview` bumps the
  // sequence, so every chain already in flight stops where it is.
  cancelNotificationPreview();
  const seq = ++previewSeq;
  setPreview(runId, seq, "asking");

  void (async () => {
    try {
      await invoke("notify", {
        title: "Draft the quarterly update",
        body: "This is what a deadline looks like.",
      });
    } catch (e) {
      // A denial is a fact about the machine, not a failure to hide: the
      // card says so, and the tour carries on.
      const msg = String(e);
      setPreview(runId, seq, /permission|turned off/i.test(msg) ? "denied" : "failed", msg);
      return;
    }
    if (!stillCurrent(runId, seq)) return; // the page (or the tour) has moved on
    setPreview(runId, seq, "sending");

    previewTimer = setTimeout(() => {
      previewTimer = null;
      if (!stillCurrent(runId, seq)) return;
      const c = wellnessCopy("water");
      void invoke("notify", { title: c.title, body: c.msg })
        .then(() => setPreview(runId, seq, "sent"))
        .catch((e) => setPreview(runId, seq, "failed", String(e)));
    }, PREVIEW_GAP_MS);
  })();
}

/**
 * Drop a preview that has not fired.
 *
 * Leaving the page or the tour is the case that matters: a notification
 * arriving a second later, from an app that has stopped explaining
 * anything, is a nudge the user never turned on. The run id does the rest -
 * a permission promise that resolves after this cannot report into the
 * next run.
 */
export function cancelNotificationPreview(): void {
  // Supersede every chain in flight, not merely the timer one of them
  // happened to have armed.
  previewSeq++;
  if (previewTimer) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
  // The tour's preview never raises the app's own wellness card again: it
  // rendered behind the tour scrim, blurred, which read as a bug. Clear one
  // that a previous version may have left up.
  if (get(wellnessNudge) === "water") wellnessNudge.set(null);
  session.update((t) => (t.preview === "idle" ? t : { ...t, preview: "idle", previewMsg: "" }));
}

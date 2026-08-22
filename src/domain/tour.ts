/**
 * The guided tour: what Remi does, in the order you'd meet it.
 *
 * Pure data. Keeping the script out of the component means the wording can
 * be reviewed and tested without rendering anything, and the tour can be
 * reordered by moving array entries rather than untangling markup.
 *
 * Each step names the tab it is talking about, and the tour switches there
 * as you go - a tour that describes a screen you cannot see is a wall of
 * text with extra clicks.
 */

import type { Costume, DashTab, State } from "./types";

/**
 * A step that ASKS rather than tells.
 *
 * ONE control per step, on purpose. These used to be three fat pages - a
 * page that asked for both names AND the outfit, and a page carrying four
 * switches AND five wellness nudges - which meant scrolling past the mouse
 * to reach the bottom of a form. For the people this app is built for, a
 * page holding four decisions is four decisions to hold at once. More
 * pages with less on each is the cheaper trade: Next is one keypress, and
 * re-reading a short page costs nothing.
 *
 * Every one writes a real setting and shows the CURRENT value, so on a
 * retake the tour is a way to change your mind, not a form that resets you.
 */
export type TourAsk =
  "look" | "nick" | "fullname" | "mascot" | "mouse" | "tray" | "notify" | "prefs" | "wellness";

/**
 * One thing to actually DO, and how to tell it was done.
 *
 * A step with beats stops being a caption and becomes a checklist that
 * reads the app: the bubble shows ONE instruction, and swaps to the next
 * the moment the state says that one has happened. Telling somebody "add a
 * task, then a step, then a tag, then a deadline" in a single paragraph is
 * four things to hold at once; showing the second only after the first has
 * landed is one thing at a time, and it proves the app did what they
 * expected as they go.
 *
 * `done` is a pure read of state, so beats need no events, no wiring into
 * the components they describe, and cannot get out of sync with what is
 * really there. Nothing is compulsory - Next always moves on.
 */
/** What "do it for me" means on a beat, as a command rather than a keystroke. */
export type BeatFill =
  | { kind: "task"; title: string }
  | { kind: "step"; title: string }
  | { kind: "tag"; tag: string }
  | { kind: "remind"; inMinutes: number }
  /** Start the TOUR clock on the practice task. Nothing real runs. */
  | { kind: "clock" }
  /** Complete the tour's End Day rehearsal. No real day ends. */
  | { kind: "endday" };

/**
 * What the tour KNOWS that the app does not.
 *
 * A beat used to be a pure read of `State`, which works while every beat is
 * "did a task get a tag" - and breaks the moment a beat is about something
 * the tour is only pretending to do. The clock the tour starts must not run
 * the production clock over demo tasks; ending the day must not end the
 * day. Those facts live in the tour's own runtime (`store/tour.ts`), and
 * arrive here rather than being smuggled into persisted state.
 */
export interface TourFacts {
  /** The tour-only clock is running on the practice task. */
  clockRunning: boolean;
  /** The tour's End Day confirmation was completed - no real day ended. */
  endDayDone: boolean;
  /** A search was run during THIS tour run. */
  searched: boolean;
}

export const NO_FACTS: TourFacts = {
  clockRunning: false,
  endDayDone: false,
  searched: false,
};

export interface TourBeat {
  id: string;
  /** The single instruction, shown while this beat is the current one. */
  text: string;
  /** Shown once it is done, so finishing a beat is visibly acknowledged. */
  cheer: string;
  /**
   * Is it done? Reads the practice task BY ID.
   *
   * It used to be "the first task that is not a demo one", which is a guess
   * dressed as an identity: a second task, an import, or an edit from the
   * other window could all make a later beat inspect - and Next then
   * modify - something the user never meant to practise on.
   */
  done: (s: State, practiceId: string | null, facts: TourFacts) => boolean;
  /** Walk to a different element for this beat than the step's own. */
  anchor?: string;
  /**
   * What Next does for someone who would rather watch than type.
   *
   * A COMMAND, not an impersonation. This used to set an input's `.value`,
   * dispatch a synthetic input event and rely on blur to save - so the
   * tour only worked as long as every component it touched kept saving on
   * blur, and any change to one of them broke it silently. It goes through
   * the same store actions a person's typing goes through.
   */
  fill?: BeatFill;
}

/**
 * The one task the tour is practising on, by id.
 *
 * `null` until the user (or Next) makes it. Beats read THIS rather than
 * "the first non-demo task": the demo tasks already have steps, tags and
 * titles, so a beat that merely looked past them would also happily latch
 * onto a second task, an import, or something the other window added.
 */
export function practiceTask(s: State, practiceId: string | null) {
  if (!practiceId) return null;
  return s.mains.find((m) => m.id === practiceId) ?? null;
}

export interface TourStep {
  /** Stable id, so a step can be linked to or resumed by name. */
  id: string;
  title: string;
  /** Paragraphs. Kept short - this is a tour, not a manual. */
  body: string[];
  /** Switch the dashboard here while this step is showing. */
  tab?: DashTab;
  /** Rendered as a small aside, for the "why" behind a feature. */
  aside?: string;
  /**
   * What to say when this step's checklist is finished.
   *
   * It used to be one hardcoded line in the component - "That is a whole
   * task. Everything else is a variation on it." - shown whenever ANY
   * checklist completed, so starting a clock and ending a day both
   * congratulated you on building a task.
   */
  finished?: string;
  /** Show a control here instead of only prose. */
  ask?: TourAsk;
  /**
   * The `data-tour` value of the element this step is ABOUT.
   *
   * Set it and the tour walks Remi over to that element and speaks from a
   * bubble beside it; leave it off and the step is a centred card. The two
   * kinds are not a style choice: a card has room for a form, and a bubble
   * has an arrow pointing at something. Steps that ASK get cards for that
   * reason, and the walkthrough steps get bubbles.
   *
   * A missing anchor is not an error - if the element is not on screen
   * (wrong tab, still rendering, a list that happens to be empty) the step
   * falls back to a centred card, so the tour can never strand itself
   * pointing at nothing.
   */
  anchor?: string;
  /**
   * Drop this step entirely when the state makes it meaningless.
   *
   * Turning the mouse off should not then be followed by two pages asking
   * what it wears and whether it may wander the window. Disabling those
   * controls was the first answer and it is the wrong one: a greyed-out
   * question is still a question you have to read, decide is not for you,
   * and dismiss. Skipping is the honest version - the pages are simply not
   * part of your tour.
   *
   * The predicate runs on every navigation, so a step can appear again if
   * you change your mind and go back.
   */
  skipWhen?: (s: State) => boolean;
  /** Things to do on this step, revealed one at a time as each is done. */
  beats?: TourBeat[];
  /**
   * What Remi wears on this page, and how it is standing.
   *
   * Omit the costume and it falls through to whatever the user picked in
   * Settings - which is deliberate on the "look" step, where they are
   * choosing one and should see it on the mouse as they do.
   */
  costume?: Costume;
  pose?: "idle" | "ready" | "run" | "desk" | "cheer";
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    costume: "guide",
    pose: "ready",
    // Starting the tour from Settings used to leave Settings on screen
    // behind it, so the first thing said - "these tasks are a sample" -
    // pointed at a preferences panel. Land on the demo day.
    tab: "today",
    title: "Welcome to Remi",
    // One line. A paragraph to read before anything has started is a toll
    // on the person least able to pay it, and the sample-day aside said
    // nothing they could not discover by touching the sample day.
    body: ["See where time goes."],
  },
  {
    id: "look",
    // Second, because it changes how every page after it looks. Asking at
    // the end means reading the whole tour in a theme you did not choose.
    //
    // Stays on the demo day rather than jumping to Settings: the ask pages
    // are centred cards, so the tab behind one is only scenery, and five
    // pages of today->settings->today flapping is motion for nothing.
    pose: "idle",
    tab: "today",
    title: "Light or dark?",
    ask: "look",
    body: ["And a colour, if you have a preference."],
  },
  {
    id: "nickname",
    costume: "guide",
    pose: "ready",
    tab: "today",
    title: "What should I call you?",
    ask: "nick",
    body: ["Leave it empty and nothing anywhere says a name."],
  },
  {
    id: "fullname",
    costume: "guide",
    pose: "idle",
    tab: "today",
    title: "And your full name?",
    ask: "fullname",
    body: ["This one goes on exported reports, which someone else reads."],
  },
  {
    id: "mascot",
    // No costume of its own from here on: these pages are ABOUT the mouse,
    // so it wears whatever is currently picked. Forcing one made the
    // picker on the next page look broken.
    pose: "ready",
    tab: "today",
    title: "Should I be here at all?",
    ask: "mascot",
    body: ["I run while your clock runs, and sleep through your breaks."],
  },
  {
    id: "mouse",
    pose: "idle",
    tab: "today",
    title: "How should I look?",
    ask: "mouse",
    // Nothing to dress, and nowhere to wander, without a mouse.
    skipWhen: (s) => !s.mascotOn,
    body: ["An outfit, and whether I may wander the window."],
  },
  {
    id: "plan",
    anchor: "plan-add",
    costume: "planner",
    pose: "idle",
    tab: "plan",
    title: "Build one, properly",
    // NOT "keep it if you like it". The practice task is made inside the
    // sample day and goes when the real one comes back, so that was a
    // promise the tour could not keep.
    body: ["Three small things, one at a time. Practice only - this all disappears after."],
    finished: "Task ready.",
    // Reading about steps and tags teaches nobody. Making one task carry
    // all four is ninety seconds and it sticks.
    beats: [
      {
        id: "task",
        text: "Type a task in the box below and press Enter.",
        cheer: "That's a task.",
        fill: { kind: "task", title: "Task 1" },
        done: (s, id) => !!practiceTask(s, id),
      },
      {
        id: "step",
        // The "add steps" link and the box it opens answer to the same
        // name, so this points at the real way in either way. The ⋔ toggle
        // this used to name is the TODAY tab's control, not this one.
        anchor: "plan-substep",
        text: "Add a step under it - the ＋ add steps link.",
        cheer: "Steps go one level deep, on purpose.",
        fill: { kind: "step", title: "First step" },
        done: (s, id) => (practiceTask(s, id)?.subs.length ?? 0) > 0,
      },
      {
        id: "tag",
        anchor: "plan-tag",
        text: "Last one: give it a tag - a project, or a kind of work.",
        cheer: "Tags are what let you pull a report for one client later.",
        fill: { kind: "tag", tag: "example" },
        done: (s, id) => (practiceTask(s, id)?.tags.length ?? 0) > 0,
      },
    ],
  },
  {
    id: "work",
    // The whole practice CARD, not the Start button. Every task row
    // registers a `today-start`, so the registry pointed at whichever
    // mounted last - the tour rang a button belonging to a sample task.
    anchor: "today-practice",
    costume: "timekeeper",
    pose: "run",
    tab: "today",
    title: "The clock",
    body: ["Start runs it. Interrupt records what pulled you away, and charges it the time."],
    aside: "That record is why a two-hour task can eat a whole day.",
    finished: "Clock started.",
    beats: [
      {
        id: "start",
        anchor: "today-practice",
        text: "Press Start on your task to put it on the clock.",
        cheer: "It is on the clock - the card lights up while it runs.",
        // A TOUR clock, not the production one: running the real session
        // machinery over a demo task would bank practice time onto a task
        // that is about to stop existing.
        fill: { kind: "clock" },
        done: (_s, _id, facts) => facts.clockRunning,
      },
    ],
  },
  {
    id: "tray",
    costume: "timekeeper",
    pose: "idle",
    tab: "today",
    title: "The other half",
    ask: "tray",
    body: ["Remi lives in your menu bar. Same day, one click, no window in the way."],
    aside: "The clock keeps running there whether this window is open or not.",
  },
  {
    id: "endday",
    anchor: "today-endday",
    costume: "worker",
    pose: "idle",
    tab: "today",
    title: "Ending a day",
    body: ["Unfinished tasks carry over with their notes. Only the clock resets."],
    finished: "Day ended.",
    beats: [
      {
        id: "endday",
        anchor: "today-endday",
        text: "Press Wrap up the day, then confirm it.",
        cheer: "Tomorrow starts with what you did not finish, notes and all.",
        // REHEARSED. Confirming here used to call the production `endDay()`
        // against the demo state: it replaced the demo day, invalidated the
        // restore checkpoint, made a real `resumable` day out of sample
        // tasks, and left the tour pointing at anchors that no longer
        // existed - the blank screens and the "Reopen day" after onboarding.
        fill: { kind: "endday" },
        done: (_s, _id, facts) => facts.endDayDone,
      },
    ],
  },
  {
    id: "calendar",
    anchor: "cal-grid",
    costume: "detective",
    pose: "idle",
    tab: "calendar",
    title: "History",
    body: ["Every day you have finished. Green done; orange left something open."],
  },
  {
    id: "search",
    anchor: "cal-search",
    costume: "detective",
    pose: "idle",
    tab: "calendar",
    title: "Finding it again",
    body: ["The tag you set is the fastest way back to work you have already done."],
    finished: "Found it.",
    beats: [
      {
        id: "tagsearch",
        text: "Press one of the tag chips, or type a word you used.",
        cheer: "That is every day that touched it, with the time it took.",
        // From the RUN, not from persisted state: `tourSearched` survived a
        // retake in the same process, so the search step opened already
        // finished for anyone taking the tour a second time.
        done: (_s, _id, facts) => facts.searched,
      },
    ],
  },
  {
    id: "evidence",
    anchor: "stats-given",
    costume: "artist",
    pose: "desk",
    tab: "stats",
    title: "The evidence",
    body: ["What interrupts you, what it costs, and a report you can hand to someone."],
  },
  {
    id: "wellness",
    pose: "idle",
    tab: "settings",
    title: "Looking after yourself",
    ask: "wellness",
    body: ["Optional, one at a time, and never during a break."],
  },
  {
    id: "notifications",
    costume: "timekeeper",
    pose: "ready",
    tab: "settings",
    title: "What a nudge looks like",
    ask: "notify",
    body: ["Send yourself one now, so the first real one is not a surprise."],
    aside: "macOS will ask permission the first time. Deny it and Remi just nudges in-app.",
  },
  {
    id: "settings",
    costume: "guide",
    pose: "cheer",
    tab: "settings",
    title: "Last few",
    ask: "prefs",
    body: ["All of this lives in Settings too, so nothing is locked in."],
  },
];

/** Is this step part of the tour, given what has been chosen so far? */
export function stepShown(step: TourStep, s: State): boolean {
  return !step.skipWhen?.(s);
}

/**
 * The next/previous step that is actually shown, or null at either end.
 *
 * Navigation walks over hidden steps rather than landing on them, so a
 * skipped page never flashes up for the frame it takes to skip it again.
 */
export function nextShown(from: number, dir: 1 | -1, s: State): number | null {
  for (let i = from + dir; i >= 0 && i < TOUR_STEPS.length; i += dir) {
    if (stepShown(TOUR_STEPS[i], s)) return i;
  }
  return null;
}

/**
 * Where this step sits in the tour the user is actually being given.
 *
 * "Step 5 of 14" when two of the fourteen were skipped is a lie, and a
 * progress bar that never reaches the end is worse than none.
 */
export function tourProgress(i: number, s: State): { pos: number; total: number } {
  let pos = 0;
  let total = 0;
  TOUR_STEPS.forEach((step, at) => {
    if (!stepShown(step, s)) return;
    total++;
    if (at <= i) pos = total;
  });
  return { pos: Math.max(1, pos), total: Math.max(1, total) };
}

/**
 * ===== CHECKLIST NAVIGATION =====
 *
 * Pure, because it is what kept breaking. Two drivers, and exactly one of
 * them is in charge at a time:
 *
 *   AUTO (`cursor === null`) - the bubble follows whatever is still
 *   outstanding, and finishing the list turns the page by itself.
 *
 *   MANUAL (`cursor` set) - from the moment Back or Next is pressed. The
 *   person is driving: nothing re-syncs the bubble and the page never turns
 *   on its own. Pressing Next past the last beat is the only way onward.
 *
 * Mixing the two is the bug this exists to make impossible: an automatic
 * advance firing on top of a deliberate Back, turning the page out from
 * under someone who had just gone back a beat.
 */

/** Which beat is on screen. `total` means "past the end - all done". */
export function beatIndexFor(total: number, cursor: number | null, autoIdx: number): number {
  return Math.max(0, Math.min(total, cursor ?? autoIdx));
}

/** Keep a manual cursor inside the checklist (its end included). */
export function clampCursor(total: number, at: number): number {
  return Math.max(0, Math.min(total, at));
}

/**
 * Should finishing the list turn the page on its own?
 *
 * Three conditions, and the third is the one that is easy to miss.
 *
 *   - the list is finished
 *   - the tour is still driving (`cursor === null`) - once someone has
 *     taken the wheel, the page waits for them
 *   - the list was UNFINISHED when this step was entered (`armed`)
 *
 * Without the last one, pressing Back onto a step whose checklist is
 * already complete re-arms the advance and throws you forward again a
 * moment later - so Back looks broken when it worked perfectly. Turning
 * the page is a reward for finishing something HERE, not a fact about the
 * state of the world when you arrive.
 */
export function shouldAutoAdvance(
  total: number,
  autoIdx: number,
  cursor: number | null,
  armed: boolean,
): boolean {
  return armed && total > 0 && autoIdx >= total && cursor === null;
}

/** Clamp an index to a real step. */
export function stepAt(i: number): TourStep {
  const clamped = Math.max(0, Math.min(TOUR_STEPS.length - 1, Math.floor(i) || 0));
  return TOUR_STEPS[clamped];
}

export const TOUR_LENGTH = TOUR_STEPS.length;

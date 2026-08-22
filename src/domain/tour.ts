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
export type TourAsk = "look" | "nick" | "fullname" | "mascot" | "mouse" | "prefs" | "wellness";

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
    body: [
      "I track where your day actually goes - the time you lose, not just the time you spend.",
    ],
    aside: "The tasks behind me are a sample. Poke at them; your own day comes back untouched.",
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
    title: "Tasks and steps",
    body: ["Steps go one level deep. Tags group tasks for a report later."],
    aside: "Try it: add a task below, press Enter, then add a step under it.",
  },
  {
    id: "work",
    anchor: "today-start",
    costume: "timekeeper",
    pose: "run",
    tab: "today",
    title: "The clock",
    body: ["Start runs it. Interrupt records what pulled you away, and charges it the time."],
    aside: "That record is why a two-hour task can eat a whole day.",
  },
  {
    id: "endday",
    anchor: "today-endday",
    costume: "worker",
    pose: "idle",
    tab: "today",
    title: "Ending a day",
    body: ["Unfinished tasks carry over with their notes. Only the clock resets."],
  },
  {
    id: "calendar",
    anchor: "cal-grid",
    costume: "detective",
    pose: "idle",
    tab: "calendar",
    title: "History",
    body: ["Every day, searchable. Green finished; orange left something open."],
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

/** Clamp an index to a real step. */
export function stepAt(i: number): TourStep {
  const clamped = Math.max(0, Math.min(TOUR_STEPS.length - 1, Math.floor(i) || 0));
  return TOUR_STEPS[clamped];
}

export const TOUR_LENGTH = TOUR_STEPS.length;

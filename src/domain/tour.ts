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

import type { Costume, DashTab } from "./types";

/**
 * A step that ASKS rather than tells.
 *
 * "name" collects what to call the user; "prefs" is the on/off switches.
 * Both write real settings, so both show the CURRENT value: on a retake the
 * tour is a way to change your mind, not a form that resets you.
 */
export type TourAsk = "name" | "look" | "prefs";

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
    // behind it, so the first thing said - "the tasks you can see are a
    // sample" - pointed at a preferences panel. Land on the demo day.
    tab: "today",
    title: "Welcome to Remi",
    ask: "name",
    body: [
      "Remi tracks where your day actually goes: not just what you worked on, but how long it really took and what kept getting in the way.",
      "The tasks you can see are a sample, put there so you have something real to poke at. They disappear when the tour ends and your own day comes back untouched.",
    ],
    aside: "Two minutes. Close it whenever you like and pick it up again from Settings.",
  },
  {
    id: "plan",
    costume: "planner",
    pose: "idle",
    title: "Tasks, steps and tags",
    tab: "plan",
    body: [
      "A task can hold steps, one level deep on purpose - deeper nesting turns planning into procrastination. If a step turns out to be the real work, promote it with the arrow and it keeps the time it already earned.",
      "Tags label a task by project or kind. They are what let you pull a report for one client or one sort of work later.",
    ],
    aside: "Try it: add a task below, press Enter, then add a step under it.",
  },
  {
    id: "work",
    costume: "timekeeper",
    pose: "run",
    title: "Working, and being interrupted",
    tab: "today",
    body: [
      "Press Start and the clock runs, in the window and in your menu bar. When something pulls you away, press Interrupt rather than just switching: Remi saves your place, records what took you, and charges the time to the task that lost it.",
      "Breaks pause the clock properly. Remi goes to sleep while you are gone.",
    ],
    aside:
      "That interruption record is the thing other trackers do not keep, and the reason a two-hour task can eat a whole day.",
  },
  {
    id: "endday",
    costume: "worker",
    pose: "idle",
    title: "Ending a day",
    tab: "today",
    body: [
      "Wrap up when you are done. Anything unfinished carries to tomorrow with its notes, steps and reminders intact; only the clock resets.",
      "You can decide task by task instead, and you can reopen a day you ended by mistake.",
    ],
  },
  {
    id: "calendar",
    costume: "detective",
    pose: "idle",
    title: "History, search and time off",
    tab: "calendar",
    body: [
      "Every finished day is here, searchable by title or tag. Green finished, orange left something open.",
      "Add time off from the button above the calendar. Days off bridge a streak rather than breaking it, so a holiday never costs you one.",
    ],
  },
  {
    id: "evidence",
    costume: "artist",
    pose: "desk",
    title: "The evidence, and the report",
    tab: "stats",
    body: [
      "What interrupts you most, how much time it costs, and which tasks ran longest past their focused time.",
      "When someone needs to see the work rather than take your word for it, Data gives you a printable record for any date range or tag.",
    ],
  },
  {
    id: "look",
    pose: "idle",
    title: "How it should look",
    ask: "look",
    tab: "settings",
    body: ["Light or dark, an accent colour, and whether Remi appears at all."],
  },
  {
    id: "settings",
    costume: "guide",
    pose: "cheer",
    title: "A few switches",
    ask: "prefs",
    tab: "settings",
    body: [
      "The ones worth deciding now. Everything here lives in Settings too, so nothing is locked in.",
    ],
    aside:
      "Retaking the tour shows whatever you have set, so it is a way to change your mind rather than start over.",
  },
];

/** Clamp an index to a real step. */
export function stepAt(i: number): TourStep {
  const clamped = Math.max(0, Math.min(TOUR_STEPS.length - 1, Math.floor(i) || 0));
  return TOUR_STEPS[clamped];
}

export const TOUR_LENGTH = TOUR_STEPS.length;

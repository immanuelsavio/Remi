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

import type { DashTab } from "./types";

/**
 * A step that ASKS rather than tells.
 *
 * "name" collects what to call the user; "prefs" is the on/off switches.
 * Both write real settings, so both show the CURRENT value: on a retake the
 * tour is a way to change your mind, not a form that resets you.
 */
export type TourAsk = "name" | "prefs";

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
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Remi",
    body: [
      "Remi tracks where your day actually goes - not just what you worked on, but how long it really took and what kept getting in the way.",
      "This takes about a minute. You can close it any time and pick it up again from Settings.",
    ],
  },
  {
    id: "your-name",
    title: "What should Remi call you?",
    ask: "name",
    body: [
      "Remi will use this in a few greetings. Skip it and nothing anywhere says a name - the app just talks to you without one.",
    ],
    aside: "You can change or clear this any time in Settings.",
  },
  {
    id: "menubar",
    title: "It lives in your menu bar",
    body: [
      "Look up, not at your Dock - Remi has no Dock icon. The mark near your clock opens a small popover, which is where you work the day.",
      "This bigger window is for planning it and looking at the evidence afterwards.",
    ],
    aside: "The popover floats above everything, including other apps in fullscreen.",
  },
  {
    id: "plan-task",
    title: "Add a task",
    tab: "plan",
    body: [
      "Type a task and press Enter. The box stays focused, so you can list a whole day without touching the mouse.",
      "There's always an empty row at the bottom waiting for the next one.",
    ],
  },
  {
    id: "plan-steps",
    title: "Break it into steps",
    tab: "plan",
    body: [
      "Under any task, “＋ add steps” opens an indented list. Steps are one level deep on purpose - deeper nesting turns into planning instead of doing.",
      "If a step turns out to be the real work, you can promote it into a task of its own later, and it keeps the time it already earned.",
    ],
  },
  {
    id: "plan-tags",
    title: "Tag by project or type",
    tab: "plan",
    body: [
      "Tags sit under each task. Use them for a client, a project, or a kind of work like “coding”.",
      "Later you can filter a report to one tag, or search everything you've ever finished with it.",
    ],
    aside:
      "Tags are case-folded, so “Coding” and “coding” stay one tag rather than two that never match.",
  },
  {
    id: "today-start",
    title: "Start the clock",
    tab: "today",
    body: [
      "Press Start on a task and Remi begins timing it. The elapsed time can show next to the menu-bar icon, so you can see it without clicking anything.",
      "That's the point: time blindness is easier to fight when the number is just there.",
    ],
  },
  {
    id: "interrupt",
    title: "When something pulls you away",
    tab: "today",
    body: [
      "Press “Something came up” and pick what you moved to. Remi saves your place and brings you back afterwards.",
      "It also records what interrupted you, for how long, and which task paid for it.",
    ],
    aside:
      "This is the number most trackers miss: a two-hour task can occupy five hours of your day.",
  },
  {
    id: "break",
    title: "Take a break properly",
    tab: "today",
    body: [
      "The ☕ button pauses the clock and starts a break timer. Breaks are a quiet corner, not another thing to manage.",
      "Optional wellness nudges - water, stand up, lunch - are off by default and never touch your task clock.",
    ],
  },
  {
    id: "endday",
    title: "Wrap up the day",
    tab: "today",
    body: [
      "Ending the day archives it and carries anything unfinished to tomorrow.",
      "“Decide per task” lets you send each one to Tomorrow, the Backlog, or mark it Done. Changed your mind? Reopen the day and everything comes back.",
    ],
  },
  {
    id: "calendar",
    title: "Look back, and search",
    tab: "calendar",
    body: [
      "Green means the day finished clean, orange means something was left open. Today shows up live, not only after you end it.",
      "The search box finds anything you've ever finished, by title or tag.",
    ],
  },
  {
    id: "stats",
    title: "The evidence",
    tab: "stats",
    body: [
      "Time given back against your target day, your streak, and how your estimates compare with reality.",
      "The interruptions section shows what interrupts you most and which tasks lost the most time to it.",
    ],
    aside: "Weekends and days off bridge a streak - they never break it.",
  },
  {
    id: "report",
    title: "Export a work record",
    tab: "data",
    body: [
      "A printable record of what you finished - pick a date range, filter to a tag, and choose whether to include the interruption detail.",
      "It opens in your browser, where Print → Save as PDF gives you a file to keep or send.",
    ],
    aside:
      "Leave interruptions off if the record is going to someone who doesn't need that detail.",
  },
  {
    id: "data",
    title: "Your data is yours",
    tab: "data",
    body: [
      "Everything is a plain JSON file on this machine. Back it up, restore it, or open the folder and read it.",
      "Nothing is uploaded. If something's broken, the feedback box travels with your logs when you export them.",
    ],
  },
  {
    id: "your-prefs",
    title: "A few switches",
    ask: "prefs",
    tab: "settings",
    body: [
      "These are the ones worth deciding up front. Everything here is in Settings too, so nothing is locked in.",
    ],
    aside:
      "Retaking the tour shows whatever you have now, so you can change your mind rather than start over.",
  },
  {
    id: "settings",
    title: "Make it yours",
    tab: "settings",
    body: [
      "Light or dark, seven accent colours, how often Remi checks in, your workday length, and daily routines.",
      "The tour lives here too - “Take the tour again” is at the top whenever you want it.",
    ],
  },
];

/** Clamp an index to a real step. */
export function stepAt(i: number): TourStep {
  const clamped = Math.max(0, Math.min(TOUR_STEPS.length - 1, Math.floor(i) || 0));
  return TOUR_STEPS[clamped];
}

export const TOUR_LENGTH = TOUR_STEPS.length;

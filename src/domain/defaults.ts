/** Constructors: how a fresh Main/Sub/State/Wellness comes into being. */

import { nid } from "./ids";
import { DEFAULT_NAME } from "./name";
import { todayISO } from "./dates";
import { ACCENTS, DEFAULT_TARGET_MINS } from "./types";
import type { CarrySnapshot, Main, State, Sub, Wellness } from "./types";

export function mkSub(title: string): Sub {
  return { id: nid(), title, accrued: 0, done: false, remind: null, note: "" };
}

export function mkMain(title: string, subs: Sub[] = []): Main {
  return {
    id: nid(),
    title,
    subs,
    accrued: 0,
    done: false,
    fromSub: false,
    deferred: false,
    _showSubs: false,
    remind: null,
    note: "",
    carries: 0,
    estMs: 0,
    tags: [],
    firstStartedAt: 0,
    completedAt: 0,
    interruptedCount: 0,
    interruptedMs: 0,
  };
}

export function freshWellness(): Wellness {
  return {
    water: { on: false, everyMin: 60, _last: 0 },
    stand: { on: false, everyMin: 45, _last: 0 },
    walk: { on: false, everyMin: 120, _last: 0 },
    lunch: { on: false, atHour: 13, _last: 0 },
    breakr: { on: false, everyMin: 90, _last: 0 },
  };
}

/**
 * A brand-new day. `carry` seeds the tasks shown on the Start Day screen.
 * Preferences and cross-day facts are copied over by `endDay`, not here.
 */
export function freshDay(dayNum = 1, carry: CarrySnapshot[] = []): State {
  return {
    v: 1,
    _rev: 0,
    phase: "startday",
    dayNum,
    dateISO: todayISO(),
    awaitingStart: true,
    carryDecided: false,
    mains: [],
    carrySeed: carry,
    backlog: [],
    history: [],
    estimateLog: [],
    interruptions: [],
    trainerOn: false,
    avoidanceOn: true,
    mode: "light",
    accent: "remi",
    dayTargetMins: DEFAULT_TARGET_MINS,
    pingMin: 15,
    wellness: freshWellness(),
    standardDaily: [],
    loggingOptIn: true,
    tourSeen: false,
    feedback: "",
    notifyReminders: true,
    notifyBreakEnd: true,
    welcomeBack: true,
    privateNotifications: false,
    mascotOn: true,
    wakeAnimation: true,
    roamOn: false,
    userName: DEFAULT_NAME,
    fullName: "",
    mascotCostume: "none",
    demoRestore: null,
    leftAt: 0,
    lastAutoBackup: "",
    trayTimer: true,
    pto: [],
    life: 1,
    revived: [],
    activeMainId: null,
    activeSubId: null,
    startedAt: 0,
    returnStack: [],
    breakEndsAt: 0,
    breakPausedTitle: "",
    metrics: { days: {}, errors: [] },
    savedAt: 0,
    overlay: null,
    switchReason: "",
    subsOpen: false,
    ciStage: 0,
    ciMutedDate: null,
  };
}

// Re-exported so callers that only need accent validation don't need to
// import from `./types` directly.
export { ACCENTS };

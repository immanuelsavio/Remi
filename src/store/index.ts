import {
  sandboxAddStep,
  sandboxAddTag,
  sandboxAddTask,
  startTourClockFor,
  tourIsActive,
} from "./tour";
import {
  addMain as addMainAction,
  addSub as addSubAction,
  addTag as addTagAction,
  completeMain as completeMainAction,
  removeMain as removeMainAction,
  startSub as startSubAction,
  startTask as startTaskAction,
  switchToMain as switchToMainAction,
  toggleSubDone as toggleSubDoneAction,
} from "./task-actions";

/**
 * The store's public facade - the ONLY module Svelte components import
 * from. Internal modules (state, persistence, sync, clock, day,
 * task-actions, break-actions, backlog-actions, telemetry, ui-state,
 * settings-actions, import-export) are wiring details a component should
 * never need to reach into directly.
 */

import { get } from "svelte/store";
import { M, showToast, welcomeBack } from "./state";

export type { CarryChoice } from "../domain/types";
export { allTags, normalizeTag, normalizeTags, parseTags } from "../domain/tags";
export { TOUR_STEPS, TOUR_LENGTH, stepAt, type TourStep } from "../domain/tour";
export { searchDays, summarise, type SearchHit, type SearchQuery } from "../domain/search";

export {
  app,
  dashTab,
  damagedPaths,
  loadKind,
  loadMessage,
  nowMs,
  planTaskDraft,
  tourRunningAnywhere,
  returning,
  showToast,
  toast,
  welcomeBack,
  S,
  M,
  activeMain,
  activeSub,
  activeThing,
  type Toast,
} from "./state";

export {
  autoBackup,
  boot,
  dismissWelcomeBack,
  allowOverwritingMalformedOnce,
  flushSave,
  registerQuitListener,
  teardownQuitListener,
} from "./persistence";
export { initSync, reloadFromDisk, teardownSync } from "./sync";
export {
  clearTrayPreview,
  initTrayPreview,
  showTrayPreview,
  teardownTrayPreview,
  trayPreview,
  type TrayPreview,
} from "./tour-preview";
export {
  dismissWellness,
  muteCheckins,
  snoozeWellness,
  startClock,
  stopClock,
  wellnessCopy,
  wellnessNudge,
} from "./clock";
export { previewNotifications, cancelNotificationPreview } from "./tour";
export {
  startTour,
  endTour,
  tourStep,
  tourNext,
  tourBack,
  goToStep,
  tourView,
  tourPaused,
  tourPracticeId,
  tourSession,
  tourSandbox,
  tourActive,
  tourHistory,
  startTourClock,
  completeTourEndDay,
  markTrayOpened,
  openTrayPreview,
  closeTrayPreview,
  maybeAutoAdvance,
  cancelAutoAdvance,
  markSearched,
} from "./tour";
export type { TourSession } from "./tour";
export { tourAnchor, tourAnchors } from "./tour-anchors";
export {
  endDay,
  pruneEmpty,
  restartDay,
  resumeDay,
  startDay,
  togglePto,
  useRevive,
  type SeedChoice,
  startTodayFresh,
} from "./day";
export {
  promoteSub,
  removeSub,
  reviveMain,
  setEstimate,
  setMainTitle,
  setNote,
  setRemind,
  setSubTitle,
  setTags,
  removeTag,
  startNewMain,
  switchToSub,
  toggleShowSubs,
} from "./task-actions";
export { extendBreak, resumeFromBreak, startBreak } from "./break-actions";
export { addBacklog, backlogToToday, deleteBacklog } from "./backlog-actions";
export {
  exportLogs,
  friction,
  initErrorCapture,
  setFeedback,
  track,
  trackClick,
  trackError,
  trackTab,
} from "./telemetry";
export {
  closeOverlay,
  closePopoverToTour,
  closeRemind,
  openDashboard,
  openSwitch,
  openRemind,
  remindTarget,
  setOverlay,
  openPopover,
  setPhase,
  toggleSubsOpen,
  type RemindTarget,
} from "./ui-state";
export {
  getAutoUpdate,
  getDataFolder,
  openDataFolder,
  quitApp,
  factoryReset,
  resetAndUninstall,
  setAccent,
  setCostume,
  setAutoUpdate,
  setDayTarget,
  setFlag,
  setFullName,
  setMode,
  setPingMin,
  setStandardDaily,
  setUserName,
  setWellnessEvery,
  setWellnessHour,
  toggleWellness,
  type BoolPref,
} from "./settings-actions";
export { applyImport, exportBackup, restoreBackup } from "./import-export";
export { exportWorkRecord, rangeBounds } from "./report-actions";
export type { ReportRange } from "../domain/report";
export {
  appVersion,
  checkForUpdate,
  checkWhatsNew,
  dismissWhatsNew,
  installUpdate,
  loadAppVersion,
  updateChecking,
  updateInfo,
  whatsNew,
  type UpdateInfo,
} from "./updates";

/** Take the offer: resume the work that was interrupted. */
export function resumeWelcomeBack(): void {
  const offer = get(welcomeBack);
  welcomeBack.set(null);
  if (!offer) return;
  const m = M(offer.mainId);
  if (!m || m.done) {
    showToast("That task isn't open any more");
    return;
  }
  if (offer.subId) startSub(offer.mainId, offer.subId);
  else startTask(offer.mainId);
}

// ---------------------------------------------------------------------------
// COMPOSITION
//
// The tour performs a beat through the same task mutations a person's typing
// goes through, but `store/tour.ts` may not import `store/task-actions.ts` -
// action modules depend only on `state.ts`, and this facade is where two of
// them are meant to meet. Wiring it here keeps the module graph a star and
// keeps the tour off a second, divergent copy of those mutations.
/**
 * Add a task - to the SANDBOX while the tour is running, to the real day
 * otherwise.
 *
 * This is the boundary that keeps practice out of production. The tour used
 * to add its practice task to `state.mains` (with the real day parked in
 * `demoRestore`), which is why every exit, close, quit, crash, midnight and
 * second window had to know the app's own state was temporarily fictional.
 *
 * Composed here rather than inside `task-actions.ts` for the usual reason:
 * action modules import only `state.ts`, and this facade is where two of
 * them meet.
 */
export function addMain(title: string): string | null {
  if (tourIsActive()) {
    sandboxAddTask(title);
    return null; // the sandbox owns its ids; nothing real was created
  }
  return addMainAction(title);
}

/**
 * Start a task - the TOUR clock while a tour is running, the real one
 * otherwise.
 *
 * The tour draws the sandbox, so every Start button on screen during it
 * belongs to a task the real day has never contained. `beginSession`
 * refuses those outright now, but refusing is not the same as doing the
 * right thing: pressing Start on the practice row is the clock lesson, and
 * pressing it on a sample row should do what the sample suggests rather
 * than nothing at all.
 */
export function startTask(mainId: string): void {
  if (tourIsActive()) return void startTourClockFor(mainId);
  startTaskAction(mainId);
}

/**
 * The rest of the mutating surface, while a tour is running.
 *
 * Every one of these is pointed at a sandbox row. They are no-ops rather
 * than sandbox operations because none of them is anything the tour
 * teaches - and a no-op is the honest outcome for a button attached to a
 * task that exists only as an illustration.
 */
export function switchToMain(mainId: string, remember: boolean): void {
  if (tourIsActive()) return void startTourClockFor(mainId);
  switchToMainAction(mainId, remember);
}

export function completeMain(mainId: string): void {
  if (tourIsActive()) return;
  completeMainAction(mainId);
}

export function removeMain(mainId: string): void {
  if (tourIsActive()) return;
  removeMainAction(mainId);
}

export function toggleSubDone(mainId: string, subId: string): void {
  if (tourIsActive()) return;
  toggleSubDoneAction(mainId, subId);
}

export function startSub(mainId: string, subId: string): void {
  if (tourIsActive()) return void startTourClockFor(mainId);
  startSubAction(mainId, subId);
}

/** As above: a step typed during the tour is practice, not work. */
export function addSub(mainId: string, title: string): void {
  if (tourIsActive()) return void sandboxAddStep(mainId, title);
  addSubAction(mainId, title);
}

/** ...and a tag. */
export function addTag(mainId: string, tag: string): void {
  if (tourIsActive()) return void sandboxAddTag(mainId, tag);
  addTagAction(mainId, tag);
}

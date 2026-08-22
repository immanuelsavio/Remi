import { sandboxAddStep, sandboxAddTag, sandboxAddTask, tourIsActive } from "./tour";
import {
  addMain as addMainAction,
  addSub as addSubAction,
  addTag as addTagAction,
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
import { startSub, startTask } from "./task-actions";

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
  completeMain,
  promoteSub,
  removeMain,
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
  startSub,
  startTask,
  switchToMain,
  switchToSub,
  toggleShowSubs,
  toggleSubDone,
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

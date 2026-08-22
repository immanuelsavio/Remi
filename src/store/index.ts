import { provideBeatCommands } from "./tour";
import { addMain, addSub, addTag, setRemind } from "./task-actions";

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
  maybeAutoAdvance,
  cancelAutoAdvance,
  markSearched,
} from "./tour";
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
} from "./day";
export {
  addMain,
  addSub,
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
  addTag,
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
provideBeatCommands({ addMain, addSub, addTag, setRemind });

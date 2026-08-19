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

export {
  app,
  dashTab,
  damagedPaths,
  loadKind,
  loadMessage,
  nowMs,
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

export { boot, dismissWelcomeBack, flushSave } from "./persistence";
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
export {
  endDay,
  pruneEmpty,
  restartDay,
  startDay,
  togglePto,
  useRevive,
  type CarryChoice,
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
  track,
  trackClick,
  trackError,
  trackTab,
} from "./telemetry";
export { closeOverlay, openDashboard, setOverlay, setPhase, toggleSubsOpen } from "./ui-state";
export {
  getAutoUpdate,
  getDataFolder,
  openDataFolder,
  quitApp,
  resetAndUninstall,
  setAccent,
  setAutoUpdate,
  setDayTarget,
  setFlag,
  setMode,
  setPingMin,
  setStandardDaily,
  setWellnessEvery,
  setWellnessHour,
  toggleWellness,
  type BoolPref,
} from "./settings-actions";
export { applyImport, exportBackup, restoreBackup } from "./import-export";

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

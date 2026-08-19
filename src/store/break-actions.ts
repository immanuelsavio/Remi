/** BREAKS: start, extend, resume. */

import { activeThing, bankActive, commit, showToast } from "./state";

/** Take a timed break; the task clock stops. */
export function startBreak(minutes = 15): void {
  const now = Date.now();
  commit((s) => {
    const t = activeThing();
    bankActive(s, now);
    s.breakPausedTitle = t?.title ?? "your work";
    s.breakEndsAt = now + minutes * 60000;
    // Keep activeMainId so the break can resume the same work, but stop the
    // clock: startedAt = 0 means nothing is accruing.
    s.startedAt = 0;
    s.phase = "break";
    s.overlay = null;
  });
}

export function extendBreak(minutes = 5): void {
  commit((s) => void (s.breakEndsAt += minutes * 60000));
  showToast(`${minutes} more minutes`);
}

/** Resume after a break, returning to the paused task when there was one. */
export function resumeFromBreak(): void {
  const now = Date.now();
  commit((s) => {
    s.breakEndsAt = 0;
    if (s.activeMainId && s.mains.some((m) => m.id === s.activeMainId && !m.done)) {
      s.startedAt = now;
      s.ciStage = 0;
      s.phase = "active";
    } else {
      s.activeMainId = null;
      s.activeSubId = null;
      s.phase = "today";
    }
  });
  showToast("Back to work");
}

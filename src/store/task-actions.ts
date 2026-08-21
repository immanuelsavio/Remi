/** TASKS: create/rename/delete tasks and steps, notes, estimates, reminders,
 * start/switch/interrupt/complete/promote. */

import { mkMain, mkSub } from "../domain/defaults";
import { normalizeTag, normalizeTags } from "../domain/tags";
import { makeRemind } from "../domain/reminders";
import { mainTotal } from "../domain/tasks";
import type { Remind, RemindKind } from "../domain/types";
import {
  M,
  S,
  activeThing,
  closeOpenInterruption,
  commit,
  openInterruption,
  sessionTx,
  showToast,
} from "./state";

export function addMain(title: string): void {
  const t = title.trim();
  if (!t) return;
  commit((s) => void s.mains.push(mkMain(t)));
}

export function setMainTitle(id: string, title: string): void {
  commit((s) => {
    const m = s.mains.find((x) => x.id === id);
    if (m) m.title = title;
  });
}

export function removeMain(id: string): void {
  const m0 = M(id);
  // Via sessionTx: deleting the ACTIVE task must bank its time first and
  // clear the dangling reference, not leave a session pointing at nothing.
  sessionTx((s) => {
    s.mains = s.mains.filter((m) => m.id !== id);
  });
  if (m0) {
    showToast(`Removed "${m0.title}"`, "Undo", () => {
      commit((s) => void s.mains.push(m0));
    });
  }
}

export function addSub(mainId: string, title: string): void {
  const t = title.trim();
  if (!t) return;
  commit((s) => {
    const m = s.mains.find((x) => x.id === mainId);
    if (m) {
      m.subs.push(mkSub(t));
      m._showSubs = true;
    }
  });
}

export function setSubTitle(mainId: string, subId: string, title: string): void {
  commit((s) => {
    const sub = s.mains.find((x) => x.id === mainId)?.subs.find((x) => x.id === subId);
    if (sub) sub.title = title;
  });
}

export function removeSub(mainId: string, subId: string): void {
  sessionTx((s) => {
    const m = s.mains.find((x) => x.id === mainId);
    if (m) m.subs = m.subs.filter((x) => x.id !== subId);
  });
}

export function toggleShowSubs(mainId: string): void {
  commit((s) => {
    const m = s.mains.find((x) => x.id === mainId);
    if (m) m._showSubs = !m._showSubs;
  });
}

/** Replace a task's tags. Normalised, so casing and stray "#" never split one tag into two. */
export function setTags(mainId: string, tags: string[]): void {
  commit((s) => {
    const m = s.mains.find((x) => x.id === mainId);
    if (m) m.tags = normalizeTags(tags);
  });
}

/** Add one tag, ignoring duplicates and blanks. */
export function addTag(mainId: string, tag: string): void {
  const m = M(mainId);
  if (!m) return;
  const clean = normalizeTag(tag);
  if (!clean || m.tags.includes(clean)) return;
  setTags(mainId, [...m.tags, clean]);
}

export function removeTag(mainId: string, tag: string): void {
  const m = M(mainId);
  if (!m) return;
  setTags(
    mainId,
    m.tags.filter((t) => t !== tag),
  );
}

/** Set a note on a task (`subId === null`) or one of its steps. */
export function setNote(mainId: string, subId: string | null, note: string): void {
  commit((s) => {
    const m = s.mains.find((x) => x.id === mainId);
    if (!m) return;
    if (subId) {
      const sub = m.subs.find((x) => x.id === subId);
      if (sub) sub.note = note;
    } else {
      m.note = note;
    }
  });
}

/** Set the trainer estimate, in hours + minutes. */
export function setEstimate(id: string, hours: number, mins: number): void {
  const ms = Math.max(0, Math.round(hours) * 3600000 + Math.round(mins) * 60000);
  commit((s) => {
    const m = s.mains.find((x) => x.id === id);
    if (m) m.estMs = ms;
  });
}

/** Attach or clear a reminder on a task, step or backlog item. */
export function setRemind(
  target: { kind: "main" | "sub" | "backlog"; mainId?: string; id: string },
  kind: RemindKind | "clear",
  raw: string | number,
): void {
  const remind: Remind | null = kind === "clear" ? null : makeRemind(kind, raw);
  if (kind !== "clear" && !remind) {
    showToast("That time didn't make sense");
    return;
  }
  commit((s) => {
    if (target.kind === "main") {
      const m = s.mains.find((x) => x.id === target.id);
      if (m) m.remind = remind;
    } else if (target.kind === "sub") {
      const sub = s.mains.find((x) => x.id === target.mainId)?.subs.find((x) => x.id === target.id);
      if (sub) sub.remind = remind;
    } else {
      const b = s.backlog.find((x) => x.id === target.id);
      if (b) b.remind = remind;
    }
  });
  showToast(remind ? remind.label : "Reminder cleared");
}

/** Start (or restart) a task. */
export function startTask(mainId: string): void {
  sessionTx((s, now) => {
    // Working on it now overrides "I'll do this tomorrow" - the label is a
    // record of a decision, not a rule to argue with.
    const m = s.mains.find((x) => x.id === mainId);
    if (m) m.deferred = false;
    // Coming back to something on the return stack closes the interruption
    // and charges its time to the task it stole from.
    const idx = s.returnStack.findIndex((r) => r.mainId === mainId);
    if (idx >= 0) {
      s.returnStack = s.returnStack.slice(0, idx);
      closeOpenInterruption(s, now);
    }
    return { mainId, subId: null };
  });
  const m = M(mainId);
  if (m) showToast(`Started "${m.title}"`);
}

/** Work a step of a task. */
export function startSub(mainId: string, subId: string): void {
  sessionTx(() => ({ mainId, subId }));
}

/**
 * Switch to another task, remembering where to come back to.
 *
 * `remember` is the difference between "I'm moving on" and "something
 * pulled me away" - only the latter records an interruption and pushes a
 * return.
 */
export function switchToMain(mainId: string, remember: boolean): void {
  const cur = S();
  if (cur.activeMainId === mainId && !cur.activeSubId) {
    commit((s) => void (s.overlay = null));
    showToast("Continuing this task");
    return;
  }
  const via = cur.switchReason === "checkin" ? "checkin" : remember ? "interrupt" : "switch";
  sessionTx((s, now) => {
    if (remember && s.activeMainId) {
      const from = s.mains.find((x) => x.id === s.activeMainId);
      const to = s.mains.find((x) => x.id === mainId);
      if (from) openInterruption(s, from.id, from.title, to?.title ?? "another task", via, now);
      s.returnStack.push({ mainId: s.activeMainId, subId: s.activeSubId });
    }
    s.overlay = null;
    s.switchReason = "";
    return { mainId, subId: null };
  });
  const m = M(mainId);
  showToast(`Switched to "${m?.title ?? ""}"${remember ? " · saved your place" : ""}`);
}

/** Switch to a step, remembering the place when leaving a different task. */
export function switchToSub(mainId: string, subId: string, remember: boolean): void {
  const cur = S();
  if (cur.activeMainId === mainId && cur.activeSubId === subId) {
    commit((s) => void (s.overlay = null));
    showToast("Continuing this step");
    return;
  }
  sessionTx((s, now) => {
    if (remember && s.activeMainId && s.activeMainId !== mainId) {
      const from = s.mains.find((x) => x.id === s.activeMainId);
      const to = s.mains.find((x) => x.id === mainId);
      if (from)
        openInterruption(s, from.id, from.title, to?.title ?? "another task", "switch", now);
      s.returnStack.push({ mainId: s.activeMainId, subId: s.activeSubId });
    }
    s.overlay = null;
    return { mainId, subId };
  });
  showToast("Switched to a step");
}

/** Add a brand-new task and start it - the textbook interruption. */
export function startNewMain(title: string, remember: boolean): void {
  const t = title.trim();
  if (!t) return;
  sessionTx((s, now) => {
    if (remember && s.activeMainId) {
      const from = s.mains.find((x) => x.id === s.activeMainId);
      if (from) openInterruption(s, from.id, from.title, t, "interrupt", now);
      s.returnStack.push({ mainId: s.activeMainId, subId: s.activeSubId });
    }
    const m = mkMain(t);
    s.mains.push(m);
    s.overlay = null;
    return { mainId: m.id, subId: null };
  });
  showToast(`Started "${t}"${remember ? " · saved your place" : ""}`);
}

/** Toggle a step's done state. */
export function toggleSubDone(mainId: string, subId: string): void {
  const s0 = S();
  const m0 = s0.mains.find((x) => x.id === mainId);
  const sub0 = m0?.subs.find((x) => x.id === subId);
  if (!m0 || !sub0) return;
  const wasActive = s0.activeSubId === subId && s0.activeMainId === mainId;

  if (sub0.done) {
    commit((s) => {
      const sub = s.mains.find((x) => x.id === mainId)?.subs.find((x) => x.id === subId);
      if (sub) sub.done = false;
    });
    return;
  }

  // Finishing the step you were timing banks it and returns you to the parent.
  sessionTx((s) => {
    const sub = s.mains.find((x) => x.id === mainId)?.subs.find((x) => x.id === subId);
    if (sub) sub.done = true;
    return wasActive ? { mainId, subId: null } : undefined;
  });

  if (wasActive) {
    showToast(`Step done · back to "${m0.title}"`, "Undo", () => {
      sessionTx((s) => {
        const sub = s.mains.find((x) => x.id === mainId)?.subs.find((x) => x.id === subId);
        if (sub) sub.done = false;
        return { mainId, subId };
      });
    });
  }
}

/**
 * Complete the active task: record the estimate outcome, then resume
 * whatever it interrupted - or ask what's next.
 */
export function completeMain(mainId: string): void {
  const now = Date.now();
  const s0 = S();
  const m0 = s0.mains.find((x) => x.id === mainId);
  if (!m0) return;
  const actual = mainTotal(m0, s0, now);
  const estMs = m0.estMs;

  sessionTx((s) => {
    const m = s.mains.find((x) => x.id === mainId);
    if (m) {
      m.done = true;
      m.completedAt = now; // with firstStartedAt this gives the elapsed span
    }
    if (s.trainerOn && estMs > 0) s.estimateLog.push({ estMs, actualMs: actual });
    closeOpenInterruption(s, now);

    // Resume the most recent still-open place on the return stack.
    for (let i = s.returnStack.length - 1; i >= 0; i--) {
      const r = s.returnStack[i];
      const rm = s.mains.find((x) => x.id === r.mainId);
      if (!rm || rm.done) continue;
      const rs = r.subId ? rm.subs.find((x) => x.id === r.subId) : null;
      if (r.subId && (!rs || rs.done)) continue;
      s.returnStack = s.returnStack.slice(0, i);
      return { mainId: rm.id, subId: rs ? rs.id : null };
    }
  });

  if (S().trainerOn && estMs > 0) {
    const ratio = actual / estMs;
    const msg =
      ratio <= 1
        ? "Nice - done under your estimate."
        : ratio < 1.5
          ? "Close to your estimate."
          : `That took about ${ratio.toFixed(1)}x your estimate - worth noting.`;
    setTimeout(() => showToast(msg), 400);
  }

  const s2 = S();
  const back = activeThing();
  if (s2.activeMainId && back) {
    showToast(`"${m0.title}" done · back to "${back.title}"`);
  } else {
    // Nothing waiting -> ask what's next.
    commit((s) => void (s.overlay = "done-choose"));
  }
}

/** Un-complete a finished task. */
export function reviveMain(mainId: string): void {
  commit((s) => {
    const m = s.mains.find((x) => x.id === mainId);
    if (m) {
      m.done = false;
      m.completedAt = 0;
    }
  });
}

/** Promote a step into its own task, keeping ALL of its time. */
export function promoteSub(mainId: string, subId: string): void {
  const s0 = S();
  const m0 = s0.mains.find((x) => x.id === mainId);
  const sub0 = m0?.subs.find((x) => x.id === subId);
  if (!m0 || !sub0) return;
  const wasActive = s0.activeSubId === subId && s0.activeMainId === mainId;
  let newId = "";

  // Through the transaction so the live session is banked into the step
  // FIRST - otherwise the time since the last save would be dropped on the
  // floor.
  sessionTx((s) => {
    const m = s.mains.find((x) => x.id === mainId);
    const sub = m?.subs.find((x) => x.id === subId);
    if (!m || !sub) return;
    m.subs = m.subs.filter((x) => x.id !== subId);
    const nm = mkMain(sub.title);
    nm.accrued = sub.accrued; // banked above, so this is the full elapsed time
    nm.fromSub = true;
    nm.note = sub.note;
    nm.remind = sub.remind;
    newId = nm.id;
    const idx = s.mains.findIndex((x) => x.id === mainId);
    s.mains.splice(idx + 1, 0, nm);
    return wasActive ? { mainId: nm.id, subId: null } : undefined;
  });

  showToast(`"${sub0.title}" is now its own task`, "Undo", () => {
    // Undo also banks first, so time worked during the undo window isn't lost.
    sessionTx((s) => {
      const promoted = s.mains.find((x) => x.id === newId);
      const parent = s.mains.find((x) => x.id === mainId);
      if (!promoted || !parent) return;
      s.mains = s.mains.filter((x) => x.id !== newId);
      const back = mkSub(promoted.title);
      back.accrued = promoted.accrued;
      back.note = promoted.note;
      back.remind = promoted.remind;
      parent.subs.push(back);
      return wasActive ? { mainId: parent.id, subId: back.id } : undefined;
    });
  });
}

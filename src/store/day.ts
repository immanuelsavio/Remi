/** DAY LIFECYCLE: Start Day, End Day, Restart Day, revive, PTO. */

import { mkMain, mkSub, freshDay } from "../domain/defaults";
import { daySnapshot, enrichSnapshot, carrySnapshot } from "../domain/tasks";
import { computeStreaks } from "../domain/streaks";
import { todayISO } from "../domain/dates";
import { nid } from "../domain/ids";
import type { BacklogItem, CarrySnapshot } from "../domain/types";
import {
  S,
  bankActive,
  closeOpenInterruption,
  commit,
  copyDurablePreferences,
  mergeHistory,
  setState,
  showToast,
} from "./state";

/** Start Day: seed carried tasks + standard-daily routines, then open planning. */
export function startDay(): void {
  commit((s) => {
    const seeded: ReturnType<typeof mkMain>[] = [];
    (s.carrySeed || []).forEach((c) => {
      // Rebuild from the durable snapshot so notes/reminders/estimate come back.
      const m = mkMain(
        c.title,
        (c.subs || []).map((x) => {
          const sub = mkSub(x.title);
          sub.note = x.note ?? "";
          sub.remind = x.remind ?? null;
          return sub;
        }),
      );
      m.carries = c.carries || 0;
      m.note = c.note ?? "";
      m.remind = c.remind ?? null;
      m.estMs = c.estMs || 0;
      seeded.push(m);
    });
    // Standard daily routines are added fresh every day, skipping duplicates.
    (s.standardDaily || []).forEach((title) => {
      const t = title.trim();
      if (!t) return;
      if (seeded.some((m) => m.title.trim().toLowerCase() === t.toLowerCase())) return;
      seeded.push(mkMain(t));
    });
    s.mains = seeded;
    s.carrySeed = [];
    s.dateISO = todayISO();
    s.awaitingStart = false; // the day has begun; rollover may act normally again
    s.phase = "today";
  });
}

/** Remove blank tasks/steps, whatever created them. */
export function pruneEmpty(): void {
  commit((s) => {
    s.mains.forEach((m) => {
      m.subs = m.subs.filter((x) => x.title?.trim());
    });
    s.mains = s.mains.filter((m) => m.title?.trim());
  });
}

export type CarryChoice = "done" | "carry" | "backlog";

/**
 * End Day: apply each pending task's disposition, archive the day, award a
 * revive at each 5-day streak multiple, and seed tomorrow. One atomic swap.
 */
export function endDay(choices: Record<string, CarryChoice> = {}): void {
  const now = Date.now();
  const s0 = S();
  const pending = s0.mains.filter((m) => !m.done);

  const carry: CarrySnapshot[] = [];
  const backlogAdds: BacklogItem[] = [];
  const doneIds = new Set<string>();
  pending.forEach((m) => {
    const c = choices[m.id] ?? "carry";
    if (c === "done") doneIds.add(m.id);
    else if (c === "backlog") backlogAdds.push({ id: nid(), title: m.title, remind: m.remind });
    else carry.push(carrySnapshot(m));
  });

  commit((s) => {
    bankActive(s, now);
    // An interruption still open at End Day would archive with a 0 duration.
    closeOpenInterruption(s, now);
    s.mains.forEach((m) => {
      if (doneIds.has(m.id)) {
        m.done = true;
        if (!m.completedAt) m.completedAt = now;
      }
    });
    s.backlog = [...s.backlog, ...backlogAdds];
    s.activeMainId = null;
    s.activeSubId = null;
    s.startedAt = 0;
  });

  const s1 = S();
  const snap = enrichSnapshot(s1, daySnapshot(s1, now));
  const history = mergeHistory(s1.history, snap);

  // Revive earn-back: refill to 1 at each 5-day streak multiple (max 1).
  const st = computeStreaks(s1);
  let life = s1.life || 0;
  let earned = false;
  if (life < 1 && st.current > 0 && st.current % 5 === 0) {
    life = 1;
    earned = true;
  }

  const endedDay = s1.dayNum;
  const next = freshDay(s1.dayNum + 1, carry);
  copyDurablePreferences(s1, next);
  next.history = history;
  next.life = life;
  // Keep the ENDED day's date. The next launch's rollover re-dates this
  // state to the real today; combined with `awaitingStart` that happens
  // exactly once, so the day number advances once and the carried tasks
  // survive.
  next.dateISO = s1.dateISO;
  next.awaitingStart = true;

  setState(next);
  showToast(
    (carry.length
      ? `Day ${endedDay} ended · ${carry.length} task${carry.length > 1 ? "s" : ""} waiting for tomorrow`
      : `Day ${endedDay} ended - see you tomorrow`) + (earned ? " · ❤️ revive earned!" : ""),
  );
}

/** Restart the day: clear today's work, keep backlog, history and preferences. */
export function restartDay(): void {
  const s1 = S();
  const next = freshDay(s1.dayNum, []);
  copyDurablePreferences(s1, next);
  next.dateISO = s1.dateISO;
  next.awaitingStart = false;
  next.phase = "today";
  setState(next);
  showToast("Fresh day");
}

/** Spend the revive heart to bridge the most recent genuinely-missed day. */
export function useRevive(): void {
  const s = S();
  const st = computeStreaks(s);
  if (!st.broken) {
    showToast("Nothing to revive");
    return;
  }
  if ((s.life || 0) < 1) {
    showToast("No revive left - earn one with a 5-day streak");
    return;
  }
  const day = st.broken;
  commit((d) => {
    d.life = 0;
    if (!d.revived.includes(day)) d.revived.push(day);
  });
  showToast(`❤️ ${day} revived - your streak is safe`);
}

/** Mark a day as time off, which bridges a streak gap. Today or future only. */
export function togglePto(iso: string): void {
  commit((s) => {
    s.pto = s.pto.includes(iso) ? s.pto.filter((x) => x !== iso) : [...s.pto, iso];
  });
}

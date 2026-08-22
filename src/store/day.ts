/** DAY LIFECYCLE: Start Day, End Day, Restart Day, revive, PTO. */

import { mkMain, mkSub, freshDay } from "../domain/defaults";
import { daySnapshot, enrichSnapshot, carrySnapshot } from "../domain/tasks";
import { computeStreaks, firstBrokenDayISO, reviveOffer } from "../domain/streaks";
import { todayISO } from "../domain/dates";
import { nid } from "../domain/ids";
import type { BacklogItem, CarryChoice, CarrySnapshot, ResumableDay } from "../domain/types";
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

/**
 * What happens to one carried task when the day starts.
 *
 * Distinct from `CarryChoice`, which End Day uses: "done" is meaningful
 * when wrapping up (you did finish it, you just forgot to tick it) but not
 * the next morning, because yesterday's record is already archived. What is
 * left is whether the task belongs in today, in the backlog, or nowhere.
 */
export type SeedChoice = "keep" | "backlog" | "drop";

/**
 * Start Day: seed carried tasks + standard-daily routines, then open planning.
 *
 * `choices` runs parallel to `carrySeed`; anything unspecified is kept, so
 * calling `startDay()` with no arguments behaves exactly as it always did.
 */
export function startDay(choices: SeedChoice[] = []): void {
  commit((s) => {
    const seeded: ReturnType<typeof mkMain>[] = [];
    const parked: BacklogItem[] = [];
    (s.carrySeed || []).forEach((c, i) => {
      const choice = choices[i] ?? "keep";
      if (choice === "drop") return;
      if (choice === "backlog") {
        // Steps are dropped on purpose: the backlog is a one-line parking
        // lot, and a task pulled back out starts its planning again.
        parked.push({ id: nid(), title: c.title, remind: c.remind ?? null, note: c.note ?? "" });
        return;
      }
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
      m.tags = [...(c.tags ?? [])];
      seeded.push(m);
    });
    if (parked.length) s.backlog = [...s.backlog, ...parked];
    // Standard daily routines are added fresh every day, skipping duplicates.
    (s.standardDaily || []).forEach((title) => {
      const t = title.trim();
      if (!t) return;
      if (seeded.some((m) => m.title.trim().toLowerCase() === t.toLowerCase())) return;
      seeded.push(mkMain(t));
    });
    s.mains = seeded;
    s.carrySeed = [];
    s.carryDecided = false; // consumed; the next carry starts undecided again
    // The new day has begun; yesterday is no longer reopenable.
    s.resumable = null;
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

  // TWO commits, with the resume snapshot taken between them, because the
  // two halves must be undone differently:
  //
  //   settle  - bank the running session, close any open interruption, stop
  //             the clock. Reopening the day must NOT rewind this: the time
  //             was worked, and restarting a timer that has been stopped for
  //             hours would invent time nobody spent.
  //   apply   - the per-task choices (mark done, move to backlog). These ARE
  //             the decision being undone, so they land after the snapshot.
  commit((s) => {
    bankActive(s, now);
    // An interruption still open at End Day would archive with a 0 duration.
    closeOpenInterruption(s, now);
    s.activeMainId = null;
    s.activeSubId = null;
    s.startedAt = 0;
  });

  const settled = S();
  // Deep copy: the commit below mutates these task objects in place, and a
  // snapshot that aliased them would be quietly rewritten by the very
  // changes it exists to undo.
  const resumable: ResumableDay = JSON.parse(
    JSON.stringify({
      dayNum: settled.dayNum,
      dateISO: settled.dateISO,
      mains: settled.mains,
      interruptions: settled.interruptions,
      life: settled.life,
      // The backlog is deliberately NOT snapshotted: parking something is a
      // decision about where it belongs, not part of ending the day, so
      // reopening leaves it parked.
      choices,
      decided: Object.keys(choices).length > 0,
    }),
  );

  commit((s) => {
    s.mains.forEach((m) => {
      if (doneIds.has(m.id)) {
        m.done = true;
        if (!m.completedAt) m.completedAt = now;
      }
    });
    s.backlog = [...s.backlog, ...backlogAdds];
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
  next.resumable = resumable;
  // Only a real per-task decision counts. A plain "wrap up the day" carries
  // everything by default, which is not the same as being asked - so Start
  // Day should still offer the choice in the morning.
  next.carryDecided = Object.keys(choices).length > 0;

  setState(next);
  showToast(
    (carry.length
      ? `Day ${endedDay} ended · ${carry.length} task${carry.length > 1 ? "s" : ""} waiting for tomorrow`
      : `Day ${endedDay} ended - see you tomorrow`) + (earned ? " · ❤️ revive earned!" : ""),
    "Undo",
    resumeDay,
  );
}

/**
 * Reopen the day End Day just closed.
 *
 * Honours what you chose on the way out rather than flattening it:
 *
 *   nothing chosen  everything comes back plain and workable. A default
 *                   carry is not the same as saying "tomorrow" about each
 *                   task, so nothing is labelled.
 *   "tomorrow"      comes back workable but marked `deferred`, so the
 *                   decision is visible instead of silently undone.
 *   "backlog"       STAYS in the backlog. Parking something is a decision
 *                   about where it belongs, not part of ending the day.
 *   "done"          stays done. You said you finished it.
 *
 * A no-op when there is nothing to reopen.
 */
export function resumeDay(): void {
  const s0 = S();
  const r = s0.resumable;
  if (!r) {
    showToast("There's no ended day to reopen");
    return;
  }
  const choices = r.choices ?? {};
  const parked = new Set(
    Object.entries(choices)
      .filter(([, c]) => c === "backlog")
      .map(([id]) => id),
  );

  commit((s) => {
    s.dayNum = r.dayNum;
    s.dateISO = r.dateISO;
    s.mains = r.mains
      // Anything sent to the backlog is already there and stays there;
      // bringing it back would duplicate it.
      .filter((m) => !parked.has(m.id))
      .map((m) => {
        const c = choices[m.id];
        if (c === "done") return { ...m, done: true, completedAt: m.completedAt || Date.now() };
        // Only an explicit choice defers. See `decided`.
        if (r.decided && c === "carry") return { ...m, deferred: true };
        return m;
      });
    s.interruptions = [...r.interruptions];
    s.life = r.life;
    // The day is live again, so its archived record must go - otherwise
    // the calendar would show it finished while it is still being worked.
    s.history = s.history.filter((h) => h.dateISO !== r.dateISO);
    s.carrySeed = [];
    s.carryDecided = false;
    s.awaitingStart = false;
    s.phase = "today";
    s.resumable = null;
  });

  const deferred = S().mains.filter((m) => m.deferred).length;
  showToast(
    deferred
      ? `Day ${r.dayNum} reopened · ${deferred} still marked for tomorrow`
      : `Day ${r.dayNum} reopened`,
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

/**
 * Spend the revive heart to get a broken streak's COUNT back.
 *
 * It does not fill the missed days in - the calendar goes on saying you
 * missed them, because it is a record and a record that lies is worthless.
 * What it does is bank the number the old streak reached and stitch it onto
 * a new one starting at the anchor day, so `old + new` is what the streak
 * reads from here on. See `reviveOffer` in `domain/streaks.ts` for when
 * that is still on the table (a week, and only until a new streak of two
 * days has taken hold).
 */
export function useRevive(): void {
  const s = S();
  const offer = reviveOffer(s);
  if (!offer) {
    showToast(
      firstBrokenDayISO(s)
        ? "That streak is past reviving - a new one has started"
        : "Nothing to revive",
    );
    return;
  }
  if ((s.life || 0) < 1) {
    showToast("No revive left - earn one with a 5-day streak");
    return;
  }
  const { anchorISO, credit } = offer;
  commit((d) => {
    d.life = 0;
    d.reviveCredit = credit;
    d.reviveAnchor = anchorISO;
    // Marks the anchor on the calendar and bridges it, so a revive taken on
    // a day you have not worked yet still holds the count until you do.
    if (!d.revived.includes(anchorISO)) d.revived.push(anchorISO);
  });
  const now = computeStreaks(S()).current;
  showToast(`❤️ ${credit}-day streak back - you're on ${now} and counting`);
}

/** Mark a day as time off, which bridges a streak gap. Today or future only. */
export function togglePto(iso: string): void {
  commit((s) => {
    s.pto = s.pto.includes(iso) ? s.pto.filter((x) => x !== iso) : [...s.pto, iso];
  });
}

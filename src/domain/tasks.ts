/** Roll-ups: live elapsed time, day totals, and snapshotting a task across
 * a day boundary or into the archived day record. */

import type {
  CarrySnapshot,
  CompletedRecord,
  DayRecord,
  Main,
  State,
  Sub,
  UnfinishedRecord,
} from "./types";

/** Live elapsed for one item: its banked time plus any running session. */
export function elapsedOf(
  item: Main | Sub | null,
  isActive: boolean,
  startedAt: number,
  now: number,
): number {
  if (!item) return 0;
  return item.accrued + (isActive && startedAt > 0 ? Math.max(0, now - startedAt) : 0);
}

/** A task's total: its own time plus every step's, plus the live session. */
export function mainTotal(m: Main, s: State, now: number): number {
  let base = m.accrued + m.subs.reduce((a, x) => a + x.accrued, 0);
  if (s.activeMainId === m.id && s.startedAt > 0) base += Math.max(0, now - s.startedAt);
  return base;
}

/** Total tracked today across every task (banked + live). */
export function todayTrackedMs(s: State, now: number): number {
  let t = 0;
  s.mains.forEach((m) => {
    t += m.accrued + m.subs.reduce((a, x) => a + x.accrued, 0);
  });
  if (s.activeMainId && s.startedAt > 0) t += Math.max(0, now - s.startedAt);
  return t;
}

/** Everything finished today, tasks and steps alike. */
export function completedToday(s: State): CompletedRecord[] {
  const out: CompletedRecord[] = [];
  s.mains.forEach((m) => {
    if (m.done) {
      out.push({
        title: m.title,
        kind: "task",
        ms: m.accrued + m.subs.reduce((a, x) => a + x.accrued, 0),
        tags: m.tags?.length ? [...m.tags] : undefined,
      });
    }
    m.subs.forEach((x) => {
      // A step inherits its parent's tags: it is part of that work, and a
      // report filtered by project should not lose the steps inside it.
      if (x.done)
        out.push({
          title: x.title,
          kind: "step",
          ms: x.accrued,
          tags: m.tags?.length ? [...m.tags] : undefined,
        });
    });
  });
  return out;
}

/** Unfinished tasks with their still-open steps (carry-forward + calendar). */
export function unfinishedToday(s: State): UnfinishedRecord[] {
  return s.mains
    .filter((m) => !m.done)
    .map((m) => ({
      title: m.title,
      subs: m.subs.filter((x) => !x.done).map((x) => ({ title: x.title, note: x.note })),
      tags: m.tags?.length ? [...m.tags] : undefined,
    }));
}

/** Build the immutable record archived at End Day. */
export function daySnapshot(s: State, now: number): DayRecord {
  return {
    day: s.dayNum,
    dateISO: s.dateISO,
    completed: completedToday(s),
    unfinished: unfinishedToday(s),
    totalMs: todayTrackedMs(s, now),
  };
}

/** Snapshot an unfinished task so "Tomorrow" keeps notes, reminders, estimate. */
export function carrySnapshot(m: Main): CarrySnapshot {
  return {
    title: m.title,
    note: m.note,
    remind: m.remind,
    estMs: m.estMs,
    tags: m.tags?.length ? [...m.tags] : undefined,
    carries: (m.carries || 0) + 1,
    subs: m.subs
      .filter((x) => !x.done)
      .map((x) => ({ title: x.title, note: x.note, remind: x.remind })),
  };
}

/** Attach interruption evidence to a day's archived record. */
export function enrichSnapshot(s: State, snap: DayRecord): DayRecord {
  const byTitle = new Map(s.mains.map((m) => [m.title, m]));
  return {
    ...snap,
    interruptions: [...s.interruptions],
    completed: snap.completed.map((c) => {
      const m = c.kind === "task" ? byTitle.get(c.title) : undefined;
      if (!m) return c;
      return {
        ...c,
        elapsedMs:
          m.firstStartedAt && m.completedAt
            ? Math.max(0, m.completedAt - m.firstStartedAt)
            : undefined,
        interruptedCount: m.interruptedCount || undefined,
        interruptedMs: m.interruptedMs || undefined,
        estMs: m.estMs || undefined,
      };
    }),
  };
}

/** Today's in-progress numbers, shaped like a day record so stats can reuse it. */
export function todayAsRecord(s: State, now: number) {
  const byTitle = new Map(s.mains.map((m) => [m.title, m]));
  return {
    completed: completedToday(s).map((c) => {
      const m = c.kind === "task" ? byTitle.get(c.title) : undefined;
      if (!m) return c;
      return {
        ...c,
        elapsedMs:
          m.firstStartedAt && m.completedAt
            ? Math.max(0, m.completedAt - m.firstStartedAt)
            : undefined,
        interruptedCount: m.interruptedCount || undefined,
        interruptedMs: m.interruptedMs || undefined,
        estMs: m.estMs || undefined,
      };
    }),
    totalMs: todayTrackedMs(s, now),
    interruptions: s.interruptions,
  };
}

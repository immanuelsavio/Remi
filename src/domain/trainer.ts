/** The time-sense trainer and interruption-evidence analysis. */

import type { CompletedRecord, EstimateEntry, InterruptionEvent } from "./types";

export interface TimeSense {
  count: number;
  avgRatio: number;
  under: number;
  over: number;
  verdict: string;
  recent: EstimateEntry[];
}

/** Estimate-vs-actual summary. Zero estimates are excluded, not divided by. */
export function timeSense(log: EstimateEntry[]): TimeSense | null {
  const clean = (log || []).filter((e) => e && e.estMs > 0 && Number.isFinite(e.actualMs));
  if (!clean.length) return null;
  const ratios = clean.map((e) => e.actualMs / e.estMs);
  const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const under = clean.filter((e) => e.actualMs <= e.estMs).length;
  const verdict =
    avg <= 1.1
      ? "Your estimates are pretty accurate."
      : avg < 1.5
        ? `You tend to run a bit over - pad your estimates ~${Math.round((avg - 1) * 100)}%.`
        : `You underestimate a lot - tasks take about ${avg.toFixed(1)}x your guess. Try estimating, then doubling.`;
  return {
    count: clean.length,
    avgRatio: avg,
    under,
    over: clean.length - under,
    verdict,
    recent: clean.slice(-5).reverse(),
  };
}

export interface InterruptionStats {
  count: number;
  totalMs: number;
  longestMs: number;
  /** Focused time on real tasks in the same period. */
  focusedMs: number;
  /**
   * Interruptions per hour of focused work - the comparable rate. A raw
   * count means little without knowing how long the person was working.
   */
  perFocusHour: number;
  topCauses: { title: string; count: number; totalMs: number }[];
  /** Tasks whose wall-clock ran well past their focused time. */
  stretched: {
    title: string;
    estMs?: number;
    focusedMs: number;
    elapsedMs: number;
    interruptedCount: number;
    interruptedMs: number;
    /** elapsed / focused - "a 2h task occupied 5h of my day" is 2.5x. */
    stretchRatio: number;
  }[];
}

/**
 * Summarise interruptions across day records (optionally including today).
 *
 * This is the evidence layer for the case that an estimate can be accurate
 * while the day still runs long: `focusedMs` is the work, the stretch
 * ratio is what the interruptions did to it.
 */
export function interruptionStats(
  days: { completed: CompletedRecord[]; totalMs: number; interruptions?: InterruptionEvent[] }[],
): InterruptionStats {
  const events: InterruptionEvent[] = [];
  let focusedMs = 0;
  const stretched: InterruptionStats["stretched"] = [];

  days.forEach((d) => {
    focusedMs += d.totalMs || 0;
    (d.interruptions ?? []).forEach((e) => events.push(e));
    (d.completed ?? []).forEach((c) => {
      // Only tasks carry the span, and only when both ends are known.
      if (c.kind !== "task" || !c.elapsedMs || !c.ms) return;
      const ratio = c.elapsedMs / c.ms;
      // 1.25x is the noise floor: below it the "stretch" is rounding, not a story.
      if (ratio < 1.25) return;
      stretched.push({
        title: c.title,
        estMs: c.estMs,
        focusedMs: c.ms,
        elapsedMs: c.elapsedMs,
        interruptedCount: c.interruptedCount ?? 0,
        interruptedMs: c.interruptedMs ?? 0,
        stretchRatio: ratio,
      });
    });
  });

  // An interruption still open has no final duration yet; counting it is
  // honest, adding a partial duration to the total is not.
  const totalMs = events.reduce((a, e) => a + (e.open ? 0 : e.durationMs || 0), 0);
  const longestMs = events.reduce((a, e) => Math.max(a, e.durationMs || 0), 0);

  const causes = new Map<string, { count: number; totalMs: number }>();
  events.forEach((e) => {
    const key = e.causeTitle || "something else";
    const cur = causes.get(key) ?? { count: 0, totalMs: 0 };
    cur.count++;
    cur.totalMs += e.durationMs || 0;
    causes.set(key, cur);
  });

  return {
    count: events.length,
    totalMs,
    longestMs,
    focusedMs,
    perFocusHour: focusedMs > 0 ? events.length / (focusedMs / 3600000) : 0,
    topCauses: [...causes.entries()]
      .map(([title, v]) => ({ title, ...v }))
      .sort((a, b) => b.totalMs - a.totalMs || b.count - a.count)
      .slice(0, 10),
    stretched: stretched.sort((a, b) => b.stretchRatio - a.stretchRatio).slice(0, 25),
  };
}

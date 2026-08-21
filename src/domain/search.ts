/**
 * SEARCH across everything that has been recorded.
 *
 * Reads day records rather than live tasks, because the question this
 * answers is "when did I do that thing?" - and the answer usually lives in
 * a day that has already been archived. Today is folded in by the caller,
 * the same way the calendar does it, so a search at 4pm still finds what
 * you finished at 11am.
 *
 * Pure: records in, results out. No store, no clock.
 */

import type { DayRecord } from "./types";
import { matchesTags } from "./tags";

export interface SearchHit {
  title: string;
  kind: "task" | "step";
  /** Whether it was finished, or left open at the end of that day. */
  done: boolean;
  dateISO: string;
  day: number;
  /** Focused time, for completed items. Zero for unfinished ones. */
  ms: number;
  tags: string[];
}

export interface SearchQuery {
  /** Free text matched against the title, case-insensitively. */
  text?: string;
  /** Every tag here must be present. Empty matches everything. */
  tags?: string[];
  /** Inclusive ISO date bounds. */
  from?: string;
  to?: string;
  /** Include items that were never finished. */
  includeUnfinished?: boolean;
}

/**
 * Find recorded work matching a query, newest first.
 *
 * Ordering is deliberate: someone searching their history is far more often
 * asking "what did I do recently" than "what did I do first".
 */
export function searchDays(days: DayRecord[], q: SearchQuery): SearchHit[] {
  const needle = (q.text ?? "").trim().toLowerCase();
  const wanted = q.tags ?? [];
  const hits: SearchHit[] = [];

  for (const d of days) {
    if (q.from && d.dateISO < q.from) continue;
    if (q.to && d.dateISO > q.to) continue;

    for (const c of d.completed) {
      if (needle && !c.title.toLowerCase().includes(needle)) continue;
      if (!matchesTags(c.tags, wanted)) continue;
      hits.push({
        title: c.title,
        kind: c.kind,
        done: true,
        dateISO: d.dateISO,
        day: d.day,
        ms: c.ms,
        tags: c.tags ?? [],
      });
    }

    if (!q.includeUnfinished) continue;
    for (const u of d.unfinished) {
      if (needle && !u.title.toLowerCase().includes(needle)) continue;
      if (!matchesTags(u.tags, wanted)) continue;
      hits.push({
        title: u.title,
        kind: "task",
        done: false,
        dateISO: d.dateISO,
        day: d.day,
        ms: 0,
        tags: u.tags ?? [],
      });
    }
  }

  return hits.sort((a, b) => (a.dateISO < b.dateISO ? 1 : a.dateISO > b.dateISO ? -1 : 0));
}

/** Totals for a result set, so the UI can say what the search adds up to. */
export function summarise(hits: SearchHit[]): { count: number; ms: number; days: number } {
  return {
    count: hits.length,
    ms: hits.reduce((a, h) => a + h.ms, 0),
    days: new Set(hits.map((h) => h.dateISO)).size,
  };
}

/**
 * The work record: a printable summary of what actually got done.
 *
 * Pure by design - it takes day records and returns an HTML string, with no
 * DOM, no Tauri and no clock of its own. That is what makes the output
 * testable, and the reason `logoDataUri` and `generatedAt` are parameters
 * rather than something this module fetches for itself.
 *
 * Output is a standalone file: the logo is embedded as a data URI and all
 * styling is inline, so the report still renders years later, on a machine
 * without Remi, with no network. Printing it to PDF is the browser's job -
 * bundling a PDF engine to produce a document the OS can already make would
 * be a lot of weight for no gain.
 */

import type { DayRecord, InterruptionEvent } from "./types";
import { matchesTags } from "./tags";
import { fmtEst, hoursStr } from "./time";
import { prettyDate, dateFromISO } from "./dates";

export type ReportRange = "all" | "year" | "month" | "custom";

export interface ReportOptions {
  /** Include the interruption evidence section. */
  includeInterruptions: boolean;
  /** Inline `data:` URI for the logo. Omitted renders the title alone. */
  logoDataUri?: string;
  /** Stamped in the footer so a printout says when it was produced. */
  generatedAt: number;
  /** Human label for the range, e.g. "August 2026". */
  rangeLabel: string;
}

const esc = (s: unknown): string =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

/**
 * Day records inside `[fromISO, toISO]`, oldest first, optionally narrowed
 * to work carrying every tag in `tags`.
 *
 * Filtering rewrites each day rather than dropping it wholesale: a day
 * where you touched three projects should appear in a per-project report
 * showing only that project's work, and with `totalMs` recomputed to match.
 * Leaving the original total would make a filtered report claim hours it
 * has not shown. Days left with nothing are dropped.
 */
export function selectDays(
  history: DayRecord[],
  fromISO: string,
  toISO: string,
  tags: string[] = [],
): DayRecord[] {
  const inRange = history
    .filter((h) => h.dateISO && h.dateISO >= fromISO && h.dateISO <= toISO)
    .sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));
  if (!tags.length) return inRange;

  return inRange
    .map((d) => {
      const completed = d.completed.filter((c) => matchesTags(c.tags, tags));
      const unfinished = d.unfinished.filter((u) => matchesTags(u.tags, tags));
      return {
        ...d,
        completed,
        unfinished,
        totalMs: completed.reduce((a, c) => a + (c.ms || 0), 0),
        // An interruption belongs to the report only if it cost one of the
        // tasks still shown; otherwise it is evidence about other work.
        interruptions: (d.interruptions ?? []).filter((e) =>
          completed.some((c) => c.title === e.interruptedTitle),
        ),
      };
    })
    .filter((d) => d.completed.length || d.unfinished.length);
}

export interface ReportTotals {
  days: number;
  completed: number;
  trackedMs: number;
  unfinished: number;
  interruptions: number;
  interruptedMs: number;
}

export function totals(days: DayRecord[]): ReportTotals {
  const events: InterruptionEvent[] = days.flatMap((d) => d.interruptions ?? []);
  return {
    days: days.length,
    completed: days.reduce((a, d) => a + d.completed.length, 0),
    trackedMs: days.reduce((a, d) => a + (d.totalMs || 0), 0),
    unfinished: days.reduce((a, d) => a + d.unfinished.length, 0),
    interruptions: events.length,
    // An interruption still open has no final duration; counting it is
    // honest, inventing a duration for it is not.
    interruptedMs: events.reduce((a, e) => a + (e.open ? 0 : e.durationMs || 0), 0),
  };
}

function dayBlock(d: DayRecord, opts: ReportOptions): string {
  const completed = d.completed
    .map((c) => {
      const kind = c.kind === "step" ? '<span class="kind">step</span>' : "";
      const span =
        c.elapsedMs && c.ms && c.elapsedMs > c.ms * 1.25
          ? `<span class="stretch">took ${hoursStr(c.elapsedMs)} of the day</span>`
          : "";
      return `<tr><td>${esc(c.title)} ${kind}</td><td class="num">${fmtEst(c.ms)}</td><td class="note">${span}</td></tr>`;
    })
    .join("");

  const unfinished = d.unfinished.length
    ? `<div class="sub">Left open</div><ul class="open">${d.unfinished
        .map((u) => `<li>${esc(u.title)}</li>`)
        .join("")}</ul>`
    : "";

  const events = opts.includeInterruptions ? (d.interruptions ?? []) : [];
  const interruptions = events.length
    ? `<div class="sub">Interruptions</div><table class="t"><tbody>${events
        .map(
          (e) =>
            `<tr><td>${esc(e.causeTitle || "something else")} <span class="kind">interrupted ${esc(
              e.interruptedTitle,
            )}</span></td><td class="num">${e.open ? "open" : fmtEst(e.durationMs)}</td><td class="note">${esc(e.via)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : "";

  return `<section class="day">
    <h2>${esc(prettyDate(dateFromISO(d.dateISO)))} <span class="daynum">day ${d.day}</span></h2>
    <div class="meta">${d.completed.length} completed · ${hoursStr(d.totalMs || 0)} tracked</div>
    ${completed ? `<table class="t"><tbody>${completed}</tbody></table>` : `<div class="empty">Nothing completed.</div>`}
    ${unfinished}
    ${interruptions}
  </section>`;
}

/** Build the standalone work-record document. */
export function buildReport(days: DayRecord[], opts: ReportOptions): string {
  const t = totals(days);
  const logo = opts.logoDataUri
    ? `<img class="logo" src="${opts.logoDataUri}" alt="Remi" />`
    : `<div class="wordmark">Remi</div>`;

  const interruptionSummary =
    opts.includeInterruptions && t.interruptions
      ? `<div class="stat"><b>${t.interruptions}</b><span>interruptions</span></div>
         <div class="stat"><b>${hoursStr(t.interruptedMs)}</b><span>lost to them</span></div>`
      : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Remi — work record — ${esc(opts.rangeLabel)}</title>
<style>
  :root { --ink:#2a2622; --soft:#6b6259; --faint:#a59c90; --line:#e2dccf; --accent:#218693; }
  * { box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         color:var(--ink); margin:0; padding:40px; max-width:820px; margin:0 auto; line-height:1.5; }
  header { display:flex; align-items:center; gap:16px; border-bottom:2px solid var(--line); padding-bottom:18px; }
  .logo { width:150px; height:auto; }
  .wordmark { font-size:28px; font-weight:700; color:var(--accent); }
  h1 { font-size:19px; margin:0; font-weight:600; }
  .range { color:var(--soft); font-size:13px; margin-top:2px; }
  .stats { display:flex; gap:26px; flex-wrap:wrap; margin:22px 0 6px; }
  .stat b { display:block; font-size:26px; color:var(--accent); line-height:1.1; }
  .stat span { font-size:12px; color:var(--soft); }
  section.day { border-top:1px solid var(--line); padding-top:16px; margin-top:22px; page-break-inside:avoid; }
  h2 { font-size:16px; margin:0; font-weight:600; }
  .daynum { font-size:11px; color:var(--faint); font-weight:400; }
  .meta { font-size:12px; color:var(--soft); margin:2px 0 10px; }
  .sub { font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:var(--faint); margin:14px 0 4px; }
  table.t { width:100%; border-collapse:collapse; }
  table.t td { padding:5px 0; border-bottom:1px solid var(--line); vertical-align:top; font-size:13px; }
  td.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; width:90px; color:var(--soft); }
  td.note { width:210px; text-align:right; font-size:11px; color:var(--faint); }
  .kind { font-size:10px; color:var(--faint); text-transform:uppercase; letter-spacing:.08em; }
  .stretch { color:#c0392b; }
  ul.open { margin:0; padding-left:18px; font-size:13px; color:var(--soft); }
  .empty { font-size:13px; color:var(--faint); }
  footer { margin-top:34px; padding-top:14px; border-top:1px solid var(--line); font-size:11px; color:var(--faint); }
  @media print { body { padding:0; } @page { margin:18mm; } }
</style></head>
<body>
<header>${logo}<div><h1>Work record</h1><div class="range">${esc(opts.rangeLabel)}</div></div></header>
<div class="stats">
  <div class="stat"><b>${t.days}</b><span>days</span></div>
  <div class="stat"><b>${t.completed}</b><span>completed</span></div>
  <div class="stat"><b>${hoursStr(t.trackedMs)}</b><span>tracked</span></div>
  <div class="stat"><b>${t.unfinished}</b><span>left open</span></div>
  ${interruptionSummary}
</div>
${days.length ? days.map((d) => dayBlock(d, opts)).join("") : '<section class="day"><div class="empty">No days in this range.</div></section>'}
<footer>Generated by Remi on ${esc(new Date(opts.generatedAt).toLocaleString())}. Times are focused work, not wall-clock.</footer>
</body></html>`;
}

import { describe, expect, it } from "vitest";

import { buildReport, selectDays, totals } from "./report";
import { rangeBounds } from "../store/report-actions";
import type { DayRecord, InterruptionEvent } from "./types";

const ev = (over: Partial<InterruptionEvent> = {}): InterruptionEvent => ({
  id: "e1",
  dateISO: "2026-08-10",
  interruptedId: "m1",
  interruptedTitle: "Write the spec",
  causeTitle: "Standup",
  atMs: 0,
  durationMs: 30 * 60_000,
  open: false,
  via: "interrupt",
  ...over,
});

const day = (over: Partial<DayRecord> = {}): DayRecord => ({
  day: 1,
  dateISO: "2026-08-10",
  completed: [{ title: "Write the spec", kind: "task", ms: 2 * 3_600_000 }],
  unfinished: [{ title: "Review PRs", subs: [] }],
  totalMs: 2 * 3_600_000,
  ...over,
});

describe("selectDays", () => {
  it("keeps only the range, oldest first", () => {
    const h = [
      day({ dateISO: "2026-08-12" }),
      day({ dateISO: "2026-08-01" }),
      day({ dateISO: "2026-09-02" }),
    ];
    expect(selectDays(h, "2026-08-01", "2026-08-31").map((d) => d.dateISO)).toEqual([
      "2026-08-01",
      "2026-08-12",
    ]);
  });

  it("is inclusive at both ends", () => {
    const h = [day({ dateISO: "2026-08-01" }), day({ dateISO: "2026-08-31" })];
    expect(selectDays(h, "2026-08-01", "2026-08-31")).toHaveLength(2);
  });
});

describe("totals", () => {
  it("adds up days, completions and tracked time", () => {
    const t = totals([day(), day({ dateISO: "2026-08-11", day: 2 })]);
    expect(t.days).toBe(2);
    expect(t.completed).toBe(2);
    expect(t.unfinished).toBe(2);
    expect(t.trackedMs).toBe(4 * 3_600_000);
  });

  it("never invents a duration for an interruption still open", () => {
    const t = totals([day({ interruptions: [ev(), ev({ id: "e2", open: true, durationMs: 0 })] })]);
    expect(t.interruptions).toBe(2); // counted honestly
    expect(t.interruptedMs).toBe(30 * 60_000); // but only the closed one contributes
  });
});

describe("buildReport", () => {
  const base = { includeInterruptions: false, generatedAt: 0, rangeLabel: "August 2026" };

  it("renders the tasks and the range", () => {
    const html = buildReport([day()], base);
    expect(html).toContain("Write the spec");
    expect(html).toContain("Review PRs");
    expect(html).toContain("August 2026");
    expect(html).toContain("Work record");
  });

  it("embeds the logo so the file stands alone", () => {
    const html = buildReport([day()], { ...base, logoDataUri: "data:image/png;base64,AAA" });
    expect(html).toContain('src="data:image/png;base64,AAA"');
    expect(html).not.toContain('<img class="logo" src="http');
  });

  it("falls back to a wordmark rather than a broken image", () => {
    const html = buildReport([day()], base);
    expect(html).not.toContain('<img class="logo"');
    expect(html).toContain("wordmark");
  });

  it("omits interruptions unless asked", () => {
    const d = day({ interruptions: [ev()] });
    expect(buildReport([d], base)).not.toContain("Standup");
    expect(buildReport([d], { ...base, includeInterruptions: true })).toContain("Standup");
  });

  it("names which task an interruption cost, not just that one happened", () => {
    const html = buildReport([day({ interruptions: [ev()] })], {
      ...base,
      includeInterruptions: true,
    });
    expect(html).toContain("interrupted Write the spec");
  });

  it("says a still-open interruption is open rather than giving it a duration", () => {
    const html = buildReport([day({ interruptions: [ev({ open: true, durationMs: 0 })] })], {
      ...base,
      includeInterruptions: true,
    });
    // The ROW says "open". The summary separately reporting 0m lost is
    // correct - nothing has finished being lost yet.
    expect(html).toContain('<td class="num">open</td>');
    expect(html).not.toContain('<td class="num">0m</td>');
  });

  it("escapes task titles so a report cannot inject markup", () => {
    const html = buildReport(
      [day({ completed: [{ title: '<img src=x onerror="alert(1)">', kind: "task", ms: 1000 }] })],
      base,
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("produces a valid document for an empty range instead of failing", () => {
    const html = buildReport([], base);
    expect(html).toContain("No days in this range");
    expect(html).toContain("</html>");
  });

  it("flags a task whose day ran far past its focused time", () => {
    const html = buildReport(
      [
        day({
          completed: [{ title: "Spec", kind: "task", ms: 3_600_000, elapsedMs: 5 * 3_600_000 }],
        }),
      ],
      base,
    );
    expect(html).toContain("of the day");
  });
});

describe("rangeBounds", () => {
  it("covers everything by default", () => {
    const r = rangeBounds("all", "2026-08-20");
    expect(r.from < "1900-01-01").toBe(true);
    expect(r.to > "2100-01-01").toBe(true);
    expect(r.label).toBe("Entire history");
  });

  it("scopes to the current year and month", () => {
    expect(rangeBounds("year", "2026-08-20")).toMatchObject({
      from: "2026-01-01",
      to: "2026-12-31",
      label: "2026",
    });
    expect(rangeBounds("month", "2026-08-20")).toMatchObject({
      from: "2026-08-01",
      label: "August 2026",
    });
  });

  it("tolerates custom dates given the wrong way round", () => {
    // Silently producing an empty report would be the worst outcome here.
    const r = rangeBounds("custom", "2026-08-20", { from: "2026-08-30", to: "2026-08-01" });
    expect(r.from).toBe("2026-08-01");
    expect(r.to).toBe("2026-08-30");
  });

  it("falls back to everything when a custom range is incomplete", () => {
    expect(rangeBounds("custom", "2026-08-20", { from: "", to: "" }).label).toBe("Entire history");
  });
});

import { describe, expect, it } from "vitest";

import { interruptionStats, timeSense } from "./trainer";

describe("trainer and interruption analysis", () => {
  it("returns null until there is a usable estimate", () => {
    expect(timeSense([])).toBeNull();
    // A zero estimate must be excluded, never divided by.
    expect(timeSense([{ estMs: 0, actualMs: 5000 }])).toBeNull();
  });

  it("verdicts accurate, slightly-over and way-under estimators", () => {
    expect(timeSense([{ estMs: 1000, actualMs: 1000 }])!.verdict).toContain("accurate");
    expect(timeSense([{ estMs: 1000, actualMs: 1300 }])!.verdict).toContain("bit over");
    const bad = timeSense([{ estMs: 1000, actualMs: 3000 }])!;
    expect(bad.verdict).toContain("underestimate");
    expect(bad.avgRatio).toBe(3);
    expect(bad.under).toBe(0);
    expect(bad.over).toBe(1);
  });

  it("summarises interruptions with a comparable per-hour rate", () => {
    const stats = interruptionStats([
      {
        totalMs: 3_600_000, // one focused hour
        completed: [],
        interruptions: [
          {
            id: "1",
            dateISO: "2026-08-12",
            interruptedTitle: "Alpha",
            causeTitle: "Slack",
            atMs: 0,
            durationMs: 600_000,
            open: false,
            via: "interrupt",
          },
          {
            id: "2",
            dateISO: "2026-08-12",
            interruptedTitle: "Alpha",
            causeTitle: "Slack",
            atMs: 0,
            durationMs: 300_000,
            open: false,
            via: "switch",
          },
          {
            id: "3",
            dateISO: "2026-08-12",
            interruptedTitle: "Alpha",
            causeTitle: "Walk-up",
            atMs: 0,
            durationMs: 60_000,
            open: false,
            via: "interrupt",
          },
        ],
      },
    ]);
    expect(stats.count).toBe(3);
    expect(stats.totalMs).toBe(960_000);
    expect(stats.longestMs).toBe(600_000);
    expect(stats.perFocusHour).toBe(3);
    // Ranked by time cost, so the worst offender leads.
    expect(stats.topCauses[0]).toEqual({ title: "Slack", count: 2, totalMs: 900_000 });
  });

  it("counts an OPEN interruption but adds no partial duration", () => {
    const stats = interruptionStats([
      {
        totalMs: 0,
        completed: [],
        interruptions: [
          {
            id: "1",
            dateISO: "2026-08-12",
            interruptedTitle: "A",
            causeTitle: "B",
            atMs: 0,
            durationMs: 0,
            open: true,
            via: "interrupt",
          },
        ],
      },
    ]);
    expect(stats.count).toBe(1); // honest: it happened
    expect(stats.totalMs).toBe(0); // honest: it isn't over yet
  });

  it("surfaces STRETCHED tasks above the noise floor", () => {
    const stats = interruptionStats([
      {
        totalMs: 0,
        interruptions: [],
        completed: [
          // 2h focused, 5h elapsed = 2.5x. The headline case.
          { title: "Stretched", kind: "task", ms: 7_200_000, elapsedMs: 18_000_000 },
          // 1.1x is rounding, not a story.
          { title: "Normal", kind: "task", ms: 1_000_000, elapsedMs: 1_100_000 },
          // Steps never carry a span.
          { title: "A step", kind: "step", ms: 1000, elapsedMs: 999_999 },
        ],
      },
    ]);
    expect(stats.stretched).toHaveLength(1);
    expect(stats.stretched[0].title).toBe("Stretched");
    expect(stats.stretched[0].stretchRatio).toBe(2.5);
  });
});

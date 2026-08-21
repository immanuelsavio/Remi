import { describe, expect, it } from "vitest";

import { searchDays, summarise } from "./search";
import { allTags, matchesTags, normalizeTag, normalizeTags, parseTags } from "./tags";
import type { DayRecord } from "./types";

const days: DayRecord[] = [
  {
    day: 1,
    dateISO: "2026-08-10",
    completed: [
      { title: "Fix the login bug", kind: "task", ms: 3_600_000, tags: ["coding", "acme"] },
      { title: "Write tests", kind: "step", ms: 1_800_000, tags: ["coding", "acme"] },
    ],
    unfinished: [{ title: "Refactor auth", subs: [], tags: ["coding"] }],
    totalMs: 5_400_000,
  },
  {
    day: 2,
    dateISO: "2026-08-12",
    completed: [{ title: "Client call", kind: "task", ms: 1_800_000, tags: ["acme"] }],
    unfinished: [],
    totalMs: 1_800_000,
  },
];

describe("normalising tags", () => {
  it("folds case and stray punctuation into one tag", () => {
    // The whole point of a tag is that it matches next time.
    expect(normalizeTag("  #Coding ")).toBe("coding");
    expect(normalizeTag("ACME")).toBe("acme");
    expect(normalizeTag("side  project")).toBe("side project");
  });

  it("de-duplicates a list without reordering it", () => {
    expect(normalizeTags(["Coding", "coding", "#CODING", "acme"])).toEqual(["coding", "acme"]);
  });

  it("splits typed input on commas and newlines", () => {
    expect(parseTags("coding, acme\nside project")).toEqual(["coding", "acme", "side project"]);
  });

  it("caps length and count so one paste cannot bloat a task", () => {
    expect(normalizeTag("x".repeat(80)).length).toBe(32);
    expect(normalizeTags(Array.from({ length: 40 }, (_, i) => `t${i}`))).toHaveLength(12);
  });

  it("matches only when every wanted tag is present", () => {
    expect(matchesTags(["coding", "acme"], ["coding"])).toBe(true);
    expect(matchesTags(["coding"], ["coding", "acme"])).toBe(false);
    expect(matchesTags(undefined, [])).toBe(true); // no filter matches everything
  });

  it("ranks known tags by how often they are used", () => {
    expect(allTags(days.flatMap((d) => d.completed))[0]).toBe("acme");
  });
});

describe("searchDays", () => {
  it("finds completed work by title, case-insensitively", () => {
    expect(searchDays(days, { text: "LOGIN" }).map((h) => h.title)).toEqual(["Fix the login bug"]);
  });

  it("returns newest first", () => {
    expect(searchDays(days, {}).map((h) => h.dateISO)[0]).toBe("2026-08-12");
  });

  it("filters by tag, and requires all of them", () => {
    expect(searchDays(days, { tags: ["acme"] })).toHaveLength(3);
    expect(searchDays(days, { tags: ["coding", "acme"] }).map((h) => h.title)).toEqual([
      "Fix the login bug",
      "Write tests",
    ]);
  });

  it("leaves unfinished work out unless asked for it", () => {
    expect(searchDays(days, { text: "Refactor" })).toHaveLength(0);
    const withOpen = searchDays(days, { text: "Refactor", includeUnfinished: true });
    expect(withOpen).toHaveLength(1);
    expect(withOpen[0].done).toBe(false);
    expect(withOpen[0].ms).toBe(0);
  });

  it("honours date bounds", () => {
    expect(searchDays(days, { from: "2026-08-11", to: "2026-08-31" })).toHaveLength(1);
  });

  it("summarises what the results add up to", () => {
    const s = summarise(searchDays(days, { tags: ["acme"] }));
    expect(s.count).toBe(3);
    expect(s.ms).toBe(7_200_000);
    expect(s.days).toBe(2);
  });
});

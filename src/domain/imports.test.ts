import { describe, expect, it } from "vitest";

import { IMPORT_LIMITS, parseImport, parseWhen } from "./imports";

const T0 = new Date(2026, 7, 12, 10, 0, 0).getTime(); // Wed 12 Aug 2026, 10:00

describe("import parsing", () => {
  it("reads the documented format: tasks, indented steps, backlog", () => {
    const p = parseImport(
      [
        "Main Task 1",
        "    Subtask 1 @ in 30m",
        "    Subtask 2",
        "Main Task 2 @ by 3pm",
        "",
        "Backlog:",
        "    Later thing",
      ].join("\n"),
      T0,
    );
    expect(p.errors).toEqual([]);
    expect(p.mains.map((m) => m.title)).toEqual(["Main Task 1", "Main Task 2"]);
    expect(p.mains[0].subs.map((s) => s.title)).toEqual(["Subtask 1", "Subtask 2"]);
    expect(p.mains[0].subs[0].remind?.at).toBe(T0 + 30 * 60_000);
    expect(p.mains[1].remind?.short).toBe("by 3pm");
    expect(p.backlog.map((b) => b.title)).toEqual(["Later thing"]);
  });

  it("tolerates bullets and numbering", () => {
    const p = parseImport("- First\n* Second\n1. Third", T0);
    expect(p.mains.map((m) => m.title)).toEqual(["First", "Second", "Third"]);
  });

  it("reports an unreadable reminder without dropping the task", () => {
    const p = parseImport("Task @ whenever", T0);
    expect(p.mains).toHaveLength(1);
    expect(p.mains[0].remind).toBeNull();
    expect(p.errors[0]).toContain("couldn't read reminder");
  });

  it("truncates an absurd title and says so", () => {
    const p = parseImport("x".repeat(IMPORT_LIMITS.maxTitle + 50), T0);
    expect(p.mains[0].title).toHaveLength(IMPORT_LIMITS.maxTitle);
    expect(p.errors[0]).toContain("shortened");
  });

  it("stops at the item cap rather than hanging on a huge paste", () => {
    const p = parseImport(Array.from({ length: 600 }, (_, i) => `T${i}`).join("\n"), T0);
    expect(p.mains).toHaveLength(IMPORT_LIMITS.maxItems);
    expect(p.errors.some((e) => e.includes("Stopped at"))).toBe(true);
  });

  it("parses every documented `when` form", () => {
    expect(parseWhen("in 1h30m", T0)?.at).toBe(T0 + 90 * 60_000);
    expect(parseWhen("in 45m", T0)?.at).toBe(T0 + 45 * 60_000);
    expect(parseWhen("in 2h", T0)?.at).toBe(T0 + 120 * 60_000);
    expect(parseWhen("by 3pm", T0)?.short).toBe("by 3pm");
    expect(parseWhen("by 9:30am", T0)?.label).toContain("tomorrow"); // already past
    expect(parseWhen("2026-09-01 09:00", T0)?.kind).toBe("on");
    expect(parseWhen("gibberish", T0)).toBeNull();
  });
});

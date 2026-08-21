import { describe, expect, it } from "vitest";

import { endedOn, lastLoggedDay } from "./day-state";
import { freshDay } from "./defaults";
import type { DayRecord, State } from "./types";

function rec(dateISO: string, day: number): DayRecord {
  return { day, dateISO, completed: [], unfinished: [], totalMs: 0 };
}

function withHistory(...days: DayRecord[]): State {
  return { ...freshDay(), history: days };
}

describe("lastLoggedDay", () => {
  it("is null with no history at all", () => {
    expect(lastLoggedDay(withHistory())).toBeNull();
  });

  it("is the LATEST archived day, not the last array entry", () => {
    // History is kept date-sorted, but nothing should depend on that here -
    // a restored backup or a merged import can arrive in any order.
    const s = withHistory(rec("2026-08-19", 4), rec("2026-08-21", 6), rec("2026-08-20", 5));
    expect(lastLoggedDay(s)?.dateISO).toBe("2026-08-21");
  });
});

describe("endedOn", () => {
  it("is true when today has already been archived", () => {
    // You wrapped up, then came back the same afternoon. There is no new
    // day to start - only the one you closed, to reopen.
    const s = withHistory(rec("2026-08-21", 6));
    expect(endedOn(s, "2026-08-21")).toBe(true);
  });

  it("is false once the calendar has actually moved on", () => {
    const s = withHistory(rec("2026-08-20", 5));
    expect(endedOn(s, "2026-08-21")).toBe(false);
  });

  it("is false on a first run with no history", () => {
    expect(endedOn(withHistory(), "2026-08-21")).toBe(false);
  });

  it("ignores an archived date in the FUTURE", () => {
    // A clock change or a restored backup can leave a record dated ahead of
    // today. That must not permanently suppress starting a day - the test
    // is "today is already logged", not "some record is newer than today".
    const s = withHistory(rec("2099-01-01", 99));
    expect(endedOn(s, "2026-08-21")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { fmt, fmtEst } from "./time";
import { addDays, clockLabel, dateFromISO, todayISO } from "./dates";

describe("formatters", () => {
  it("formats a live timer as h:mm:ss, never negative", () => {
    expect(fmt(0)).toBe("0:00:00");
    expect(fmt(61_000)).toBe("0:01:01");
    expect(fmt(3_661_000)).toBe("1:01:01");
    expect(fmt(-5)).toBe("0:00:00");
  });

  it("formats totals compactly", () => {
    expect(fmtEst(0)).toBe("0m");
    expect(fmtEst(45 * 60_000)).toBe("45m");
    expect(fmtEst(60 * 60_000)).toBe("1h");
    expect(fmtEst(135 * 60_000)).toBe("2h 15m");
  });

  it("uses the LOCAL date, so the day cannot roll mid-evening", () => {
    // A UTC-based date would report the 2nd for anyone west of UTC.
    expect(todayISO(new Date(2026, 7, 1, 23, 30))).toBe("2026-08-01");
  });

  it("parses an ISO date as local, round-tripping through addDays", () => {
    expect(todayISO(dateFromISO("2026-08-01"))).toBe("2026-08-01");
    expect(addDays("2026-08-01", 1)).toBe("2026-08-02");
    expect(addDays("2026-08-01", -1)).toBe("2026-07-31");
    // Across a DST boundary the calendar date must still advance by exactly one.
    expect(addDays("2026-03-08", -1)).toBe("2026-03-07");
  });

  it("labels clock times in 12-hour form", () => {
    expect(clockLabel(14, 0)).toBe("2pm");
    expect(clockLabel(9, 5)).toBe("9:05am");
    expect(clockLabel(0, 0)).toBe("12am");
    expect(clockLabel(12, 0)).toBe("12pm");
  });
});

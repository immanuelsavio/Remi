import { describe, expect, it } from "vitest";

import { exportSuffix, nid } from "./ids";

describe("nid", () => {
  it("produces a non-empty string", () => {
    expect(nid().length).toBeGreaterThan(0);
  });

  it("never repeats across many calls", () => {
    const ids = new Set(Array.from({ length: 200 }, () => nid()));
    expect(ids.size).toBe(200);
  });
});

describe("exportSuffix", () => {
  it("is stable for the same millisecond timestamp only when random happens to repeat - so callers must not rely on the timestamp alone", () => {
    // Two calls at the EXACT same `now` still differ, because of the
    // random tail - this is what makes back-to-back exports collision-safe.
    const now = 1_700_000_000_000;
    const a = exportSuffix(now);
    const b = exportSuffix(now);
    expect(a).not.toBe(b);
  });

  it("encodes the timestamp so suffixes are naturally sortable-ish and traceable", () => {
    const suffix = exportSuffix(1_700_000_000_000);
    expect(suffix).toContain((1_700_000_000_000).toString(36));
  });

  it("never repeats across many calls even at default (real) now", () => {
    const suffixes = new Set(Array.from({ length: 100 }, () => exportSuffix()));
    expect(suffixes.size).toBe(100);
  });
});

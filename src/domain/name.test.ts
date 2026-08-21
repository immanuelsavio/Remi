import { describe, expect, it } from "vitest";

import { NAME_MAX, greeting, normalizeName, withName } from "./name";

describe("normalizeName", () => {
  it("keeps an ordinary name unchanged", () => {
    expect(normalizeName("Sam")).toBe("Sam");
  });

  it("trims and collapses whitespace", () => {
    expect(normalizeName("  Sam   Taylor  ")).toBe("Sam Taylor");
  });

  it("caps the length so it cannot overflow the interface", () => {
    // The name is rendered inside headings, buttons and a popover only a
    // menu bar wide. An unbounded string breaks all three, and nothing
    // downstream clamps it.
    expect(normalizeName("a".repeat(200))).toHaveLength(NAME_MAX);
  });

  it("does not leave a trailing space after capping mid-word", () => {
    const name = normalizeName("Bartholomew Fitzgerald Windsor III and friends");
    expect(name).toBe(name.trim());
  });

  it("strips control characters and newlines", () => {
    expect(normalizeName("Sa\nm\t ")).toBe("Sa m");
  });

  it("is empty for junk-only input", () => {
    expect(normalizeName("   ")).toBe("");
    expect(normalizeName(undefined as unknown as string)).toBe("");
    expect(normalizeName(42 as unknown as string)).toBe("");
  });
});

describe("withName", () => {
  it("appends the name to a phrase", () => {
    expect(withName("Good morning", "Sam")).toBe("Good morning, Sam");
  });

  it("leaves the phrase exactly alone when there is no name", () => {
    // Never "Good morning, " with a dangling comma.
    expect(withName("Good morning", "")).toBe("Good morning");
  });
});

describe("greeting", () => {
  it("greets by hour", () => {
    expect(greeting(6)).toBe("Good morning");
    expect(greeting(13)).toBe("Good afternoon");
    expect(greeting(20)).toBe("Good evening");
  });

  it("treats the small hours as morning rather than yesterday evening", () => {
    expect(greeting(2)).toBe("Good morning");
  });
});

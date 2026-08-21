import { describe, expect, it } from "vitest";

import { DEFAULT_TARGET_MINS, ACCENTS } from "./types";
import { freshDay } from "./defaults";
import { hydrate, looksLikeRemiState } from "./hydration";

describe("hydrate", () => {
  it("returns a fresh day for junk input", () => {
    for (const junk of [null, undefined, 42, "nope", [], true]) {
      const s = hydrate(junk);
      expect(s.mains).toEqual([]);
      expect(s.dayNum).toBe(1);
    }
  });

  it("repairs impossible values instead of trusting them", () => {
    const s = hydrate({
      dayNum: -5,
      dayTargetMins: 2,
      accent: "chartreuse",
      mode: "sepia",
      phase: "wat",
      startedAt: -100,
      life: 99,
      pingMin: -3,
      mains: [{ title: "ok", accrued: -9, carries: -1 }, null, "junk", 42],
    });
    expect(s.dayNum).toBe(1);
    expect(s.dayTargetMins).toBeGreaterThanOrEqual(30);
    expect(s.accent).toBe("remi");
    expect(s.mode).toBe("light");
    expect(s.phase).toBe("today");
    expect(s.startedAt).toBe(0);
    expect(s.life).toBe(1);
    expect(s.pingMin).toBe(0);
    // Only the real object survives; a truthy bare string is NOT a task.
    expect(s.mains).toHaveLength(1);
    expect(s.mains[0].accrued).toBe(0);
    expect(s.mains[0].carries).toBe(0);
  });

  it("defaults notification prefs ON for a file that predates them", () => {
    // Absent must not read as "the user turned this off".
    const s = hydrate({ dayNum: 2 });
    expect(s.notifyReminders).toBe(true);
    expect(s.notifyBreakEnd).toBe(true);
    expect(s.welcomeBack).toBe(true);
    expect(s.trayTimer).toBe(true);
    // The mascot is part of the app's character, not a notification - an
    // existing install should meet it rather than have it silently absent.
    expect(s.mascotOn).toBe(true);
    expect(s.wakeAnimation).toBe(true);
    // …but privacy redaction defaults OFF, since it changes what banners say.
    expect(s.privateNotifications).toBe(false);
  });

  it("honours an explicit false", () => {
    const s = hydrate({
      notifyReminders: false,
      trayTimer: false,
      mascotOn: false,
      wakeAnimation: false,
      privateNotifications: true,
    });
    expect(s.notifyReminders).toBe(false);
    expect(s.trayTimer).toBe(false);
    expect(s.mascotOn).toBe(false);
    expect(s.wakeAnimation).toBe(false);
    expect(s.privateNotifications).toBe(true);
  });

  it("merges wellness over the defaults so a new key is never missing", () => {
    const s = hydrate({ wellness: { water: { on: true, everyMin: 30, _last: 5 } } });
    expect(s.wellness.water).toMatchObject({ on: true, everyMin: 30, _last: 5 });
    expect(s.wellness.lunch).toMatchObject({ on: false, atHour: 13 });
    expect(Object.keys(s.wellness).sort()).toEqual(
      ["breakr", "lunch", "stand", "walk", "water"].sort(),
    );
  });

  it("drops a reminder with no usable time", () => {
    const s = hydrate({
      mains: [{ title: "t", remind: { kind: "in", at: "nonsense" } }],
    });
    expect(s.mains[0].remind).toBeNull();
  });

  it("drops a history record with no date", () => {
    // It could never be placed on a calendar or counted in a streak.
    const s = hydrate({
      history: [
        { day: 1, dateISO: "2026-08-11", completed: [], unfinished: [], totalMs: 0 },
        { day: 2, completed: [], unfinished: [], totalMs: 0 },
      ],
    });
    expect(s.history).toHaveLength(1);
  });

  it("clears a session pointing at a task that no longer exists", () => {
    // Otherwise it would tick forever and bank into nothing.
    const s = hydrate({
      mains: [{ id: "m1", title: "real" }],
      activeMainId: "ghost",
      startedAt: 1000,
      phase: "active",
    });
    expect(s.activeMainId).toBeNull();
    expect(s.startedAt).toBe(0);
    expect(s.phase).toBe("today");
  });

  it("clears a session pointing at a DONE task", () => {
    const s = hydrate({
      mains: [{ id: "m1", title: "finished", done: true }],
      activeMainId: "m1",
      startedAt: 1000,
      phase: "active",
    });
    expect(s.activeMainId).toBeNull();
  });

  it("falls back to the parent when the active STEP is missing", () => {
    const s = hydrate({
      mains: [{ id: "m1", title: "parent", subs: [{ id: "s1", title: "kept" }] }],
      activeMainId: "m1",
      activeSubId: "ghost",
      startedAt: 1000,
      phase: "active",
    });
    expect(s.activeMainId).toBe("m1");
    expect(s.activeSubId).toBeNull();
  });

  it("drops return-stack entries whose target is gone", () => {
    const s = hydrate({
      mains: [{ id: "m1", title: "real" }],
      returnStack: [{ mainId: "m1", subId: null }, { mainId: "ghost", subId: null }, null],
    });
    expect(s.returnStack).toEqual([{ mainId: "m1", subId: null }]);
  });

  it("infers awaitingStart for a file that predates the flag", () => {
    // Empty day on the start screen has effectively not begun.
    expect(hydrate({ mains: [], phase: "startday" }).awaitingStart).toBe(true);
    expect(hydrate({ mains: [{ title: "x" }], phase: "today" }).awaitingStart).toBe(false);
    // An explicit value always wins.
    expect(hydrate({ awaitingStart: false, mains: [], phase: "startday" }).awaitingStart).toBe(
      false,
    );
  });

  it("always starts transient UI clean", () => {
    const s = hydrate({ overlay: "endday", subsOpen: true, switchReason: "checkin" });
    expect(s.overlay).toBeNull();
    expect(s.subsOpen).toBe(false);
    expect(s.switchReason).toBe("");
  });

  it("preserves a valid state round-trip", () => {
    const before = freshDay(4);
    before.accent = "teal";
    before.mode = "dark";
    before.trainerOn = true;
    before.pto = ["2026-08-11"];
    before.backlog = [{ id: "b1", title: "later", remind: null }];
    const after = hydrate(JSON.parse(JSON.stringify(before)));
    expect(after.dayNum).toBe(4);
    expect(after.accent).toBe("teal");
    expect(after.mode).toBe("dark");
    expect(after.trainerOn).toBe(true);
    expect(after.pto).toEqual(["2026-08-11"]);
    expect(after.backlog[0].title).toBe("later");
  });

  it("accepts every accent in ACCENTS and each has a real hex", () => {
    for (const [name, hex] of ACCENTS) {
      expect(hydrate({ accent: name }).accent).toBe(name);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(freshDay().dayTargetMins).toBe(DEFAULT_TARGET_MINS);
  });
});

describe("looksLikeRemiState", () => {
  it("rejects junk and non-object input", () => {
    for (const junk of [null, undefined, 42, "nope", [], true, "{}"]) {
      expect(looksLikeRemiState(junk)).toBe(false);
    }
  });

  it("rejects an empty object - hydrate({}) would silently look like a fresh valid day", () => {
    expect(looksLikeRemiState({})).toBe(false);
  });

  it("rejects an unrelated object that happens to be valid JSON", () => {
    expect(looksLikeRemiState({ foo: 1, bar: [1, 2, 3] })).toBe(false);
  });

  it("accepts a real state export", () => {
    expect(looksLikeRemiState(freshDay(3))).toBe(true);
  });

  it("rejects an object missing any one required marker", () => {
    const base = freshDay(3) as unknown as Record<string, unknown>;
    for (const key of ["v", "dayNum", "dateISO", "mains"]) {
      const { [key]: _omit, ...rest } = base;
      expect(looksLikeRemiState(rest)).toBe(false);
    }
  });
});

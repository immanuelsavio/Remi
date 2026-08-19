/**
 * Tests for the PURE layer: formatters, roll-ups, streaks, reminders, import,
 * the trainer, interruption analysis, and `hydrate`.
 *
 * Nothing here touches the store or Tauri, so every case is a plain function
 * call with an explicit `now` - no fake timers, no mocks.
 */
import { describe, expect, it } from "vitest";

import {
  ACCENTS,
  DEFAULT_TARGET_MINS,
  IMPORT_LIMITS,
  addDays,
  canMarkPto,
  carrySnapshot,
  clockLabel,
  completedToday,
  computeStreaks,
  dateFromISO,
  daySnapshot,
  dueReminders,
  elapsedOf,
  enrichSnapshot,
  firstBrokenDayISO,
  fmt,
  fmtEst,
  forPersist,
  freshDay,
  hydrate,
  interruptionStats,
  isWeekend,
  mainTotal,
  makeRemind,
  mkMain,
  mkSub,
  parseImport,
  parseWhen,
  timeSense,
  todayAsRecord,
  todayISO,
  todayTrackedMs,
  unfinishedToday,
  type DayRecord,
  type State,
} from "./model";

/** A fixed reference point so every time assertion is deterministic. */
const T0 = new Date(2026, 7, 12, 10, 0, 0).getTime(); // Wed 12 Aug 2026, 10:00

// ===========================================================================
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

// ===========================================================================
describe("roll-ups", () => {
  function dayWith(): State {
    const s = freshDay();
    const a = mkMain("Alpha");
    a.accrued = 600_000; // 10m
    a.subs = [mkSub("step one"), mkSub("step two")];
    a.subs[0].accrued = 60_000;
    a.subs[0].done = true;
    const b = mkMain("Beta");
    b.accrued = 300_000;
    b.done = true;
    s.mains = [a, b];
    return s;
  }

  it("rolls a task's total up from its steps", () => {
    const s = dayWith();
    expect(mainTotal(s.mains[0], s, T0)).toBe(660_000);
  });

  it("includes the LIVE session in the active task's total only", () => {
    const s = dayWith();
    s.activeMainId = s.mains[0].id;
    s.startedAt = T0 - 30_000;
    expect(mainTotal(s.mains[0], s, T0)).toBe(690_000);
    expect(mainTotal(s.mains[1], s, T0)).toBe(300_000); // untouched
    expect(todayTrackedMs(s, T0)).toBe(660_000 + 300_000 + 30_000);
  });

  it("computes one item's elapsed time with and without a live session", () => {
    const sub = mkSub("x");
    sub.accrued = 1000;
    expect(elapsedOf(sub, false, 0, T0)).toBe(1000);
    expect(elapsedOf(sub, true, T0 - 500, T0)).toBe(1500);
    expect(elapsedOf(null, true, T0 - 500, T0)).toBe(0);
  });

  it("separates completed tasks and steps from unfinished work", () => {
    const s = dayWith();
    const done = completedToday(s);
    expect(done).toEqual([
      { title: "step one", kind: "step", ms: 60_000 },
      { title: "Beta", kind: "task", ms: 300_000 },
    ]);
    const open = unfinishedToday(s);
    expect(open).toHaveLength(1);
    expect(open[0].title).toBe("Alpha");
    // Only the OPEN step carries forward.
    expect(open[0].subs.map((x) => x.title)).toEqual(["step two"]);
  });

  it("snapshots the day for the archive", () => {
    const s = dayWith();
    const snap = daySnapshot(s, T0);
    expect(snap.day).toBe(s.dayNum);
    expect(snap.dateISO).toBe(s.dateISO);
    expect(snap.totalMs).toBe(960_000);
  });

  it("enriches the snapshot with the interruption evidence", () => {
    const s = dayWith();
    s.mains[1].firstStartedAt = T0 - 3_600_000;
    s.mains[1].completedAt = T0;
    s.mains[1].interruptedCount = 2;
    s.mains[1].interruptedMs = 600_000;
    s.mains[1].estMs = 300_000;
    const snap = enrichSnapshot(s, daySnapshot(s, T0));
    const beta = snap.completed.find((c) => c.title === "Beta")!;
    // 5m focused, but an hour of wall clock: that gap IS the product's subject.
    expect(beta.elapsedMs).toBe(3_600_000);
    expect(beta.interruptedCount).toBe(2);
    expect(beta.estMs).toBe(300_000);
    // Steps never carry a span.
    expect(snap.completed.find((c) => c.kind === "step")!.elapsedMs).toBeUndefined();
  });

  it("carries an unfinished task WITH its notes, reminder and estimate", () => {
    const m = mkMain("Carry me");
    m.note = "remember the context";
    m.estMs = 900_000;
    m.carries = 2;
    m.remind = makeRemind("in", 30, T0);
    m.subs = [mkSub("open step"), mkSub("finished step")];
    m.subs[0].note = "step note";
    m.subs[1].done = true;

    const snap = carrySnapshot(m);
    expect(snap.carries).toBe(3); // incremented, driving the avoidance nudge
    expect(snap.note).toBe("remember the context");
    expect(snap.estMs).toBe(900_000);
    expect(snap.remind?.kind).toBe("in");
    // Only the open step carries, and it keeps its note.
    expect(snap.subs).toEqual([
      { title: "open step", note: "step note", remind: null },
    ]);
  });

  it("shapes today as a record so stats can reuse the same code", () => {
    const s = dayWith();
    const rec = todayAsRecord(s, T0);
    expect(rec.totalMs).toBe(960_000);
    expect(rec.interruptions).toEqual([]);
  });
});

// ===========================================================================
describe("streaks", () => {
  /** Build a state whose history has completed work on each given date. */
  function withDays(dates: string[], today: string): State {
    const s = freshDay();
    s.dateISO = today;
    s.history = dates.map(
      (dateISO, i): DayRecord => ({
        day: i + 1,
        dateISO,
        completed: [{ title: "t", kind: "task", ms: 1000 }],
        unfinished: [],
        totalMs: 1000,
      }),
    );
    return s;
  }

  it("knows weekends", () => {
    expect(isWeekend("2026-08-15")).toBe(true); // Saturday
    expect(isWeekend("2026-08-16")).toBe(true); // Sunday
    expect(isWeekend("2026-08-17")).toBe(false); // Monday
  });

  it("counts consecutive worked days", () => {
    // Mon-Wed worked, today is Wednesday.
    const s = withDays(["2026-08-10", "2026-08-11", "2026-08-12"], "2026-08-12");
    expect(computeStreaks(s).current).toBe(3);
  });

  it("bridges a WEEKEND for free", () => {
    // Fri worked, Sat+Sun off, Mon worked -> a 3-day streak, not two 1-day ones.
    const s = withDays(["2026-08-14", "2026-08-17"], "2026-08-17");
    expect(computeStreaks(s).current).toBe(2);
    expect(computeStreaks(s).broken).toBeNull();
  });

  it("breaks on a genuinely missed WEEKDAY", () => {
    // Mon worked, Tue missed, Wed worked -> only Wed counts.
    const s = withDays(["2026-08-10", "2026-08-12"], "2026-08-12");
    expect(computeStreaks(s).current).toBe(1);
    expect(firstBrokenDayISO(s)).toBe("2026-08-11");
  });

  it("bridges a PTO day", () => {
    const s = withDays(["2026-08-10", "2026-08-12"], "2026-08-12");
    s.pto = ["2026-08-11"];
    expect(computeStreaks(s).current).toBe(2);
    expect(computeStreaks(s).broken).toBeNull();
  });

  it("bridges a REVIVED day", () => {
    const s = withDays(["2026-08-10", "2026-08-12"], "2026-08-12");
    s.revived = ["2026-08-11"];
    expect(computeStreaks(s).current).toBe(2);
  });

  it("never counts dates before day 1 as misses", () => {
    const s = withDays(["2026-08-12"], "2026-08-12");
    // The walk stops at the floor rather than marching back through all history.
    expect(computeStreaks(s).current).toBe(1);
    expect(firstBrokenDayISO(s)).toBeNull();
  });

  it("does not treat an unworked TODAY as a missed day", () => {
    // Today isn't over; a revive heart must not be spendable on it.
    const s = withDays(["2026-08-11"], "2026-08-12");
    expect(firstBrokenDayISO(s)).toBeNull();
    expect(computeStreaks(s).current).toBe(1);
  });

  it("reports the longest streak alongside the current one", () => {
    const s = withDays(
      ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-12"],
      "2026-08-12",
    );
    const st = computeStreaks(s);
    expect(st.current).toBe(1);
    expect(st.longest).toBe(5);
  });

  it("allows PTO only for today or the future", () => {
    expect(canMarkPto("2026-08-12", "2026-08-12")).toBe(true);
    expect(canMarkPto("2026-08-13", "2026-08-12")).toBe(true);
    // Never retroactively, which would erase a real miss.
    expect(canMarkPto("2026-08-11", "2026-08-12")).toBe(false);
  });
});

// ===========================================================================
describe("reminders", () => {
  it("builds a relative reminder", () => {
    const r = makeRemind("in", 90, T0)!;
    expect(r.at).toBe(T0 + 90 * 60_000);
    expect(r.short).toBe("in 1h 30m");
  });

  it("builds a clock-time reminder for later today", () => {
    const r = makeRemind("by", "14:30", T0)!; // now is 10:00
    expect(new Date(r.at).getHours()).toBe(14);
    expect(r.short).toBe("by 2:30pm");
    expect(r.label).not.toContain("tomorrow");
  });

  it("ROLLS a past clock time to tomorrow", () => {
    const r = makeRemind("by", "09:00", T0)!; // 9am already passed
    expect(r.at).toBeGreaterThan(T0);
    expect(r.label).toContain("tomorrow");
    expect(new Date(r.at).getDate()).toBe(13);
  });

  it("rejects nonsense times and clears on demand", () => {
    expect(makeRemind("by", "99:99", T0)).toBeNull();
    expect(makeRemind("by", "abc", T0)).toBeNull();
    expect(makeRemind("on", "not-a-date", T0)).toBeNull();
    expect(makeRemind("clear", "", T0)).toBeNull();
  });

  it("finds only reminders that are due AND undelivered", () => {
    const s = freshDay();
    const m = mkMain("has one");
    m.remind = makeRemind("in", 1, T0 - 120_000); // due a minute ago
    const already = mkMain("delivered");
    already.remind = { ...makeRemind("in", 1, T0 - 120_000)!, delivered: true };
    const future = mkMain("later");
    future.remind = makeRemind("in", 60, T0);
    s.mains = [m, already, future];
    s.backlog = [{ id: "b1", title: "backlog item", remind: makeRemind("in", 1, T0 - 120_000) }];

    const due = dueReminders(s, T0);
    expect(due.map((d) => d.title).sort()).toEqual(["backlog item", "has one"]);
    expect(due.find((d) => d.title === "has one")!.where).toBe(`main|${m.id}`);
  });

  it("locates a step's reminder so it can be marked delivered", () => {
    const s = freshDay();
    const m = mkMain("parent", [mkSub("child")]);
    m.subs[0].remind = makeRemind("in", 1, T0 - 120_000);
    s.mains = [m];
    expect(dueReminders(s, T0)[0].where).toBe(`sub|${m.id}~${m.subs[0].id}`);
  });
});

// ===========================================================================
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

// ===========================================================================
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
            id: "1", dateISO: "2026-08-12", interruptedTitle: "Alpha", causeTitle: "Slack",
            atMs: T0, durationMs: 600_000, open: false, via: "interrupt",
          },
          {
            id: "2", dateISO: "2026-08-12", interruptedTitle: "Alpha", causeTitle: "Slack",
            atMs: T0, durationMs: 300_000, open: false, via: "switch",
          },
          {
            id: "3", dateISO: "2026-08-12", interruptedTitle: "Alpha", causeTitle: "Walk-up",
            atMs: T0, durationMs: 60_000, open: false, via: "interrupt",
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
            id: "1", dateISO: "2026-08-12", interruptedTitle: "A", causeTitle: "B",
            atMs: T0, durationMs: 0, open: true, via: "interrupt",
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

// ===========================================================================
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
    expect(s.accent).toBe("amber");
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
    // …but privacy redaction defaults OFF, since it changes what banners say.
    expect(s.privateNotifications).toBe(false);
  });

  it("honours an explicit false", () => {
    const s = hydrate({ notifyReminders: false, trayTimer: false, privateNotifications: true });
    expect(s.notifyReminders).toBe(false);
    expect(s.trayTimer).toBe(false);
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

// ===========================================================================
describe("forPersist", () => {
  it("strips transient UI fields and stamps savedAt", () => {
    const s = freshDay();
    s.overlay = "endday";
    s.subsOpen = true;
    s.switchReason = "checkin";
    const out = forPersist(s, T0);
    expect(out.overlay).toBeUndefined();
    expect(out.subsOpen).toBeUndefined();
    expect(out.switchReason).toBeUndefined();
    expect(out.savedAt).toBe(T0);
    // Durable product state survives.
    expect(out.dayNum).toBe(1);
    expect(out.mains).toEqual([]);
  });

  it("round-trips through hydrate without losing durable fields", () => {
    const s = freshDay(3);
    s.mains = [mkMain("keep me")];
    s.mains[0].accrued = 5000;
    const back = hydrate(JSON.parse(JSON.stringify(forPersist(s, T0))));
    expect(back.dayNum).toBe(3);
    expect(back.mains[0].title).toBe("keep me");
    expect(back.mains[0].accrued).toBe(5000);
    expect(back.savedAt).toBe(T0);
  });
});

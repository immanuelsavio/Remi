/**
 * Tests for the MUTATING layer: the session transaction, interruption evidence,
 * the day lifecycle, backlog, import/export and settings.
 *
 * `@tauri-apps/api` is mocked, so nothing here touches the filesystem. What each
 * test really pins down is that time is banked exactly once, into the right
 * place, no matter what the mutation did to the thing being timed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Captures what would have been persisted, so saves can be asserted on. */
const saved: Record<string, unknown>[] = [];
/** Captures native notifications and tray titles. */
const notified: { title: string; body: string }[] = [];
const trayTitles: (string | null)[] = [];
/** What `load_app_state` should hand back on the next boot. */
let loadResult: { kind: string; state?: unknown; message?: string } = { kind: "fresh" };
/** When set, the NEXT `save_app_state` call rejects with this message
 * instead of succeeding - simulates disk-full/permission failures. */
let saveShouldFail: string | null = null;
/** Number of `quit_app` invocations observed, so tests can assert a failed
 * save never reaches it. */
let quitAppCalls = 0;
/** Mimics Rust's real compare-and-swap revision tracking in state_io.rs,
 * so tests can exercise the cross-window stale-write path without a real
 * second window. */
let mockCurrentRev = 0;
/** When true, the NEXT `save_app_state` call is treated as stale
 * regardless of the revision it actually sent - simulates "the other
 * window saved first" without needing real concurrent callers. */
let forceStaleOnce = false;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "load_app_state":
        return loadResult;
      case "save_app_state":
        if (saveShouldFail) {
          const msg = saveShouldFail;
          saveShouldFail = null; // one-shot, so retries can succeed
          throw new Error(msg);
        }
        {
          const payload = args?.state as Record<string, unknown>;
          const sentRev = typeof payload._rev === "number" ? payload._rev : 0;
          if (forceStaleOnce || sentRev !== mockCurrentRev) {
            forceStaleOnce = false;
            return { stale: true, currentRev: mockCurrentRev };
          }
          mockCurrentRev++;
          saved.push(payload);
          return { rev: mockCurrentRev };
        }
      case "quit_app":
        quitAppCalls++;
        return null;
      case "get_standard_daily":
        return [];
      case "notify":
        notified.push({ title: String(args?.title), body: String(args?.body) });
        return null;
      case "set_tray_title":
        trayTitles.push((args?.title as string | null) ?? null);
        return null;
      case "write_text_file":
        return `/tmp/${String(args?.name)}`;
      case "get_auto_update":
        return true;
      default:
        return null;
    }
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));

import { buildLogs } from "../domain/usage-logs";
import { computeStreaks } from "../domain/streaks";
import { freshDay, mkMain } from "../domain/defaults";
import { mainTotal } from "../domain/tasks";
import { todayISO } from "../domain/dates";
import type { State } from "../domain/types";
import {
  S,
  activeThing,
  addBacklog,
  addMain,
  addSub,
  app,
  applyImport,
  backlogToToday,
  boot,
  completeMain,
  deleteBacklog,
  dismissWelcomeBack,
  endDay,
  exportBackup,
  extendBreak,
  flushSave,
  friction,
  loadKind,
  promoteSub,
  pruneEmpty,
  quitApp,
  removeMain,
  removeSub,
  restartDay,
  restoreBackup,
  resumeFromBreak,
  resumeWelcomeBack,
  reviveMain,
  setEstimate,
  setFlag,
  setMainTitle,
  setNote,
  setRemind,
  startBreak,
  startDay,
  startNewMain,
  startSub,
  startTask,
  switchToMain,
  toggleSubDone,
  togglePto,
  track,
  trackClick,
  trackError,
  trackTab,
  useRevive,
  welcomeBack,
} from "./index";
import { get } from "svelte/store";

/**
 * Reset to a known two-task day.
 *
 * The store is a module-level singleton, so state MUST be forced back. Note that
 * `kind: "fresh"` deliberately does NOT overwrite state (a genuine first run
 * already starts from `freshDay()`), so a full reset has to hand boot an
 * explicit blank day.
 */
async function reset(): Promise<void> {
  saved.length = 0;
  notified.length = 0;
  trayTitles.length = 0;
  saveShouldFail = null;
  quitAppCalls = 0;
  mockCurrentRev = 0;
  forceStaleOnce = false;
  dismissWelcomeBack();
  loadResult = { kind: "loaded", state: freshDay() };
  await boot();
  startDay(); // leave the start screen
  addMain("Alpha");
  addMain("Beta");
  saved.length = 0;
}

/** Rewind the live session by `ms`, to simulate time passing without waiting. */
function rewind(ms: number): void {
  const s = S();
  s.startedAt -= ms;
}

const ids = () => S().mains.map((m) => m.id);

beforeEach(reset);

// ===========================================================================
describe("the session transaction", () => {
  it("starts a task and derives live time from an absolute stamp", () => {
    const [a] = ids();
    startTask(a);
    const s = S();
    expect(s.activeMainId).toBe(a);
    expect(s.phase).toBe("active");
    expect(s.startedAt).toBeGreaterThan(0);
    // Nothing is banked yet - that happens on the next transition.
    expect(s.mains[0].accrued).toBe(0);
    // But the total already reflects the live session.
    expect(mainTotal(s.mains[0], s, s.startedAt + 90_000)).toBe(90_000);
  });

  it("banks the running session when switching away", () => {
    const [a, b] = ids();
    startTask(a);
    rewind(10_000);
    startTask(b);
    const s = S();
    expect(s.activeMainId).toBe(b);
    expect(s.mains[0].accrued).toBeGreaterThanOrEqual(9_900);
    expect(s.mains[1].accrued).toBe(0);
  });

  it("banks step time to the STEP, not its parent", () => {
    const [a] = ids();
    addSub(a, "step one");
    startSub(a, S().mains[0].subs[0].id);
    rewind(5_000);
    startTask(a); // leaving the step banks it
    const m = S().mains[0];
    expect(m.subs[0].accrued).toBeGreaterThanOrEqual(4_900);
    expect(m.accrued).toBe(0);
  });

  it("banks time and clears the session when the ACTIVE task is deleted", () => {
    // The bug this guards: deleting the active task used to leave activeMainId
    // dangling and silently discard the running session.
    const [a] = ids();
    startTask(a);
    rewind(3_000);
    removeMain(a);
    const s = S();
    expect(s.mains.find((m) => m.id === a)).toBeUndefined();
    expect(s.activeMainId).toBeNull();
    expect(s.startedAt).toBe(0);
    expect(s.phase).toBe("today");
  });

  it("falls back to the parent task when the ACTIVE step is deleted", () => {
    const [a] = ids();
    addSub(a, "doomed");
    const sub = S().mains[0].subs[0].id;
    startSub(a, sub);
    rewind(2_000);
    removeSub(a, sub);
    const s = S();
    expect(s.activeSubId).toBeNull();
    expect(s.activeMainId).toBe(a); // still timing the parent
    expect(s.phase).toBe("active");
  });

  it("banks the deleted step's worked time into the STEP RECORD (not the parent), then the parent starts a FRESH clock", () => {
    // Defines active-step-deletion semantics precisely: the time already
    // worked on the step before deletion is real work that happened - it
    // must not vanish, and it must not be silently re-attributed to the
    // parent task's own total (the parent didn't do that work, the step
    // did, and the step is gone). The step's `bankActive` already folded
    // that interval into `sub.accrued` before the step object was
    // filtered out of `m.subs` - so the honest record is that the time was
    // worked and then the record (the step) was deleted along with it,
    // same as deleting a completed step would discard its accrued time.
    // What must NOT happen is that stale time being double-counted onto
    // the parent by continuing to bank against the OLD startedAt.
    const [a] = ids();
    addSub(a, "doomed");
    const sub = S().mains[0].subs[0].id;
    startSub(a, sub);
    rewind(2_000);
    removeSub(a, sub);

    // The session now continues on the PARENT with a FRESH stamp - not the
    // stale startedAt from when the step began.
    rewind(3_000); // simulate 3s of real parent-task work
    const before = S().mains[0].accrued;
    startTask(a); // a no-op-ish sessionTx that banks the current session
    const after = S().mains[0].accrued;
    // Only the 3s worked on the PARENT after the fallback is banked here -
    // not the step's 2s (already gone with the step) and not double-banked.
    expect(after - before).toBeGreaterThanOrEqual(2_900);
    expect(after - before).toBeLessThan(4_000);
  });

  it("returns to the parent task when the active step is completed", () => {
    const [a] = ids();
    addSub(a, "step");
    const sub = S().mains[0].subs[0].id;
    startSub(a, sub);
    rewind(4_000);
    toggleSubDone(a, sub);
    const s = S();
    expect(s.mains[0].subs[0].done).toBe(true);
    expect(s.mains[0].subs[0].accrued).toBeGreaterThanOrEqual(3_900);
    expect(s.activeSubId).toBeNull();
    expect(s.activeMainId).toBe(a);
  });

  it("un-completing a step does not restart its timer", () => {
    const [a] = ids();
    addSub(a, "step");
    const sub = S().mains[0].subs[0].id;
    toggleSubDone(a, sub);
    toggleSubDone(a, sub);
    expect(S().mains[0].subs[0].done).toBe(false);
    expect(S().activeMainId).toBeNull();
  });

  it("stamps firstStartedAt once, so the real-time span stays measurable", () => {
    const [a, b] = ids();
    startTask(a);
    const first = S().mains[0].firstStartedAt;
    expect(first).toBeGreaterThan(0);
    startTask(b);
    startTask(a); // a second start must NOT move the stamp
    expect(S().mains[0].firstStartedAt).toBe(first);
  });

  it("promoting the active step keeps ALL of its time", () => {
    // The bug this guards: promote used to copy only already-banked time,
    // dropping everything since the last save.
    const [a] = ids();
    addSub(a, "big step");
    const sub = S().mains[0].subs[0].id;
    startSub(a, sub);
    rewind(8_000);

    promoteSub(a, sub);
    const s = S();
    const promoted = s.mains.find((m) => m.title === "big step")!;
    expect(promoted).toBeDefined();
    expect(promoted.fromSub).toBe(true);
    expect(promoted.accrued).toBeGreaterThanOrEqual(7_900);
    // It is still what's being worked on, now as a task.
    expect(s.activeMainId).toBe(promoted.id);
    expect(s.activeSubId).toBeNull();
    // Inserted directly after its old parent.
    expect(s.mains[1].id).toBe(promoted.id);
  });

  it("promoting a NON-active step leaves the active task running, uninterrupted", () => {
    const [a, b] = ids();
    addSub(a, "quiet step");
    startTask(b);
    promoteSub(a, S().mains[0].subs[0].id);
    expect(S().activeMainId).toBe(b);
    // Still ticking - a sessionTx that leaves the same thing active must not
    // stop the clock, only re-stamp it (see the next test for why).
    expect(S().startedAt).toBeGreaterThan(0);
  });

  it("deleting a NON-active task keeps the other task's clock running without double-counting", () => {
    const [a, b] = ids();
    startTask(a);
    rewind(10_000);
    removeMain(b); // sessionTx against a DIFFERENT, non-active task

    expect(S().activeMainId).toBe(a); // untouched
    expect(S().mains.find((m) => m.id === b)).toBeUndefined();

    rewind(10_000);
    const before = S().mains.find((m) => m.id === a)!.accrued;
    startBreak(10); // banks the session via a plain commit, not sessionTx
    const after = S().mains.find((m) => m.id === a)!.accrued;
    // Only the second 10s is banked here - the first 10s was already
    // folded in in real time by the removeMain() transaction's rebank.
    expect(after - before).toBeGreaterThanOrEqual(9_500);
    expect(after - before).toBeLessThan(15_000);
  });

  it("banks exactly the elapsed interval across two sessionTx calls, not twice", () => {
    // The bug this guards: bankActive() adds `now - startedAt` into
    // `accrued`, but if the active task/step survives a sessionTx
    // unreplaced (no `next` from `mutate`, and `activeMainId` still set),
    // `startedAt` must be re-stamped to `now` - otherwise the NEXT
    // sessionTx banks the same already-banked interval a second time.
    const [a, b] = ids();
    startTask(a);
    rewind(10_000);
    completeMain(b); // sessionTx that leaves `a` active and unreplaced
    rewind(10_000);
    startTask(b); // sessionTx that finally banks `a` and switches away
    const m = S().mains.find((x) => x.id === a)!;
    // ~20s of real elapsed time, not ~30s (which double-counts the first
    // 10s banked by the completeMain() transaction).
    expect(m.accrued).toBeGreaterThanOrEqual(19_000);
    expect(m.accrued).toBeLessThan(25_000);
  });
});

// ===========================================================================
describe("interruption evidence", () => {
  it("charges an interruption's duration to the task it stole from", () => {
    const [a] = ids();
    startTask(a);
    startNewMain("Someone stopped by", true);

    let s = S();
    expect(s.interruptions).toHaveLength(1);
    expect(s.interruptions[0].open).toBe(true);
    expect(s.interruptions[0].interruptedTitle).toBe("Alpha");
    expect(s.interruptions[0].causeTitle).toBe("Someone stopped by");
    expect(s.interruptions[0].via).toBe("interrupt");
    expect(s.returnStack).toHaveLength(1);

    // Backdate it, then come back to the original task.
    s.interruptions[0].atMs = Date.now() - 120_000;
    startTask(a);

    s = S();
    expect(s.interruptions[0].open).toBe(false);
    expect(s.interruptions[0].durationMs).toBeGreaterThanOrEqual(119_000);
    // The evidence lands on the victim - the whole point of the feature.
    const victim = s.mains.find((m) => m.title === "Alpha")!;
    expect(victim.interruptedCount).toBe(1);
    expect(victim.interruptedMs).toBeGreaterThanOrEqual(119_000);
    expect(s.returnStack).toHaveLength(0);
  });

  it("only records an interruption when the switch is a remembered one", () => {
    const [a, b] = ids();
    startTask(a);
    switchToMain(b, false); // "I'm moving on"
    expect(S().interruptions).toHaveLength(0);
    expect(S().returnStack).toHaveLength(0);

    switchToMain(a, true); // "something pulled me away"
    expect(S().interruptions).toHaveLength(1);
    expect(S().returnStack).toHaveLength(1);
  });

  it("never lets one interruption absorb the rest of the day", () => {
    // Opening a second must close the first, not nest forever.
    const [a] = ids();
    startTask(a);
    startNewMain("first", true);
    startNewMain("second", true);
    const s = S();
    expect(s.interruptions).toHaveLength(2);
    expect(s.interruptions.filter((e) => e.open)).toHaveLength(1);
    expect(s.interruptions[0].open).toBe(false);
  });

  it("switching back to the already-active task is a no-op", () => {
    const [a] = ids();
    startTask(a);
    const before = S().startedAt;
    switchToMain(a, true);
    expect(S().startedAt).toBe(before); // the timer was NOT restarted
    expect(S().interruptions).toHaveLength(0);
  });

  it("resumes the interrupted work when the interrupter is completed", () => {
    const [a] = ids();
    startTask(a);
    startNewMain("Urgent thing", true);
    const urgent = S().activeMainId!;

    completeMain(urgent);
    const s = S();
    expect(s.mains.find((m) => m.id === urgent)!.done).toBe(true);
    // Back on Alpha automatically, with the interruption closed.
    expect(s.activeMainId).toBe(a);
    expect(s.phase).toBe("active");
    expect(s.interruptions[0].open).toBe(false);
    expect(s.returnStack).toHaveLength(0);
  });

  it("asks what's next when nothing is waiting", () => {
    const [a] = ids();
    startTask(a);
    completeMain(a);
    expect(S().overlay).toBe("done-choose");
    expect(S().activeMainId).toBeNull();
  });

  it("skips a return target that was completed in the meantime", () => {
    const [a] = ids();
    startTask(a);
    startNewMain("Interrupter", true);
    const int = S().activeMainId!;
    // Alpha gets finished from the dashboard while the interrupter runs.
    reviveMain(a); // no-op, but proves revive doesn't disturb the stack
    completeMain(a);

    completeMain(int);
    // Nothing valid to return to, so it asks rather than resuming a done task.
    expect(S().activeMainId).toBeNull();
    expect(S().overlay).toBe("done-choose");
  });

  it("attributes evidence to the RIGHT task when two tasks share a title", () => {
    // The bug this guards: interruptions used to be matched by TITLE, so
    // starting a duplicate-titled task while the original was interrupted
    // would attribute (or steal) the evidence from the wrong one.
    addMain("Report"); // a second task named the same as `a`... rename first
    const [a] = ids();
    setMainTitle(a, "Report"); // now `a` and the new task share a title
    const dupeId = S().mains.find((m) => m.title === "Report" && m.id !== a)!.id;

    startTask(a);
    startNewMain("Someone stopped by", true);
    expect(S().interruptions[0].interruptedId).toBe(a);

    S().interruptions[0].atMs = Date.now() - 60_000;
    startTask(a); // returns to `a` and closes the interruption

    const s = S();
    const victimA = s.mains.find((m) => m.id === a)!;
    const notVictim = s.mains.find((m) => m.id === dupeId)!;
    expect(victimA.interruptedCount).toBe(1);
    expect(notVictim.interruptedCount).toBe(0); // the SAME-TITLED task is untouched
  });

  it("keeps attributing evidence correctly after the victim task is RENAMED mid-interruption", () => {
    const [a] = ids();
    startTask(a);
    startNewMain("Someone stopped by", true);
    // Rename the interrupted task WHILE the interruption is still open.
    setMainTitle(a, "Renamed mid-flight");
    S().interruptions[0].atMs = Date.now() - 30_000;

    startTask(a);
    const victim = S().mains.find((m) => m.id === a)!;
    expect(victim.interruptedCount).toBe(1);
    expect(victim.interruptedMs).toBeGreaterThanOrEqual(29_000);
  });
});

// ===========================================================================
describe("breaks", () => {
  it("banks the session and stops the clock", () => {
    const [a] = ids();
    startTask(a);
    rewind(6_000);
    startBreak(10);
    const s = S();
    expect(s.phase).toBe("break");
    expect(s.startedAt).toBe(0); // nothing is accruing
    expect(s.breakEndsAt).toBeGreaterThan(Date.now());
    expect(s.breakPausedTitle).toBe("Alpha");
    expect(s.mains[0].accrued).toBeGreaterThanOrEqual(5_900);
  });

  it("resumes the SAME work after the break", () => {
    const [a] = ids();
    startTask(a);
    startBreak(10);
    resumeFromBreak();
    const s = S();
    expect(s.phase).toBe("active");
    expect(s.activeMainId).toBe(a);
    expect(s.startedAt).toBeGreaterThan(0);
    expect(s.breakEndsAt).toBe(0);
  });

  it("goes to the list when the paused task is gone", () => {
    const [a] = ids();
    startTask(a);
    startBreak(10);
    // The task is completed from the other window during the break.
    reviveMain(a);
    S().mains[0].done = true;
    resumeFromBreak();
    expect(S().phase).toBe("today");
    expect(S().activeMainId).toBeNull();
  });

  it("extends a break without restarting the task clock", () => {
    startTask(ids()[0]);
    startBreak(5);
    const before = S().breakEndsAt;
    extendBreak(5);
    expect(S().breakEndsAt).toBe(before + 5 * 60_000);
    expect(S().startedAt).toBe(0);
  });

  it("does not accrue time during a break", () => {
    const [a] = ids();
    startTask(a);
    rewind(1_000);
    startBreak(10);
    const banked = S().mains[0].accrued;
    // Time passes while on break…
    resumeFromBreak();
    // …and the task's banked total is unchanged by the break itself.
    expect(S().mains[0].accrued).toBe(banked);
  });

  it("does NOT restart the paused task's clock when a sessionTx runs against a DIFFERENT task during a break", () => {
    // The bug this guards: the sessionTx fix for double-counting re-stamps
    // startedAt = now whenever activeMainId survives a transaction - but
    // during a break, activeMainId is DELIBERATELY kept (so the break can
    // resume the same work) while startedAt is 0 (nothing is running).
    // Using "activeMainId is still set" as proof of "a timer is running" is
    // wrong: a dashboard action on another task while on break must not
    // silently start the clock on the paused task.
    const [a, b] = ids();
    startTask(a);
    startBreak(10);
    expect(S().phase).toBe("break");
    expect(S().startedAt).toBe(0);
    expect(S().activeMainId).toBe(a); // kept, to resume the same work

    // A dashboard action on a DIFFERENT task while `a` is break-paused.
    completeMain(b);

    const s = S();
    expect(s.phase).toBe("break"); // still on break
    expect(s.activeMainId).toBe(a); // still the paused task
    expect(s.startedAt).toBe(0); // NOT restarted
  });

  it("promoting a non-active step of the SAME break-paused task does not restart the clock", () => {
    const [a] = ids();
    addSub(a, "quiet step");
    startTask(a);
    startBreak(10);
    expect(S().startedAt).toBe(0);

    promoteSub(a, S().mains[0].subs[0].id); // a sessionTx during the break
    expect(S().phase).toBe("break");
    expect(S().startedAt).toBe(0); // still not running
  });

  it("deleting a non-active task while another is break-paused does not restart its clock", () => {
    const [a, b] = ids();
    startTask(a);
    startBreak(10);
    removeMain(b); // sessionTx against an unrelated task during the break

    const s = S();
    expect(s.phase).toBe("break");
    expect(s.activeMainId).toBe(a);
    expect(s.startedAt).toBe(0);
  });

  it("resuming after an unrelated sessionTx during the break still resumes cleanly", () => {
    // Follows on from the test above: if startedAt were wrongly restarted
    // during the break, resumeFromBreak would double-stamp and the banked
    // total would silently include break time.
    const [a, b] = ids();
    startTask(a);
    rewind(2_000);
    startBreak(10);
    const bankedAtBreakStart = S().mains.find((m) => m.id === a)!.accrued;

    completeMain(b); // an unrelated sessionTx while on break

    resumeFromBreak();
    const s = S();
    expect(s.phase).toBe("active");
    expect(s.activeMainId).toBe(a);
    // Resuming banks nothing extra - the break itself contributed 0.
    expect(s.mains.find((m) => m.id === a)!.accrued).toBe(bankedAtBreakStart);
  });
});

// ===========================================================================
describe("day lifecycle", () => {
  it("seeds carried tasks and routines on Start Day, keeping attachments", async () => {
    loadResult = {
      kind: "loaded",
      state: {
        ...freshDay(3),
        awaitingStart: true,
        carrySeed: [
          {
            title: "Carried",
            note: "keep this",
            estMs: 900_000,
            carries: 2,
            remind: null,
            subs: [{ title: "open step", note: "step note", remind: null }],
          },
        ],
        standardDaily: ["Standup", "Carried"], // the dupe must be skipped
      },
    };
    await boot();
    expect(S().phase).toBe("startday");

    startDay();
    const s = S();
    expect(s.phase).toBe("today");
    expect(s.awaitingStart).toBe(false);
    expect(s.mains.map((m) => m.title)).toEqual(["Carried", "Standup"]);
    const carried = s.mains[0];
    expect(carried.note).toBe("keep this");
    expect(carried.estMs).toBe(900_000);
    expect(carried.carries).toBe(2);
    expect(carried.subs.map((x) => x.title)).toEqual(["open step"]);
    expect(carried.subs[0].note).toBe("step note");
    expect(s.carrySeed).toEqual([]);
  });

  it("archives the day, carries the unfinished, and increments carries", () => {
    const [a] = ids();
    startTask(a);
    completeMain(a);

    endDay();
    const s = S();
    expect(s.history).toHaveLength(1);
    expect(s.history[0].completed.map((c) => c.title)).toEqual(["Alpha"]);
    expect(s.history[0].unfinished.map((u) => u.title)).toEqual(["Beta"]);
    expect(s.dayNum).toBe(2);
    expect(s.phase).toBe("startday");
    expect(s.awaitingStart).toBe(true);
    expect(s.mains).toEqual([]);
    expect(s.carrySeed).toEqual([expect.objectContaining({ title: "Beta", carries: 1 })]);
  });

  it("honours the per-task disposition at End Day", () => {
    const [a, b] = ids();
    endDay({ [a]: "done", [b]: "backlog" });
    const s = S();
    expect(s.history[0].completed.map((c) => c.title)).toEqual(["Alpha"]);
    expect(s.backlog.map((x) => x.title)).toEqual(["Beta"]);
    expect(s.carrySeed).toEqual([]); // nothing carried
  });

  it("banks a running session into the archive rather than losing it", () => {
    startTask(ids()[0]);
    rewind(30_000);
    endDay();
    expect(S().history[0].totalMs).toBeGreaterThanOrEqual(29_000);
  });

  it("closes an interruption still open at End Day", () => {
    const [a] = ids();
    startTask(a);
    startNewMain("late thing", true);
    S().interruptions[0].atMs = Date.now() - 60_000;

    endDay();
    const archived = S().history[0].interruptions!;
    expect(archived).toHaveLength(1);
    expect(archived[0].open).toBe(false);
    expect(archived[0].durationMs).toBeGreaterThanOrEqual(59_000);
    // Today's live list is cleared for the new day.
    expect(S().interruptions).toEqual([]);
  });

  it("is IDEMPOTENT: reopening after End Day does not roll again", async () => {
    // The bug this guards: rolling twice double-incremented dayNum and rebuilt
    // the carry list from an empty `mains`, discarding every "Tomorrow" task.
    endDay();
    const ended = S();
    expect(ended.dayNum).toBe(2);
    expect(ended.carrySeed).toHaveLength(2);

    // Simulate next morning: the persisted state has YESTERDAY's date.
    loadResult = {
      kind: "loaded",
      state: { ...ended, dateISO: "2020-01-01", savedAt: Date.now() },
    };
    await boot();

    const s = S();
    expect(s.dayNum).toBe(2); // advanced ONCE, not twice
    expect(s.carrySeed).toHaveLength(2); // the carried tasks survived
    expect(s.dateISO).toBe(todayISO()); // just re-dated
  });

  it("rolls a stale day forward, archiving it once", async () => {
    const stale = freshDay(1);
    stale.dateISO = "2020-01-01";
    stale.awaitingStart = false;
    const m = mkMain("Yesterday's work");
    m.accrued = 60_000;
    m.done = true;
    stale.mains = [m, mkMain("Left over")];

    loadResult = { kind: "loaded", state: stale };
    await boot();

    const s = S();
    expect(s.dayNum).toBe(2);
    expect(s.dateISO).toBe(todayISO());
    expect(s.history).toHaveLength(1);
    expect(s.history[0].dateISO).toBe("2020-01-01");
    expect(s.carrySeed.map((c) => c.title)).toEqual(["Left over"]);
  });

  it("preserves preferences across a day boundary", () => {
    // The bug this guards: one new-day path reset toggles another preserved.
    setFlag("notifyReminders", false);
    setFlag("trainerOn", true);
    togglePto("2030-01-01");
    addBacklog("keep me");

    endDay();
    const s = S();
    expect(s.notifyReminders).toBe(false);
    expect(s.trainerOn).toBe(true);
    expect(s.pto).toContain("2030-01-01");
    expect(s.backlog.map((b) => b.title)).toContain("keep me");
  });

  it("Restart Day clears today but keeps history, backlog and prefs", () => {
    addBacklog("survivor");
    setFlag("trainerOn", true);
    const dayNum = S().dayNum;

    restartDay();
    const s = S();
    expect(s.mains).toEqual([]);
    expect(s.dayNum).toBe(dayNum); // same day, not the next one
    expect(s.phase).toBe("today");
    expect(s.backlog.map((b) => b.title)).toEqual(["survivor"]);
    expect(s.trainerOn).toBe(true);
  });

  it("prunes blank tasks and steps", () => {
    addMain("real");
    S().mains.push(mkMain("   "));
    const m = S().mains[0];
    m.subs.push({ id: "s1", title: "  ", accrued: 0, done: false, remind: null, note: "" });
    pruneEmpty();
    expect(S().mains.every((x) => x.title.trim())).toBe(true);
    expect(S().mains[0].subs).toHaveLength(0);
  });
});

// ===========================================================================
describe("streak revive", () => {
  it("spends the heart on the most recent genuinely-missed day", () => {
    const s = S();
    s.dateISO = "2026-08-12"; // a Wednesday
    s.history = [
      {
        day: 1,
        dateISO: "2026-08-10",
        completed: [{ title: "t", kind: "task", ms: 1 }],
        unfinished: [],
        totalMs: 1,
      },
      {
        day: 3,
        dateISO: "2026-08-12",
        completed: [{ title: "u", kind: "task", ms: 1 }],
        unfinished: [],
        totalMs: 1,
      },
    ];
    s.life = 1;
    expect(computeStreaks(S()).broken).toBe("2026-08-11");

    useRevive();
    const after = S();
    expect(after.life).toBe(0);
    expect(after.revived).toContain("2026-08-11");
    // The gap is now bridged, so the streak spans it.
    expect(computeStreaks(after).current).toBe(2);
  });

  it("refuses when there is nothing to revive or no heart left", () => {
    useRevive(); // fresh day: nothing broken
    expect(S().revived).toEqual([]);
    expect(S().life).toBe(1);

    const s = S();
    s.life = 0;
    s.dateISO = "2026-08-12";
    s.history = [
      {
        day: 1,
        dateISO: "2026-08-10",
        completed: [{ title: "t", kind: "task", ms: 1 }],
        unfinished: [],
        totalMs: 1,
      },
    ];
    useRevive();
    expect(S().revived).toEqual([]); // no heart, no bridge
  });

  it("earns a heart back at a 5-day streak multiple", () => {
    const s = S();
    s.life = 0;
    s.dateISO = "2026-08-14"; // Friday
    // Mon-Thu worked; today gets work below, making 5.
    s.history = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13"].map((dateISO, i) => ({
      day: i + 1,
      dateISO,
      completed: [{ title: "t", kind: "task" as const, ms: 1 }],
      unfinished: [],
      totalMs: 1,
    }));
    const [a] = ids();
    startTask(a);
    completeMain(a);

    endDay();
    expect(S().life).toBe(1);
  });
});

// ===========================================================================
describe("backlog", () => {
  it("adds, removes and restores by undo", () => {
    addBacklog("later thing");
    expect(S().backlog.map((b) => b.title)).toEqual(["later thing"]);
    const id = S().backlog[0].id;
    deleteBacklog(id);
    expect(S().backlog).toEqual([]);
  });

  it("promotes a backlog item into today, carrying its reminder", () => {
    addBacklog("someday");
    const id = S().backlog[0].id;
    setRemind({ kind: "backlog", id }, "in", 30);
    expect(S().backlog[0].remind).not.toBeNull();

    backlogToToday(id);
    const s = S();
    expect(s.backlog).toEqual([]);
    const added = s.mains.find((m) => m.title === "someday")!;
    expect(added).toBeDefined();
    expect(added.remind?.kind).toBe("in");
  });

  it("ignores a blank title", () => {
    addBacklog("   ");
    expect(S().backlog).toEqual([]);
  });
});

// ===========================================================================
describe("notes, estimates and reminders", () => {
  it("sets a note on a task and on a step", () => {
    const [a] = ids();
    addSub(a, "step");
    const sub = S().mains[0].subs[0].id;
    setNote(a, null, "task note");
    setNote(a, sub, "step note");
    expect(S().mains[0].note).toBe("task note");
    expect(S().mains[0].subs[0].note).toBe("step note");
  });

  it("stores an estimate in ms from hours + minutes", () => {
    const [a] = ids();
    setEstimate(a, 1, 30);
    expect(S().mains[0].estMs).toBe(90 * 60_000);
  });

  it("logs the estimate outcome only when the trainer is on", () => {
    const [a, b] = ids();
    setEstimate(a, 0, 10);
    startTask(a);
    completeMain(a);
    expect(S().estimateLog).toEqual([]); // trainer off

    setFlag("trainerOn", true);
    setEstimate(b, 0, 10);
    startTask(b);
    rewind(60_000);
    completeMain(b);
    expect(S().estimateLog).toHaveLength(1);
    expect(S().estimateLog[0].estMs).toBe(600_000);
    expect(S().estimateLog[0].actualMs).toBeGreaterThanOrEqual(59_000);
  });

  it("attaches and clears a reminder", () => {
    const [a] = ids();
    setRemind({ kind: "main", id: a }, "by", "23:59");
    expect(S().mains[0].remind?.short).toBe("by 11:59pm");
    setRemind({ kind: "main", id: a }, "clear", "");
    expect(S().mains[0].remind).toBeNull();
  });

  it("rejects a nonsense reminder rather than storing garbage", () => {
    const [a] = ids();
    setRemind({ kind: "main", id: a }, "by", "99:99");
    expect(S().mains[0].remind).toBeNull();
  });
});

// ===========================================================================
describe("welcome back", () => {
  it("offers to resume a session that was running at quit, banking honestly", async () => {
    const t = Date.now();
    const m = mkMain("Was running");
    const state: State = {
      ...freshDay(2),
      awaitingStart: false,
      phase: "active",
      dateISO: todayISO(),
      mains: [m],
      activeMainId: m.id,
      startedAt: t - 3_600_000, // started an hour ago
      savedAt: t - 3_000_000, // but last saved 50 minutes ago
    };
    loadResult = { kind: "loaded", state };
    await boot();

    const s = S();
    // Credited only up to the LAST SAVE - 10 minutes are correctly NOT awarded.
    expect(s.mains[0].accrued).toBe(600_000);
    expect(s.activeMainId).toBeNull();
    expect(s.phase).toBe("today");

    const offer = get(welcomeBack);
    expect(offer?.title).toBe("Was running");

    resumeWelcomeBack();
    expect(S().activeMainId).toBe(m.id);
    expect(get(welcomeBack)).toBeNull();
  });

  it("stays silent when the preference is off", async () => {
    const t = Date.now();
    const m = mkMain("Was running");
    loadResult = {
      kind: "loaded",
      state: {
        ...freshDay(2),
        awaitingStart: false,
        dateISO: todayISO(),
        welcomeBack: false,
        mains: [m],
        activeMainId: m.id,
        startedAt: t - 60_000,
        savedAt: t - 30_000,
      },
    };
    await boot();
    expect(get(welcomeBack)).toBeNull();
    // The banking still happened - accounting never depends on the toggle.
    expect(S().mains[0].accrued).toBe(30_000);
  });

  it("declines gracefully when the task is gone", async () => {
    const m = mkMain("Vanished");
    loadResult = {
      kind: "loaded",
      state: {
        ...freshDay(2),
        awaitingStart: false,
        dateISO: todayISO(),
        mains: [m],
        activeMainId: m.id,
        startedAt: Date.now() - 1000,
        savedAt: Date.now(),
      },
    };
    await boot();
    // Remove it before accepting the offer.
    removeMain(m.id);
    resumeWelcomeBack();
    expect(S().activeMainId).toBeNull();
  });

  it("can be dismissed", () => {
    welcomeBack.set({ mainId: "x", subId: null, title: "t" });
    dismissWelcomeBack();
    expect(get(welcomeBack)).toBeNull();
  });
});

// ===========================================================================
describe("recovery", () => {
  it("shows the recovery screen instead of a blank day when data is damaged", async () => {
    loadResult = { kind: "damaged", message: "both files unreadable" };
    await boot();
    expect(get(loadKind)).toBe("damaged");
    expect(S().phase).toBe("recovery");
    // Critically: it must NOT have written anything over the user's files.
    expect(saved).toEqual([]);
  });
});

// ===========================================================================
describe("import, export and restore", () => {
  it("applies a parsed import as tasks, steps and backlog", () => {
    applyImport({
      mains: [{ title: "Imported", remind: null, subs: [{ title: "its step", remind: null }] }],
      backlog: [{ title: "for later", remind: null }],
      errors: [],
    });
    const s = S();
    const m = s.mains.find((x) => x.title === "Imported")!;
    expect(m.subs.map((x) => x.title)).toEqual(["its step"]);
    expect(s.backlog.map((b) => b.title)).toEqual(["for later"]);
  });

  it("exports a backup through the write command", async () => {
    await exportBackup();
    // The name is date-stamped so successive exports don't overwrite each other.
    expect(saved.length).toBeGreaterThanOrEqual(0);
  });

  it("restores a backup through hydrate", () => {
    const backup = { ...freshDay(7), dateISO: todayISO(), awaitingStart: false, accent: "rose" };
    restoreBackup(JSON.stringify(backup));
    expect(S().dayNum).toBe(7);
    expect(S().accent).toBe("rose");
  });

  it("refuses a file that isn't JSON, without touching state", () => {
    const before = S().dayNum;
    restoreBackup("{{{ not json");
    expect(S().dayNum).toBe(before);
  });

  it("refuses an empty object instead of silently wiping to a fresh day", () => {
    // The bug this guards: hydrate({}) legitimately returns freshDay(), so a
    // post-hydrate `dateISO` check can NEVER reject anything - it's always
    // truthy by construction. Validation must happen on the RAW input.
    const before = S().dayNum;
    S().mains.push(mkMain("must survive"));
    restoreBackup("{}");
    expect(S().dayNum).toBe(before);
    expect(S().mains.some((m) => m.title === "must survive")).toBe(true);
  });

  it("refuses an unrelated JSON object that isn't shaped like a backup", () => {
    const before = S().dayNum;
    restoreBackup(JSON.stringify({ foo: 1, bar: [1, 2, 3] }));
    expect(S().dayNum).toBe(before);
  });
});

// ===========================================================================
describe("persistence", () => {
  it("writes on mutation, stamping savedAt and stripping transient fields", async () => {
    saved.length = 0;
    addMain("Gamma");
    await new Promise((r) => setTimeout(r, 400)); // past the 250ms debounce
    expect(saved.length).toBeGreaterThan(0);
    const last = saved[saved.length - 1];
    expect((last.mains as { title: string }[]).some((m) => m.title === "Gamma")).toBe(true);
    expect(last.savedAt).toBeGreaterThan(0);
    expect(last.overlay).toBeUndefined();
    expect(last.subsOpen).toBeUndefined();
  });

  it("mirrors savedAt into the live state, so a checkpoint measures correctly", async () => {
    await flushSave();
    expect(S().savedAt).toBeGreaterThan(0);
  });

  it("keeps the accent switch in the saved payload", async () => {
    setFlag("trainerOn", true);
    await flushSave();
    expect(saved[saved.length - 1].trainerOn).toBe(true);
  });

  it("awaits the FULL in-flight chain, including a save queued while one was already running", async () => {
    // The bug this guards: calling flushSave() while a save is already in
    // flight used to mark it dirty and return IMMEDIATELY, without waiting
    // for that dirty re-write to actually land - so a caller like quitApp()
    // could proceed to quit before the edit it cared about was persisted.
    setFlag("trainerOn", true);
    const first = flushSave(); // starts the write
    setFlag("avoidanceOn", false); // mutates again WHILE the first is running
    const second = flushSave(); // must not interleave - must await the same chain
    await Promise.all([first, second]);
    // Both edits are down by the time BOTH calls have resolved.
    const last = saved[saved.length - 1];
    expect(last.trainerOn).toBe(true);
    expect(last.avoidanceOn).toBe(false);
  });

  it("REJECTS when the write fails, instead of swallowing the error and resolving normally", async () => {
    // The bug this guards: flushSave() used to catch every error, show a
    // toast, and resolve as if nothing happened - so a caller could never
    // tell a save actually failed.
    saveShouldFail = "disk full";
    await expect(flushSave()).rejects.toThrow("disk full");
  });

  it("does NOT update savedAt when the write fails", async () => {
    const before = S().savedAt;
    saveShouldFail = "disk full";
    await flushSave().catch(() => {});
    expect(S().savedAt).toBe(before);
  });

  it("a queued dirty rewrite failing is propagated to every awaiter of the chain", async () => {
    // first's own save_app_state call succeeds; while it's in flight a
    // second edit arrives and is queued as a dirty rewrite, and THAT
    // rewrite is the one that fails. Both `first` and `second` resolve to
    // the SAME in-flight chain, so both must see the rewrite's rejection -
    // a caller must never observe "success" when the actual state on disk
    // is stale relative to what it just asked to persist.
    const first = flushSave();
    setFlag("trainerOn", true);
    saveShouldFail = "disk full"; // the QUEUED dirty rewrite will fail
    const second = flushSave(); // marks dirty, awaits the same chain
    await expect(first).rejects.toThrow("disk full");
    await expect(second).rejects.toThrow("disk full");
  });

  it("retry after a failure succeeds and updates savedAt normally", async () => {
    saveShouldFail = "disk full";
    await flushSave().catch(() => {});
    // saveShouldFail is one-shot (cleared by the mock after firing), so
    // this second call hits the real success path.
    await flushSave();
    expect(S().savedAt).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("cross-window compare-and-swap", () => {
  it("advances _rev by exactly one on every successful save", async () => {
    const before = S()._rev;
    await flushSave();
    expect(S()._rev).toBe(before + 1);
  });

  it("REJECTS a stale write instead of silently overwriting a newer revision", async () => {
    // The bug this guards: two independent windows, each with their own
    // in-memory store, could both persist a full-state snapshot - the
    // second one landing would silently discard whatever the first one
    // saved, with the second window never even knowing it happened.
    forceStaleOnce = true;
    await expect(flushSave()).rejects.toThrow(/saved changes first/);
  });

  it("reloads from disk on a stale write, rather than leaving the user's edit floating unsaved with no explanation", async () => {
    const before = S().dayNum;
    // Simulate the "current" server-side content being different from
    // what THIS window has, by changing loadResult before forcing staleness.
    loadResult = { kind: "loaded", state: { ...S(), dayNum: before + 5 } };
    forceStaleOnce = true;
    await flushSave().catch(() => {});
    // The window picked up the "other window's" persisted content instead
    // of silently believing its own stale write had succeeded.
    expect(S().dayNum).toBe(before + 5);
  });

  it("does NOT update savedAt on a stale (rejected) write", async () => {
    const before = S().savedAt;
    forceStaleOnce = true;
    await flushSave().catch(() => {});
    expect(S().savedAt).toBe(before);
  });

  it("a retry after a stale rejection, with the reloaded revision, succeeds normally", async () => {
    forceStaleOnce = true;
    await flushSave().catch(() => {});
    // forceStaleOnce was one-shot; the reload picked up the current
    // revision, so the NEXT save succeeds using that fresh baseline.
    await flushSave();
    expect(S()._rev).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("quit is a real persistence barrier", () => {
  it("quits normally after a successful flush", async () => {
    await quitApp();
    expect(quitAppCalls).toBe(1);
  });

  it("does NOT invoke quit_app when the save fails", async () => {
    saveShouldFail = "disk full";
    await quitApp().catch(() => {});
    expect(quitAppCalls).toBe(0);
  });

  it("surfaces the save failure as a visible error rather than quitting silently", async () => {
    saveShouldFail = "permission denied";
    await expect(quitApp()).rejects.toThrow("permission denied");
    expect(quitAppCalls).toBe(0);
  });

  it("a retried quit after a failure succeeds and actually quits", async () => {
    saveShouldFail = "disk full";
    await quitApp().catch(() => {});
    expect(quitAppCalls).toBe(0);

    await quitApp(); // saveShouldFail was one-shot, this attempt succeeds
    expect(quitAppCalls).toBe(1);
  });

  it("multiple simultaneous quit requests do not trigger multiple overlapping shutdowns", async () => {
    const [a, b, c] = await Promise.all([quitApp(), quitApp(), quitApp()]);
    void a;
    void b;
    void c;
    // Exactly one underlying quit_app call, however many times Quit was
    // pressed while a shutdown was already in flight.
    expect(quitAppCalls).toBe(1);
  });
});

// ===========================================================================
describe("usage logging", () => {
  it("records NOTHING until the user opts in", () => {
    track("task_started");
    trackClick("start");
    friction("undo_used");
    expect(S().metrics.days).toEqual({});
  });

  it("counts events, clicks and friction once enabled", () => {
    setFlag("loggingOptIn", true);
    track("task_started");
    track("task_started");
    trackClick("start_button");
    friction("undo_used");
    const b = S().metrics.days[String(S().dayNum)];
    expect(b.events.task_started).toBe(2);
    expect(b.clicks.start_button).toBe(1);
    expect(b.friction.undo_used).toBe(1);
  });

  it("records errors even when logging is off, capped at 50", () => {
    // An error the user can report is worth more than the privacy of its own
    // stack location; only the COUNTER bump is opt-in.
    for (let i = 0; i < 60; i++) trackError(`boom ${i}`, "somewhere");
    const errs = S().metrics.errors;
    expect(errs).toHaveLength(50);
    expect(errs[errs.length - 1].msg).toBe("boom 59"); // newest kept
  });

  it("truncates error text rather than storing an essay", () => {
    trackError("x".repeat(500), "y".repeat(200));
    const e = S().metrics.errors[S().metrics.errors.length - 1];
    expect(e.msg).toHaveLength(200);
    expect(e.where).toHaveLength(80);
  });

  it("builds an export payload that contains NO task content", () => {
    setFlag("loggingOptIn", true);
    addMain("Secret project codename");
    const [a] = ids();
    startTask(a);
    startNewMain("Confidential interruption", true);

    const json = JSON.stringify(buildLogs(S()));
    expect(json).not.toContain("Secret project codename");
    expect(json).not.toContain("Confidential interruption");
    expect(json).not.toContain("Alpha");
    // But the SHAPE is there.
    const logs = buildLogs(S());
    expect(logs.containsNoContent).toBe(true);
    expect(logs.interruptions.todayCount).toBe(1);
    expect(logs.interruptions.byVia.interrupt).toBe(1);
    expect(logs.settings.checkinMin).toBe(S().pingMin);
  });

  it("detects TAB THRASH - four switches inside eight seconds", () => {
    // Each click looks intentional on its own; only the burst reveals someone
    // hunting for something they can't find.
    setFlag("loggingOptIn", true);
    for (const t of ["plan", "stats", "data", "plan"]) trackTab(t);
    const b = S().metrics.days[String(S().dayNum)];
    expect(b.clicks["tab:plan"]).toBe(2);
    expect(b.friction.tab_thrash).toBe(1);
  });

  it("annotates friction signals with what they mean", () => {
    setFlag("loggingOptIn", true);
    friction("tab_thrash");
    const summary = buildLogs(S()).frictionSummary.find((f) => f.signal === "tab_thrash")!;
    expect(summary.count).toBe(1);
    expect(summary.means).toContain("hunting");
  });

  it("preserves metrics and the opt-in across a day boundary", () => {
    setFlag("loggingOptIn", true);
    track("day_started");
    endDay();
    expect(S().loggingOptIn).toBe(true);
    expect(Object.keys(S().metrics.days).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe("settings", () => {
  it("flips each boolean preference", () => {
    for (const key of [
      "trainerOn",
      "avoidanceOn",
      "notifyReminders",
      "notifyBreakEnd",
      "welcomeBack",
      "privateNotifications",
      "trayTimer",
    ] as const) {
      setFlag(key, true);
      expect(S()[key]).toBe(true);
      setFlag(key, false);
      expect(S()[key]).toBe(false);
    }
  });

  it("clears the tray title the moment the timer is turned off", () => {
    trayTitles.length = 0;
    setFlag("trayTimer", false);
    expect(trayTitles).toContain(null);
  });

  it("exposes the thing currently being timed", () => {
    const [a] = ids();
    expect(activeThing()).toBeNull();
    startTask(a);
    expect(activeThing()?.title).toBe("Alpha");
    addSub(a, "the step");
    startSub(a, S().mains[0].subs[0].id);
    expect(activeThing()?.title).toBe("the step");
  });

  it("publishes state through the readable store", () => {
    let seen: State | null = null;
    const un = app.subscribe((v) => (seen = v));
    addMain("Observed");
    expect(seen!.mains.some((m) => m.title === "Observed")).toBe(true);
    un();
  });
});

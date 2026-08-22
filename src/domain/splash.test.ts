import { describe, expect, it } from "vitest";

import { focused, initialSplash, loaded, opened } from "./splash";

describe("the dashboard's opening splash", () => {
  it("a fresh launch shows the splash and no reopen is needed to get it", () => {
    // Run 0 is the mount: the component is on screen from the first frame,
    // and `covered` is about a REOPEN's reload, which a launch does not
    // have (boot's own `ready` covers that).
    const s = initialSplash();
    expect(s.run).toBe(0);
    expect(s.covered).toBe(false);
  });

  it("reopening after hiding replays it: a new run, and the window stays covered", () => {
    // The webview is kept warm across a close, so a reopen is not a mount.
    // Without the run bump the splash would be a launch-only thing and
    // every subsequent open would snap straight to the last tab.
    const a = initialSplash();
    const b = opened(a);
    expect(b.run).toBe(a.run + 1);
    expect(b.covered).toBe(true);
  });

  it("the cover lifts when that run's reload finishes", () => {
    const s = loaded(opened(initialSplash()), 1);
    expect(s.covered).toBe(false);
    expect(s.run).toBe(1);
  });

  it("focus alone does NOT replay it", () => {
    // Alt-tabbing back to a window that was already open has not opened
    // anything. Replaying three seconds of splash over the work someone was
    // looking at is a bug, not a flourish.
    const open = opened(initialSplash());
    const settled = loaded(open, open.run);
    expect(focused(settled)).toEqual(settled);
    expect(focused(settled).run).toBe(settled.run);
  });

  it("rapid repeated opens collapse into ONE covering, not a stack", () => {
    let s = initialSplash();
    s = opened(s);
    s = opened(s);
    s = opened(s);
    s = opened(s);
    // Four opens, four runs - each remounting the one component that owns
    // the one hold timer. There is no queue of pending splashes to drain.
    expect(s.run).toBe(4);
    expect(s.covered).toBe(true);
    // And the LAST run's reload is the one that uncovers.
    expect(loaded(s, 4).covered).toBe(false);
  });

  it("a slow reload from an earlier open cannot lift a newer splash early", () => {
    // The failure a plain boolean cannot express: open, start a reload,
    // open again, and let the FIRST reload resolve. It must not uncover
    // the second opening.
    let s = opened(initialSplash());
    const firstRun = s.run;
    s = opened(s);
    s = loaded(s, firstRun);
    expect(s.covered).toBe(true);
    // The newer run's own reload is what finishes it.
    expect(loaded(s, s.run).covered).toBe(false);
  });
});

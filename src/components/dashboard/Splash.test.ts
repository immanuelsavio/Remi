/**
 * The opening splash, MOUNTED.
 *
 * What the pure `domain/splash.ts` tests cannot see: that the hold is
 * really three seconds, that it is a MINIMUM rather than an added wait,
 * and that a remount (which is how a reopen replays it) genuinely restarts
 * that hold instead of inheriting the finished one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

import Splash from "./Splash.svelte";

let host: HTMLElement;
let comp: Splash | null = null;

const onScreen = () => !!host.querySelector(".splash");

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  comp?.$destroy();
  comp = null;
  host.remove();
  vi.useRealTimers();
});

/** Advance timers and let Svelte's reactive statements settle. */
async function advance(ms: number) {
  vi.advanceTimersByTime(ms);
  await tick();
  await tick();
}

describe("Splash", () => {
  it("stays on screen for the full three seconds even when the data is ready instantly", async () => {
    // The point of the hold: boot is a few milliseconds off a local JSON
    // file, so without a floor the splash would strobe and nobody would
    // see the app open at all.
    comp = new Splash({ target: host, props: { ready: true } });
    expect(onScreen()).toBe(true);

    await advance(2999);
    expect(onScreen()).toBe(true);

    await advance(1);
    expect(onScreen()).toBe(false);
  });

  it("is a MINIMUM, not an added wait: slow data keeps it up past the hold", async () => {
    comp = new Splash({ target: host, props: { ready: false } });
    await advance(3500);
    // The hold expired, but the data has not arrived - the splash is what
    // covers that, so it stays.
    expect(onScreen()).toBe(true);

    comp.$set({ ready: true });
    await tick();
    expect(onScreen()).toBe(false);
  });

  it("a remount restarts the hold - this is how a reopen replays it", async () => {
    // The dashboard keeps its webview warm across a close, so reopening is
    // not a mount. `Dashboard.svelte` forces one with a {#key} on the run
    // id; if the hold did not restart with it, the replayed splash would
    // vanish on the first frame.
    comp = new Splash({ target: host, props: { ready: true } });
    await advance(3000);
    expect(onScreen()).toBe(false);

    comp.$destroy();
    comp = new Splash({ target: host, props: { ready: true } });
    expect(onScreen()).toBe(true);
    await advance(2999);
    expect(onScreen()).toBe(true);
    await advance(1);
    expect(onScreen()).toBe(false);
  });

  it("clears its timer on destroy, so a closed window leaves nothing running", async () => {
    comp = new Splash({ target: host, props: { ready: true } });
    comp.$destroy();
    comp = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honours an explicit hold, so the value is not baked into the component", async () => {
    comp = new Splash({ target: host, props: { ready: true, hold: 100 } });
    await advance(100);
    expect(onScreen()).toBe(false);
  });
});

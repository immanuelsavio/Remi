/**
 * The opening splash, MOUNTED.
 *
 * What the pure `domain/splash.ts` tests cannot see: that the hold is
 * really three seconds, that it is a MINIMUM rather than an added wait,
 * and that a remount (which is how a reopen replays it) genuinely restarts
 * that hold instead of inheriting the finished one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";

import Splash from "./Splash.svelte";

let host: HTMLElement;
let comp: ReturnType<typeof mount> | null = null;

/**
 * Reactive props, so a test can flip `ready` on a mounted component.
 *
 * Svelte 5 removed `$set`; a plain object handed to `mount` is read once.
 * A rune-backed object is the replacement, which is why this file is named
 * `.svelte.test.ts` - runes are only compiled in `.svelte`-suffixed files.
 */
const props: { ready: boolean; hold?: number } = $state({ ready: false });

function show(initial: { ready: boolean; hold?: number }) {
  props.ready = initial.ready;
  props.hold = initial.hold;
  comp = mount(Splash, { target: host, props });
  // Svelte 5 runs effects asynchronously, so `onMount` - and the hold timer
  // it starts - has not happened yet when `mount` returns.
  flushSync();
  return comp;
}

const onScreen = () => !!host.querySelector(".splash");

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  if (comp) unmount(comp);
  comp = null;
  host.remove();
  vi.useRealTimers();
});

/** Advance timers and let Svelte's reactive statements settle. */
async function advance(ms: number) {
  vi.advanceTimersByTime(ms);
  // Svelte 5 batches updates; `flushSync` is what makes the DOM reflect a
  // change made inside a timer callback before the next assertion.
  flushSync();
  await tick();
}

describe("Splash", () => {
  it("stays on screen for the full three seconds even when the data is ready instantly", async () => {
    // The point of the hold: boot is a few milliseconds off a local JSON
    // file, so without a floor the splash would strobe and nobody would
    // see the app open at all.
    show({ ready: true });
    expect(onScreen()).toBe(true);

    await advance(2999);
    expect(onScreen()).toBe(true);

    await advance(1);
    expect(onScreen()).toBe(false);
  });

  it("is a MINIMUM, not an added wait: slow data keeps it up past the hold", async () => {
    show({ ready: false });
    await advance(3500);
    // The hold expired, but the data has not arrived - the splash is what
    // covers that, so it stays.
    expect(onScreen()).toBe(true);

    props.ready = true;
    flushSync();
    await tick();
    expect(onScreen()).toBe(false);
  });

  it("a remount restarts the hold - this is how a reopen replays it", async () => {
    // The dashboard keeps its webview warm across a close, so reopening is
    // not a mount. `Dashboard.svelte` forces one with a {#key} on the run
    // id; if the hold did not restart with it, the replayed splash would
    // vanish on the first frame.
    show({ ready: true });
    await advance(3000);
    expect(onScreen()).toBe(false);

    unmount(comp!);
    show({ ready: true });
    expect(onScreen()).toBe(true);
    await advance(2999);
    expect(onScreen()).toBe(true);
    await advance(1);
    expect(onScreen()).toBe(false);
  });

  it("clears its timer on destroy, so a closed window leaves nothing running", async () => {
    show({ ready: true });
    unmount(comp!);
    comp = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honours an explicit hold, so the value is not baked into the component", async () => {
    show({ ready: true, hold: 100 });
    await advance(100);
    expect(onScreen()).toBe(false);
  });
});

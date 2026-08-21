<script lang="ts">
  /**
   * A mouse that lives along the bottom of the dashboard, wanders on its
   * own, and scurries to wherever you click.
   *
   * Pure fun. It reads nothing and reports nothing — which is exactly why
   * it is the one mascot behaviour that defaults OFF: every other pose is a
   * readout of real state, and this is movement for its own sake inside an
   * app built for people whose attention is the scarce resource.
   *
   * Four things keep it from being a menace:
   *
   *   1. `pointer-events: none` on the whole layer. It can NEVER swallow a
   *      click meant for a button underneath it. Non-negotiable: a
   *      decoration that eats input is a bug, not a feature.
   *   2. It stays in a strip along the bottom edge, so it is never on top
   *      of the thing you are reading.
   *   3. Movement is a CSS transition on one transform, not a per-frame
   *      loop. The browser animates it off the main thread; there is no
   *      rAF burning battery behind a window nobody is looking at.
   *   4. Off under `prefers-reduced-motion`, which no toggle overrides.
   *
   * Speed is constant, so the transition duration is derived from the
   * DISTANCE. A fixed duration would make it crawl across short hops and
   * teleport across long ones, which reads as broken rather than alive.
   */
  import { onDestroy, onMount } from "svelte";

  import { app } from "../../store";
  import Mascot from "../shared/Mascot.svelte";

  /** Rendered width of the sprite, px. */
  const SIZE = 44;
  /** Travel speed, px per second. A real mouse is quick. */
  const SPEED = 210;
  /** How long it rests between self-directed wanders, ms. */
  const REST_MIN = 2600;
  const REST_MAX = 7000;

  let x = 60;
  let facing: 1 | -1 = 1;
  let moving = false;
  let travelMs = 0;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let alive = false;

  $: s = $app;
  $: enabled = s.mascotOn && s.roamOn;

  function reducedMotion(): boolean {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }

  function maxX(): number {
    return Math.max(0, window.innerWidth - SIZE - 8);
  }

  /** Send it to `target`, facing the way it is going. */
  function goTo(target: number) {
    const clamped = Math.min(maxX(), Math.max(8, target));
    const dist = Math.abs(clamped - x);
    if (dist < 6) return;
    facing = clamped > x ? 1 : -1;
    travelMs = (dist / SPEED) * 1000;
    moving = true;
    x = clamped;
    timers.push(
      setTimeout(() => {
        moving = false;
      }, travelMs),
    );
  }

  /** Pick somewhere else to be, then rest, then do it again. */
  function wander() {
    if (!alive) return;
    goTo(Math.random() * maxX());
    const wait = travelMs + REST_MIN + Math.random() * (REST_MAX - REST_MIN);
    timers.push(setTimeout(wander, wait));
  }

  /**
   * Chase a click. Centred on the pointer, so it arrives AT what you
   * pressed rather than beside it.
   */
  function onClick(e: MouseEvent) {
    if (!alive) return;
    goTo(e.clientX - SIZE / 2);
  }

  function stop() {
    timers.forEach(clearTimeout);
    timers = [];
    alive = false;
    moving = false;
  }

  function start() {
    if (alive) return;
    alive = true;
    x = Math.min(maxX(), 60);
    timers.push(setTimeout(wander, 1200));
  }

  // Follows the preference live, so switching it on in Settings starts the
  // mouse immediately instead of on the next launch.
  $: if (typeof window !== "undefined") {
    if (enabled && !reducedMotion()) start();
    else stop();
  }

  onMount(() => {
    window.addEventListener("click", onClick);
  });

  onDestroy(() => {
    window.removeEventListener("click", onClick);
    stop();
  });
</script>

{#if alive}
  <!-- `aria-hidden`: it carries no information, and a screen reader
       announcing a wandering mouse would be pure noise. -->
  <div
    class="roam"
    aria-hidden="true"
    style="transform: translateX({x}px); transition-duration: {moving ? travelMs : 0}ms;"
  >
    <div class="flip" style="transform: scaleX({facing});">
      <Mascot mood={moving ? "run" : "idle"} size={SIZE} />
    </div>
  </div>
{/if}

<style>
  .roam {
    position: fixed;
    left: 0;
    bottom: 2px;
    /* Load-bearing: this layer must never intercept a click meant for the
       UI underneath it. */
    pointer-events: none;
    /* Under the toast and any sheet, over ordinary content. */
    z-index: 40;
    transition-property: transform;
    transition-timing-function: linear;
    will-change: transform;
  }
  .flip {
    transition: transform 160ms ease;
  }
</style>

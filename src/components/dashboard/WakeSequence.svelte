<script lang="ts">
  /**
   * The morning beat: Remi wakes, rubs its eyes, and settles at its desk —
   * and only then does the day (and the dashboard) open up.
   *
   * This is the one place in the app where a pause is the point rather than
   * a cost. It marks the boundary between "not started" and "started",
   * which is otherwise an instantaneous state flip with nothing to feel.
   *
   * Three rules keep it from becoming something people hate by Thursday:
   *
   *   1. Always skippable. Click, tap or any key ends it immediately. A
   *      daily animation you cannot escape is a daily tax.
   *   2. Driven by TIMERS, never by `animationend`. Under
   *      `prefers-reduced-motion` the global rule sets `animation: none`,
   *      so `animationend` would never fire and the sequence would hang
   *      forever with the dashboard behind it — a hard lock, on exactly
   *      the setting chosen by people least able to tolerate one.
   *   3. Skipped outright when reduced motion is on, or when the user has
   *      turned the mascot or this sequence off. `done` still fires, so the
   *      day starts either way.
   *
   * It never mutates state itself: it reports `done` and the caller decides
   * what that means. That keeps the day-start transaction in one place.
   */
  import { createEventDispatcher, onDestroy, onMount } from "svelte";

  import { app } from "../../store";
  import Mascot from "../shared/Mascot.svelte";

  const dispatch = createEventDispatcher<{ done: void }>();

  /** How long each beat holds, ms. Tuned against the CSS durations. */
  const WAKE_MS = 1700;
  const DESK_MS = 1150;

  let step: "wake" | "desk" = "wake";
  let timers: ReturnType<typeof setTimeout>[] = [];
  let finished = false;

  $: s = $app;

  function reducedMotion(): boolean {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }

  /** End the sequence exactly once, however it ended. */
  function finish() {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    timers = [];
    dispatch("done");
  }

  onMount(() => {
    if (!s.mascotOn || !s.wakeAnimation || reducedMotion()) {
      finish();
      return;
    }
    timers.push(setTimeout(() => (step = "desk"), WAKE_MS));
    timers.push(setTimeout(finish, WAKE_MS + DESK_MS));
  });

  onDestroy(() => timers.forEach(clearTimeout));
</script>

<svelte:window on:keydown={finish} />

<!-- The whole surface is the skip target, so there is no small button to
     hunt for while something is moving. -->
<div
  class="wakeseq"
  role="button"
  tabindex="0"
  aria-label="Starting your day — click to skip"
  on:click={finish}
  on:keydown={finish}
>
  <Mascot mood={step} size={230} />
  <p class="wk-cap" aria-live="polite">
    {step === "wake" ? "Morning…" : "Getting to work."}
  </p>
  <p class="wk-skip">click anywhere to skip</p>
</div>

<style>
  .wakeseq {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 340px;
    padding: 30px 24px;
    cursor: pointer;
    border: none;
    background: none;
    width: 100%;
  }
  .wk-cap {
    font-family: var(--font-serif);
    font-size: 19px;
    font-weight: 600;
    color: var(--ink);
    margin: 10px 0 0;
  }
  .wk-skip {
    font-size: 11px;
    color: var(--ink-faint);
    margin: 2px 0 0;
  }
</style>

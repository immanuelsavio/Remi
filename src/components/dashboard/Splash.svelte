<script lang="ts">
  /**
   * The startup screen: the app's own logo, while the day is read off disk.
   *
   * The dashboard used to open on the words "Loading…" in the body text
   * style, which is what a half-rendered page looks like rather than what
   * an app opening looks like - and it meant Remi's actual icon, the thing
   * the user clicked, appeared nowhere in the app they had just opened.
   * The mouse is everywhere; the logo was only in the popover's Start-day
   * screen and on an exported report.
   *
   * `hold` exists because boot is FAST - a few milliseconds off a local
   * JSON file - so without a floor this would strobe and nobody would see
   * anything. It is a minimum on screen, never an added wait on top of a
   * finished boot: the two run concurrently and the splash leaves on
   * whichever finishes last. Short enough not to be a tax on every launch.
   *
   * Not a fake progress bar. There are no stages to report - the app either
   * has its state or it does not - and a bar that fills on a timer is a lie
   * about work that is not happening.
   */
  import { onDestroy, onMount } from "svelte";

  import wordmark from "../../assets/remi-wordmark.png";

  /** Flips true once boot is done; the splash still honours `hold`. */
  export let ready = false;
  /** Minimum time on screen, ms. */
  export let hold = 650;

  let held = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    timer = setTimeout(() => (held = false), hold);
  });

  onDestroy(() => {
    if (timer) clearTimeout(timer);
  });

  $: done = ready && !held;
</script>

{#if !done}
  <div class="splash" role="status" aria-label="Remi is starting">
    <img class="sp-mark" src={wordmark} alt="Remi" />
    <div class="sp-dots" aria-hidden="true"><i></i><i></i><i></i></div>
  </div>
{/if}

<style>
  .splash {
    position: absolute;
    inset: 0;
    z-index: 200;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 22px;
    background: var(--bg);
  }
  .sp-mark {
    width: min(300px, 52vw);
    height: auto;
    object-fit: contain;
  }
  .sp-dots {
    display: flex;
    gap: 7px;
  }
  .sp-dots i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    opacity: 0.3;
    animation: sp-pulse 1150ms ease-in-out infinite;
  }
  .sp-dots i:nth-child(2) {
    animation-delay: 160ms;
  }
  .sp-dots i:nth-child(3) {
    animation-delay: 320ms;
  }
  @keyframes sp-pulse {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }
  /* The dots are decoration, and this is the one screen a person cannot
     dismiss - so it must not be the thing that makes them look away. */
  @media (prefers-reduced-motion: reduce) {
    .sp-dots i {
      animation: none;
    }
  }
</style>

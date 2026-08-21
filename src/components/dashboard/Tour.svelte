<script lang="ts">
  /**
   * The guided tour panel.
   *
   * Pinned to a corner rather than centred behind a scrim, deliberately:
   * each step switches the dashboard to the tab it is describing, and a
   * modal would cover the very thing being pointed at. You can keep
   * clicking the app while it is open.
   */
  import { endTour, tourBack, tourNext, tourStep, stepAt, TOUR_LENGTH } from "../../store";
  import Mascot from "../shared/Mascot.svelte";

  $: i = $tourStep;
  $: step = i === null ? null : stepAt(i);

  /** Arrow keys and Escape, so the tour is navigable without aiming. */
  function onKey(e: KeyboardEvent) {
    if (i === null) return;
    if (e.key === "Escape") endTour();
    else if (e.key === "ArrowRight" || e.key === "Enter") tourNext();
    else if (e.key === "ArrowLeft") tourBack();
  }
</script>

<svelte:window on:keydown={onKey} />

{#if i !== null && step}
  <div class="tour" role="dialog" aria-live="polite" aria-label="Guided tour">
    <div class="head">
      <Mascot mood="idle" size={40} />
      <span class="count">{i + 1} of {TOUR_LENGTH}</span>
      <button class="x" title="Close the tour" aria-label="Close the tour" on:click={endTour}
        >✕</button
      >
    </div>

    <h3>{step.title}</h3>
    {#each step.body as para (para)}
      <p>{para}</p>
    {/each}
    {#if step.aside}
      <p class="aside">{step.aside}</p>
    {/if}

    <div class="bar" aria-hidden="true">
      <span style="width:{((i + 1) / TOUR_LENGTH) * 100}%"></span>
    </div>

    <div class="acts">
      <button class="ghost" on:click={endTour}>
        {i === TOUR_LENGTH - 1 ? "Done" : "Skip"}
      </button>
      <span class="spacer"></span>
      {#if i > 0}
        <button class="ghost" on:click={tourBack}>Back</button>
      {/if}
      <button class="next" on:click={tourNext}>
        {i === TOUR_LENGTH - 1 ? "Finish" : "Next"}
      </button>
    </div>
  </div>
{/if}

<style>
  .tour {
    position: absolute;
    right: 22px;
    bottom: 22px;
    z-index: 60;
    width: 330px;
    max-width: calc(100% - 44px);
    background: var(--card);
    border: 1px solid var(--hero-line);
    border-radius: var(--r-md);
    box-shadow: 0 18px 44px -16px rgba(0, 0, 0, 0.45);
    padding: 16px 18px 14px;
    animation: tourIn 0.28s cubic-bezier(0.2, 0.9, 0.25, 1) both;
  }
  @keyframes tourIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  /* Pushes the close button to the far edge whether or not the mascot is
     rendered, so turning it off does not re-centre the row. */
  .head .count {
    margin-right: auto;
  }
  .count {
    font-family: var(--font-num);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .x {
    border: none;
    background: none;
    color: var(--ink-faint);
    cursor: pointer;
    font-size: 12px;
    padding: 2px 4px;
    border-radius: 6px;
  }
  .x:hover {
    color: var(--danger);
  }
  h3 {
    font-family: var(--font-serif);
    font-size: 18px;
    font-weight: 600;
    margin: 6px 0 0;
  }
  p {
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--ink-soft);
    margin: 8px 0 0;
  }
  p.aside {
    font-size: 11.5px;
    color: var(--ink-faint);
    border-left: 2px solid var(--hero-line);
    padding-left: 9px;
    margin-top: 10px;
  }
  .bar {
    height: 3px;
    border-radius: 999px;
    background: var(--line);
    overflow: hidden;
    margin: 14px 0 12px;
  }
  .bar > span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.25s;
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .spacer {
    flex: 1;
  }
  .acts button {
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    border-radius: var(--r-sm);
    padding: 8px 14px;
    cursor: pointer;
  }
  .ghost {
    border: 1px solid var(--line);
    background: transparent;
    color: var(--ink-soft);
  }
  .ghost:hover {
    border-color: var(--accent);
    color: var(--ink);
  }
  .next {
    border: 1px solid var(--accent);
    background: var(--accent);
    color: #fff;
  }
  .next:hover {
    filter: brightness(1.05);
  }
</style>

<script lang="ts">
  import { app, extendBreak, resumeFromBreak } from "../../../store";
  import { fmt } from "../../../view";

  export let breakLeft: number;

  $: s = $app;
</script>

<div class="center pad brk">
  <div class="eyebrow">On a break</div>
  <div class="timer">{fmt(breakLeft)}</div>
  <p class="muted">
    {#if breakLeft > 0}
      Step away properly. We'll still be here.
    {:else}
      Break's up — no rush.
    {/if}
  </p>
  {#if s.breakPausedTitle}
    <p class="muted small">Paused: {s.breakPausedTitle}</p>
  {/if}
  <div class="row">
    <button class="btn accent" on:click={resumeFromBreak}>I'm back</button>
    <button class="btn" on:click={() => extendBreak(5)}>+5 min</button>
  </div>
</div>

<style>
  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 9px;
    height: 100%;
    text-align: center;
    margin: auto;
  }
  .pad {
    padding: 10px 14px;
  }
  .row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .eyebrow {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--ink-soft);
  }
  .muted {
    color: var(--ink-soft);
  }
  .small {
    font-size: 12px;
  }
  .timer {
    font-family: var(--font-num);
    font-size: 33px;
    font-variant-numeric: tabular-nums;
    margin: 6px 0;
  }
  .brk {
    background: var(--break-bg);
    color: var(--break-ink);
  }
</style>

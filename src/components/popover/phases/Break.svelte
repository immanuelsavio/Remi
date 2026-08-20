<script lang="ts">
  import { app, extendBreak, resumeFromBreak } from "../../../store";
  import { fmt } from "../../../view";

  export let breakLeft: number;

  $: s = $app;
</script>

<div class="center pad brk">
  <div class="eyebrow">On break{s.breakPausedTitle ? " · Clock paused" : ""}</div>
  <div class="timer">{fmt(breakLeft)}</div>
  {#if s.breakPausedTitle}
    <p class="muted small">Paused: {s.breakPausedTitle}</p>
  {:else}
    <p class="muted">
      {#if breakLeft > 0}
        Step away properly. We'll still be here.
      {:else}
        Break's up — no rush.
      {/if}
    </p>
  {/if}
  <div class="row">
    <button class="btn primary" on:click={resumeFromBreak}>
      <span class="ico" aria-hidden="true">▸</span> Resume
    </button>
    <button class="btn" on:click={() => extendBreak(5)}>+5 minutes</button>
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
    font-family: var(--font-num);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    font-weight: 500;
    color: var(--break-ink);
  }
  .muted {
    color: var(--ink-soft);
  }
  .small {
    font-size: 12px;
  }
  .timer {
    font-family: var(--font-num);
    font-weight: 600;
    font-size: 40px;
    font-variant-numeric: tabular-nums;
    color: var(--break-ink);
    margin: 6px 0;
  }
  .brk {
    background: var(--break-bg);
    color: var(--break-ink);
  }
  .row .btn {
    min-width: 150px;
  }
</style>

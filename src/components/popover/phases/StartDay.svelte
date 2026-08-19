<script lang="ts">
  import { app, openDashboard, startDay } from "../../../store";
  import type { computeStreaks } from "../../../view";

  export let streaks: ReturnType<typeof computeStreaks>;

  $: s = $app;
</script>

<div class="center pad">
  <div class="ring" aria-hidden="true"></div>
  <div class="eyebrow">Day {s.dayNum}</div>
  <h1>{s.dayNum > 1 ? "New day." : "Good morning."}</h1>
  <p class="muted">
    {#if s.carrySeed.length}
      {s.carrySeed.length} task{s.carrySeed.length > 1 ? "s" : ""} carried over, ready to go.
      {#if s.standardDaily.length}<br />Plus your {s.standardDaily.length} daily routine{s
          .standardDaily.length > 1
          ? "s"
          : ""}.{/if}
    {:else if s.standardDaily.length}
      Your {s.standardDaily.length} daily routine{s.standardDaily.length > 1 ? "s" : ""} will be added
      automatically.
    {:else}
      Let's line up today.<br />Add your tasks, then work them here.
    {/if}
  </p>
  {#if streaks.current > 1}
    <p class="muted small">🔥 {streaks.current}-day streak</p>
  {/if}
  <button
    class="btn accent big"
    on:click={() => {
      // Seed the day, then open Plan: typing a whole day's tasks belongs in
      // the 900px window, not a 380px popover.
      startDay();
      openDashboard("plan");
    }}
  >
    ▸ Start my day
  </button>
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
  h1 {
    font-size: 25px;
    margin: 2px 0;
    letter-spacing: -0.02em;
  }
  .ring {
    width: 54px;
    height: 54px;
    border-radius: 50%;
    border: 5px solid var(--accent);
    opacity: 0.9;
  }
</style>

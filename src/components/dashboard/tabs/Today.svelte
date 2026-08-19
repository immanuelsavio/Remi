<script lang="ts">
  import {
    app,
    completeMain,
    extendBreak,
    resumeFromBreak,
    reviveMain,
    startBreak,
    startSub,
    startTask,
    switchToMain,
    toggleShowSubs,
    toggleSubDone,
  } from "../../../store";
  import { fmt, fmtEst, mainTotal, nowMs } from "../../../view";
  import type { Main, Sub } from "../../../view";

  export let active: Main | null;
  export let activeSub: Sub | null;
  export let thing: Main | Sub | null;
  export let live: number;
  export let breakLeft: number;

  $: s = $app;
</script>

<div class="wrap">
  <h1>Today</h1>
  <p class="muted">
    The popover's working view at desk scale, so a day planned here can also be worked here.
  </p>

  {#if s.phase === "break"}
    <div class="hero brk">
      <div class="eyebrow">On a break</div>
      <div class="timer">{fmt(breakLeft)}</div>
      {#if s.breakPausedTitle}
        <div class="muted small">Paused: {s.breakPausedTitle}</div>
      {/if}
      <div class="row">
        <button class="btn accent" on:click={resumeFromBreak}>I'm back</button>
        <button class="btn" on:click={() => extendBreak(5)}>+5 min</button>
      </div>
    </div>
  {:else if thing && active}
    <div class="hero">
      <div class="eyebrow">{activeSub ? "Working on a step" : "Working on"}</div>
      <div class="hero-title">{thing.title}</div>
      {#if activeSub}<div class="muted small">in {active.title}</div>{/if}
      <div class="timer">{fmt((thing.accrued ?? 0) + live)}</div>
      <div class="row">
        <button class="btn accent" on:click={() => completeMain(active.id)}>Done</button>
        <button class="btn" on:click={() => startBreak(10)}>Break</button>
      </div>
    </div>
  {:else}
    <div class="callout">
      <div class="grow">
        <b>Nothing running.</b>
        <div class="muted small">Start something below to begin tracking.</div>
      </div>
    </div>
  {/if}

  <h2>Open</h2>
  {#each s.mains.filter((m) => !m.done) as m (m.id)}
    <div class="line">
      <div class="grow">
        <div>{m.title}</div>
        <div class="muted small">{fmtEst(mainTotal(m, s, $nowMs))}</div>
      </div>
      {#if m.subs.length}
        <button class="mini" on:click={() => toggleShowSubs(m.id)}>
          {m._showSubs ? "▾" : "⋔"}
        </button>
      {/if}
      <button
        class="btn small"
        on:click={() => (s.activeMainId ? switchToMain(m.id, true) : startTask(m.id))}
      >
        {s.activeMainId === m.id ? "Running" : s.activeMainId ? "Switch" : "Start ▸"}
      </button>
      <button class="btn small" on:click={() => completeMain(m.id)}>Done</button>
    </div>
    {#if m._showSubs}
      <div class="steps indent">
        {#each m.subs as sub (sub.id)}
          <div class="step">
            <input
              type="checkbox"
              checked={sub.done}
              aria-label={sub.title}
              on:change={() => toggleSubDone(m.id, sub.id)}
            />
            <span class="grow" class:strike={sub.done}>{sub.title}</span>
            {#if !sub.done}
              <button class="mini" on:click={() => startSub(m.id, sub.id)}>▸</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/each}
  {#if !s.mains.some((m) => !m.done)}
    <p class="muted small">Nothing open. Plan some tasks, or end the day.</p>
  {/if}

  {#if s.mains.some((m) => m.done)}
    <h2>Done today</h2>
    {#each s.mains.filter((m) => m.done) as m (m.id)}
      <div class="line">
        <span class="grow strike">{m.title}</span>
        <span class="muted small">{fmtEst(mainTotal(m, s, $nowMs))}</span>
        <button class="mini" title="Not actually done" on:click={() => reviveMain(m.id)}>
          ↺
        </button>
      </div>
    {/each}
  {/if}
</div>

<style>
  .wrap {
    padding: 20px 26px 48px;
    max-width: 1040px;
  }
  h1 {
    font-size: 26px;
    letter-spacing: -0.02em;
    margin: 0 0 4px;
  }
  h2 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--ink-soft);
    margin: 26px 0 8px;
  }
  .muted {
    color: var(--ink-soft);
  }
  .small {
    font-size: 12px;
  }
  .strike {
    text-decoration: line-through;
    opacity: 0.6;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .row {
    display: flex;
    align-items: flex-end;
    gap: 9px;
    margin-top: 9px;
    flex-wrap: wrap;
  }
  .indent {
    padding-left: 16px;
  }
  .hero {
    padding: 16px;
    border-radius: var(--r-lg);
    background: var(--hero-bg);
    border: 1px solid var(--hero-line);
    margin: 14px 0;
  }
  .hero.brk {
    background: var(--break-bg);
    color: var(--break-ink);
  }
  .hero-title {
    font-size: 21px;
    font-weight: 620;
    letter-spacing: -0.01em;
  }
  .eyebrow {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--ink-soft);
  }
  .timer {
    font-family: var(--font-num);
    font-size: 34px;
    font-variant-numeric: tabular-nums;
    margin: 5px 0;
  }
  .steps {
    margin: 9px 0 0 5px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 2px;
    border-bottom: 1px solid var(--line);
  }
  .callout {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px;
    border-radius: var(--r-md);
    background: var(--hero-bg);
    border: 1px solid var(--hero-line);
    margin: 12px 0;
  }
</style>

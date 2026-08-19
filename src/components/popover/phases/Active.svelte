<script lang="ts">
  import {
    app,
    completeMain,
    startBreak,
    startNewMain,
    startSub,
    toggleSubDone,
  } from "../../../store";
  import { fmt, fmtEst, mainTotal, nowMs } from "../../../view";
  import type { Main, Sub } from "../../../view";

  export let active: Main;
  export let activeSub: Sub | null;
  export let thing: Main | Sub;
  export let thingMs: number;
  /** Shared with the Switch overlay: typing here and opening Switch (or vice
      versa) must see the same draft, matching the original single-file
      behavior where both inputs bound to one variable. */
  export let interruptDraft: string;
  /** Also lifted to the router: Active is destroyed and recreated whenever
      `phase` leaves "active" (e.g. starting a break) and comes back, but in
      the original single-file component this survived that round trip. */
  export let showInterrupt: boolean;

  $: s = $app;

  function commitInterrupt() {
    if (!interruptDraft.trim()) {
      showInterrupt = false;
      return;
    }
    startNewMain(interruptDraft, true);
    interruptDraft = "";
    showInterrupt = false;
  }
</script>

<!-- ---------- the running task ---------- -->
<div class="hero">
  <div class="eyebrow">{activeSub ? "Working on a step" : "Working on"}</div>
  <div class="hero-title">{thing.title}</div>
  {#if activeSub}<div class="muted small">in {active.title}</div>{/if}
  <div class="timer">{fmt(thingMs)}</div>
  {#if active.estMs}
    <div class="muted small">
      Estimated {fmtEst(active.estMs)} · {Math.round(
        (mainTotal(active, s, $nowMs) / active.estMs) * 100,
      )}% used
    </div>
  {/if}

  <div class="row">
    <button class="btn accent" on:click={() => completeMain(active.id)}>Done</button>
    <button class="btn" on:click={() => startBreak(10)}>Break</button>
  </div>

  <div class="row">
    {#if showInterrupt}
      <!-- svelte-ignore a11y-autofocus -->
      <input
        class="in"
        autofocus
        placeholder="What came up?"
        bind:value={interruptDraft}
        on:keydown={(e) => {
          if (e.key === "Enter") commitInterrupt();
          if (e.key === "Escape") showInterrupt = false;
        }}
        on:blur={commitInterrupt}
      />
    {:else}
      <button class="btn ghost" on:click={() => (showInterrupt = true)}> Something came up </button>
    {/if}
  </div>

  {#if active.subs.length}
    <div class="subs">
      {#each active.subs as sub (sub.id)}
        <div class="sub">
          <input
            type="checkbox"
            checked={sub.done}
            aria-label={sub.title}
            on:change={() => toggleSubDone(active.id, sub.id)}
          />
          <span class="grow" class:strike={sub.done}>{sub.title}</span>
          {#if !sub.done && s.activeSubId !== sub.id}
            <button
              class="mini"
              title="Work on this step"
              on:click={() => startSub(active.id, sub.id)}>▸</button
            >
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
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
  .strike {
    text-decoration: line-through;
    opacity: 0.6;
  }
  .row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .timer {
    font-family: var(--font-num);
    font-size: 33px;
    font-variant-numeric: tabular-nums;
    margin: 6px 0;
  }
  .hero {
    margin: 10px 14px 0;
    padding: 14px;
    border-radius: var(--r-lg);
    background: var(--hero-bg);
    border: 1px solid var(--hero-line);
  }
  .hero-title {
    font-size: 19px;
    font-weight: 620;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }
  .subs {
    margin-top: 9px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
  }
</style>

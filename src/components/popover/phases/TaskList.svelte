<script lang="ts">
  import {
    addMain,
    app,
    reviveMain,
    startTask,
    switchToMain,
    toggleShowSubs,
    toggleSubDone,
  } from "../../../store";
  import { fmtEst, mainTotal, nowMs } from "../../../view";
  import type { Main } from "../../../view";

  export let open: Main[];
  export let done: Main[];
  /** Lifted to the router: TaskList is destroyed and recreated whenever
      `phase` leaves "today"/"active" (e.g. starting a break) and comes back,
      but in the original single-file component this survived that round
      trip. */
  export let draft: string;

  $: s = $app;

  function commitDraft() {
    addMain(draft);
    draft = "";
  }
</script>

<!-- ---------- the list ---------- -->
<div class="pad tight">
  <h1 class="headline">{s.phase === "active" ? "Everything else" : "Ready when you are"}</h1>
</div>

{#if !open.length && !done.length}
  <div class="pad">
    <p class="muted small">
      Nothing here yet. Add a task below, or plan the whole day in the dashboard.
    </p>
  </div>
{/if}

{#each open as m (m.id)}
  {@const warn = s.avoidanceOn && m.carries >= 3}
  {@const total = mainTotal(m, s, $nowMs)}
  <div class="card" class:warn>
    <div class="card-row">
      <div class="grow">
        <div class="title">
          {m.title}
          {#if m.remind}<span class="badge" title={m.remind.label}>⏲ {m.remind.short}</span>{/if}
          {#if m.estMs}<span class="badge">⏱ {fmtEst(m.estMs)}</span>{/if}
          {#if s.avoidanceOn && m.carries >= 1}
            <span class="badge" class:warnb={warn} title="Moved {m.carries} times">
              ↻ {m.carries}×
            </span>
          {/if}
        </div>
        {#if warn}
          <div class="note">
            You've moved this {m.carries} days running - are you avoiding it? Try just the first small
            step.
          </div>
        {:else if m.subs.length}
          <div class="muted small">
            {m.subs.filter((x) => x.done).length}/{m.subs.length} steps
            {#if total}· {fmtEst(total)}{/if}
          </div>
        {:else if total}
          <div class="muted small">{fmtEst(total)}</div>
        {/if}
      </div>
      {#if m.subs.length}
        <button class="mini" title="Steps" on:click={() => toggleShowSubs(m.id)}>
          {m._showSubs ? "▾" : "⋔"}
        </button>
      {/if}
      <button
        class="start-pill"
        on:click={() => (s.activeMainId ? switchToMain(m.id, true) : startTask(m.id))}
      >
        {s.activeMainId ? "Switch to" : "Start"} <span class="ico" aria-hidden="true">▸</span>
      </button>
    </div>

    {#if m._showSubs}
      <div class="subs">
        {#each m.subs as sub (sub.id)}
          <div class="sub">
            <input
              type="checkbox"
              checked={sub.done}
              aria-label={sub.title}
              on:change={() => toggleSubDone(m.id, sub.id)}
            />
            <span class="grow" class:strike={sub.done}>{sub.title}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/each}

{#if done.length}
  <div class="pad tight"><h2>Done · {done.length}</h2></div>
  {#each done as m (m.id)}
    <div class="card done-card">
      <div class="card-row">
        <div class="grow"><div class="title strike">{m.title}</div></div>
        <span class="muted small">{fmtEst(mainTotal(m, s, $nowMs))}</span>
        <button class="mini" title="Not actually done" on:click={() => reviveMain(m.id)}>
          ↺
        </button>
      </div>
    </div>
  {/each}
{/if}

<div class="pad">
  <input
    class="in"
    placeholder="Add a task, then press Enter"
    bind:value={draft}
    on:keydown={(e) => e.key === "Enter" && commitDraft()}
  />
</div>

<style>
  .pad {
    padding: 10px 14px;
  }
  .pad.tight {
    padding-bottom: 2px;
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
  h1.headline {
    font-size: 22px;
    letter-spacing: -0.01em;
    margin: 0;
  }
  h2 {
    font-size: 12px;
    font-family: var(--font-sans);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin: 0;
    color: var(--ink-soft);
  }
  .card {
    margin: 7px 14px;
    padding: 11px 12px;
    border-radius: var(--r-md);
    background: var(--card);
    border: 1px solid var(--line);
  }
  .card-row {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .title {
    font-weight: 560;
    overflow-wrap: anywhere;
  }
  .done-card {
    opacity: 0.65;
  }
  .card.warn {
    background: var(--warn-bg);
    border-color: var(--warn-line);
  }
  .note {
    font-size: 12px;
    color: var(--warn-ink);
    margin-top: 3px;
  }
  .badge {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--pill-bg);
    color: var(--accent-ink);
    white-space: nowrap;
  }
  .badge.warnb {
    background: var(--warn-bg);
    color: var(--warn-ink);
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

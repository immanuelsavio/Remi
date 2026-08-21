<script lang="ts">
  /**
   * The running task - the screen you spend the day on.
   *
   * Layout follows the showcase exactly: a tinted hero carrying the context
   * line, the title, the live timer and (when the time-sense trainer is on)
   * an estimate budget bar; then the three actions; then the steps.
   *
   * Steps stay COLLAPSED behind a one-line toggle unless a step is itself
   * what is running. A list of eight steps above the fold turns the screen
   * into a to-do list, and the point of this screen is the one thing you are
   * doing right now.
   */
  import {
    app,
    completeMain,
    promoteSub,
    addSub,
    openSwitch,
    setOverlay,
    startSub,
    switchToSub,
    toggleSubDone,
    toggleSubsOpen,
    track,
  } from "../../../store";
  import { fmt, fmtEst, mainTotal, nowMs } from "../../../view";
  import type { Main, Sub } from "../../../view";
  import RemindControl from "../../shared/RemindControl.svelte";
  import Mascot from "../../shared/Mascot.svelte";
  import ConfirmSubSheet from "../../shared/ConfirmSubSheet.svelte";

  export let active: Main;
  export let activeSub: Sub | null;
  export let thing: Main | Sub;
  export let thingMs: number;

  let stepDraft = "";
  let stepInput: HTMLInputElement | null = null;
  let pendingRemove: { mainId: string; subId: string } | null = null;

  $: s = $app;
  $: total = mainTotal(active, s, $nowMs);
  $: doneCount = active.subs.filter((x) => x.done).length;
  /** Auto-open while a step is the thing on the clock: you cannot sensibly
      hide the row that is currently accruing time. */
  $: subsOpen = !!s.subsOpen || !!activeSub;
  $: estPct = active.estMs ? Math.min(100, Math.round((total / active.estMs) * 100)) : 0;
  $: estOver = !!active.estMs && total > active.estMs;

  /** What the return stack will send you back to when this is done. */
  $: returnHint = (() => {
    const r = s.returnStack[s.returnStack.length - 1];
    if (!r) return "";
    const m = s.mains.find((x) => x.id === r.mainId);
    const sub = r.subId ? m?.subs.find((x) => x.id === r.subId) : null;
    const title = (sub ?? m)?.title;
    return title ? `back to “${title}” after` : "";
  })();

  function commitStep() {
    const v = stepDraft.trim();
    if (!v) return;
    track("step_added");
    addSub(active.id, v);
    stepDraft = "";
    stepInput?.focus();
  }

  /** "Subtask" adds a step to THIS task; it does not start it. Working a
      step is a switch, which is what Interrupt is for. */
  function focusAddStep() {
    if (!s.subsOpen && !activeSub) toggleSubsOpen();
    queueMicrotask(() => stepInput?.focus());
  }

  function elapsedOf(sub: Sub): number {
    return sub.accrued + (sub.id === s.activeSubId && s.startedAt ? $nowMs - s.startedAt : 0);
  }
</script>

<div class="hero">
  {#if activeSub}
    <div class="ctx"><span class="arc" aria-hidden="true">↳</span> in {active.title}</div>
  {:else}
    <div class="ctx">
      Main task{#if returnHint}
        · <span style="color:var(--ink-faint)">{returnHint}</span>{/if}
    </div>
  {/if}
  <div class="task-title">{thing.title}</div>
  {#if activeSub}
    <span class="subtag"><span aria-hidden="true">◈</span> Step of {active.title}</span>
  {/if}
  <!-- The mouse runs while the clock runs. Peripheral, deliberately: it is
       the thing you notice without reading, which is the whole reason a
       timer lives in the menu bar in the first place. Wrapped in a row of
       its own rather than dropped inside `.timer`, so the digits keep the
       block layout (and the baseline `.tot` sits on) that they had. -->
  <div class="timer-row">
    <Mascot mood="run" size={46} />
    <div class="timer">
      <span>{fmt(thingMs)}</span>
      {#if activeSub}<span class="tot">{fmt(total)} on {active.title}</span>{/if}
    </div>
  </div>
  {#if s.trainerOn && active.estMs}
    <div class="est-budget" class:over={estOver}>
      <div class="eb-bar"><span style="width:{estPct}%"></span></div>
      <div class="eb-lbl">
        {#if estOver}
          ⏱ {fmtEst(total - active.estMs)} over your {fmtEst(active.estMs)} estimate
        {:else}
          ⏱ {fmtEst(total)} of your {fmtEst(active.estMs)} estimate
        {/if}
      </div>
    </div>
  {/if}
</div>

<div class="actions">
  <button class="btn primary" on:click={() => completeMain(active.id)}>
    <span class="ico" aria-hidden="true">✓</span> Done
  </button>
  <div class="tworow">
    <button class="btn" on:click={focusAddStep}>
      <span class="ico" aria-hidden="true">↳</span> Subtask
    </button>
    <button
      class="btn accent"
      on:click={() => {
        track("interrupt");
        openSwitch("interrupt");
      }}
    >
      <span class="ico" aria-hidden="true">⌥</span> Interrupt
    </button>
  </div>
</div>

<div class="subs">
  {#if active.subs.length && !subsOpen}
    <button class="subs-toggle" on:click={toggleSubsOpen}>
      <span class="lft">
        <em>{active.subs.length} step{active.subs.length > 1 ? "s" : ""}</em> · {doneCount} done
      </span>
      <span class="chev" aria-hidden="true">▸ show</span>
    </button>
  {:else}
    {#if active.subs.length}
      <button class="subs-toggle" style="margin-bottom:6px;" on:click={toggleSubsOpen}>
        <span class="lft"><em>Steps</em> · {doneCount}/{active.subs.length} done</span>
        <span class="chev" aria-hidden="true">▾ hide</span>
      </button>
    {/if}
    {#each active.subs as sub (sub.id)}
      {@const isOn = sub.id === s.activeSubId}
      <div class="subrow" class:active={isOn} class:done={sub.done}>
        <span class="st">
          <button
            class="check"
            aria-label={sub.done ? "Undo" : "Mark done"}
            on:click={() => toggleSubDone(active.id, sub.id)}>✓</button
          >
          <span class="txt">{sub.title}</span>
        </span>
        <span class="rgt">
          <span class="stime">{fmt(elapsedOf(sub))}</span>
          {#if sub.done}
            <button class="mini" on:click={() => toggleSubDone(active.id, sub.id)}>Revive</button>
          {:else if isOn}
            <span class="onnow">on now</span>
          {:else}
            <button
              class="mini"
              on:click={() =>
                s.activeMainId ? switchToSub(active.id, sub.id, true) : startSub(active.id, sub.id)}
              >Switch</button
            >
          {/if}
          {#if !sub.done}
            <RemindControl
              remind={sub.remind}
              now={$nowMs}
              target={{ kind: "sub", mainId: active.id, id: sub.id, title: sub.title }}
            />
            <button
              class="mini promo"
              title="Make its own task"
              aria-label="Make “{sub.title}” its own task"
              on:click={() => promoteSub(active.id, sub.id)}>⤴</button
            >
          {/if}
          <button
            class="xsub"
            title="Remove or complete"
            aria-label="Remove or complete"
            on:click={() => (pendingRemove = { mainId: active.id, subId: sub.id })}>✕</button
          >
        </span>
      </div>
    {/each}
    <div class="addsub-inline">
      <input
        bind:this={stepInput}
        placeholder="＋ add a step…"
        autocomplete="off"
        bind:value={stepDraft}
        on:keydown={(e) => e.key === "Enter" && commitStep()}
      />
      <button on:click={commitStep}>Add</button>
    </div>
  {/if}
</div>

<ConfirmSubSheet bind:pending={pendingRemove} />

<style>
  .timer-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  /* The row owns the spacing now; the timer's own top margin would double it. */
  .timer-row :global(.timer) {
    margin-top: 0;
  }
</style>

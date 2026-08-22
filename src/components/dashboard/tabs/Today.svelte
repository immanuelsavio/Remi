<script lang="ts">
  /**
   * TODAY at desk scale - the popover's working view in the wider window, so
   * a day PLANNED here can also be WORKED here.
   *
   * It calls the very same store actions the popover screens call, which is
   * what stops the two views drifting apart.
   */
  import {
    addMain,
    addSub,
    app,
    completeMain,
    extendBreak,
    promoteSub,
    resumeFromBreak,
    reviveMain,
    openSwitch,
    setOverlay,
    startBreak,
    startTask,
    switchToMain,
    toggleSubDone,
    track,
    tourAnchor,
  } from "../../../store";
  import { fmt, fmtEst, isTiming, mainTotal, nowMs } from "../../../view";
  import type { Main, Sub } from "../../../view";
  import RemindControl from "../../shared/RemindControl.svelte";
  import ConfirmSubSheet from "../../shared/ConfirmSubSheet.svelte";
  import Mascot from "../../shared/Mascot.svelte";
  import { withName } from "../../../domain/name";

  export let active: Main | null;
  export let activeSub: Sub | null;
  export let thing: Main | Sub | null;
  export let live: number;
  export let breakLeft: number;

  let expandedId: string | null = null;
  let adding = false;
  let taskDraft = "";
  let stepDrafts: Record<string, string> = {};
  let pendingRemove: { mainId: string; subId: string } | null = null;

  $: s = $app;
  /**
   * Whether anything is ACTUALLY on the clock - not merely assigned.
   *
   * A break keeps `activeMainId` so it can resume the same work while
   * `startedAt` is 0. Keying the button off `activeMainId` made every row
   * say "Switch" during a break, and a switch files an interruption, so
   * the obvious way back to work invented evidence of being interrupted.
   */
  $: timing = isTiming(s);
  $: running = s.phase === "active" && !!thing;
  $: onBreak = s.phase === "break";
  $: openCount = s.mains.filter((m) => !m.done).length;
  $: doneCount = s.mains.filter((m) => m.done).length;
  /** Every task on today's list is finished - and there was a list. */
  $: allDone = s.mains.length > 0 && openCount === 0;

  function commitTask() {
    if (taskDraft.trim()) addMain(taskDraft);
    taskDraft = "";
    adding = false;
  }

  function commitStep(mainId: string) {
    const v = (stepDrafts[mainId] ?? "").trim();
    if (!v) return;
    addSub(mainId, v);
    stepDrafts[mainId] = "";
  }
</script>

<div class="dsec-title">Today</div>
<div class="dsec-sub">
  Day {s.dayNum} · {openCount} open{#if doneCount}
    · {doneCount} done{/if}
</div>

{#if onBreak}
  <div class="givenback">
    <div class="eyebrow">On a break</div>
    <div class="gb-t">{breakLeft > 0 ? `${fmt(breakLeft)} left` : "Break's up"}</div>
    <div class="gb-l">
      {#if s.breakPausedTitle}Paused: {s.breakPausedTitle}.
      {/if}Step away properly - I'll still be here.
    </div>
    <div class="gb-acts">
      <button class="bk-btn" on:click={resumeFromBreak}>▸ Back to work</button>
      <button class="bk-btn ghost" on:click={() => extendBreak(5)}>+5 more minutes</button>
    </div>
  </div>
{:else if running && thing && active}
  <div class="givenback">
    <div class="eyebrow">{activeSub ? `${active.title} › step` : "On now"}</div>
    <div class="gb-t">{thing.title}</div>
    <div class="gb-l">
      {fmt((thing.accrued ?? 0) + live)} on the clock{#if activeSub}
        · {fmt(mainTotal(active, s, $nowMs))} on “{active.title}” overall{/if}{#if active.estMs}
        · est {fmtEst(active.estMs)}{/if}
    </div>
    <div class="gb-acts" use:tourAnchor={"today-start"}>
      <button class="bk-btn" on:click={() => completeMain(active.id)}>✓ Done</button>
      <button
        class="bk-btn ghost"
        on:click={() => {
          track("interrupt");
          openSwitch("interrupt");
        }}>Something came up</button
      >
      <button class="bk-btn ghost" on:click={() => startBreak(15)}>☕ Take a break</button>
    </div>
  </div>
{/if}

<div class="todaywrap" style="padding-left:0; padding-right:0;">
  {#each s.mains as m (m.id)}
    {@const open = expandedId === m.id}
    {@const isOn = m.id === s.activeMainId && running}
    {@const avoiding = s.avoidanceOn && m.carries >= 1}
    {@const warn = s.avoidanceOn && m.carries >= 3}
    <div class="today-card" class:done={m.done} class:avoiding={warn}>
      <div class="today-row">
        <div class="tinfo">
          <div class="tt">
            {m.title}
            {#if m.remind}
              <RemindControl
                remind={m.remind}
                now={$nowMs}
                target={{ kind: "main", id: m.id, title: m.title }}
              />
            {/if}
            {#if m.estMs}<span class="est-badge">⏱ {fmtEst(m.estMs)}</span>{/if}
            {#if m.deferred}<span class="carry-badge" title="You marked this for tomorrow"
                >→ tomorrow</span
              >{/if}
            {#if avoiding}
              <span
                class="carry-badge"
                class:warn
                title="Moved {m.carries} time{m.carries > 1 ? 's' : ''}">↻ {m.carries}×</span
              >
            {/if}
          </div>
          {#if warn}
            <div class="avoid-note">
              You've moved this {m.carries} days running - are you avoiding it? Try just the first small
              step.
            </div>
          {:else if m.subs.length}
            <div class="subcount">
              {m.subs.filter((x) => x.done).length}/{m.subs.length} steps · {fmtEst(
                mainTotal(m, s, $nowMs),
              )}
            </div>
          {:else}
            <div class="subcount">{fmtEst(mainTotal(m, s, $nowMs))}</div>
          {/if}
        </div>

        {#if m.done}
          <button class="revive" title="Not actually done" on:click={() => reviveMain(m.id)}
            >↺</button
          >
        {:else}
          {#if !m.remind}
            <RemindControl
              remind={null}
              now={$nowMs}
              target={{ kind: "main", id: m.id, title: m.title }}
            />
          {/if}
          <button
            class="tdexp"
            title="Steps"
            aria-label="Steps"
            aria-expanded={open}
            on:click={() => (expandedId = open ? null : m.id)}>{open ? "▾" : "⋔"}</button
          >
          {#if isOn}
            <span class="est-badge" title="This is on the clock">▸ on now</span>
          {:else}
            <button
              class="startbtn"
              use:tourAnchor={"today-start"}
              on:click={() => (timing ? switchToMain(m.id, true) : startTask(m.id))}
            >
              {timing ? "Switch" : "Start"} ▸
            </button>
          {/if}
        {/if}
      </div>

      {#if open}
        <div class="td-subs">
          {#each m.subs as sub (sub.id)}
            <div class="subrow" class:done={sub.done} class:active={sub.id === s.activeSubId}>
              <span class="st">
                <button
                  class="check"
                  aria-label={sub.done ? "Undo" : "Mark done"}
                  on:click={() => toggleSubDone(m.id, sub.id)}>✓</button
                >
                <span class="txt">{sub.title}</span>
              </span>
              <span class="rgt">
                {#if !sub.done}
                  <RemindControl
                    remind={sub.remind}
                    now={$nowMs}
                    target={{ kind: "sub", mainId: m.id, id: sub.id, title: sub.title }}
                  />
                  <button
                    class="mini promo"
                    title="Make its own task"
                    aria-label="Make “{sub.title}” its own task"
                    on:click={() => promoteSub(m.id, sub.id)}>⤴</button
                  >
                {/if}
                <button
                  class="xsub"
                  title="Remove or complete"
                  aria-label="Remove or complete"
                  on:click={() => (pendingRemove = { mainId: m.id, subId: sub.id })}>✕</button
                >
              </span>
            </div>
          {/each}
          <div class="addsub-inline">
            <input
              placeholder="＋ add a step…"
              autocomplete="off"
              bind:value={stepDrafts[m.id]}
              on:keydown={(e) => e.key === "Enter" && commitStep(m.id)}
            />
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="empty">
      <Mascot mood="ready" size={92} />
      <p class="empty-t">Nothing lined up yet</p>
      <p class="empty-sub">Add a task below, or build the day out in Plan.</p>
    </div>
  {/each}

  {#if adding}
    <div class="addsub-inline" style="margin:10px 0 0;">
      <!-- svelte-ignore a11y-autofocus -->
      <input
        autofocus
        placeholder="a task…"
        autocomplete="off"
        bind:value={taskDraft}
        on:keydown={(e) => {
          if (e.key === "Enter") commitTask();
          if (e.key === "Escape") {
            taskDraft = "";
            adding = false;
          }
        }}
        on:blur={commitTask}
      />
    </div>
  {:else}
    <button
      class="addmain-link"
      style="width:auto; margin:10px 0 0;"
      on:click={() => (adding = true)}
    >
      ＋ Add task
    </button>
  {/if}
</div>

{#if allDone}
  <!-- The one place the mouse celebrates. Gated on there having BEEN work:
       an empty day is not an achievement, and a mascot that cheers for
       nothing is a mascot nobody believes. -->
  <div class="alldone">
    <Mascot mood="cheer" size={96} label="Everything on today's list is done" />
    <div>
      <p class="ad-t">{withName("That's everything", s.userName)}.</p>
      <p class="ad-s">
        {doneCount} task{doneCount === 1 ? "" : "s"} finished. Wrap up the day when you're ready - anything
        you add later still counts.
      </p>
    </div>
  </div>
{/if}

<div style="margin-top:18px; display:flex; gap:10px; flex-wrap:wrap;">
  <button class="bk-btn ghost" on:click={() => setOverlay("backlog")}>▤ Backlog</button>
  <button
    class="bk-btn ghost"
    use:tourAnchor={"today-endday"}
    on:click={() => setOverlay("endday")}
  >
    Wrap up the day ›
  </button>
</div>

<ConfirmSubSheet bind:pending={pendingRemove} />

<style>
  .alldone {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: 18px;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: color-mix(in srgb, var(--accent) 8%, var(--card));
  }
  .ad-t {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 15px;
    color: var(--ink);
    margin: 0;
  }
  .ad-s {
    font-size: 12.5px;
    color: var(--ink-soft);
    margin: 3px 0 0;
  }
</style>

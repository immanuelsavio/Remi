<script lang="ts">
  /**
   * "Ready when you are" - today's task list.
   *
   * Each card is collapsed to a single row until you open its steps with ⋔.
   * A step row here is plan-ahead only: tick it, promote it, or remove it -
   * no timers, because nothing on this screen is running yet.
   */
  import {
    addMain,
    addSub,
    app,
    promoteSub,
    reviveMain,
    startTask,
    switchToMain,
    toggleSubDone,
  } from "../../../store";
  import { fmtEst, nowMs } from "../../../view";
  import RemindControl from "../../shared/RemindControl.svelte";
  import ConfirmSubSheet from "../../shared/ConfirmSubSheet.svelte";

  /** Which card's steps are open. Lifted to the router so it survives the
      component being recreated when the phase changes away and back. */
  export let expandedId: string | null;
  /** The inline "add a task" draft, lifted for the same reason. */
  export let draft: string;

  let adding = false;
  let stepDrafts: Record<string, string> = {};
  let pendingRemove: { mainId: string; subId: string } | null = null;

  $: s = $app;

  function commitTask() {
    if (draft.trim()) addMain(draft);
    draft = "";
    adding = false;
  }

  function commitStep(mainId: string) {
    const v = (stepDrafts[mainId] ?? "").trim();
    if (!v) return;
    addSub(mainId, v);
    stepDrafts[mainId] = "";
  }
</script>

<div class="pad" style="padding-bottom:2px;"><h2 class="mid">Ready when you are</h2></div>

<div class="todaywrap">
  {#each s.mains as m (m.id)}
    {@const open = expandedId === m.id}
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
            {#if avoiding}
              <span
                class="carry-badge"
                class:warn
                title="Moved {m.carries} time{m.carries > 1 ? 's' : ''}"
              >
                ↻ {m.carries}×
              </span>
            {/if}
          </div>
          {#if warn}
            <div class="avoid-note">
              You've moved this {m.carries} days running — are you avoiding it? Try just the first small
              step.
            </div>
          {:else if m.subs.length}
            <div class="subcount">
              {m.subs.filter((x) => x.done).length}/{m.subs.length} steps
            </div>
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
            on:click={() => (expandedId = open ? null : m.id)}
          >
            {open ? "▾" : "⋔"}
          </button>
          <button
            class="startbtn"
            on:click={() => (s.activeMainId ? switchToMain(m.id, true) : startTask(m.id))}
          >
            {s.activeMainId ? "Switch" : "Start"} ▸
          </button>
        {/if}
      </div>

      {#if open}
        <div class="td-subs">
          {#each m.subs as sub (sub.id)}
            <div class="subrow" class:done={sub.done}>
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
      <p class="empty-t">Nothing lined up yet</p>
      <p class="empty-sub">Add a task below, or build the day out in the dashboard's Plan tab.</p>
    </div>
  {/each}

  {#if adding}
    <div class="addsub-inline" style="margin:2px 0 0;">
      <!-- svelte-ignore a11y-autofocus -->
      <input
        autofocus
        placeholder="a task…"
        autocomplete="off"
        bind:value={draft}
        on:keydown={(e) => {
          if (e.key === "Enter") commitTask();
          if (e.key === "Escape") {
            draft = "";
            adding = false;
          }
        }}
        on:blur={commitTask}
      />
    </div>
  {:else}
    <button
      class="addmain-link"
      style="width:100%; margin:2px 0 0;"
      on:click={() => (adding = true)}
    >
      ＋ Add task
    </button>
  {/if}
</div>

<ConfirmSubSheet bind:pending={pendingRemove} />

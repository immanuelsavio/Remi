<script lang="ts">
  /**
   * PLAN - where a day gets built.
   *
   * The showcase's setup-list editor: a numbered row per task, each with its
   * own indented, dashed step inputs. Typing a task and pressing Enter drops
   * you straight into the next one, so a whole day goes in without touching
   * the mouse.
   *
   * One deviation, deliberate: the showcase keeps a BLANK task object in
   * state to represent "an empty box waiting to be typed into", which means
   * `state.json` can contain untitled tasks. Here the trailing box is
   * component-local and only becomes a task once it has a title - so a blank
   * row can never reach disk, or the Today screen, or a carry-forward.
   */
  import {
    addMain,
    addSub,
    app,
    removeMain,
    removeSub,
    setEstimate,
    setMainTitle,
    resumeDay,
    setOverlay,
    setSubTitle,
    startDay,
    toggleShowSubs,
  } from "../../../store";
  import { allTags, fmt, fmtEst, mainTotal, nowMs } from "../../../view";
  import RemindControl from "../../shared/RemindControl.svelte";
  import TagEditor from "../../shared/TagEditor.svelte";
  import ImportSheet from "../ImportSheet.svelte";

  /** Lifted to the router: this tab is destroyed and recreated on every tab
      switch, but these drafts must survive that round trip. */
  export let stepDrafts: Record<string, string> = {};
  export let estDrafts: Record<string, { h: number; m: number }> = {};

  let taskDraft = "";
  let importOpen = false;
  let importText = "";
  let taskInputs: Record<string, HTMLInputElement | null> = {};
  let newTaskInput: HTMLInputElement | null = null;

  $: s = $app;
  $: active = s.mains.find((m) => m.id === s.activeMainId) ?? null;
  $: activeSub = active?.subs.find((x) => x.id === s.activeSubId) ?? null;
  $: activeThing = activeSub ?? active;
  // Suggest tags already in use anywhere - today's tasks and the archive -
  // so a project gets labelled the same way each time.
  $: knownTags = allTags([...s.mains, ...s.history.flatMap((h) => h.completed)]);

  function commitTask() {
    if (!taskDraft.trim()) return;
    addMain(taskDraft);
    taskDraft = "";
    queueMicrotask(() => newTaskInput?.focus());
  }

  function commitStep(mainId: string) {
    const v = (stepDrafts[mainId] ?? "").trim();
    if (!v) return;
    addSub(mainId, v);
    stepDrafts[mainId] = "";
  }

  function commitEstimate(id: string) {
    const d = estDrafts[id] ?? { h: 0, m: 0 };
    setEstimate(id, Number(d.h) || 0, Number(d.m) || 0);
  }

  /** Enter on a task row moves to the next one, or to the new-task box. */
  function nextRow(i: number) {
    const next = s.mains[i + 1];
    if (next) taskInputs[next.id]?.focus();
    else newTaskInput?.focus();
  }
</script>

<div class="dsec-title">Plan your day</div>
<div class="dsec-sub">
  Add tasks and steps by hand, or import a list from ChatGPT / a text file.
</div>

{#if s.phase === "startday"}
  <div class="givenback">
    <div class="eyebrow">Day {s.dayNum} hasn't started</div>
    <div class="gb-l">
      {s.carrySeed.length} carried · {s.standardDaily.length} routine{s.standardDaily.length === 1
        ? ""
        : "s"} waiting to be added.
    </div>
    <div class="gb-acts">
      <button class="bk-btn" on:click={() => startDay()}>▸ Start my day</button>
      {#if s.resumable}
        <button
          class="bk-btn ghost"
          title="Put the tasks and time from day {s.resumable.dayNum} back"
          on:click={resumeDay}>↺ Reopen day {s.resumable.dayNum}</button
        >
      {/if}
    </div>
  </div>
{:else if activeThing}
  <div class="givenback">
    <div class="eyebrow">On now</div>
    <div class="gb-t">{activeThing.title}</div>
    <div class="gb-l">
      {fmt((activeThing.accrued ?? 0) + (s.startedAt ? Math.max(0, $nowMs - s.startedAt) : 0))} on the
      clock
    </div>
  </div>
{/if}

<div style="margin-bottom:14px;">
  <button class="bk-btn" on:click={() => (importOpen = true)}>⇪ Import a task list</button>
</div>

<div class="setup-list">
  {#each s.mains as m, i (m.id)}
    <div class="main-input-row">
      <div class="idx">{i + 1}</div>
      <div class="col">
        <div style="display:flex; align-items:center; gap:7px;">
          <input
            class="taskinput"
            style="flex:1;"
            placeholder="a task…"
            value={m.title}
            bind:this={taskInputs[m.id]}
            on:input={(e) => setMainTitle(m.id, e.currentTarget.value)}
            on:keydown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              nextRow(i);
            }}
          />
          <RemindControl
            remind={m.remind}
            now={$nowMs}
            target={{ kind: "main", id: m.id, title: m.title }}
          />
          {#if m.id === s.activeMainId}<span class="est-badge">▸ on now</span>{/if}
          {#if m.done}<span class="carry-badge">done · {fmtEst(mainTotal(m, s, $nowMs))}</span>{/if}
        </div>

        {#if s.trainerOn}
          <div class="est-row">
            <span class="est-lbl">⏱ Your estimate</span>
            <input
              class="est-in"
              type="number"
              min="0"
              max="23"
              placeholder="hr"
              value={m.estMs ? Math.floor(m.estMs / 3600000) || "" : ""}
              on:input={(e) => {
                estDrafts[m.id] = {
                  h: Number(e.currentTarget.value) || 0,
                  m: estDrafts[m.id]?.m ?? Math.round((m.estMs % 3600000) / 60000),
                };
              }}
              on:change={() => commitEstimate(m.id)}
            />
            <input
              class="est-in"
              type="number"
              min="0"
              max="59"
              placeholder="min"
              value={m.estMs ? Math.round((m.estMs % 3600000) / 60000) || "" : ""}
              on:input={(e) => {
                estDrafts[m.id] = {
                  h: estDrafts[m.id]?.h ?? Math.floor(m.estMs / 3600000),
                  m: Number(e.currentTarget.value) || 0,
                };
              }}
              on:change={() => commitEstimate(m.id)}
            />
          </div>
        {/if}

        <TagEditor mainId={m.id} tags={m.tags} suggestions={knownTags} />

        {#if m._showSubs || m.subs.length}
          <div class="sub-inputs">
            {#each m.subs as sub (sub.id)}
              <div style="display:flex;align-items:center;gap:6px;">
                <input
                  class="subinput"
                  style="flex:1;"
                  placeholder="a step…"
                  value={sub.title}
                  on:input={(e) => setSubTitle(m.id, sub.id, e.currentTarget.value)}
                />
                <RemindControl
                  remind={sub.remind}
                  now={$nowMs}
                  target={{ kind: "sub", mainId: m.id, id: sub.id, title: sub.title }}
                />
                <button
                  class="rm rm-sub"
                  title="Remove step"
                  aria-label="Remove step"
                  on:click={() => removeSub(m.id, sub.id)}>✕</button
                >
              </div>
            {/each}
            <input
              class="subinput"
              placeholder="＋ add a step…"
              autocomplete="off"
              bind:value={stepDrafts[m.id]}
              on:keydown={(e) => e.key === "Enter" && commitStep(m.id)}
              on:blur={() => commitStep(m.id)}
            />
          </div>
        {:else}
          <button class="addsub-link" on:click={() => toggleShowSubs(m.id)}>
            ＋ add steps (optional)
          </button>
        {/if}
      </div>
      <button class="rm" title="Remove" aria-label="Remove" on:click={() => removeMain(m.id)}>
        ✕
      </button>
    </div>
  {/each}

  <!-- The always-present trailing box: type, Enter, keep going.
       `data-tour` is what the guided tour walks Remi over to - see
       `domain/tour.ts`. Moving this row means moving the attribute with it. -->
  <div class="main-input-row" data-tour="plan-add">
    <div class="idx">{s.mains.length + 1}</div>
    <div class="col">
      <input
        class="taskinput"
        placeholder="a task…"
        autocomplete="off"
        bind:this={newTaskInput}
        bind:value={taskDraft}
        on:keydown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          commitTask();
        }}
        on:blur={commitTask}
      />
    </div>
    <span style="width:30px; flex:none;"></span>
  </div>
</div>

<button
  class="addmain-link"
  style="width:auto; margin:10px 0 0;"
  on:click={() => newTaskInput?.focus()}
>
  ＋ Add task
</button>

<div style="margin-top:16px; display:flex; gap:10px; flex-wrap:wrap;">
  <button class="bk-btn ghost" on:click={() => setOverlay("backlog")}>▤ Backlog</button>
</div>

<ImportSheet bind:open={importOpen} bind:text={importText} />

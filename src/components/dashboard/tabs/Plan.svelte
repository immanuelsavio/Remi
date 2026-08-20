<script lang="ts">
  import {
    addBacklog,
    addMain,
    addSub,
    app,
    backlogToToday,
    completeMain,
    deleteBacklog,
    promoteSub,
    pruneEmpty,
    removeMain,
    removeSub,
    reviveMain,
    setEstimate,
    setNote,
    setOverlay,
    setRemind,
    startDay,
    startSub,
    startTask,
    switchToMain,
    toggleSubDone,
  } from "../../../store";
  import { fmtEst, mainTotal, nowMs } from "../../../view";

  $: s = $app;

  // Lifted to the router and passed down bound: this tab is destroyed and
  // recreated on every tab switch, but in the original single-file component
  // these drafts lived at the top level and survived switching tabs.
  export let draft = "";
  export let stepDrafts: Record<string, string> = {};
  export let estDrafts: Record<string, { h: number; m: number }> = {};
  export let remindDrafts: Record<string, string> = {};
  export let noteOpen: string | null = null;

  function commitDraft() {
    addMain(draft);
    draft = "";
  }

  function commitStep(id: string) {
    addSub(id, stepDrafts[id] ?? "");
    stepDrafts[id] = "";
  }

  function commitEstimate(id: string) {
    const d = estDrafts[id] ?? { h: 0, m: 0 };
    setEstimate(id, d.h || 0, d.m || 0);
  }

  function commitRemind(id: string) {
    const raw = (remindDrafts[id] ?? "").trim();
    if (!raw) {
      setRemind({ kind: "main", id }, "clear", "");
      return;
    }
    // A bare `HH:MM` is a clock time today; anything else is a full datetime.
    setRemind({ kind: "main", id }, /^\d{1,2}:\d{2}$/.test(raw) ? "by" : "on", raw);
    remindDrafts[id] = "";
  }
</script>

<div class="wrap">
  <h1>Plan your day</h1>
  <p class="muted">
    Type the whole day here, then work it in the popover or the Today tab. Steps are one level deep.
  </p>

  {#if s.phase === "startday"}
    <div class="callout">
      <div class="grow">
        <b>Day {s.dayNum} hasn't started.</b>
        <div class="muted small">
          {s.carrySeed.length} carried · {s.standardDaily.length} routine{s.standardDaily.length ===
          1
            ? ""
            : "s"} waiting to be added.
        </div>
      </div>
      <button class="btn accent" on:click={startDay}>▸ Start my day</button>
    </div>
  {/if}

  <input
    class="in big"
    placeholder="Add a task, then press Enter"
    bind:value={draft}
    on:keydown={(e) => e.key === "Enter" && commitDraft()}
  />

  {#each s.mains as m (m.id)}
    {@const warn = s.avoidanceOn && m.carries >= 3}
    {@const total = mainTotal(m, s, $nowMs)}
    <div class="card" class:warn class:is-done={m.done}>
      <div class="row">
        <div class="grow">
          <div class="title" class:strike={m.done}>
            {m.title}
            {#if m.remind}
              <span class="badge" title={m.remind.label}>⏲ {m.remind.short}</span>
            {/if}
            {#if m.estMs}<span class="badge">⏱ {fmtEst(m.estMs)}</span>{/if}
            {#if s.avoidanceOn && m.carries >= 1}
              <span class="badge" class:warnb={warn}>↻ {m.carries}×</span>
            {/if}
            {#if m.id === s.activeMainId}<span class="badge live">● running</span>{/if}
          </div>
          <div class="muted small">
            {fmtEst(total)}
            {#if m.interruptedCount}
              · interrupted {m.interruptedCount}× for {fmtEst(m.interruptedMs)}
            {/if}
            {#if m.subs.length}
              · {m.subs.filter((x) => x.done).length}/{m.subs.length} steps
            {/if}
          </div>
          {#if warn}
            <div class="note">
              Moved {m.carries} days running - are you avoiding it? Try the first small step.
            </div>
          {/if}
        </div>

        {#if m.done}
          <button class="mini" title="Not actually done" on:click={() => reviveMain(m.id)}>
            ↺
          </button>
        {:else}
          <button
            class="start-pill"
            class:outline={s.activeMainId === m.id}
            disabled={s.activeMainId === m.id}
            on:click={() => (s.activeMainId ? switchToMain(m.id, true) : startTask(m.id))}
          >
            {s.activeMainId === m.id ? "Running" : s.activeMainId ? "Switch to" : "Start"}
            {#if s.activeMainId !== m.id}<span class="ico" aria-hidden="true">▸</span>{/if}
          </button>
          <button class="mini" title="Mark done" on:click={() => completeMain(m.id)}>✓</button>
        {/if}
        <button
          class="mini"
          title="Notes, estimate & reminder"
          on:click={() => (noteOpen = noteOpen === m.id ? null : m.id)}>✎</button
        >
        <button class="mini danger" title="Remove" on:click={() => removeMain(m.id)}>✕</button>
      </div>

      {#if noteOpen === m.id}
        <div class="detail">
          <label class="fld">
            <span class="muted small">Note</span>
            <textarea
              class="in"
              rows="2"
              placeholder="Context you'll want tomorrow…"
              value={m.note}
              on:change={(e) => setNote(m.id, null, e.currentTarget.value)}
            ></textarea>
          </label>
          <div class="row">
            <label class="fld">
              <span class="muted small">Estimate</span>
              <span class="inline">
                <input
                  class="in narrow"
                  type="number"
                  min="0"
                  max="23"
                  placeholder="h"
                  value={Math.floor(m.estMs / 3600000) || ""}
                  on:change={(e) => {
                    estDrafts[m.id] = {
                      h: Number(e.currentTarget.value),
                      m: estDrafts[m.id]?.m ?? Math.round((m.estMs % 3600000) / 60000),
                    };
                    commitEstimate(m.id);
                  }}
                />
                <input
                  class="in narrow"
                  type="number"
                  min="0"
                  max="59"
                  placeholder="m"
                  value={Math.round((m.estMs % 3600000) / 60000) || ""}
                  on:change={(e) => {
                    estDrafts[m.id] = {
                      h: estDrafts[m.id]?.h ?? Math.floor(m.estMs / 3600000),
                      m: Number(e.currentTarget.value),
                    };
                    commitEstimate(m.id);
                  }}
                />
              </span>
            </label>
            <label class="fld grow">
              <span class="muted small">Remind (HH:MM today, or a full date-time)</span>
              <input
                class="in"
                placeholder={m.remind ? m.remind.label : "14:30"}
                bind:value={remindDrafts[m.id]}
                on:keydown={(e) => e.key === "Enter" && commitRemind(m.id)}
                on:blur={() => remindDrafts[m.id] && commitRemind(m.id)}
              />
            </label>
            {#if m.remind}
              <button
                class="btn small"
                on:click={() => setRemind({ kind: "main", id: m.id }, "clear", "")}
              >
                Clear
              </button>
            {/if}
          </div>
        </div>
      {/if}

      <div class="steps">
        {#each m.subs as sub (sub.id)}
          <div class="step">
            <input
              type="checkbox"
              checked={sub.done}
              aria-label={sub.title}
              on:change={() => toggleSubDone(m.id, sub.id)}
            />
            <span class="grow" class:strike={sub.done}>{sub.title}</span>
            {#if sub.accrued}<span class="muted small">{fmtEst(sub.accrued)}</span>{/if}
            {#if !sub.done && !m.done}
              <button class="mini" title="Work on this step" on:click={() => startSub(m.id, sub.id)}
                >▸</button
              >
              <button
                class="promote"
                title="Make this its own task"
                on:click={() => promoteSub(m.id, sub.id)}
              >
                ↳ make its own task
              </button>
            {/if}
            <button class="mini danger" on:click={() => removeSub(m.id, sub.id)}>✕</button>
          </div>
        {/each}
        {#if !m.done}
          <input
            class="in step-in"
            placeholder="Add a step…"
            bind:value={stepDrafts[m.id]}
            on:keydown={(e) => e.key === "Enter" && commitStep(m.id)}
          />
        {/if}
      </div>
    </div>
  {/each}

  {#if s.mains.length}
    <div class="row">
      <button class="btn" on:click={pruneEmpty}>Tidy blank rows</button>
      <button class="btn" on:click={() => setOverlay("endday")}>End the day…</button>
      <button class="btn" on:click={() => setOverlay("restart")}>Restart the day…</button>
    </div>
  {/if}

  <h2>Backlog</h2>
  <p class="muted small">Things for later. Nothing here is on today's list.</p>
  {#each s.backlog as b (b.id)}
    <div class="line">
      <span class="grow">{b.title}</span>
      <button class="btn small" on:click={() => backlogToToday(b.id)}>→ Today</button>
      <button class="mini danger" on:click={() => deleteBacklog(b.id)}>✕</button>
    </div>
  {/each}
  <input
    class="in"
    placeholder="Add something for later…"
    on:keydown={(e) => {
      if (e.key !== "Enter") return;
      addBacklog(e.currentTarget.value);
      e.currentTarget.value = "";
    }}
  />
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
  .inline {
    display: flex;
    gap: 5px;
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .card {
    margin: 11px 0;
    padding: 13px;
    border-radius: var(--r-md);
    background: var(--card);
    border: 1px solid var(--line);
  }
  .card.is-done {
    opacity: 0.62;
  }
  .card.warn {
    background: var(--warn-bg);
    border-color: var(--warn-line);
  }
  .note {
    font-size: 12px;
    color: var(--warn-ink);
    margin-top: 4px;
  }
  .title {
    font-weight: 570;
    font-size: 15px;
    overflow-wrap: anywhere;
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
  .badge.live {
    background: var(--accent);
    color: #fff;
  }
  .detail {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
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
  .step-in {
    font-size: 13px;
    padding: 6px 9px;
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
  .narrow {
    width: 72px;
  }
</style>

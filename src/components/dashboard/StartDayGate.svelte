<script lang="ts">
  /**
   * The dashboard's Start-my-day screen.
   *
   * The popover has had one since the beginning; this window never did.
   * `awaitingStart` was referenced in exactly ONE place in the whole UI
   * (Calendar's "is today real yet" check), so the dashboard happily
   * rendered Plan, Today, Stats and the rest before the day had begun —
   * while the carried tasks sat in `carrySeed`, where nothing displayed
   * them.
   *
   * That is the exact inversion a user hit: the window hid the one thing
   * they had to make a decision about, and showed everything else. This
   * closes the gate and puts the decision behind it, matching the popover.
   *
   * Deliberately NOT a modal: it replaces the tab body, and the tab strip
   * is disabled alongside it, because a day that has not started has no
   * Today to look at.
   */
  import { app, openDashboard, resumeDay, startDay } from "../../store";
  import type { SeedChoice } from "../../store";
  import { fmtEst } from "../../view";
  import CarryDecisions from "../shared/CarryDecisions.svelte";
  import Mascot from "../shared/Mascot.svelte";
  import WakeSequence from "./WakeSequence.svelte";

  let deciding = false;
  /** Keyed by index: a carried task is a snapshot and has no id yet. */
  let choices: Record<string, SeedChoice> = {};

  $: s = $app;
  $: carried = s.carrySeed ?? [];
  /** Only ask again if End Day did not already ask. */
  $: canDecide = carried.length > 0 && !s.carryDecided;
  $: keeping = carried.filter((_, i) => (choices[String(i)] ?? "keep") === "keep").length;

  const OPTIONS: { value: SeedChoice; label: string; tone?: "accent" | "done" }[] = [
    { value: "keep", label: "Today", tone: "accent" },
    { value: "backlog", label: "Backlog" },
    { value: "drop", label: "Drop" },
  ];

  /** True while the wake-up sequence is playing and the gate is hidden. */
  let waking = false;

  /**
   * Pressing Start plays the sequence FIRST and commits after.
   *
   * The order matters: the day starting is what the animation is about, so
   * committing up front would reveal the dashboard behind a mouse still
   * pretending to wake up. `WakeSequence` skips itself instantly when the
   * setting is off or reduced motion is on, so this path is the same one
   * either way and there is no second code route to keep correct.
   */
  function begin() {
    waking = true;
  }

  function commit() {
    startDay(deciding ? carried.map((_, i) => choices[String(i)] ?? "keep") : []);
    openDashboard("plan");
  }
</script>

{#if waking}
  <WakeSequence on:done={commit} />
{:else}
  <div class="sdgate">
    <!-- Asleep until you say so. -->
    <Mascot mood="sleep" size={132} />
    <div class="eyebrow">Day {s.dayNum}</div>
    <h1 class="big">{s.dayNum > 1 ? "New day." : "Good morning."}</h1>

    {#if deciding}
      <p class="lede">
        {carried.length} task{carried.length === 1 ? "" : "s"} came over from yesterday. What happens
        to each?
      </p>
      <div class="sd-list">
        <CarryDecisions
          items={carried.map((c, i) => ({
            key: String(i),
            title: c.title,
            detail: c.estMs ? fmtEst(c.estMs) : undefined,
            warn: (c.carries ?? 0) >= 3,
          }))}
          bind:choices
          options={OPTIONS}
        />
      </div>
      <div class="sd-acts">
        <button class="bk-btn ghost" on:click={() => (deciding = false)}>Back</button>
        <button class="bk-btn" on:click={begin}>
          Start with {keeping} task{keeping === 1 ? "" : "s"} ›
        </button>
      </div>
    {:else}
      {#if carried.length}
        <p class="lede">
          {carried.length} task{carried.length === 1 ? "" : "s"} carried over from yesterday.
        </p>
        <!-- Show WHAT carried, before the decision. The whole complaint was
           that the count was visible but the tasks were not. -->
        <ul class="sd-preview">
          {#each carried as c, i (i)}
            <li>
              <span class="sp-t">{c.title}</span>
              {#if (c.carries ?? 0) >= 3}
                <span class="sp-warn">moved {c.carries} days running</span>
              {:else if c.estMs}
                <span class="sp-d">{fmtEst(c.estMs)}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="lede">Nothing carried over. A clean start.</p>
      {/if}

      <div class="sd-acts">
        <button class="bk-btn" on:click={begin}>▸ Start my day</button>
        {#if canDecide}
          <button class="bk-btn ghost" on:click={() => (deciding = true)}>Decide per task</button>
        {/if}
        {#if s.resumable}
          <button class="bk-btn ghost" on:click={resumeDay}>Reopen yesterday</button>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .sdgate {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 34px 24px 40px;
    max-width: 620px;
    margin: 0 auto;
  }
  .sd-list {
    width: 100%;
    margin-top: 14px;
    text-align: left;
  }
  .sd-preview {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    width: 100%;
    text-align: left;
  }
  .sd-preview li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--card);
    margin-bottom: 8px;
  }
  .sp-t {
    font-weight: 600;
    color: var(--ink);
  }
  .sp-d {
    font-family: var(--font-num);
    font-size: 11.5px;
    color: var(--ink-faint);
  }
  .sp-warn {
    font-size: 11.5px;
    color: var(--danger);
  }
  .sd-acts {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: center;
    margin-top: 18px;
  }
</style>

<script lang="ts">
  /**
   * The Start-my-day screen: the first thing you see each morning.
   *
   * When work carried over WITHOUT anyone being asked — an unattended
   * rollover past midnight, or a plain "wrap up the day" — this is the
   * moment to ask, because it is the first moment someone is actually
   * present. Each carried task can come into today, go to the backlog, or
   * be dropped.
   *
   * If the choice was already made at End Day (`carryDecided`), it is not
   * asked again.
   */
  import { app, openDashboard, resumeDay } from "../../../store";
  import type { SeedChoice } from "../../../store";
  import { fmtEst, todayISO } from "../../../view";
  import { endedOn } from "../../../domain/day-state";
  import type { computeStreaks } from "../../../view";
  import RemiMark from "../../shared/RemiMark.svelte";
  import Mascot from "../../shared/Mascot.svelte";
  import CarryDecisions from "../../shared/CarryDecisions.svelte";

  export let streaks: ReturnType<typeof computeStreaks>;

  let deciding = false;
  /** Keyed by index, because a carried task is a snapshot with no id. */
  let choices: Record<string, SeedChoice> = {};

  $: s = $app;
  $: carried = s.carrySeed ?? [];
  $: canDecide = carried.length > 0 && !s.carryDecided;
  /** Today is already archived: reopening is the only way back in. */
  $: wrappedToday = endedOn(s, todayISO());
  $: canReopen = wrappedToday && !!s.resumable;
  $: keeping = carried.filter((_, i) => (choices[String(i)] ?? "keep") === "keep").length;

  /**
   * The tray OPENS the door; the dashboard walks through it.
   *
   * Starting the day is now a two-step move on purpose: tray → dashboard
   * gate → Start. The gate is where the carried tasks are actually listed
   * and decided on, and where the wake-up sequence plays. Committing here
   * as well would mean the dashboard's gate never appeared, so the one
   * screen built to show what carried over would be skipped by the very
   * button meant to reach it.
   */
  function begin() {
    openDashboard("plan");
  }
</script>

<div class="popover">
  <div class="pop-body">
    <div class="startday">
      <!-- The animated mouse where the static icon was: same animal,
           awake and waiting for the day to start. Falls back to the flat
           mark when the mascot is off, so the screen still has a brand. -->
      {#if s.mascotOn}
        <Mascot mood="sleep" size={92} />
      {:else}
        <RemiMark size={54} />
      {/if}
      <div class="eyebrow">Day {s.dayNum}</div>
      <h1 class="big">
        {#if wrappedToday}That's today, done.{:else}{s.dayNum > 1
            ? "New day."
            : "Good morning."}{/if}
      </h1>

      {#if deciding}
        <div class="lede">
          {carried.length} task{carried.length > 1 ? "s" : ""} came over from yesterday. What happens
          to each?
        </div>
      {:else}
        <div class="lede">
          {#if carried.length}
            {carried.length} task{carried.length > 1 ? "s" : ""} carried over from yesterday, ready to
            go.
            {#if s.standardDaily.length}<br />Plus your {s.standardDaily.length} daily routine{s
                .standardDaily.length > 1
                ? "s"
                : ""}.{/if}
          {:else if s.standardDaily.length}
            Your {s.standardDaily.length} daily routine{s.standardDaily.length > 1 ? "s" : ""} will be
            added automatically.
          {:else}
            Let's line up today.<br />Plan your tasks in the dashboard, then work them here.
          {/if}
        </div>
        {#if streaks.current > 1}
          <div class="lede">🔥 {streaks.current}-day streak</div>
        {/if}
      {/if}

      {#if deciding}
        <div class="carrywrap">
          <CarryDecisions
            bind:choices
            items={carried.map((c, i) => ({
              key: String(i),
              title: c.title,
              detail: [
                c.carries >= 1 ? `moved ${c.carries}×` : "",
                c.subs.length ? `${c.subs.length} steps` : "",
                c.estMs ? `est ${fmtEst(c.estMs)}` : "",
              ]
                .filter(Boolean)
                .join(" · "),
              warn: s.avoidanceOn && c.carries >= 3,
            }))}
            options={[
              { value: "keep", label: "Today", tone: "accent" },
              { value: "backlog", label: "Backlog" },
              { value: "drop", label: "Drop" },
            ]}
          />
        </div>
      {/if}

      {#if canReopen && !deciding}
        <!-- Today is already archived. A new day belongs to a new date, so
             reopening is the only move on offer. -->
        <button
          class="btn accent big"
          title="Put today's tasks and their time back"
          on:click={resumeDay}
        >
          <span class="ico" aria-hidden="true">↺</span> Reopen today
        </button>
      {:else}
        <button class="btn accent big" on:click={begin}>
          <span class="ico" aria-hidden="true">▸</span>
          {deciding ? `Start with ${keeping}` : "Start my day"}
        </button>
        {#if s.resumable && !deciding}
          <button
            class="btn"
            style="margin-top:9px; max-width:220px; width:100%;"
            title="Put yesterday's tasks and their time back"
            on:click={resumeDay}
          >
            ↺ Reopen day {s.resumable.dayNum}
          </button>
        {/if}
      {/if}
      {#if canDecide && !deciding && !canReopen}
        <button
          class="btn"
          style="margin-top:9px; max-width:220px; width:100%;"
          on:click={() => (deciding = true)}
        >
          Decide per task…
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .startday :global(.remi-logo) {
    margin: 0 auto 14px;
  }
  /* The decision list is left-aligned inside an otherwise centred screen,
     and scrolls on its own so a long carry list cannot push the button off. */
  .carrywrap {
    width: 100%;
    text-align: left;
    margin-top: 16px;
    max-height: 240px;
    overflow-y: auto;
  }
</style>

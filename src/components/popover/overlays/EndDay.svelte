<script lang="ts">
  /**
   * End Day, with a real per-task decision.
   *
   * The default is still one button: most evenings everything unfinished
   * should just carry. "Decide per task" expands the list in place rather
   * than sending you to another screen - the previous version's button
   * claimed to do this and merely opened the Plan tab, which offers no such
   * choice.
   */
  import { app, closeOverlay, endDay } from "../../../store";
  import type { CarryChoice } from "../../../store";
  import { fmtEst } from "../../../view";
  import type { Main } from "../../../view";
  import CarryDecisions from "../../shared/CarryDecisions.svelte";

  export let tracked: number;
  export let done: Main[];

  let deciding = false;
  let choices: Record<string, CarryChoice> = {};

  $: s = $app;
  $: pending = s.mains.filter((m) => !m.done);
  $: carrying = pending.filter((m) => (choices[m.id] ?? "carry") === "carry").length;
  $: toBacklog = pending.filter((m) => choices[m.id] === "backlog").length;
  $: marked = pending.filter((m) => choices[m.id] === "done").length;
</script>

<div class="scrim">
  <div class="sheet" role="dialog" aria-modal="true">
    <div class="s-in">
      <h3>End the day?</h3>
      <div class="s-text">
        {fmtEst(tracked)} tracked · {done.length + marked} done{#if carrying}
          · {carrying} carrying to tomorrow{/if}{#if toBacklog}
          · {toBacklog} to backlog{/if}.
      </div>

      {#if deciding && pending.length}
        <div class="grouplbl">What happens to each?</div>
        <CarryDecisions
          bind:choices
          items={pending.map((m) => ({
            key: m.id,
            title: m.title,
            detail: s.avoidanceOn && m.carries >= 1 ? `moved ${m.carries}×` : undefined,
            warn: s.avoidanceOn && m.carries >= 3,
          }))}
          options={[
            { value: "carry", label: "Tomorrow", tone: "accent" },
            { value: "backlog", label: "Backlog" },
            { value: "done", label: "Done", tone: "done" },
          ]}
        />
      {/if}

      <button
        class="checkin-yes"
        on:click={() => {
          endDay(deciding ? choices : {});
          closeOverlay();
        }}>Wrap up the day</button
      >
      {#if !deciding && pending.length}
        <button class="checkin-no" on:click={() => (deciding = true)}>
          Decide per task… ({pending.length})
        </button>
      {/if}
      <button class="checkin-no" on:click={closeOverlay}>Not yet</button>
    </div>
  </div>
</div>

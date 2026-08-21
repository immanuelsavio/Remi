<script lang="ts">
  /**
   * The reminder affordance on a task/step/backlog row: a small ⏲ button
   * when nothing is set, the badge itself when one is - and clicking either
   * opens the picker. One component so a row never has to decide which of
   * the two to draw.
   */
  import { openRemind, type RemindTarget } from "../../store";
  import type { Remind } from "../../view";

  export let remind: Remind | null;
  export let target: RemindTarget;
  /** Overdue badges go red; the caller passes `now` so it ticks live. */
  export let now = Date.now();

  $: due = !!remind && now >= remind.at;
</script>

{#if remind}
  <button
    class="rembadge"
    class:due
    title="{remind.label} - click to change"
    on:click|stopPropagation={() => openRemind(target)}
  >
    <span aria-hidden="true">⏲</span>
    {remind.short}
  </button>
{:else}
  <button
    class="rembtn"
    title="Set a reminder"
    aria-label="Set a reminder"
    on:click|stopPropagation={() => openRemind(target)}>⏲</button
  >
{/if}

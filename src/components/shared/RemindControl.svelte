<script lang="ts">
  /**
   * The reminder affordance on a task/step/backlog row: a small ⏲ button
   * when nothing is set, the badge itself when one is - and clicking either
   * opens the picker. One component so a row never has to decide which of
   * the two to draw.
   */
  import { openRemind, tourAnchor, type RemindTarget } from "../../store";
  import type { Remind } from "../../view";

  export let remind: Remind | null;
  export let target: RemindTarget;
  /** Overdue badges go red; the caller passes `now` so it ticks live. */
  export let now = Date.now();
  /**
   * Registers this control as the tour's target, when a caller names one.
   *
   * A prop rather than a wrapper element: this button sits inside a flex
   * row whose spacing is load-bearing, and a div around it would change
   * the layout for everyone to serve the tour.
   */
  export let tourId: string | undefined = undefined;

  $: due = !!remind && now >= remind.at;
</script>

{#if remind}
  <button
    class="rembadge"
    use:tourAnchor={tourId}
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
    use:tourAnchor={tourId}
    title="Set a reminder"
    aria-label="Set a reminder"
    on:click|stopPropagation={() => openRemind(target)}>⏲</button
  >
{/if}

<script lang="ts">
  /**
   * The popover's top strip: day/context on the left, the three "quiet"
   * tools on the right (Backlog, Task map, Break).
   *
   * These three deliberately live up here rather than among the main
   * actions: they are places you GO, not things you DO to the running task.
   */
  import { app, setOverlay, startBreak } from "../../store";

  /** Left-hand label. Ignored when `back` is set. */
  export let label = "";
  /** Hide Map + Break on screens where there is no work to act on. */
  export let showWork = true;
  /** Replace the label with a Back button (the task map uses this). */
  export let back = false;
  /** Called when Back is pressed. */
  export let onBack: (() => void) | null = null;
  /** Called when the Map button is pressed. */
  export let onMap: (() => void) | null = null;

  $: s = $app;
</script>

<div class="topstrip">
  <span class="day">
    {#if back}
      <button class="tbtn" title="Back" on:click={() => onBack?.()}>‹ Back</button>
    {:else}
      {label}
    {/if}
  </span>
  <span class="tools">
    <button class="tbtn" title="Backlog" on:click={() => setOverlay("backlog")}>
      ▤ Backlog{#if s.backlog.length}&nbsp;· {s.backlog.length}{/if}
    </button>
    {#if showWork}
      <button class="tbtn" title="Task map" on:click={() => onMap?.()}>⋔ Map</button>
      <button class="tbtn break" title="Break" on:click={() => startBreak(15)}>☕</button>
    {/if}
  </span>
</div>

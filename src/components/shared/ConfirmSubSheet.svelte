<script lang="ts">
  /**
   * The ✕ on a step asks before acting.
   *
   * Deleting and completing look identical from the outside - the row goes
   * away - but only one of them throws work away. A step is often the only
   * record that a piece of work happened, so ✕ offers both and assumes
   * neither.
   *
   * The sheet closes by clearing its own `pending` prop rather than by
   * touching the shared overlay slot, because it can be raised from screens
   * that already have an overlay open.
   */
  import { app, removeSub, toggleSubDone } from "../../store";

  /** `{ mainId, subId }` while open, `null` when closed. */
  export let pending: { mainId: string; subId: string } | null = null;

  $: s = $app;
  $: sub = pending
    ? (s.mains.find((m) => m.id === pending?.mainId)?.subs.find((x) => x.id === pending?.subId) ??
      null)
    : null;

  function markDone() {
    if (!pending || !sub) return;
    if (!sub.done) toggleSubDone(pending.mainId, pending.subId);
    pending = null;
  }

  function del() {
    if (!pending) return;
    removeSub(pending.mainId, pending.subId);
    pending = null;
  }
</script>

{#if pending && sub}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="scrim" on:click|self={() => (pending = null)}>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="s-in">
        <h3>“{sub.title}”</h3>
        <div class="s-text">Mark it done, or delete it?</div>
        <button class="checkin-yes" on:click={markDone}>✓ Mark done</button>
        <button class="btn danger" style="margin-top:9px; width:100%;" on:click={del}>Delete</button
        >
        <button class="checkin-no" on:click={() => (pending = null)}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

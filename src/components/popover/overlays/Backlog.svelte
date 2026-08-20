<script lang="ts">
  /**
   * The backlog: a parking lot, so "I should also…" can leave your head
   * without derailing today.
   */
  import { addBacklog, app, backlogToToday, closeOverlay, deleteBacklog } from "../../../store";
  import { nowMs } from "../../../view";
  import RemindControl from "../../shared/RemindControl.svelte";

  /** Lifted to the router so it survives closing and reopening. */
  export let backlogDraft: string;

  $: s = $app;

  function commit() {
    if (!backlogDraft.trim()) return;
    addBacklog(backlogDraft);
    backlogDraft = "";
  }
</script>

<div class="scrim">
  <div class="sheet" role="dialog" aria-modal="true">
    <div class="s-in">
      <h3>Backlog</h3>
      <div class="s-text">Ideas and someday-tasks. Pull one into today when you're ready.</div>

      <div class="newmain-row">
        <input
          placeholder="Add to backlog…"
          autocomplete="off"
          bind:value={backlogDraft}
          on:keydown={(e) => e.key === "Enter" && commit()}
        />
        <button on:click={commit}>Add</button>
      </div>

      <div class="backlog-body" style="padding:10px 0 0;">
        {#each s.backlog as b (b.id)}
          <div class="bl-row">
            <span class="bt">{b.title}</span>
            <span class="rgt">
              <RemindControl
                remind={b.remind}
                now={$nowMs}
                target={{ kind: "backlog", id: b.id, title: b.title }}
              />
              <button class="toToday" on:click={() => backlogToToday(b.id)}>→ Today</button>
              <button
                class="xdel"
                title="Remove"
                aria-label="Remove"
                on:click={() => deleteBacklog(b.id)}>✕</button
              >
            </span>
          </div>
        {:else}
          <div class="bl-empty">Empty — that's a good sign.</div>
        {/each}
      </div>

      <button class="checkin-no" on:click={closeOverlay}>Close</button>
    </div>
  </div>
</div>

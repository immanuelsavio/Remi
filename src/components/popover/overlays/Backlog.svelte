<script lang="ts">
  import { addBacklog, app, backlogToToday, closeOverlay, deleteBacklog } from "../../../store";

  $: s = $app;

  /** Lifted to the router: this overlay is destroyed and recreated each time
      it closes and reopens, but in the original single-file component this
      survived that round trip. */
  export let backlogDraft: string;

  function commitBacklog() {
    addBacklog(backlogDraft);
    backlogDraft = "";
  }
</script>

<div class="scrim">
  <div class="sheet">
    <h3>Backlog</h3>
    <p class="muted small">
      A parking lot for ideas and someday-tasks. Add freely; pull into today when you're ready.
    </p>
    <div class="add-row">
      <input
        class="in"
        placeholder="Add to backlog…"
        bind:value={backlogDraft}
        on:keydown={(e) => e.key === "Enter" && commitBacklog()}
      />
      <button class="btn accent" on:click={commitBacklog}>Add</button>
    </div>
    <div class="stack scroll-sm">
      {#each s.backlog as b (b.id)}
        <div class="card-row bl">
          <span class="grow">{b.title}</span>
          <button class="start-pill outline" on:click={() => backlogToToday(b.id)}>
            <span class="ico" aria-hidden="true">→</span> Today
          </button>
          <button class="mini danger" title="Remove" on:click={() => deleteBacklog(b.id)}>
            ✕
          </button>
        </div>
      {/each}
      {#if !s.backlog.length}<p class="muted small">Empty.</p>{/if}
      <button class="link" on:click={closeOverlay}>Close</button>
    </div>
  </div>
</div>

<style>
  .muted {
    color: var(--ink-soft);
  }
  .small {
    font-size: 12px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  h3 {
    font-size: 17px;
    margin: 0 0 3px;
    letter-spacing: -0.01em;
  }
  .add-row {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .add-row .in {
    flex: 1;
  }
  .add-row .btn {
    flex: none;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-top: 12px;
  }
  .scroll-sm {
    max-height: 340px;
    overflow-y: auto;
  }
  .card-row {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .card-row.bl {
    padding: 7px 0;
    border-bottom: 1px solid var(--line);
  }
  .scrim {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--ink) 42%, transparent);
    display: flex;
    align-items: flex-end;
    padding: 12px;
  }
  .sheet {
    width: 100%;
    padding: 15px;
    border-radius: var(--r-lg);
    background: var(--bg);
    border: 1px solid var(--line);
    box-shadow: 0 12px 34px color-mix(in srgb, var(--ink) 24%, transparent);
  }
</style>

<script lang="ts">
  import { app, closeOverlay, startNewMain, switchToMain } from "../../../store";

  $: s = $app;

  /** Shared with the Active hero's "Something came up" input - see the note
      in Active.svelte. */
  export let interruptDraft: string;

  function commitInterrupt() {
    if (!interruptDraft.trim()) {
      return;
    }
    startNewMain(interruptDraft, true);
    interruptDraft = "";
  }
</script>

<div class="scrim">
  <div class="sheet">
    <h3>What are you on now?</h3>
    <div class="stack scroll-sm">
      {#each s.mains.filter((m) => !m.done && m.id !== s.activeMainId) as m (m.id)}
        <button class="btn" on:click={() => switchToMain(m.id, true)}>{m.title}</button>
      {/each}
      <input
        class="in"
        placeholder="Something else…"
        bind:value={interruptDraft}
        on:keydown={(e) => e.key === "Enter" && commitInterrupt()}
      />
      <button class="link" on:click={closeOverlay}>Cancel</button>
    </div>
  </div>
</div>

<style>
  h3 {
    font-size: 17px;
    margin: 0 0 3px;
    letter-spacing: -0.01em;
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

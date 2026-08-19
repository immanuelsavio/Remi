<script lang="ts">
  import { app, closeOverlay, startBreak, startTask } from "../../../store";

  $: s = $app;
</script>

<div class="scrim">
  <div class="sheet">
    <h3>Nice. What's next?</h3>
    <div class="stack scroll-sm">
      {#each s.mains.filter((m) => !m.done) as m (m.id)}
        <button class="btn" on:click={() => startTask(m.id)}>{m.title}</button>
      {/each}
      {#if !s.mains.some((m) => !m.done)}
        <p class="muted small">Everything on today's list is done.</p>
      {/if}
      <button class="btn ghost" on:click={() => startBreak(10)}>Take a break</button>
      <button class="link" on:click={closeOverlay}>Just stop for now</button>
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

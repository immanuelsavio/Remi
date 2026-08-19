<script lang="ts">
  import { app, closeOverlay, endDay, openDashboard } from "../../../store";
  import { fmtEst } from "../../../view";
  import type { Main } from "../../../view";

  export let tracked: number;
  export let done: Main[];

  $: s = $app;
</script>

<div class="scrim">
  <div class="sheet">
    <h3>End the day?</h3>
    <p class="muted small">
      {fmtEst(tracked)} tracked · {done.length} done
      {#if s.mains.filter((m) => !m.done).length}
        · {s.mains.filter((m) => !m.done).length} will carry to tomorrow
      {/if}
    </p>
    <div class="stack">
      <button
        class="btn accent"
        on:click={() => {
          endDay();
          closeOverlay();
        }}>End day</button
      >
      <button class="btn" on:click={() => openDashboard("plan")}>Decide per task…</button>
      <button class="link" on:click={closeOverlay}>Not yet</button>
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

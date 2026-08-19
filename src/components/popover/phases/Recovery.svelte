<script lang="ts">
  /** Honest recovery screen. Rust preserved the files and changed nothing;
      showing a blank day here would read as "all my work vanished". */
  import { damagedPaths, loadMessage, openDashboard, setPhase } from "../../../store";
</script>

<div class="pad scroll">
  <h1>Couldn't read your data</h1>
  <p class="muted small">{$loadMessage}</p>
  <p class="muted small">
    Nothing was deleted or overwritten. Copies of the affected files are in your recovery folder.
  </p>
  {#each $damagedPaths as p (p)}
    <div class="path">{p}</div>
  {/each}
  <div class="row">
    <button class="btn accent" on:click={() => setPhase("today")}>Start today fresh</button>
    <button class="btn" on:click={() => openDashboard("settings")}>Open settings</button>
  </div>
</div>

<style>
  .pad {
    padding: 10px 14px;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
  }
  .row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  h1 {
    font-size: 25px;
    margin: 2px 0;
    letter-spacing: -0.02em;
  }
  .muted {
    color: var(--ink-soft);
  }
  .small {
    font-size: 12px;
  }
  .path {
    font-family: var(--font-num);
    font-size: 11px;
    color: var(--ink-soft);
    overflow-wrap: anywhere;
    margin: 4px 0;
  }
</style>

<script lang="ts">
  import { closeOverlay, muteCheckins, setOverlay, startBreak } from "../../../store";
  import { fmt } from "../../../view";
  import type { Main, Sub } from "../../../view";

  export let thing: Main | Sub;
  export let thingMs: number;
</script>

<div class="scrim">
  <div class="sheet">
    <h3>Still on this?</h3>
    <p class="muted small">{thing.title} · {fmt(thingMs)}</p>
    <div class="stack">
      <button class="btn accent" on:click={closeOverlay}>Yes, still on it</button>
      <button class="btn" on:click={() => setOverlay("switch")}>No, I moved on</button>
      <button class="btn" on:click={() => startBreak(10)}>I need a break</button>
      <button class="link" on:click={muteCheckins}>Mute check-ins today</button>
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

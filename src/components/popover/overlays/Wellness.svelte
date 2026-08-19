<script lang="ts">
  import { dismissWellness, snoozeWellness, wellnessCopy, wellnessNudge } from "../../../store";

  $: c = $wellnessNudge ? wellnessCopy($wellnessNudge) : null;
</script>

{#if $wellnessNudge && c}
  <div class="scrim">
    <div class="sheet">
      <h3>{c.icon} {c.title}</h3>
      <p class="muted small">{c.msg}</p>
      <div class="stack">
        <button class="btn accent" on:click={dismissWellness}>Done</button>
        <button class="btn" on:click={snoozeWellness}>Snooze 15 min</button>
      </div>
    </div>
  </div>
{/if}

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

<script lang="ts">
  import { dismissWelcomeBack, resumeWelcomeBack, welcomeBack } from "../../../store";
</script>

{#if $welcomeBack}
  <div class="scrim">
    <div class="sheet">
      <h3>Welcome back</h3>
      <p class="muted small">
        You were on "{$welcomeBack.title}" when Remi last closed. Time was only counted up to the
        last save.
      </p>
      <div class="stack">
        <button class="btn accent" on:click={resumeWelcomeBack}>Pick it back up</button>
        <button class="btn" on:click={dismissWelcomeBack}>Something else</button>
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

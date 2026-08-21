<script lang="ts">
  /**
   * "What's new" - shown ONCE, the first time the app runs on a version it
   * has not run on before.
   *
   * Deliberately not shown on a fresh install: someone opening Remi for the
   * first time wants the app, not a changelog for a version they never had.
   */
  import { dismissWhatsNew, whatsNew } from "../../store";
</script>

{#if $whatsNew}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="scrim" on:click|self={dismissWhatsNew}>
    <div class="sheet wide" role="dialog" aria-modal="true" aria-label="What's new">
      <div class="s-in">
        <div class="eyebrow">Updated</div>
        <h3>Remi {$whatsNew.version}</h3>
        {#if $whatsNew.notes}
          <div class="notes">{$whatsNew.notes}</div>
        {:else}
          <div class="s-text">
            You're on a new version. Release notes weren't available offline - they're on the
            releases page whenever you want them.
          </div>
        {/if}
        <button class="checkin-yes" on:click={dismissWhatsNew}>Got it</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Release notes are markdown from GitHub; rendering it as HTML would mean
     trusting a remote document inside the app, so it stays plain text. */
  .notes {
    margin-top: 10px;
    max-height: 320px;
    overflow-y: auto;
    white-space: pre-wrap;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--ink-soft);
    background: color-mix(in srgb, var(--bg-2) 35%, var(--card));
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: 12px 14px;
  }
</style>

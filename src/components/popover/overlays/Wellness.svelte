<script lang="ts">
  /**
   * A wellness nudge. Deliberately a CARD pinned to the bottom, not a modal
   * scrim: it must never block the screen or interrupt the clock - it is a
   * suggestion, and ignoring it should cost nothing.
   */
  import { dismissWellness, snoozeWellness, wellnessCopy, wellnessNudge } from "../../../store";

  $: c = $wellnessNudge ? wellnessCopy($wellnessNudge) : null;
</script>

{#if $wellnessNudge && c}
  <div class="well-nudge" role="status">
    <span class="wn-ico" aria-hidden="true">{c.icon}</span>
    <span class="wn-body">
      <span class="wn-t">{c.title}</span>
      <span class="wn-m">{c.msg}</span>
    </span>
    <span class="wn-acts">
      <button class="wn-snooze" on:click={snoozeWellness}>Later</button>
      <button class="wn-ok" on:click={dismissWellness}>OK</button>
    </span>
  </div>
{/if}

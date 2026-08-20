<script lang="ts">
  /**
   * "You were on X when Remi last closed." A non-blocking card, like the
   * wellness nudge - the offer is convenience, never a prerequisite, and the
   * clock already banked only up to the last save either way.
   */
  import { dismissWelcomeBack, resumeWelcomeBack, welcomeBack } from "../../../store";
</script>

{#if $welcomeBack}
  <div class="well-nudge" role="status">
    <span class="wn-ico" aria-hidden="true">👋</span>
    <span class="wn-body">
      <span class="wn-t">Welcome back</span>
      <span class="wn-m">You were on “{$welcomeBack.title}”.</span>
    </span>
    <span class="wn-acts">
      <button class="wn-snooze" on:click={dismissWelcomeBack}>Something else</button>
      <button class="wn-ok" on:click={resumeWelcomeBack}>Pick it up</button>
    </span>
  </div>
{/if}

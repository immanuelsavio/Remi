<script lang="ts">
  /**
   * "You were on X when Remi last closed." A non-blocking card, like the
   * wellness nudge - the offer is convenience, never a prerequisite, and the
   * clock already banked only up to the last save either way.
   */
  import { app, dismissWelcomeBack, resumeWelcomeBack, welcomeBack } from "../../../store";
  import { isTiming } from "../../../view";

  /**
   * Retire the offer when work starts in the OTHER window.
   *
   * `welcomeBack` is a per-window store and is deliberately not part of
   * State, so it never syncs - but State does. When the dashboard starts a
   * task, this window sees the running session arrive and the offer to
   * resume something else is stale by definition. Without this, the popover
   * kept saying "You were on X" while the dashboard timed something else,
   * and taking the offer switched the user off their live work.
   */
  $: if ($welcomeBack && isTiming($app)) dismissWelcomeBack();
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

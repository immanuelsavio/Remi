<script lang="ts">
  /**
   * "Welcome back" after an uninstall that kept the history.
   *
   * Shown once. The marker it reads is cleared during boot, so this cannot
   * reappear on the next launch even if the card is never dismissed.
   *
   * It exists because the alternative is unsettling: you remove an app,
   * reinstall it weeks later, and it opens with all your data as though
   * nothing happened. Saying so out loud turns a slightly eerie moment into
   * the feature it actually is.
   */
  import { app, returning } from "../../store";
  import { withName } from "../../domain/name";
  import { computeStreaks } from "../../view";
  import Mascot from "../shared/Mascot.svelte";

  $: s = $app;
  $: streaks = computeStreaks(s);
  $: days = s.history.length;
</script>

{#if $returning}
  <div class="retcard" role="status">
    <Mascot mood="cheer" size={92} />
    <div class="rc-text">
      <p class="rc-t">{withName("Welcome back", s.userName)}.</p>
      <p class="rc-s">
        Your history was waiting for you: {days} day{days === 1 ? "" : "s"} on record{#if streaks.current > 1},
          a
          {streaks.current}-day streak{/if}, and every setting exactly as you left it. Search it
        from the Calendar tab whenever you like.
      </p>
    </div>
    <button class="rc-x" aria-label="Dismiss" on:click={() => returning.set(false)}>✕</button>
  </div>
{/if}

<style>
  .retcard {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 16px;
    padding: 14px 16px;
    border: 1px solid var(--accent);
    border-radius: 14px;
    background: color-mix(in srgb, var(--accent) 8%, var(--card));
  }
  .rc-text {
    flex: 1;
  }
  .rc-t {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 16px;
    color: var(--ink);
    margin: 0;
  }
  .rc-s {
    font-size: 12.5px;
    color: var(--ink-soft);
    margin: 3px 0 0;
  }
  .rc-x {
    border: none;
    background: none;
    color: var(--ink-faint);
    cursor: pointer;
    font-size: 14px;
    padding: 4px 6px;
    align-self: flex-start;
  }
  .rc-x:hover {
    color: var(--ink);
  }
</style>

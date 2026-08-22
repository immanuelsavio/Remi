<script lang="ts">
  /**
   * Confirm before quitting.
   *
   * The power button sits in a four-button row a thumb-width from End day
   * and Restart, and quitting is the one action there with no undo: it
   * stops the clock, drops the tray icon and ends reminders for the rest of
   * the day. A misfire is only discovered later, by which point the time is
   * simply missing.
   *
   * What is running is spelled out rather than implied, because that is the
   * thing being lost - "Quit?" alone tells you nothing you didn't know.
   */
  import { app, closeOverlay, quitApp } from "../../../store";
  import { fmtEst, nowMs, todayTrackedMs } from "../../../view";

  $: s = $app;
  $: tracked = todayTrackedMs(s, $nowMs);
  $: running = !!s.activeMainId && !!s.startedAt;
  $: active = s.mains.find((m) => m.id === s.activeMainId) ?? null;
  $: activeSub = active?.subs.find((x) => x.id === s.activeSubId) ?? null;
  $: thing = activeSub ?? active;
</script>

<div class="scrim">
  <div class="sheet" role="dialog" aria-modal="true">
    <div class="s-in">
      <h3>Quit Remi?</h3>
      <div class="s-text">
        {#if running && thing}
          <b>{thing.title}</b> is on the clock. Quitting banks its time and stops counting - nothing is
          lost, but nothing is tracked until you open Remi again.
        {:else}
          The menu-bar icon goes away and reminders stop until you open Remi again.
        {/if}
      </div>
      <div class="s-text" style="color:var(--ink-faint); margin-top:6px;">
        {fmtEst(tracked)} tracked today. Your day is saved before Remi closes.
      </div>
      <button
        class="btn danger"
        style="width:100%; margin-top:16px;"
        on:click={() => void quitApp().catch(() => {})}>Quit Remi</button
      >
      <button class="checkin-no" on:click={closeOverlay}>Keep it running</button>
    </div>
  </div>
</div>

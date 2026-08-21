<script lang="ts">
  /**
   * The break screen. Full-bleed and footer-less on purpose: a break is a
   * quiet corner, not another place to take actions from.
   */
  import { app, extendBreak, resumeFromBreak } from "../../../store";
  import { fmt } from "../../../view";
  import Mascot from "../../shared/Mascot.svelte";

  export let breakLeft: number;

  $: s = $app;
</script>

<div class="popover">
  <div class="breakscreen">
    <!-- Asleep, because the clock genuinely is. The cup stays as the
         fallback for anyone who has turned the mascot off, so the screen
         never loses its focal point. -->
    {#if s.mascotOn}
      <Mascot mood="sleep" size={104} />
    {:else}
      <div class="cup" aria-hidden="true">☕</div>
    {/if}
    <div class="eyebrow">On break · clock paused</div>
    <div class="btimer">{breakLeft > 0 ? fmt(breakLeft) : "Break's up"}</div>
    <div class="paused">Paused: <b>{s.breakPausedTitle || "your work"}</b></div>
    <div class="break-actions">
      <button class="btn primary" on:click={resumeFromBreak}>
        <span class="ico" aria-hidden="true">▸</span> Resume
      </button>
      <button class="btn" on:click={() => extendBreak(5)}>+5 minutes</button>
    </div>
  </div>
</div>

<script lang="ts">
  /**
   * The bounded check-in: "are you still on this?", asked at most three
   * times a session. Two loud buttons and two quiet escapes - the whole
   * point is that answering takes no thought.
   */
  import { app, closeOverlay, muteCheckins, openSwitch, startBreak } from "../../../store";
  import { fmt } from "../../../view";
  import type { Main, Sub } from "../../../view";

  export let thing: Main | Sub;
  export let thingMs: number;

  $: s = $app;
  $: parent = s.activeSubId ? (s.mains.find((m) => m.id === s.activeMainId) ?? null) : null;
</script>

<div class="scrim">
  <div class="sheet" role="dialog" aria-modal="true">
    <div class="s-in">
      <h3>Still on this?</h3>
      <div class="s-text">
        {fmt(thingMs)} on <b>{thing.title}</b>{#if parent}
          <span style="color:var(--sub-fg)"> (step of {parent.title})</span>{/if}.
      </div>
      <!-- svelte-ignore a11y-autofocus -->
      <button class="checkin-yes" autofocus on:click={closeOverlay}>Yep, still on it</button>
      <button class="checkin-no" on:click={() => openSwitch("checkin")}>No - switch task</button>
      <button class="checkin-no" on:click={() => startBreak(15)}>I need a break</button>
      <button class="checkin-no" on:click={muteCheckins}>Mute check-ins today</button>
    </div>
  </div>
</div>

<script lang="ts">
  /**
   * The popover's pinned footer.
   *
   * Matches the showcase's three actions, plus Exit - which the showcase has
   * no need for (a browser tab has nothing to quit) but a real menu-bar app
   * does, since an Accessory app has no Dock icon to quit from.
   */
  import { openDashboard, setOverlay } from "../../store";
</script>

<div class="foot">
  <button class="fbtn end" on:click={() => setOverlay("endday")}>◼ End day</button>
  <button class="fbtn" on:click={() => openDashboard("plan")}>⊞ Dashboard</button>
  <button class="fbtn" on:click={() => setOverlay("restart")}>↺ Restart</button>
  <!-- Asks first: this button is one row away from End day, and quitting
       by accident is only noticed hours later, as missing time. -->
  <button class="fbtn" title="Quit Remi" on:click={() => setOverlay("quit")}>⏻</button>
</div>

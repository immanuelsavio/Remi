<script lang="ts">
  import { closeOverlay, restartDay } from "../../../store";
</script>

<div class="scrim">
  <div class="sheet" role="dialog" aria-modal="true">
    <div class="s-in">
      <h3>Start today over?</h3>
      <div class="s-text">
        Clears today's tasks and timers. Your backlog, history and settings stay.
      </div>
      <button
        class="btn danger"
        style="width:100%; margin-top:16px;"
        on:click={() => {
          restartDay();
          closeOverlay();
        }}>Restart the day</button
      >
      <button class="checkin-no" on:click={closeOverlay}>Cancel</button>
    </div>
  </div>
</div>

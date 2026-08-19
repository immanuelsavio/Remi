<script lang="ts">
  import { openDashboard, quitApp, setOverlay } from "../../store";
</script>

<div class="foot">
  <button class="link" on:click={() => openDashboard("plan")}>Dashboard</button>
  <button class="link" on:click={() => setOverlay("backlog")}>Backlog</button>
  <span class="spacer"></span>
  <button class="link" on:click={() => setOverlay("endday")}>End day</button>
  <button class="link" on:click={() => void quitApp().catch(() => {})}>Quit</button>
</div>

<style>
  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    flex: none;
    border-top: 1px solid var(--line);
  }
  .spacer {
    flex: 1;
  }
</style>

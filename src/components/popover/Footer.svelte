<script lang="ts">
  import { openDashboard, quitApp, setOverlay } from "../../store";
</script>

<div class="foot">
  <button class="fbtn end" on:click={() => setOverlay("endday")}>
    <span class="ico" aria-hidden="true">◼</span> End day
  </button>
  <button class="fbtn" on:click={() => openDashboard("plan")}>
    <span class="ico" aria-hidden="true">⊞</span> Dashboard
  </button>
  <button class="fbtn" on:click={() => setOverlay("restart")}>
    <span class="ico" aria-hidden="true">↺</span> Restart
  </button>
  <span class="spacer"></span>
  <button class="fbtn" on:click={() => void quitApp().catch(() => {})}>
    <span class="ico" aria-hidden="true">⏻</span> Exit
  </button>
</div>

<style>
  .foot {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 9px 12px;
    flex: none;
    border-top: 1px solid var(--line);
    background: var(--bg-2);
  }
  .spacer {
    flex: 1;
  }
  .fbtn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--line);
    background: transparent;
    color: var(--ink-soft);
    font-family: var(--font-sans);
    font-weight: 600;
    font-size: 11px;
    padding: 6px 10px;
    border-radius: 999px;
    cursor: pointer;
  }
  .fbtn:hover {
    border-color: var(--accent);
    color: var(--ink);
  }
  .fbtn.end {
    border-color: color-mix(in srgb, var(--danger) 40%, var(--line));
    color: var(--danger);
  }
  .fbtn.end:hover {
    background: color-mix(in srgb, var(--danger) 10%, transparent);
  }
  .ico {
    font-size: 10px;
  }
</style>

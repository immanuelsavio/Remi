<script lang="ts">
  /**
   * The update panel: what you're running, whether there's anything newer,
   * and one button to take it.
   *
   * Honest about not knowing: a failed check says so rather than claiming
   * you're up to date. A private repo, no network, and no published release
   * are indistinguishable from here and all mean "couldn't check".
   */
  import {
    appVersion,
    checkForUpdate,
    installUpdate,
    updateChecking,
    updateInfo,
  } from "../../store";

  let confirming = false;
</script>

<div class="bk-card">
  <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
    <h4 style="margin:0;">Version</h4>
    <span class="beta-badge" title="Remi is still in beta">BETA</span>
  </div>

  <p style="margin-top:10px;">
    You're running <b>Remi {$appVersion || "…"}</b>.
    {#if $updateInfo?.available}
      <b>Remi {$updateInfo.latest}</b> is available.
    {:else if $updateInfo?.latest}
      That's the latest release.
    {/if}
  </p>

  {#if $updateInfo?.available && $updateInfo.notes}
    <div class="grouplbl">What's in {$updateInfo.latest}</div>
    <div class="notes">{$updateInfo.notes}</div>
  {/if}

  <div class="bk-actions" style="margin-top:12px;">
    <button class="bk-btn ghost" disabled={$updateChecking} on:click={() => checkForUpdate()}>
      {$updateChecking ? "Checking…" : "⟳ Check for updates"}
    </button>

    {#if $updateInfo?.available}
      {#if !confirming}
        <button class="bk-btn" on:click={() => (confirming = true)}>
          ⬇ Update to {$updateInfo.latest}
        </button>
      {:else}
        <button class="bk-btn" on:click={() => installUpdate($updateInfo?.latest ?? "")}>
          Yes - quit and update
        </button>
        <button class="bk-btn ghost" on:click={() => (confirming = false)}>Cancel</button>
      {/if}
    {/if}
  </div>

  {#if confirming}
    <p class="imp-note" style="margin-top:10px;">
      Remi will save your day, quit, install the update and reopen. Don't quit it yourself while
      that happens.
    </p>
  {/if}
</div>

<style>
  .beta-badge {
    font-family: var(--font-num);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: #fff;
    background: var(--break);
    border-radius: 999px;
    padding: 3px 9px;
    flex: none;
  }
  .notes {
    margin-top: 6px;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    font-size: 12px;
    line-height: 1.55;
    color: var(--ink-soft);
    background: color-mix(in srgb, var(--bg-2) 30%, var(--card));
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: 10px 12px;
  }
</style>

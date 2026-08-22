<script lang="ts">
  /**
   * Honest recovery screen. Rust preserved the damaged files and changed
   * nothing; showing a blank day here would read as "all my work vanished".
   */
  import { damagedPaths, loadMessage, openDashboard, startTodayFresh } from "../../../store";

  /**
   * Deliberately start over on top of the unreadable file.
   *
   * Ordinary saves are refused while `state.json` cannot be read, which is
   * right - but it left this button unable to do the one thing it offers.
   * The damaged file has ALREADY been copied into the recovery folder by
   * the loader, so the promise to preserve it is kept by that copy; this
   * only overwrites the broken original, once, because the user asked.
   *
   * AWAITED. This used to arm the overwrite and change screen in the same
   * breath: if the write then failed, the user had already left recovery,
   * the one-shot permission was spent, and everything they did afterwards
   * lived in memory only. Leaving the screen is now something the confirmed
   * write earns.
   */
  let working = false;
  let error = "";
  async function startFresh() {
    if (working) return; // one attempt at a time - it spends a one-shot permission
    working = true;
    error = "";
    const res = await startTodayFresh();
    working = false;
    if (!res.ok) error = res.error;
  }
  import RemiMark from "../../shared/RemiMark.svelte";
</script>

<div class="popover">
  <div class="pop-body">
    <div class="startday" style="justify-content:flex-start; padding-top:26px;">
      <RemiMark size={44} />
      <div class="eyebrow">Recovery</div>
      <h1 class="big">Couldn't read your data</h1>
      <div class="lede">{$loadMessage}</div>
      <div class="lede">
        Nothing was deleted or overwritten. Copies of the affected files are in your recovery
        folder.
      </div>
      {#each $damagedPaths as p (p)}
        <div class="path">{p}</div>
      {/each}
      <button class="btn accent big" on:click={startFresh} disabled={working}>
        {working ? "Starting…" : "Start today fresh"}
      </button>
      {#if error}
        <div class="err" role="alert">
          {error} Nothing was changed - your files are still in the recovery folder.
        </div>
      {/if}
      <button
        class="btn"
        style="margin-top:9px; max-width:220px; width:100%;"
        on:click={() => openDashboard("data")}
      >
        Open the Data tab
      </button>
    </div>
  </div>
</div>

<style>
  .path {
    font-family: var(--font-num);
    font-size: 11px;
    color: var(--ink-faint);
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 6px 9px;
    margin-top: 6px;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .err {
    margin-top: 9px;
    font-size: 12px;
    color: var(--bad, #c0392b);
    max-width: 320px;
    text-align: center;
  }
  .startday :global(.remi-logo) {
    margin: 0 auto 12px;
  }
</style>

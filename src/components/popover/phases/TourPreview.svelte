<script lang="ts">
  /**
   * What the menu-bar panel shows while the tour is explaining it.
   *
   * The lesson says "your task, still on the clock, one click away". On a
   * first run the popover's own screens say "start my day", which is a
   * different sentence entirely - so for the length of that lesson the
   * panel shows the practice task instead.
   *
   * The data arrives as an event payload (`store/tour-preview.ts`) and is
   * never persisted: the practice task must not become the popover's real
   * day, which is the whole reason the demo lives in one window.
   *
   * The timer is DERIVED from an absolute stamp, like every other timer in
   * the app - `now - startedAt` - so it cannot drift and needs no counter.
   */
  import { closePopoverToTour } from "../../../store";
  import { fmt, nowMs } from "../../../view";
  import type { TrayPreview } from "../../../store";
  import RemiMark from "../../shared/RemiMark.svelte";

  export let preview: TrayPreview;

  $: live = preview.startedAt > 0 ? Math.max(0, $nowMs - preview.startedAt) : 0;
</script>

<div class="pop-body tp-wrap">
  <div class="tp-head">
    <RemiMark size={26} />
    <span class="tp-eyebrow">Still on the clock</span>
  </div>

  <div class="tp-card">
    <div class="tp-title">{preview.title}</div>
    <div class="tp-time">{fmt(live)}</div>
    <div class="tp-note">Same day, same clock - no window in the way.</div>
  </div>

  <button class="tp-back" on:click={closePopoverToTour}>‹ Back to the tour</button>
</div>

<style>
  .tp-wrap {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
  }
  .tp-head {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .tp-eyebrow {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .tp-card {
    border: 1px solid var(--accent);
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--accent) 10%, var(--card));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
    padding: 14px;
  }
  .tp-title {
    font-weight: 650;
    font-size: 14.5px;
    margin-bottom: 6px;
    overflow-wrap: anywhere;
  }
  .tp-time {
    font-family: var(--font-num);
    font-size: 26px;
    color: var(--accent-ink);
  }
  .tp-note {
    font-size: 11.5px;
    color: var(--ink-faint);
    margin-top: 8px;
  }
  .tp-back {
    align-self: flex-start;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink);
    border-radius: var(--r-sm);
    padding: 8px 12px;
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }
  .tp-back:hover {
    border-color: var(--accent);
  }
</style>

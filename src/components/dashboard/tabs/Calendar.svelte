<script lang="ts">
  /**
   * CALENDAR - a RECORD, not a planner.
   *
   * Green = the day's work was finished; orange = something was left open.
   * Only days that actually have a record are coloured, because the point is
   * to show what happened, not what was intended.
   *
   * PTO can be set for today or LATER only. Marking a past missed day off
   * would silently un-break a broken streak - which is exactly the lie the
   * revive heart exists to make you pay for deliberately.
   */
  import { app, showToast, togglePto } from "../../../store";
  import {
    canMarkPto,
    computeStreaks,
    fmtEst,
    hoursStr,
    MONTHS_FULL,
    todayISO,
  } from "../../../view";

  /** "YYYY-MM" of the month on screen. Lifted to the router so paging back
      and switching tabs doesn't snap you to today again. */
  export let monthCursor: string;

  $: s = $app;
  $: streaks = computeStreaks(s);
  $: year = Number(monthCursor.split("-")[0]);
  $: month = Number(monthCursor.split("-")[1]) - 1;
  $: byDate = new Map(s.history.filter((h) => h.dateISO).map((h) => [h.dateISO, h]));
  $: today = todayISO();

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  /** Leading blanks + every real day, as ISO strings. */
  $: cells = (() => {
    const startDow = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const out: (string | null)[] = Array(startDow).fill(null);
    const p = (n: number) => String(n).padStart(2, "0");
    for (let d = 1; d <= days; d++) out.push(`${year}-${p(month + 1)}-${p(d)}`);
    return out;
  })();

  function shiftMonth(delta: number) {
    const d = new Date(year, month + delta, 1);
    monthCursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function onDay(iso: string) {
    const rec = byDate.get(iso);
    if (rec) {
      showToast(
        `${iso} · ${rec.completed.length} done · ${hoursStr(rec.totalMs)}` +
          (rec.unfinished.length ? ` · ${rec.unfinished.length} left open` : ""),
      );
      return;
    }
    if (!canMarkPto(iso, today)) {
      showToast("Time off can only be set for today or later");
      return;
    }
    togglePto(iso);
  }
</script>

<div class="dsec-title">Calendar</div>
{#if streaks.longest}
  <div class="cal-streak">
    🔥 <b>{streaks.current}</b>-day streak{#if streaks.longest > streaks.current}
      · best {streaks.longest}{/if}
  </div>
{/if}

<div class="cal-head">
  <div class="mnav">
    <button aria-label="Previous month" on:click={() => shiftMonth(-1)}>‹</button>
    <span class="mtitle">{MONTHS_FULL[month]} {year}</span>
    <button aria-label="Next month" on:click={() => shiftMonth(1)}>›</button>
  </div>
  <div class="cal-legend">
    <span><i class="g"></i> done</span>
    <span><i class="o"></i> left something</span>
    <span><i class="p"></i> day off</span>
  </div>
</div>

<div class="cal-grid">
  {#each DOW as d (d)}
    <div class="cal-dow">{d}</div>
  {/each}
  {#each cells as iso, i (i)}
    {#if !iso}
      <div class="cal-cell empty"></div>
    {:else}
      {@const rec = byDate.get(iso)}
      {@const pto = s.pto.includes(iso)}
      {@const unfinished = !!rec && rec.unfinished.length > 0}
      <button
        class="cal-cell clickable"
        class:pto
        class:done={!pto && !!rec && !unfinished}
        class:unfinished={!pto && unfinished}
        class:today={iso === s.dateISO}
        title={rec
          ? `${rec.completed.length} done · ${fmtEst(rec.totalMs)}`
          : pto
            ? "Day off"
            : iso}
        on:click={() => onDay(iso)}
      >
        <span class="dnum">{Number(iso.slice(-2))}</span>
        {#if rec}
          <span class="cdot">
            {#if rec.completed.length}<i class="g"></i>{/if}
            {#if unfinished}<i class="o"></i>{/if}
            {#if s.revived.includes(iso)}<i class="s"></i>{/if}
          </span>
          <span class="cmini">{rec.completed.length}✓</span>
        {:else if pto}
          <span class="cmini">PTO</span>
        {/if}
      </button>
    {/if}
  {/each}
</div>

<div class="dsec-sub" style="margin-top:14px;">
  Tap a day with a record to see what it held. Tap today or a future day to mark a day off (PTO).
  Past days can't be marked off — that's what the revive heart is for.
</div>

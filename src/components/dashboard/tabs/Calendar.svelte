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
  import { app, showToast } from "../../../store";
  import PtoSheet from "../PtoSheet.svelte";
  import {
    allTags,
    canMarkPto,
    computeStreaks,
    daySnapshot,
    fmtEst,
    hoursStr,
    MONTHS_FULL,
    nowMs,
    prettyDate,
    dateFromISO,
    searchDays,
    summarise,
    todayISO,
  } from "../../../view";

  /** "YYYY-MM" of the month on screen. Lifted to the router so paging back
      and switching tabs doesn't snap you to today again. */
  export let monthCursor: string;

  $: s = $app;
  $: streaks = computeStreaks(s);
  $: year = Number(monthCursor.split("-")[0]);
  $: month = Number(monthCursor.split("-")[1]) - 1;
  /**
   * The month's records, INCLUDING today.
   *
   * `history` only gains a day once End Day archives it, so a calendar
   * built from history alone shows today as blank until the evening - the
   * one day you most want to see. Today is folded in from live state
   * instead, using the same snapshot End Day will eventually store.
   */
  $: byDate = new Map([
    ...s.history.filter((h) => h.dateISO).map((h) => [h.dateISO, h] as const),
    ...(s.awaitingStart ? [] : [[s.dateISO, daySnapshot(s, $nowMs)] as const]),
  ]);
  $: today = todayISO();

  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // --- search -------------------------------------------------------------
  let query = "";
  let searchTags: string[] = [];
  let includeUnfinished = false;
  $: knownTags = allTags([...s.mains, ...s.history.flatMap((h) => h.completed)]);
  $: searching = query.trim().length > 0 || searchTags.length > 0;
  $: hits = searching
    ? searchDays([...byDate.values()], {
        text: query,
        tags: searchTags,
        includeUnfinished,
      })
    : [];
  $: found = summarise(hits);

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

  /**
   * A click on the grid reads a day back. That is all it does.
   *
   * It used to also toggle time off - first as the only way to set it, then
   * behind an invisible mode whose browse path STILL toggled. Either way a
   * person reviewing their own history could silently book a holiday by
   * clicking the wrong square. Marking time off now lives in its own sheet,
   * where a click cannot mean two things.
   */
  let ptoOpen = false;

  function onDay(iso: string) {
    const rec = byDate.get(iso);
    if (rec) {
      showToast(
        `${iso} - ${rec.completed.length} done - ${hoursStr(rec.totalMs)}` +
          (rec.unfinished.length ? ` - ${rec.unfinished.length} left open` : ""),
      );
      return;
    }
    if (s.pto.includes(iso)) {
      showToast(`${iso} - time off`);
      return;
    }
    showToast(`${iso} - nothing recorded`);
  }
</script>

<div class="dsec-title">Calendar</div>
{#if streaks.longest}
  <div class="cal-streak">
    🔥 <b>{streaks.current}</b>-day streak{#if streaks.longest > streaks.current}
      · best {streaks.longest}{/if}
  </div>
{/if}

<div class="cal-modes">
  <button class="bk-btn ghost" on:click={() => (ptoOpen = true)}>＋ Add time off</button>
  <span class="cal-hint">
    Days off bridge a streak rather than breaking it. Clicking the calendar below just reads a day
    back; it never marks one.
  </span>
</div>

<div class="searchbar">
  <input
    class="in"
    type="search"
    placeholder="Search everything you've finished…"
    bind:value={query}
  />
  <button
    class="pill-switch"
    class:on={includeUnfinished}
    role="switch"
    aria-checked={includeUnfinished}
    aria-label="Include unfinished"
    on:click={() => (includeUnfinished = !includeUnfinished)}
  >
    <span class="ps-track"><span class="ps-knob"></span></span>
    <span class="ps-lbl">Unfinished too</span>
  </button>
</div>

{#if knownTags.length}
  <div class="tagpick">
    {#each knownTags as t (t)}
      <button
        class="tagchip"
        class:on={searchTags.includes(t)}
        on:click={() =>
          (searchTags = searchTags.includes(t)
            ? searchTags.filter((x) => x !== t)
            : [...searchTags, t])}>#{t}</button
      >
    {/each}
  </div>
{/if}

{#if searching}
  <div class="dsec-sub" style="margin:12px 0 8px;">
    {found.count} result{found.count === 1 ? "" : "s"} · {hoursStr(found.ms)} tracked · across {found.days}
    day{found.days === 1 ? "" : "s"}
  </div>
  {#if !hits.length}
    <div class="hist-empty">Nothing matched. Tags and titles are searched, not notes.</div>
  {:else}
    <div class="hist-day">
      <div class="hist-list">
        {#each hits as h, i (h.dateISO + h.title + i)}
          <div class="hist-item">
            <span class="hi-t">
              {h.title}
              {#if h.kind === "step"}<span class="k">step</span>{/if}
              {#if !h.done}<span class="k">open</span>{/if}
              {#each h.tags as t (t)}<span class="k">#{t}</span>{/each}
            </span>
            <span class="hi-m">
              {prettyDate(dateFromISO(h.dateISO))}{#if h.ms}
                · {fmtEst(h.ms)}{/if}
            </span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
{:else}
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
        {@const isToday = iso === s.dateISO}
        <button
          class="cal-cell clickable"
          class:pto
          class:done={!pto && !!rec && !unfinished && (!isToday || !!rec.completed.length)}
          class:unfinished={!pto && unfinished}
          class:today={isToday}
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
    Past days can't be marked off - that's what the revive heart is for.
  </div>
{/if}

<PtoSheet bind:open={ptoOpen} />

<style>
  .searchbar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }
  .searchbar .in {
    flex: 1;
    min-width: 0;
  }
  .tagpick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 4px;
  }
  .tagchip {
    font-family: var(--font-num);
    font-size: 11px;
    font-weight: 600;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink-soft);
    border-radius: 999px;
    padding: 4px 10px;
    cursor: pointer;
  }
  .tagchip:hover {
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .tagchip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .cal-modes {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin: 10px 0 4px;
  }
  .cal-hint {
    font-size: 11.5px;
    color: var(--ink-soft);
  }
</style>

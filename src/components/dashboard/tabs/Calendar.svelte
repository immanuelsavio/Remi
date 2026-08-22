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
  import { app } from "../../../store";
  import PtoSheet from "../PtoSheet.svelte";
  import TagPicker from "../../shared/TagPicker.svelte";
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
   *
   * "Reads a day back" used to mean a one-line toast - "2 done, 3h 10m" -
   * which named the day's SIZE and nothing about its content, then took
   * itself away before you could look twice. It opens the day below the
   * grid instead: what was finished, what was left, and what interrupted
   * it, staying put until you pick another day or close it.
   */
  let ptoOpen = false;
  /** The day open below the grid, or null. */
  let selected: string | null = null;

  function onDay(iso: string) {
    selected = selected === iso ? null : iso;
  }

  /** Everything the panel needs about `selected`, or null when nothing is. */
  $: detail = (() => {
    if (!selected) return null;
    const rec = byDate.get(selected) ?? null;
    const intr = (rec?.interruptions ?? []).filter((x) => !x.open);
    return {
      iso: selected,
      rec,
      pto: s.pto.includes(selected),
      revived: s.revived.includes(selected),
      isToday: selected === s.dateISO,
      intrCount: intr.length,
      intrMs: intr.reduce((a, x) => a + Math.max(0, x.durationMs), 0),
    };
  })();

  // Paging to another month closes the panel: the open day is no longer on
  // screen, and a detail card for a date you can't see is a puzzle.
  $: if (monthCursor) selected = null;
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

<TagPicker
  tags={knownTags}
  selected={searchTags}
  onToggle={(t) =>
    (searchTags = searchTags.includes(t) ? searchTags.filter((x) => x !== t) : [...searchTags, t])}
/>

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

  <div class="cal-grid" data-tour="cal-grid">
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
          class:sel={selected === iso}
          aria-pressed={selected === iso}
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

  {#if detail}
    {@const rec = detail.rec}
    <div class="dayview">
      <div class="dv-head">
        <span class="dv-when">
          {prettyDate(dateFromISO(detail.iso))}
          {#if rec}<span class="k">Day {rec.day}</span>{/if}
          {#if detail.isToday}<span class="k">today</span>{/if}
          {#if detail.pto}<span class="k">day off</span>{/if}
          {#if detail.revived}<span class="k">❤️ revived</span>{/if}
        </span>
        <button class="dv-x" aria-label="Close this day" on:click={() => (selected = null)}
          >✕</button
        >
      </div>

      {#if rec}
        <div class="dv-sum">
          <b>{hoursStr(rec.totalMs)}</b> tracked · {rec.completed.length} done{#if rec.unfinished.length}
            · {rec.unfinished.length} left open{/if}{#if detail.intrCount}
            · {detail.intrCount} interruption{detail.intrCount === 1 ? "" : "s"} costing {fmtEst(
              detail.intrMs,
            )}{/if}
        </div>
        <div class="hist-list">
          {#each rec.completed as c, i (c.title + i)}
            <div class="hist-item">
              <span class="hi-t">
                <span class="dv-tick">✓</span>
                {c.title}
                {#if c.kind === "step"}<span class="k">step</span>{/if}
                {#each c.tags ?? [] as tg (tg)}<span class="k">#{tg}</span>{/each}
              </span>
              <span class="hi-m">
                {fmtEst(c.ms)}{#if c.interruptedCount}
                  · {c.interruptedCount}✕ interrupted{/if}
              </span>
            </div>
          {/each}
          {#each rec.unfinished as u, i (u.title + i)}
            <div class="hist-item">
              <span class="hi-t">
                <span class="dv-open">○</span>
                {u.title}
                <span class="k">open</span>
                {#each u.tags ?? [] as tg (tg)}<span class="k">#{tg}</span>{/each}
              </span>
              <span class="hi-m">
                {#if u.subs.length}{u.subs.length} step{u.subs.length === 1 ? "" : "s"}{/if}
              </span>
            </div>
          {/each}
          {#if !rec.completed.length && !rec.unfinished.length}
            <div class="hist-empty">The day was started, but nothing was recorded on it.</div>
          {/if}
        </div>
        {#if detail.intrCount}
          <!-- The interruptions are the point of this app, so they get named
               here rather than left as a count in the summary line. -->
          <div class="dv-sub">What took you away</div>
          <div class="hist-list">
            {#each (rec.interruptions ?? []).filter((x) => !x.open) as x (x.id)}
              <div class="hist-item">
                <span class="hi-t">{x.causeTitle || "Something"}</span>
                <span class="hi-m">
                  {fmtEst(x.durationMs)}{#if x.interruptedTitle}
                    · off {x.interruptedTitle}{/if}
                </span>
              </div>
            {/each}
          </div>
        {/if}
      {:else if detail.pto}
        <div class="dv-sum">Time off. It bridges your streak rather than breaking it.</div>
      {:else}
        <div class="dv-sum">
          Nothing recorded.
          {#if detail.iso > today}
            Not here yet.
          {:else}
            A day with no finished work doesn't count towards a streak.
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <div class="dsec-sub" style="margin-top:14px;">
    Tap any day to open it below. Time off is set from the button above - past days can't be marked
    off, which is what the revive heart is for.
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

  /* The opened day, below the grid. Bordered in the accent so it reads as
     belonging to the cell you pressed rather than as a new section. */
  .dayview {
    margin-top: 14px;
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    border-radius: 12px;
    background: var(--card);
    padding: 12px 14px 14px;
  }
  .dv-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .dv-when {
    font-family: var(--font-serif);
    font-size: 15px;
    font-weight: 600;
    color: var(--ink);
    margin-right: auto;
  }
  .dv-x {
    border: none;
    background: none;
    color: var(--ink-faint);
    font-size: 14px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 8px;
  }
  .dv-x:hover {
    color: var(--ink);
    background: var(--bg);
  }
  .dv-sum {
    font-size: 12.5px;
    color: var(--ink-soft);
    margin-bottom: 8px;
  }
  .dv-sub {
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-faint);
    margin: 12px 0 4px;
  }
  .dv-tick {
    color: var(--success-ink);
  }
  .dv-open {
    color: var(--ink-faint);
  }
  /* The pressed cell, so the panel below is obviously about THIS square. */
  .cal-cell.sel {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
</style>

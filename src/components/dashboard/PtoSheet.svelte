<script lang="ts">
  /**
   * Time off, picked in its own small calendar.
   *
   * The first version overloaded the main month grid: a click meant "read
   * this day's summary" OR "mark this day off" depending on an invisible
   * mode, and the browse path still toggled time off on any future day. So
   * a person browsing their own history could silently book a holiday.
   *
   * One click, one meaning. The main grid now only ever reads a day back.
   * Marking time off happens here, in a sheet that exists solely for it,
   * where every click unambiguously means the one thing.
   */
  import { app, togglePto } from "../../store";
  import { canMarkPto } from "../../domain/streaks";
  import { MONTHS_FULL, todayISO } from "../../view";

  export let open = false;

  const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

  $: s = $app;
  $: today = todayISO();

  let cursor = "";
  // Seeded when the sheet opens rather than held across closes, so it always
  // starts on the current month instead of wherever it was left months ago.
  $: if (open && !cursor) cursor = today.slice(0, 7);
  $: if (!open && cursor) cursor = "";

  $: year = Number(cursor.split("-")[0]) || new Date().getFullYear();
  $: month = (Number(cursor.split("-")[1]) || 1) - 1;

  $: cells = (() => {
    const startDow = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const out: (string | null)[] = Array(startDow).fill(null);
    const p = (n: number) => String(n).padStart(2, "0");
    for (let d = 1; d <= days; d++) out.push(`${year}-${p(month + 1)}-${p(d)}`);
    return out;
  })();

  $: upcoming = s.pto.filter((d) => d >= today).sort();

  function shift(delta: number) {
    const d = new Date(year, month + delta, 1);
    cursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
</script>

{#if open}
  <div class="scrim">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Add time off">
      <div class="s-in">
        <h3>Time off</h3>
        <p class="s-text">
          Pick the days you will be away. Days off <b>bridge</b> a streak rather than breaking it, so
          a holiday never costs you one. Only today onwards can be marked.
        </p>

        <div class="pm-head">
          <button class="pm-nav" aria-label="Previous month" on:click={() => shift(-1)}>‹</button>
          <span class="pm-title">{MONTHS_FULL[month]} {year}</span>
          <button class="pm-nav" aria-label="Next month" on:click={() => shift(1)}>›</button>
        </div>

        <div class="pm-dow">
          {#each WEEKDAYS as d, i (i)}<span>{d}</span>{/each}
        </div>

        <div class="pm-grid">
          {#each cells as iso, i (i)}
            {#if !iso}
              <span class="pm-blank"></span>
            {:else}
              {@const off = s.pto.includes(iso)}
              {@const allowed = canMarkPto(iso, today)}
              <button
                class="pm-day"
                class:off
                class:istoday={iso === today}
                disabled={!allowed}
                title={allowed ? iso : "Time off can only be set for today or later"}
                aria-pressed={off}
                on:click={() => togglePto(iso)}
              >
                {Number(iso.slice(-2))}
              </button>
            {/if}
          {/each}
        </div>

        <p class="pm-count">
          {#if upcoming.length}
            {upcoming.length} day{upcoming.length === 1 ? "" : "s"} booked from today onwards.
          {:else}
            No time off booked yet.
          {/if}
        </p>

        <div class="bk-actions" style="justify-content:flex-end;">
          <button class="bk-btn" on:click={() => (open = false)}>Done</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .pm-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 14px 0 8px;
  }
  .pm-title {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 15px;
    color: var(--ink);
  }
  .pm-nav {
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink-soft);
    border-radius: 8px;
    width: 28px;
    height: 28px;
    cursor: pointer;
  }
  .pm-nav:hover {
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .pm-dow,
  .pm-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }
  .pm-dow span {
    text-align: center;
    font-size: 10px;
    letter-spacing: 0.08em;
    color: var(--ink-faint);
    padding-bottom: 2px;
  }
  .pm-blank {
    aspect-ratio: 1;
  }
  .pm-day {
    aspect-ratio: 1;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink);
    border-radius: 8px;
    font-family: var(--font-num);
    font-size: 12px;
    cursor: pointer;
  }
  .pm-day:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .pm-day:disabled {
    opacity: 0.32;
    cursor: not-allowed;
  }
  .pm-day.istoday {
    border-color: var(--accent);
    font-weight: 700;
  }
  .pm-day.off {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 700;
  }
  .pm-count {
    font-size: 11.5px;
    color: var(--ink-soft);
    margin: 10px 0 0;
  }
</style>

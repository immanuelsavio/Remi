<script lang="ts">
  import { app, showToast, togglePto, useRevive } from "../../../store";
  import { canMarkPto, computeStreaks, fmtEst, isoOf, MONTHS_FULL, todayISO } from "../../../view";

  $: s = $app;
  $: streaks = computeStreaks(s);

  // Lifted to the router and passed down bound so the visible month survives
  // switching away from this tab and back, matching the original single-file
  // component where this lived at the top level.
  export let monthCursor = todayISO().slice(0, 7);

  $: monthDays = (() => {
    const [y, m] = monthCursor.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const lead = first.getDay(); // 0 = Sunday
    const count = new Date(y, m, 0).getDate();
    const cells: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= count; d++) cells.push(isoOf(new Date(y, m - 1, d)));
    return cells;
  })();
  $: worked = new Set(s.history.filter((h) => h.completed.length).map((h) => h.dateISO));
  $: byDate = new Map(s.history.map((h) => [h.dateISO, h]));

  function shiftMonth(delta: number) {
    const [y, m] = monthCursor.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    monthCursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
</script>

<div class="wrap">
  <h1>Calendar</h1>
  <p class="muted">
    Days you finished something. Weekends, time off and revived days bridge a streak without
    breaking it.
  </p>

  <div class="row">
    <button class="btn small" on:click={() => shiftMonth(-1)}>‹</button>
    <b class="grow center-txt">
      {MONTHS_FULL[Number(monthCursor.split("-")[1]) - 1]}
      {monthCursor.split("-")[0]}
    </b>
    <button class="btn small" on:click={() => shiftMonth(1)}>›</button>
  </div>

  <div class="cal">
    {#each ["S", "M", "T", "W", "T", "F", "S"] as d, i (i)}
      <div class="cal-h muted small">{d}</div>
    {/each}
    {#each monthDays as iso, i (i)}
      {#if !iso}
        <div></div>
      {:else}
        {@const rec = byDate.get(iso)}
        <button
          class="cal-d"
          class:worked={worked.has(iso)}
          class:pto={s.pto.includes(iso)}
          class:revived={s.revived.includes(iso)}
          class:today={iso === s.dateISO}
          title={rec
            ? `${rec.completed.length} done · ${fmtEst(rec.totalMs)}`
            : s.pto.includes(iso)
              ? "Time off"
              : iso}
          on:click={() => {
            if (!canMarkPto(iso, s.dateISO)) {
              // Never retroactively - that would erase a real missed day.
              showToast("Time off can only be set for today or later");
              return;
            }
            togglePto(iso);
          }}
        >
          {Number(iso.slice(-2))}
        </button>
      {/if}
    {/each}
  </div>

  <div class="legend muted small">
    <span><i class="sw-worked"></i> worked</span>
    <span><i class="sw-pto"></i> time off</span>
    <span><i class="sw-rev"></i> revived</span>
    <span>click a future day to mark time off</span>
  </div>

  <h2>Streak</h2>
  <div class="tiles">
    <div class="tile">
      <div class="k">{streaks.current}</div>
      <div class="muted small">Current</div>
    </div>
    <div class="tile">
      <div class="k">{streaks.longest}</div>
      <div class="muted small">Longest</div>
    </div>
    <div class="tile">
      <div class="k">{streaks.life ? "❤️" : "—"}</div>
      <div class="muted small">Revive</div>
    </div>
    <div class="tile">
      <div class="k">{streaks.activeCount}</div>
      <div class="muted small">Active days</div>
    </div>
  </div>
  {#if streaks.broken}
    <div class="callout">
      <div class="grow">
        <b>{streaks.broken} broke your streak.</b>
        <div class="muted small">
          {streaks.life ? "Spend your revive to bridge it." : "Earn a revive with a 5-day streak."}
        </div>
      </div>
      <button class="btn" disabled={!streaks.life} on:click={useRevive}>❤️ Revive</button>
    </div>
  {/if}
</div>

<style>
  .wrap {
    padding: 20px 26px 48px;
    max-width: 1040px;
  }
  h1 {
    font-size: 26px;
    letter-spacing: -0.02em;
    margin: 0 0 4px;
  }
  h2 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--ink-soft);
    margin: 26px 0 8px;
  }
  .muted {
    color: var(--ink-soft);
  }
  .small {
    font-size: 12px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .center-txt {
    text-align: center;
  }
  .row {
    display: flex;
    align-items: flex-end;
    gap: 9px;
    margin-top: 9px;
    flex-wrap: wrap;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
    gap: 11px;
    margin: 14px 0;
  }
  .tile {
    padding: 15px;
    border-radius: var(--r-md);
    background: var(--card);
    border: 1px solid var(--line);
  }
  .k {
    font-family: var(--font-num);
    font-size: 27px;
    font-variant-numeric: tabular-nums;
  }
  .callout {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 13px;
    border-radius: var(--r-md);
    background: var(--hero-bg);
    border: 1px solid var(--hero-line);
    margin: 12px 0;
  }

  /* ---- calendar ---- */
  .cal {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 5px;
    max-width: 420px;
    margin: 10px 0;
  }
  .cal-h {
    text-align: center;
    padding: 3px 0;
  }
  .cal-d {
    aspect-ratio: 1;
    border-radius: var(--r-sm);
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .cal-d.worked {
    background: var(--pill-bg);
    color: var(--accent-ink);
    font-weight: 640;
  }
  .cal-d.pto {
    background: var(--break-bg);
    color: var(--break-ink);
  }
  .cal-d.revived {
    border-color: var(--danger);
  }
  .cal-d.today {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .legend {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    align-items: center;
  }
  .legend i {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 3px;
    margin-right: 4px;
    vertical-align: middle;
  }
  .sw-worked {
    background: var(--pill-bg);
  }
  .sw-pto {
    background: var(--break-bg);
  }
  .sw-rev {
    border: 2px solid var(--danger);
  }
</style>

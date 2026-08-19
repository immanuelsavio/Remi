<script lang="ts">
  import { app } from "../../../store";
  import {
    dateFromISO,
    fmtEst,
    interruptionStats,
    nowMs,
    prettyDate,
    timeSense,
    todayAsRecord,
    todayTrackedMs,
  } from "../../../view";

  $: s = $app;
  $: tracked = todayTrackedMs(s, $nowMs);
  $: target = s.dayTargetMins * 60_000;
  // "Given back" only means something while you're still under your own target.
  $: givenBack = Math.max(0, target - tracked);
  $: ints = interruptionStats([...s.history, todayAsRecord(s, $nowMs)]);
  $: sense = timeSense(s.estimateLog);
</script>

<div class="wrap">
  <h1>What actually happened</h1>
  <div class="tiles">
    <div class="tile">
      <div class="k">{fmtEst(tracked)}</div>
      <div class="muted small">Focused today</div>
    </div>
    <div class="tile">
      <div class="k">{fmtEst(givenBack)}</div>
      <div class="muted small">Under your {Math.round(s.dayTargetMins / 60)}h target</div>
    </div>
    <div class="tile">
      <div class="k">{ints.count}</div>
      <div class="muted small">Interruptions · {fmtEst(ints.totalMs)}</div>
    </div>
    <div class="tile">
      <div class="k">{ints.perFocusHour.toFixed(1)}</div>
      <div class="muted small">Per focused hour</div>
    </div>
  </div>

  {#if sense}
    <h2>Time sense</h2>
    <p>{sense.verdict}</p>
    <p class="muted small">
      {sense.count} estimate{sense.count === 1 ? "" : "s"} · {sense.under} under, {sense.over}
      over · average {sense.avgRatio.toFixed(2)}× your guess
    </p>
  {/if}

  <h2>Where the time went</h2>
  {#if !ints.stretched.length}
    <p class="muted small">
      No task has run far past its focused time yet. That's the good outcome.
    </p>
  {:else}
    <p class="muted small">
      Tasks whose wall-clock ran well past the time actually spent on them - this is what
      interruptions cost.
    </p>
    {#each ints.stretched.slice(0, 10) as t (t.title + t.elapsedMs)}
      <div class="line">
        <div class="grow">
          <div>{t.title}</div>
          <div class="muted small">
            {fmtEst(t.focusedMs)} focused · {fmtEst(t.elapsedMs)} elapsed
            {#if t.interruptedCount}· interrupted {t.interruptedCount}×{/if}
          </div>
        </div>
        <b>{t.stretchRatio.toFixed(1)}×</b>
      </div>
    {/each}
  {/if}

  <h2>What interrupts you</h2>
  {#if !ints.topCauses.length}
    <p class="muted small">Nothing has pulled you away yet.</p>
  {:else}
    {#each ints.topCauses as c (c.title)}
      <div class="line">
        <span class="grow">{c.title}</span>
        <span class="muted small">{c.count}× · {fmtEst(c.totalMs)}</span>
      </div>
    {/each}
  {/if}

  <h2>Recent days</h2>
  {#if !s.history.length}
    <p class="muted small">Your first day is still in progress.</p>
  {:else}
    {#each [...s.history].reverse().slice(0, 14) as d (d.dateISO)}
      <div class="line">
        <span class="grow">{prettyDate(dateFromISO(d.dateISO))}</span>
        <span class="muted small">
          {d.completed.length} done · {fmtEst(d.totalMs)}
          {#if d.unfinished.length}· {d.unfinished.length} carried{/if}
        </span>
      </div>
    {/each}
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
  .line {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 2px;
    border-bottom: 1px solid var(--line);
  }
</style>

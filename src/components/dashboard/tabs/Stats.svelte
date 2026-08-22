<script lang="ts">
  /**
   * STATS - the evidence tab.
   *
   * Three stories, in order of how much they change someone's mind:
   *   1. Time given back against the workday target.
   *   2. The streak, and the one revive that can rescue it.
   *   3. Estimate vs reality, and what interruptions did to the difference -
   *      the case that an estimate can be accurate while the DAY runs long.
   */
  import { app, tourAnchor, useRevive } from "../../../store";
  import {
    computeStreaks,
    dateFromISO,
    fmtEst,
    hoursStr,
    interruptionStats,
    nowMs,
    prettyDate,
    timeSense,
    todayAsRecord,
    todayTrackedMs,
  } from "../../../view";

  $: s = $app;
  $: tracked = todayTrackedMs(s, $nowMs);
  $: doneToday = s.mains.filter((m) => m.done).length;
  $: target = Math.max(1, s.dayTargetMins) * 60000;
  $: given = Math.max(0, target - tracked);
  $: pct = Math.min(100, Math.round((tracked / target) * 100));
  $: allDone = s.history.reduce((a, h) => a + h.completed.length, 0) + doneToday;
  $: allTracked = s.history.reduce((a, h) => a + h.totalMs, 0) + tracked;
  $: streaks = computeStreaks(s);
  $: ts = timeSense(s.estimateLog);
  $: intr = interruptionStats([...s.history, todayAsRecord(s, $nowMs)]);
  /** What the heart would actually buy, or null if it would buy nothing. */
  $: offer = streaks.offer;
  $: canRevive = !!offer && streaks.life >= 1;
</script>

<div class="dsec-title">Stats</div>
<div class="dsec-sub">
  Against a {fmtEst(target)} day. “Given back” is time you didn't have to spend.
</div>

<!-- ---------- streak ---------- -->
{#if streaks.longest || streaks.current}
  <div class="grouplbl" style="margin-left:2px;">Streak</div>
  <div class="stat-row">
    <div class="stat">
      <div class="v">{streaks.current > 0 ? "🔥" : "💤"} {streaks.current}</div>
      <div class="l">Current streak (days)</div>
    </div>
    <div class="stat soft">
      <div class="v">{streaks.longest}</div>
      <div class="l">Longest streak</div>
    </div>
    <div class="stat soft">
      <div class="v">{streaks.life >= 1 ? "❤️" : "🤍"}</div>
      <div class="l">Revive {streaks.life >= 1 ? "ready" : "used"}</div>
    </div>
  </div>
  <div class="bk-card">
    <div class="s-text" style="color:var(--ink-soft)">
      {#if streaks.current > 0}
        {streaks.current}-day streak{streaks.current === streaks.longest ? " - your best yet!" : ""}
      {:else}
        Streak's asleep - your best was {streaks.longest} days.
      {/if}
      <span style="color:var(--ink-faint)">Weekends and days off never break it.</span>
    </div>
    <div class="s-text" style="color:var(--ink-faint); margin-top:6px;">
      {#if streaks.life >= 1 && offer}
        ❤️ <b>1 revive ready.</b> Your {offer.credit}-day streak broke on {prettyDate(
          dateFromISO(offer.brokenISO),
        )}. Spending the heart gives that count back and carries on from {offer.sinceBreak
          ? "there"
          : "today"} - the missed day stays missed.
      {:else if streaks.life >= 1}
        ❤️ <b>1 revive ready.</b> It buys back a streak that broke within the last week, as long as a
        new one hasn't taken hold - your call when it's worth it.
      {:else}
        🤍 Revive spent. You earn one back after every 5-day streak.
      {/if}
    </div>
    {#if canRevive && offer}
      <!-- The number is the whole decision: "save your streak" told you
           nothing about whether it was worth a heart. -->
      <button class="set-btn" style="margin-top:10px;" on:click={useRevive}>
        ❤️ Get your {offer.credit}-day streak back
        {#if offer.sinceBreak}(+{offer.sinceBreak} since){/if}
      </button>
    {/if}
  </div>
{/if}

<!-- ---------- time given back ---------- -->
<div class="givenback" use:tourAnchor={"stats-given"}>
  <div class="eyebrow">Time given back today</div>
  <div class="gb-v">{hoursStr(given)}</div>
  <div class="gb-l">
    You've tracked <b>{hoursStr(tracked)}</b> of a {fmtEst(target)} day on real tasks.
  </div>
  <div class="bar"><span style="width:{pct}%"></span></div>
</div>

<div class="stat-row">
  <div class="stat">
    <div class="v">{doneToday}</div>
    <div class="l">Completed today</div>
  </div>
  <div class="stat soft">
    <div class="v">{hoursStr(tracked)}</div>
    <div class="l">Time on tasks today</div>
  </div>
  <div class="stat soft">
    <div class="v">{s.dayNum}</div>
    <div class="l">Day number</div>
  </div>
</div>
<div class="stat-row">
  <div class="stat soft">
    <div class="v">{allDone}</div>
    <div class="l">Completed all-time</div>
  </div>
  <div class="stat soft">
    <div class="v">{hoursStr(allTracked)}</div>
    <div class="l">Tracked all-time</div>
  </div>
  <div class="stat soft">
    <div class="v">{s.history.length}</div>
    <div class="l">Days logged</div>
  </div>
</div>

<!-- ---------- time-sense trainer ---------- -->
{#if s.trainerOn || ts}
  <div class="grouplbl" style="margin-left:2px;">⏱ Time-sense trainer</div>
  {#if !ts}
    <div class="bk-card">
      <div class="s-text" style="color:var(--ink-faint)">
        Estimate a task in Plan, finish it, and your accuracy shows up here.
      </div>
    </div>
  {:else}
    <div
      class="givenback"
      style="background:linear-gradient(160deg,var(--break-bg),color-mix(in srgb,var(--break-bg) 60%, var(--card)));border-color:var(--break-line);"
    >
      <div class="eyebrow" style="color:var(--break-ink)">On average, tasks take</div>
      <div class="gb-v" style="color:var(--break-ink)">{ts.avgRatio.toFixed(1)}×</div>
      <div class="gb-l">your estimate. {ts.verdict}</div>
    </div>
    <div class="stat-row">
      <div class="stat soft">
        <div class="v">{ts.count}</div>
        <div class="l">Estimated tasks</div>
      </div>
      <div class="stat soft">
        <div class="v">{ts.under}</div>
        <div class="l">Under / on time</div>
      </div>
      <div class="stat soft">
        <div class="v">{ts.over}</div>
        <div class="l">Ran over</div>
      </div>
    </div>
    <div class="bk-card">
      <h4 style="margin-bottom:8px;">Recent estimates</h4>
      {#each ts.recent as e, i (i)}
        {@const ratio = e.actualMs / e.estMs}
        <div class="ts-row">
          <span>est {fmtEst(e.estMs)} → actual {fmtEst(e.actualMs)}</span>
          <span class="ts-r" class:over={e.actualMs > e.estMs} class:ok={e.actualMs <= e.estMs}>
            {ratio.toFixed(1)}×
          </span>
        </div>
      {/each}
    </div>
  {/if}
{/if}

<!-- ---------- interruptions ---------- -->
<div class="grouplbl" style="margin-left:2px;">⚡ Interruptions</div>
{#if intr.count === 0}
  <div class="bk-card">
    <div class="s-text" style="color:var(--ink-faint)">
      No interruptions recorded yet. When something pulls you off a task, Remi logs it here - useful
      evidence when a task takes longer than anyone estimated.
    </div>
  </div>
{:else}
  <div
    class="givenback"
    style="background:linear-gradient(160deg,var(--break-bg),color-mix(in srgb,var(--break-bg) 60%, var(--card)));border-color:var(--break-line);"
  >
    <div class="eyebrow" style="color:var(--break-ink)">Time lost to interruptions</div>
    <div class="gb-v" style="color:var(--break-ink)">{hoursStr(intr.totalMs)}</div>
    <div class="gb-l">
      across {intr.count} interruption{intr.count === 1 ? "" : "s"} - about {intr.perFocusHour.toFixed(
        1,
      )} per hour of focused work.
    </div>
  </div>
  <div class="stat-row">
    <div class="stat soft">
      <div class="v">{intr.count}</div>
      <div class="l">Total interruptions</div>
    </div>
    <div class="stat soft">
      <div class="v">{hoursStr(intr.totalMs)}</div>
      <div class="l">Time lost</div>
    </div>
    <div class="stat soft">
      <div class="v">{hoursStr(intr.longestMs)}</div>
      <div class="l">Longest single one</div>
    </div>
  </div>

  {#if intr.topCauses.length}
    <div class="bk-card">
      <h4 style="margin-bottom:8px;">What interrupts you most</h4>
      {#each intr.topCauses as c (c.title)}
        <div class="ts-row">
          <span>{c.title}</span>
          <span class="ts-r">{c.count}× · {hoursStr(c.totalMs)}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if intr.stretched.length}
    <div class="grouplbl" style="margin-left:2px;">Estimate vs reality</div>
    <div class="dsec-sub" style="margin:-2px 0 8px; font-size:11.5px;">
      The work matched the estimate; the day did not. This is the gap interruptions create.
    </div>
    {#each intr.stretched.slice(0, 5) as t (t.title)}
      <div class="bk-card">
        <div class="dtask-head" style="padding:0 0 6px;">
          <span class="dt-t">{t.title}</span>
          <span class="est-badge">{t.stretchRatio.toFixed(1)}× longer</span>
        </div>
        <div class="ts-row">
          <span>Estimated</span><span class="ts-r">{t.estMs ? fmtEst(t.estMs) : "-"}</span>
        </div>
        <div class="ts-row">
          <span>Focused work</span><span class="ts-r ok">{hoursStr(t.focusedMs)}</span>
        </div>
        <div class="ts-row">
          <span>Actually took (start → done)</span>
          <span class="ts-r over">{hoursStr(t.elapsedMs)}</span>
        </div>
        <div class="ts-row">
          <span>Interrupted</span>
          <span class="ts-r">{t.interruptedCount}× · {hoursStr(t.interruptedMs)} lost</span>
        </div>
      </div>
    {/each}
    {#if intr.stretched.length > 5}
      <div class="imp-note">+{intr.stretched.length - 5} more in the work-record export.</div>
    {/if}
  {/if}
{/if}

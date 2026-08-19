<script lang="ts">
  /**
   * The dashboard window (900x640): plan a day at desk scale, work it, and see
   * the evidence.
   *
   * Full-repo equivalent: `Dashboard.svelte` + 7 tab components + an import
   * modal (~1900 lines). Six tabs inline here: Plan · Today · Calendar · Stats ·
   * Data · Settings.
   *
   * DISPLAY-ONLY for effects: `startClock({owner:false})` ticks the timers but
   * fires no notifications and does not own the tray title. Both webviews exist
   * from launch, so two owners would double-fire and let this window — hidden
   * most of the time — consume a bounded check-in the user never sees.
   *
   * The tab strip follows the WAI-ARIA tabs pattern with roving tabindex, so it
   * is fully keyboard navigable.
   */
  import { onDestroy, onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import {
    addBacklog,
    addMain,
    addSub,
    app,
    applyImport,
    backlogToToday,
    boot,
    closeOverlay,
    completeMain,
    dashTab,
    deleteBacklog,
    dismissWellness,
    endDay,
    exportBackup,
    exportLogs,
    extendBreak,
    flushSave,
    getAutoUpdate,
    getDataFolder,
    initErrorCapture,
    initSync,
    openDataFolder,
    promoteSub,
    pruneEmpty,
    reloadFromDisk,
    removeMain,
    removeSub,
    resetAndUninstall,
    restartDay,
    restoreBackup,
    resumeFromBreak,
    reviveMain,
    setAccent,
    setAutoUpdate,
    setDayTarget,
    setEstimate,
    setFlag,
    setMode,
    setNote,
    setOverlay,
    setPingMin,
    setRemind,
    setStandardDaily,
    setWellnessEvery,
    setWellnessHour,
    showToast,
    snoozeWellness,
    startBreak,
    startClock,
    startDay,
    startSub,
    startTask,
    stopClock,
    switchToMain,
    teardownSync,
    toast,
    toggleShowSubs,
    togglePto,
    trackTab,
    toggleSubDone,
    toggleWellness,
    useRevive,
    wellnessCopy,
    wellnessNudge,
    type BoolPref,
  } from "./store";
  import {
    ACCENTS,
    IMPORT_PROMPT,
    MONTHS_FULL,
    addDays,
    canMarkPto,
    computeStreaks,
    dateFromISO,
    fmt,
    fmtEst,
    interruptionStats,
    isoOf,
    mainTotal,
    nowMs,
    parseImport,
    prettyDate,
    timeSense,
    todayAsRecord,
    todayISO,
    todayTrackedMs,
    type Accent,
    type DashTab,
    type ParsedImport,
    type WellnessKey,
  } from "./view";

  const TABS: { id: DashTab; label: string }[] = [
    // Plan then Today: the order you actually move through a day.
    { id: "plan", label: "Plan" },
    { id: "today", label: "Today" },
    { id: "calendar", label: "Calendar" },
    { id: "stats", label: "Stats" },
    { id: "data", label: "Data" },
    { id: "settings", label: "Settings" },
  ];

  let ready = false;
  let tabRefs: HTMLButtonElement[] = [];
  let unlistenFocus: (() => void) | null = null;
  let unlistenClose: (() => void) | null = null;

  // Plan
  let draft = "";
  let stepDrafts: Record<string, string> = {};
  let estDrafts: Record<string, { h: number; m: number }> = {};
  let remindDrafts: Record<string, string> = {};
  let noteOpen: string | null = null;

  // Calendar
  let monthCursor = todayISO().slice(0, 7);

  // Data
  let importText = "";
  let importPreview: ParsedImport | null = null;
  let restoreText = "";
  let dataFolder = "";
  let autoUpdate = false;

  // Settings
  let routinesText = "";
  let confirmWipe = false;

  onMount(async () => {
    initErrorCapture();
    await boot();
    await initSync();
    // Display-only: the popover is the single owner of reminders, wellness and
    // check-ins. See the header note.
    startClock({ owner: false });
    dataFolder = await getDataFolder();
    autoUpdate = await getAutoUpdate();
    routinesText = $app.standardDaily.join("\n");
    ready = true;

    // This webview boots at app launch - long before the window is opened - so
    // refresh on focus as a fallback for any missed event.
    try {
      const win = getCurrentWindow();
      unlistenFocus = await win.onFocusChanged(({ payload }) => {
        if (payload) void reloadFromDisk();
      });
      unlistenClose = await win.onCloseRequested(() => {
        // Rust hides the window (keeping the webview warm); we just make sure the
        // queued debounce lands now rather than up to 250ms later.
        void flushSave();
        void invoke("dashboard_closed").catch(() => {});
      });
    } catch {
      /* not in Tauri (browser dev) - live events still cover it */
    }

    window.addEventListener("beforeunload", () => void flushSave());
  });

  onDestroy(() => {
    stopClock();
    teardownSync();
    unlistenFocus?.();
    unlistenClose?.();
  });

  $: s = $app;
  $: tab = $dashTab;
  $: live = s.activeMainId && s.startedAt ? Math.max(0, $nowMs - s.startedAt) : 0;
  $: active = s.mains.find((m) => m.id === s.activeMainId) ?? null;
  $: activeSub = active?.subs.find((x) => x.id === s.activeSubId) ?? null;
  $: thing = activeSub ?? active;
  $: tracked = todayTrackedMs(s, $nowMs);
  $: streaks = computeStreaks(s);
  $: target = s.dayTargetMins * 60_000;
  // "Given back" only means something while you're still under your own target.
  $: givenBack = Math.max(0, target - tracked);
  $: ints = interruptionStats([...s.history, todayAsRecord(s, $nowMs)]);
  $: sense = timeSense(s.estimateLog);
  $: breakLeft = Math.max(0, s.breakEndsAt - $nowMs);

  /** Arrow keys move between tabs; Home/End jump to the ends. */
  function onTabKeydown(e: KeyboardEvent, i: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    dashTab.set(TABS[next].id);
    trackTab(TABS[next].id);
    tabRefs[next]?.focus();
  }

  function commitDraft() {
    addMain(draft);
    draft = "";
  }

  function commitStep(id: string) {
    addSub(id, stepDrafts[id] ?? "");
    stepDrafts[id] = "";
  }

  function commitEstimate(id: string) {
    const d = estDrafts[id] ?? { h: 0, m: 0 };
    setEstimate(id, d.h || 0, d.m || 0);
  }

  function commitRemind(id: string) {
    const raw = (remindDrafts[id] ?? "").trim();
    if (!raw) {
      setRemind({ kind: "main", id }, "clear", "");
      return;
    }
    // A bare `HH:MM` is a clock time today; anything else is a full datetime.
    setRemind({ kind: "main", id }, /^\d{1,2}:\d{2}$/.test(raw) ? "by" : "on", raw);
    remindDrafts[id] = "";
  }

  // ---- calendar helpers ----
  /** The days of `monthCursor`, padded so the 1st lands on the right weekday. */
  $: monthDays = (() => {
    const [y, m] = monthCursor.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const lead = first.getDay(); // 0 = Sunday
    const count = new Date(y, m, 0).getDate();
    const cells: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= count; d++) cells.push(isoOf(new Date(y, m - 1, d)));
    return cells;
  })();
  $: worked = new Set(
    s.history.filter((h) => h.completed.length).map((h) => h.dateISO),
  );
  $: byDate = new Map(s.history.map((h) => [h.dateISO, h]));

  function shiftMonth(delta: number) {
    const [y, m] = monthCursor.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    monthCursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  const FLAGS: { key: BoolPref; label: string; hint: string }[] = [
    { key: "trainerOn", label: "Time-sense trainer", hint: "Estimate tasks, then compare." },
    {
      key: "avoidanceOn",
      label: "Avoidance nudges",
      hint: "Flag tasks moved 3+ days running.",
    },
    { key: "notifyReminders", label: "Reminder notifications", hint: "Native banner when due." },
    { key: "notifyBreakEnd", label: "Break-over notification", hint: "Tell me when a break ends." },
    {
      key: "welcomeBack",
      label: "Welcome back",
      hint: "Offer to resume work left running. Never affects time accounting.",
    },
    {
      key: "privateNotifications",
      label: "Private notifications",
      hint: "Keep task names out of banners - safe for screen shares.",
    },
    { key: "trayTimer", label: "Menu-bar timer", hint: "Show elapsed time beside the icon." },
  ];

  const WELLNESS_KEYS: WellnessKey[] = ["water", "stand", "walk", "lunch", "breakr"];
</script>

<div class="dash">
  <div class="head">
    <div class="brand"><span class="dot"></span> Dopamigo</div>
    <div class="tabs" role="tablist" aria-label="Dashboard sections">
      {#each TABS as t, i (t.id)}
        <button
          class="tab"
          class:on={tab === t.id}
          role="tab"
          id="tab-{t.id}"
          aria-selected={tab === t.id}
          aria-controls="panel"
          tabindex={tab === t.id ? 0 : -1}
          bind:this={tabRefs[i]}
          on:click={() => {
            dashTab.set(t.id);
            trackTab(t.id);
          }}
          on:keydown={(e) => onTabKeydown(e, i)}
        >
          {t.label}
        </button>
      {/each}
    </div>
    <span class="spacer"></span>
    <span class="muted small">
      Day {s.dayNum} · {fmtEst(tracked)} tracked
      {#if streaks.current > 1}· 🔥 {streaks.current}{/if}
    </span>
  </div>

  <div class="body" id="panel" role="tabpanel" aria-labelledby="tab-{tab}">
    {#if !ready}
      <p class="muted pad">Loading…</p>

      <!-- ================= PLAN ================= -->
    {:else if tab === "plan"}
      <div class="wrap">
        <h1>Plan your day</h1>
        <p class="muted">
          Type the whole day here, then work it in the popover or the Today tab.
          Steps are one level deep.
        </p>

        {#if s.phase === "startday"}
          <div class="callout">
            <div class="grow">
              <b>Day {s.dayNum} hasn't started.</b>
              <div class="muted small">
                {s.carrySeed.length} carried · {s.standardDaily.length} routine{s.standardDaily
                  .length === 1
                  ? ""
                  : "s"} waiting to be added.
              </div>
            </div>
            <button class="btn accent" on:click={startDay}>▸ Start my day</button>
          </div>
        {/if}

        <input
          class="in big"
          placeholder="Add a task, then press Enter"
          bind:value={draft}
          on:keydown={(e) => e.key === "Enter" && commitDraft()}
        />

        {#each s.mains as m (m.id)}
          {@const warn = s.avoidanceOn && m.carries >= 3}
          {@const total = mainTotal(m, s, $nowMs)}
          <div class="card" class:warn class:is-done={m.done}>
            <div class="row">
              <div class="grow">
                <div class="title" class:strike={m.done}>
                  {m.title}
                  {#if m.remind}
                    <span class="badge" title={m.remind.label}>⏲ {m.remind.short}</span>
                  {/if}
                  {#if m.estMs}<span class="badge">⏱ {fmtEst(m.estMs)}</span>{/if}
                  {#if s.avoidanceOn && m.carries >= 1}
                    <span class="badge" class:warnb={warn}>↻ {m.carries}×</span>
                  {/if}
                  {#if m.id === s.activeMainId}<span class="badge live">● running</span>{/if}
                </div>
                <div class="muted small">
                  {fmtEst(total)}
                  {#if m.interruptedCount}
                    · interrupted {m.interruptedCount}× for {fmtEst(m.interruptedMs)}
                  {/if}
                  {#if m.subs.length}
                    · {m.subs.filter((x) => x.done).length}/{m.subs.length} steps
                  {/if}
                </div>
                {#if warn}
                  <div class="note">
                    Moved {m.carries} days running - are you avoiding it? Try the first small step.
                  </div>
                {/if}
              </div>

              {#if m.done}
                <button class="mini" title="Not actually done" on:click={() => reviveMain(m.id)}>
                  ↺
                </button>
              {:else}
                <button
                  class="btn small"
                  on:click={() => (s.activeMainId ? switchToMain(m.id, true) : startTask(m.id))}
                >
                  {s.activeMainId === m.id ? "Running" : s.activeMainId ? "Switch" : "Start ▸"}
                </button>
                <button class="btn small" on:click={() => completeMain(m.id)}>Done</button>
              {/if}
              <button
                class="mini"
                title="Notes, estimate & reminder"
                on:click={() => (noteOpen = noteOpen === m.id ? null : m.id)}>✎</button
              >
              <button class="mini danger" title="Remove" on:click={() => removeMain(m.id)}>✕</button>
            </div>

            {#if noteOpen === m.id}
              <div class="detail">
                <label class="fld">
                  <span class="muted small">Note</span>
                  <textarea
                    class="in"
                    rows="2"
                    placeholder="Context you'll want tomorrow…"
                    value={m.note}
                    on:change={(e) => setNote(m.id, null, e.currentTarget.value)}
                  ></textarea>
                </label>
                <div class="row">
                  <label class="fld">
                    <span class="muted small">Estimate</span>
                    <span class="inline">
                      <input
                        class="in narrow"
                        type="number"
                        min="0"
                        max="23"
                        placeholder="h"
                        value={Math.floor(m.estMs / 3600000) || ""}
                        on:change={(e) => {
                          estDrafts[m.id] = {
                            h: Number(e.currentTarget.value),
                            m: estDrafts[m.id]?.m ?? Math.round((m.estMs % 3600000) / 60000),
                          };
                          commitEstimate(m.id);
                        }}
                      />
                      <input
                        class="in narrow"
                        type="number"
                        min="0"
                        max="59"
                        placeholder="m"
                        value={Math.round((m.estMs % 3600000) / 60000) || ""}
                        on:change={(e) => {
                          estDrafts[m.id] = {
                            h: estDrafts[m.id]?.h ?? Math.floor(m.estMs / 3600000),
                            m: Number(e.currentTarget.value),
                          };
                          commitEstimate(m.id);
                        }}
                      />
                    </span>
                  </label>
                  <label class="fld grow">
                    <span class="muted small">Remind (HH:MM today, or a full date-time)</span>
                    <input
                      class="in"
                      placeholder={m.remind ? m.remind.label : "14:30"}
                      bind:value={remindDrafts[m.id]}
                      on:keydown={(e) => e.key === "Enter" && commitRemind(m.id)}
                      on:blur={() => remindDrafts[m.id] && commitRemind(m.id)}
                    />
                  </label>
                  {#if m.remind}
                    <button
                      class="btn small"
                      on:click={() => setRemind({ kind: "main", id: m.id }, "clear", "")}
                    >
                      Clear
                    </button>
                  {/if}
                </div>
              </div>
            {/if}

            <div class="steps">
              {#each m.subs as sub (sub.id)}
                <div class="step">
                  <input
                    type="checkbox"
                    checked={sub.done}
                    aria-label={sub.title}
                    on:change={() => toggleSubDone(m.id, sub.id)}
                  />
                  <span class="grow" class:strike={sub.done}>{sub.title}</span>
                  {#if sub.accrued}<span class="muted small">{fmtEst(sub.accrued)}</span>{/if}
                  {#if !sub.done && !m.done}
                    <button
                      class="mini"
                      title="Work on this step"
                      on:click={() => startSub(m.id, sub.id)}>▸</button
                    >
                    <button
                      class="mini"
                      title="Make this its own task"
                      on:click={() => promoteSub(m.id, sub.id)}>↥</button
                    >
                  {/if}
                  <button class="mini danger" on:click={() => removeSub(m.id, sub.id)}>✕</button>
                </div>
              {/each}
              {#if !m.done}
                <input
                  class="in step-in"
                  placeholder="Add a step…"
                  bind:value={stepDrafts[m.id]}
                  on:keydown={(e) => e.key === "Enter" && commitStep(m.id)}
                />
              {/if}
            </div>
          </div>
        {/each}

        {#if s.mains.length}
          <div class="row">
            <button class="btn" on:click={pruneEmpty}>Tidy blank rows</button>
            <button class="btn" on:click={() => setOverlay("endday")}>End the day…</button>
            <button class="btn" on:click={() => setOverlay("restart")}>Restart the day…</button>
          </div>
        {/if}

        <h2>Backlog</h2>
        <p class="muted small">Things for later. Nothing here is on today's list.</p>
        {#each s.backlog as b (b.id)}
          <div class="line">
            <span class="grow">{b.title}</span>
            <button class="btn small" on:click={() => backlogToToday(b.id)}>→ Today</button>
            <button class="mini danger" on:click={() => deleteBacklog(b.id)}>✕</button>
          </div>
        {/each}
        <input
          class="in"
          placeholder="Add something for later…"
          on:keydown={(e) => {
            if (e.key !== "Enter") return;
            addBacklog(e.currentTarget.value);
            e.currentTarget.value = "";
          }}
        />
      </div>

      <!-- ================= TODAY ================= -->
    {:else if tab === "today"}
      <div class="wrap">
        <h1>Today</h1>
        <p class="muted">
          The popover's working view at desk scale, so a day planned here can also be
          worked here.
        </p>

        {#if s.phase === "break"}
          <div class="hero brk">
            <div class="eyebrow">On a break</div>
            <div class="timer">{fmt(breakLeft)}</div>
            {#if s.breakPausedTitle}
              <div class="muted small">Paused: {s.breakPausedTitle}</div>
            {/if}
            <div class="row">
              <button class="btn accent" on:click={resumeFromBreak}>I'm back</button>
              <button class="btn" on:click={() => extendBreak(5)}>+5 min</button>
            </div>
          </div>
        {:else if thing && active}
          <div class="hero">
            <div class="eyebrow">{activeSub ? "Working on a step" : "Working on"}</div>
            <div class="hero-title">{thing.title}</div>
            {#if activeSub}<div class="muted small">in {active.title}</div>{/if}
            <div class="timer">{fmt((thing.accrued ?? 0) + live)}</div>
            <div class="row">
              <button class="btn accent" on:click={() => completeMain(active.id)}>Done</button>
              <button class="btn" on:click={() => startBreak(10)}>Break</button>
            </div>
          </div>
        {:else}
          <div class="callout">
            <div class="grow">
              <b>Nothing running.</b>
              <div class="muted small">Start something below to begin tracking.</div>
            </div>
          </div>
        {/if}

        <h2>Open</h2>
        {#each s.mains.filter((m) => !m.done) as m (m.id)}
          <div class="line">
            <div class="grow">
              <div>{m.title}</div>
              <div class="muted small">{fmtEst(mainTotal(m, s, $nowMs))}</div>
            </div>
            {#if m.subs.length}
              <button class="mini" on:click={() => toggleShowSubs(m.id)}>
                {m._showSubs ? "▾" : "⋔"}
              </button>
            {/if}
            <button
              class="btn small"
              on:click={() => (s.activeMainId ? switchToMain(m.id, true) : startTask(m.id))}
            >
              {s.activeMainId === m.id ? "Running" : s.activeMainId ? "Switch" : "Start ▸"}
            </button>
            <button class="btn small" on:click={() => completeMain(m.id)}>Done</button>
          </div>
          {#if m._showSubs}
            <div class="steps indent">
              {#each m.subs as sub (sub.id)}
                <div class="step">
                  <input
                    type="checkbox"
                    checked={sub.done}
                    aria-label={sub.title}
                    on:change={() => toggleSubDone(m.id, sub.id)}
                  />
                  <span class="grow" class:strike={sub.done}>{sub.title}</span>
                  {#if !sub.done}
                    <button class="mini" on:click={() => startSub(m.id, sub.id)}>▸</button>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        {/each}
        {#if !s.mains.some((m) => !m.done)}
          <p class="muted small">Nothing open. Plan some tasks, or end the day.</p>
        {/if}

        {#if s.mains.some((m) => m.done)}
          <h2>Done today</h2>
          {#each s.mains.filter((m) => m.done) as m (m.id)}
            <div class="line">
              <span class="grow strike">{m.title}</span>
              <span class="muted small">{fmtEst(mainTotal(m, s, $nowMs))}</span>
              <button class="mini" title="Not actually done" on:click={() => reviveMain(m.id)}>
                ↺
              </button>
            </div>
          {/each}
        {/if}
      </div>

      <!-- ================= CALENDAR ================= -->
    {:else if tab === "calendar"}
      <div class="wrap">
        <h1>Calendar</h1>
        <p class="muted">
          Days you finished something. Weekends, time off and revived days bridge a
          streak without breaking it.
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
          <div class="tile"><div class="k">{streaks.current}</div><div class="muted small">Current</div></div>
          <div class="tile"><div class="k">{streaks.longest}</div><div class="muted small">Longest</div></div>
          <div class="tile"><div class="k">{streaks.life ? "❤️" : "—"}</div><div class="muted small">Revive</div></div>
          <div class="tile"><div class="k">{streaks.activeCount}</div><div class="muted small">Active days</div></div>
        </div>
        {#if streaks.broken}
          <div class="callout">
            <div class="grow">
              <b>{streaks.broken} broke your streak.</b>
              <div class="muted small">
                {streaks.life
                  ? "Spend your revive to bridge it."
                  : "Earn a revive with a 5-day streak."}
              </div>
            </div>
            <button class="btn" disabled={!streaks.life} on:click={useRevive}>❤️ Revive</button>
          </div>
        {/if}
      </div>

      <!-- ================= STATS ================= -->
    {:else if tab === "stats"}
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
            Tasks whose wall-clock ran well past the time actually spent on them - this
            is what interruptions cost.
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

      <!-- ================= DATA ================= -->
    {:else if tab === "data"}
      <div class="wrap">
        <h1>Your data</h1>
        <p class="muted">
          Everything is a plain JSON file on this machine. Nothing is uploaded anywhere.
        </p>

        <div class="line">
          <span class="grow">
            Data folder
            <div class="muted small mono">{dataFolder || "…"}</div>
          </span>
          <button class="btn small" on:click={openDataFolder}>Open folder</button>
          <button class="btn small" on:click={exportBackup}>Export backup</button>
        </div>

        <h2>Import a plan</h2>
        <p class="muted small">
          Paste the structured format below - handy for turning an assistant's task
          list into a real day.
        </p>
        <details>
          <summary class="muted small">Show the prompt to copy</summary>
          <pre class="prompt">{IMPORT_PROMPT}</pre>
        </details>
        <textarea
          class="in"
          rows="6"
          placeholder="Paste your task list here…"
          bind:value={importText}
        ></textarea>
        <div class="row">
          <button
            class="btn"
            on:click={() => (importPreview = importText.trim() ? parseImport(importText) : null)}
          >
            Preview
          </button>
          {#if importPreview}
            <button
              class="btn accent"
              on:click={() => {
                if (!importPreview) return;
                applyImport(importPreview);
                importPreview = null;
                importText = "";
              }}
            >
              Add {importPreview.mains.length} task{importPreview.mains.length === 1 ? "" : "s"}
            </button>
            <button class="btn" on:click={() => (importPreview = null)}>Cancel</button>
          {/if}
        </div>
        {#if importPreview}
          <div class="card">
            {#each importPreview.mains as m (m.title)}
              <div>
                <b>{m.title}</b>
                {#if m.remind}<span class="badge">⏲ {m.remind.short}</span>{/if}
              </div>
              {#each m.subs as sub (sub.title)}
                <div class="muted small indent">
                  {sub.title}
                  {#if sub.remind}<span class="badge">⏲ {sub.remind.short}</span>{/if}
                </div>
              {/each}
            {/each}
            {#each importPreview.backlog as b (b.title)}
              <div class="muted small">backlog: {b.title}</div>
            {/each}
            {#each importPreview.errors as e (e)}
              <div class="note">{e}</div>
            {/each}
          </div>
        {/if}

        <h2>Usage logging</h2>
        <p class="muted small">
          Off by default. When on, Dopamigo counts what you click and where the
          interface seems to confuse you - <b>counts and settings only</b>. Task names,
          notes, backlog text and reminder text are never recorded.
        </p>
        <div class="line">
          <span class="grow">
            Anonymous usage logging
            <div class="muted small">
              {Object.keys(s.metrics.days).length} day bucket{Object.keys(s.metrics.days)
                .length === 1
                ? ""
                : "s"} · {s.metrics.errors.length} error{s.metrics.errors.length === 1 ? "" : "s"}
              recorded
            </div>
          </span>
          <button class="btn small" on:click={() => setFlag("loggingOptIn", !s.loggingOptIn)}>
            {s.loggingOptIn ? "On" : "Off"}
          </button>
          <button class="btn small" disabled={!s.loggingOptIn} on:click={exportLogs}>
            Export logs
          </button>
        </div>

        <h2>Restore a backup</h2>
        <p class="muted small">
          Paste the contents of an exported backup. This REPLACES today's state; the
          data folder itself is machine-local and is not restored.
        </p>
        <textarea class="in" rows="4" placeholder="Paste backup JSON…" bind:value={restoreText}
        ></textarea>
        <button
          class="btn"
          on:click={() => {
            restoreBackup(restoreText);
            restoreText = "";
          }}
        >
          Restore
        </button>
      </div>

      <!-- ================= SETTINGS ================= -->
    {:else}
      <div class="wrap">
        <h1>Settings</h1>

        <div class="line">
          <span class="grow">Appearance</span>
          <button class="btn small" on:click={() => setMode(s.mode === "dark" ? "light" : "dark")}>
            {s.mode === "dark" ? "Dark" : "Light"}
          </button>
        </div>

        <div class="line">
          <span class="grow">Accent</span>
          <div class="swatches">
            {#each ACCENTS as [name, hex] (name)}
              <button
                class="sw"
                class:on={s.accent === name}
                style="background:{hex}"
                title={name}
                aria-label={name}
                on:click={() => setAccent(name)}
              ></button>
            {/each}
          </div>
        </div>

        <div class="line">
          <span class="grow">
            Workday target
            <div class="muted small">Drives the "under target" stat.</div>
          </span>
          <input
            class="in narrow"
            type="number"
            min="1"
            max="16"
            value={Math.round(s.dayTargetMins / 60)}
            on:change={(e) => setDayTarget(Number(e.currentTarget.value) * 60)}
          />
          <span class="muted small">hours</span>
        </div>

        <div class="line">
          <span class="grow">
            Check-in interval
            <div class="muted small">
              Asks "still on this?" at 1×, 2× then 4× this, then stops. 0 turns it off.
            </div>
          </span>
          <input
            class="in narrow"
            type="number"
            min="0"
            max="240"
            value={s.pingMin}
            on:change={(e) => setPingMin(Number(e.currentTarget.value))}
          />
          <span class="muted small">min</span>
        </div>

        {#each FLAGS as f (f.key)}
          <div class="line">
            <span class="grow">
              {f.label}
              <div class="muted small">{f.hint}</div>
            </span>
            <button class="btn small" on:click={() => setFlag(f.key, !s[f.key])}>
              {s[f.key] ? "On" : "Off"}
            </button>
          </div>
        {/each}

        <div class="line">
          <span class="grow">
            Silent self-update
            <div class="muted small">
              Stored for a future updater - this build does not self-update.
            </div>
          </span>
          <button
            class="btn small"
            on:click={async () => {
              autoUpdate = !autoUpdate;
              await setAutoUpdate(autoUpdate);
            }}
          >
            {autoUpdate ? "On" : "Off"}
          </button>
        </div>

        <h2>Wellness nudges</h2>
        <p class="muted small">
          Opt-in, one at a time, never during a break, and they never touch the clock.
        </p>
        {#each WELLNESS_KEYS as key (key)}
          {@const c = s.wellness[key]}
          {@const copy = wellnessCopy(key)}
          <div class="line">
            <span class="grow">{copy.icon} {copy.title}</span>
            {#if key === "lunch"}
              <input
                class="in narrow"
                type="number"
                min="0"
                max="23"
                value={c.atHour ?? 13}
                aria-label="Lunch hour"
                on:change={(e) => setWellnessHour(key, Number(e.currentTarget.value))}
              />
              <span class="muted small">o'clock</span>
            {:else}
              <span class="muted small">every</span>
              <input
                class="in narrow"
                type="number"
                min="1"
                max="480"
                value={c.everyMin ?? 60}
                aria-label="{copy.title} interval"
                on:change={(e) => setWellnessEvery(key, Number(e.currentTarget.value))}
              />
              <span class="muted small">min</span>
            {/if}
            <button class="btn small" on:click={() => toggleWellness(key, !c.on)}>
              {c.on ? "On" : "Off"}
            </button>
          </div>
        {/each}

        <h2>Daily routines</h2>
        <p class="muted small">
          One per line. Added fresh to every new day, skipping anything already carried.
        </p>
        <textarea class="in" rows="4" bind:value={routinesText}></textarea>
        <button class="btn" on:click={() => setStandardDaily(routinesText.split("\n"))}>
          Save routines
        </button>

        <h2 class="danger-h">Danger zone</h2>
        {#if !confirmWipe}
          <button class="btn danger-btn" on:click={() => (confirmWipe = true)}>
            Reset & uninstall…
          </button>
        {:else}
          <div class="card warn">
            <p><b>Remove Dopamigo's data from this machine?</b></p>
            <p class="muted small">
              This quits the app. Drag it to the Trash afterwards to finish removing it.
            </p>
            <div class="row">
              <button class="btn" on:click={() => (confirmWipe = false)}>Cancel</button>
              <button class="btn" on:click={() => resetAndUninstall(true)}>
                Wipe, keep history
              </button>
              <button class="btn danger-btn" on:click={() => resetAndUninstall(false)}>
                Remove everything
              </button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- ================= OVERLAYS =================
       Shared, so any tab can open them. "checkin" is deliberately absent: the
       popover owns bounded check-ins. -->
  {#if s.overlay === "endday"}
    <div class="scrim">
      <div class="sheet wide">
        <h3>End the day?</h3>
        <p class="muted small">
          {fmtEst(tracked)} tracked · {s.mains.filter((m) => m.done).length} done. Anything
          unfinished carries to tomorrow, keeping its notes and steps.
        </p>
        <div class="stack">
          <button
            class="btn accent"
            on:click={() => {
              endDay();
              closeOverlay();
            }}>End day</button
          >
          <button class="link" on:click={closeOverlay}>Not yet</button>
        </div>
      </div>
    </div>
  {:else if s.overlay === "restart"}
    <div class="scrim">
      <div class="sheet">
        <h3>Start today over?</h3>
        <p class="muted small">
          Clears today's tasks and timers. Backlog, history and settings stay.
        </p>
        <div class="stack">
          <button
            class="btn accent"
            on:click={() => {
              restartDay();
              closeOverlay();
            }}>Restart the day</button
          >
          <button class="link" on:click={closeOverlay}>Cancel</button>
        </div>
      </div>
    </div>
  {:else if s.overlay === "done-choose"}
    <div class="scrim">
      <div class="sheet">
        <h3>Nice. What's next?</h3>
        <div class="stack">
          {#each s.mains.filter((m) => !m.done) as m (m.id)}
            <button class="btn" on:click={() => startTask(m.id)}>{m.title}</button>
          {/each}
          {#if !s.mains.some((m) => !m.done)}
            <p class="muted small">Everything on today's list is done.</p>
          {/if}
          <button class="link" on:click={closeOverlay}>Just stop for now</button>
        </div>
      </div>
    </div>
  {/if}

  {#if $wellnessNudge}
    {@const c = wellnessCopy($wellnessNudge)}
    <div class="scrim">
      <div class="sheet">
        <h3>{c.icon} {c.title}</h3>
        <p class="muted small">{c.msg}</p>
        <div class="stack">
          <button class="btn accent" on:click={dismissWellness}>Done</button>
          <button class="btn" on:click={snoozeWellness}>Snooze 15 min</button>
        </div>
      </div>
    </div>
  {/if}

  {#if $toast}
    <div class="toast">
      <span class="grow">{$toast.msg}</span>
      {#if $toast.actionLabel}
        <button
          class="undo"
          on:click={() => {
            $toast?.action?.();
            toast.set(null);
          }}>{$toast.actionLabel}</button
        >
      {/if}
    </div>
  {/if}
</div>

<style>
  .dash {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
    color: var(--ink);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--line);
    flex: none;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 7px;
    font-weight: 640;
  }
  .dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 3px solid var(--accent);
  }
  .spacer {
    flex: 1;
  }
  .body {
    flex: 1;
    overflow-y: auto;
  }
  /* Fills the window rather than a fixed narrow column. */
  .wrap {
    padding: 20px 26px 48px;
    max-width: 1040px;
  }
  .pad {
    padding: 16px;
  }

  .tabs {
    display: flex;
    gap: 3px;
  }
  .tab {
    border: 0;
    background: none;
    color: var(--ink-soft);
    padding: 6px 12px;
    border-radius: var(--r-sm);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .tab:hover {
    background: var(--card);
  }
  .tab.on {
    background: var(--pill-bg);
    color: var(--accent-ink);
    font-weight: 600;
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
  h3 {
    font-size: 17px;
    margin: 0 0 3px;
  }
  .muted {
    color: var(--ink-soft);
  }
  .small {
    font-size: 12px;
  }
  .mono {
    font-family: var(--font-num);
    font-size: 11px;
    overflow-wrap: anywhere;
  }
  .strike {
    text-decoration: line-through;
    opacity: 0.6;
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
  .stack {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-top: 12px;
  }
  .inline {
    display: flex;
    gap: 5px;
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .indent {
    padding-left: 16px;
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

  .card {
    margin: 11px 0;
    padding: 13px;
    border-radius: var(--r-md);
    background: var(--card);
    border: 1px solid var(--line);
  }
  .card.is-done {
    opacity: 0.62;
  }
  .card.warn {
    background: var(--warn-bg);
    border-color: var(--warn-line);
  }
  .note {
    font-size: 12px;
    color: var(--warn-ink);
    margin-top: 4px;
  }
  .title {
    font-weight: 570;
    font-size: 15px;
    overflow-wrap: anywhere;
  }
  .badge {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--pill-bg);
    color: var(--accent-ink);
    white-space: nowrap;
  }
  .badge.warnb {
    background: var(--warn-bg);
    color: var(--warn-ink);
  }
  .badge.live {
    background: var(--accent);
    color: #fff;
  }
  .detail {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--line);
  }

  .hero {
    padding: 16px;
    border-radius: var(--r-lg);
    background: var(--hero-bg);
    border: 1px solid var(--hero-line);
    margin: 14px 0;
  }
  .hero.brk {
    background: var(--break-bg);
    color: var(--break-ink);
  }
  .hero-title {
    font-size: 21px;
    font-weight: 620;
    letter-spacing: -0.01em;
  }
  .eyebrow {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--ink-soft);
  }
  .timer {
    font-family: var(--font-num);
    font-size: 34px;
    font-variant-numeric: tabular-nums;
    margin: 5px 0;
  }

  .steps {
    margin: 9px 0 0 5px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .step-in {
    font-size: 13px;
    padding: 6px 9px;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 2px;
    border-bottom: 1px solid var(--line);
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

  .swatches {
    display: flex;
    gap: 6px;
  }
  .sw {
    width: 23px;
    height: 23px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
  }
  .sw.on {
    border-color: var(--ink);
  }

  .narrow {
    width: 72px;
  }
  .danger-h {
    color: var(--danger);
  }
  .prompt {
    font-family: var(--font-num);
    font-size: 11px;
    white-space: pre-wrap;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: 10px;
    max-height: 220px;
    overflow: auto;
  }

  .scrim {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--ink) 42%, transparent);
    display: grid;
    place-items: center;
    padding: 20px;
  }
  .sheet {
    width: 100%;
    max-width: 420px;
    padding: 18px;
    border-radius: var(--r-lg);
    background: var(--bg);
    border: 1px solid var(--line);
    box-shadow: 0 16px 44px color-mix(in srgb, var(--ink) 28%, transparent);
  }
  .sheet.wide {
    max-width: 520px;
  }

  .toast {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    bottom: 22px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 15px;
    border-radius: var(--r-sm);
    background: var(--ink);
    color: var(--bg);
    font-size: 13px;
    max-width: 70vw;
  }
  .undo {
    font: inherit;
    font-weight: 640;
    border: 0;
    background: none;
    color: var(--bg);
    text-decoration: underline;
    cursor: pointer;
    flex: none;
  }
</style>

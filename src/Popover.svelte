<script lang="ts">
  /**
   * The tray popover: a 380x560 window that routes on `phase` and layers one
   * overlay on top.
   *
   * Full-repo equivalent: `showcase/Popover.svelte` + 6 views + 9 overlays + 7
   * shared components (~2500 lines). Here every phase and overlay is an inline
   * `{#if}` branch, because at this scope each is under 40 lines of markup and
   * splitting them costs more in import wiring than it saves.
   *
   * This window is the effect OWNER (`startClock({owner:true})`): it fires the
   * notifications, the reminders, the wellness nudges and the bounded check-ins,
   * and it owns the tray title. The dashboard is display-only.
   *
   * Every design token lives in `global.css`, so both windows theme identically.
   */
  import { onDestroy, onMount } from "svelte";
  import {
    activeThing,
    addBacklog,
    addMain,
    app,
    backlogToToday,
    boot,
    closeOverlay,
    completeMain,
    damagedPaths,
    deleteBacklog,
    dismissWelcomeBack,
    dismissWellness,
    endDay,
    extendBreak,
    flushSave,
    initErrorCapture,
    initSync,
    loadKind,
    loadMessage,
    muteCheckins,
    openDashboard,
    quitApp,
    restartDay,
    resumeFromBreak,
    resumeWelcomeBack,
    reviveMain,
    setOverlay,
    setPhase,
    showToast,
    snoozeWellness,
    startBreak,
    startClock,
    startDay,
    startNewMain,
    startSub,
    startTask,
    stopClock,
    switchToMain,
    teardownSync,
    toast,
    toggleShowSubs,
    toggleSubDone,
    welcomeBack,
    wellnessCopy,
    wellnessNudge,
  } from "./store";
  import {
    computeStreaks,
    fmt,
    fmtEst,
    mainTotal,
    nowMs,
    todayTrackedMs,
  } from "./view";

  let ready = false;
  let draft = "";
  let interruptDraft = "";
  let showInterrupt = false;
  let backlogDraft = "";

  onMount(async () => {
    initErrorCapture();
    await boot();
    await initSync();
    // The popover owns background effects - see startClock's contract.
    startClock({ owner: true });
    ready = true;
    // Persist on the way out so nothing is lost if the process is killed.
    window.addEventListener("beforeunload", () => void flushSave());
  });

  onDestroy(() => {
    stopClock();
    teardownSync();
  });

  $: s = $app;
  $: live = s.activeMainId && s.startedAt ? Math.max(0, $nowMs - s.startedAt) : 0;
  $: active = s.mains.find((m) => m.id === s.activeMainId) ?? null;
  $: activeSub = active?.subs.find((x) => x.id === s.activeSubId) ?? null;
  $: thing = activeSub ?? active;
  /** The live elapsed for whatever is being timed, banked + running. */
  $: thingMs = (thing?.accrued ?? 0) + live;
  $: open = s.mains.filter((m) => !m.done && m.id !== s.activeMainId);
  $: done = s.mains.filter((m) => m.done);
  $: tracked = todayTrackedMs(s, $nowMs);
  $: breakLeft = Math.max(0, s.breakEndsAt - $nowMs);
  $: streaks = computeStreaks(s);
  /** Break and recovery manage their own full-height layout. */
  $: bare = s.phase === "break" || s.phase === "recovery";
  $: showFooter = ready && s.phase !== "startday" && !bare;

  function commitDraft() {
    addMain(draft);
    draft = "";
  }

  function commitInterrupt() {
    if (!interruptDraft.trim()) {
      showInterrupt = false;
      return;
    }
    startNewMain(interruptDraft, true);
    interruptDraft = "";
    showInterrupt = false;
  }

  function commitBacklog() {
    addBacklog(backlogDraft);
    backlogDraft = "";
  }
</script>

<div class="pop">
  {#if !ready}
    <div class="center muted">Loading today…</div>

    <!-- ================= RECOVERY ================= -->
  {:else if s.phase === "recovery"}
    <!-- Honest recovery screen. Rust preserved the files and changed nothing;
         showing a blank day here would read as "all my work vanished". -->
    <div class="pad scroll">
      <h1>Couldn't read your data</h1>
      <p class="muted small">{$loadMessage}</p>
      <p class="muted small">
        Nothing was deleted or overwritten. Copies of the affected files are in your
        recovery folder.
      </p>
      {#each $damagedPaths as p (p)}
        <div class="path">{p}</div>
      {/each}
      <div class="row">
        <button class="btn accent" on:click={() => setPhase("today")}>Start today fresh</button>
        <button class="btn" on:click={() => openDashboard("settings")}>Open settings</button>
      </div>
    </div>

    <!-- ================= BREAK ================= -->
  {:else if s.phase === "break"}
    <div class="center pad brk">
      <div class="eyebrow">On a break</div>
      <div class="timer">{fmt(breakLeft)}</div>
      <p class="muted">
        {#if breakLeft > 0}
          Step away properly. We'll still be here.
        {:else}
          Break's up — no rush.
        {/if}
      </p>
      {#if s.breakPausedTitle}
        <p class="muted small">Paused: {s.breakPausedTitle}</p>
      {/if}
      <div class="row">
        <button class="btn accent" on:click={resumeFromBreak}>I'm back</button>
        <button class="btn" on:click={() => extendBreak(5)}>+5 min</button>
      </div>
    </div>

    <!-- ================= START DAY ================= -->
  {:else if s.phase === "startday"}
    <div class="center pad">
      <div class="ring" aria-hidden="true"></div>
      <div class="eyebrow">Day {s.dayNum}</div>
      <h1>{s.dayNum > 1 ? "New day." : "Good morning."}</h1>
      <p class="muted">
        {#if s.carrySeed.length}
          {s.carrySeed.length} task{s.carrySeed.length > 1 ? "s" : ""} carried over, ready to go.
          {#if s.standardDaily.length}<br />Plus your {s.standardDaily.length} daily routine{s
              .standardDaily.length > 1
              ? "s"
              : ""}.{/if}
        {:else if s.standardDaily.length}
          Your {s.standardDaily.length} daily routine{s.standardDaily.length > 1 ? "s" : ""} will be
          added automatically.
        {:else}
          Let's line up today.<br />Add your tasks, then work them here.
        {/if}
      </p>
      {#if streaks.current > 1}
        <p class="muted small">🔥 {streaks.current}-day streak</p>
      {/if}
      <button
        class="btn accent big"
        on:click={() => {
          // Seed the day, then open Plan: typing a whole day's tasks belongs in
          // the 900px window, not a 380px popover.
          startDay();
          openDashboard("plan");
        }}
      >
        ▸ Start my day
      </button>
    </div>
  {:else}
    <!-- ================= HEADER ================= -->
    <div class="top">
      <span class="eyebrow">Day {s.dayNum}</span>
      {#if streaks.current > 1}<span class="muted small">🔥 {streaks.current}</span>{/if}
      <span class="spacer"></span>
      <span class="muted small" title="Tracked today">{fmtEst(tracked)}</span>
    </div>

    <div class="body">
      {#if s.phase === "active" && active && thing}
        <!-- ---------- the running task ---------- -->
        <div class="hero">
          <div class="eyebrow">{activeSub ? "Working on a step" : "Working on"}</div>
          <div class="hero-title">{thing.title}</div>
          {#if activeSub}<div class="muted small">in {active.title}</div>{/if}
          <div class="timer">{fmt(thingMs)}</div>
          {#if active.estMs}
            <div class="muted small">
              Estimated {fmtEst(active.estMs)} · {Math.round(
                (mainTotal(active, s, $nowMs) / active.estMs) * 100,
              )}% used
            </div>
          {/if}

          <div class="row">
            <button class="btn accent" on:click={() => completeMain(active.id)}>Done</button>
            <button class="btn" on:click={() => startBreak(10)}>Break</button>
          </div>

          <div class="row">
            {#if showInterrupt}
              <!-- svelte-ignore a11y-autofocus -->
              <input
                class="in"
                autofocus
                placeholder="What came up?"
                bind:value={interruptDraft}
                on:keydown={(e) => {
                  if (e.key === "Enter") commitInterrupt();
                  if (e.key === "Escape") showInterrupt = false;
                }}
                on:blur={commitInterrupt}
              />
            {:else}
              <button class="btn ghost" on:click={() => (showInterrupt = true)}>
                Something came up
              </button>
            {/if}
          </div>

          {#if active.subs.length}
            <div class="subs">
              {#each active.subs as sub (sub.id)}
                <div class="sub">
                  <input
                    type="checkbox"
                    checked={sub.done}
                    aria-label={sub.title}
                    on:change={() => toggleSubDone(active.id, sub.id)}
                  />
                  <span class="grow" class:strike={sub.done}>{sub.title}</span>
                  {#if !sub.done && s.activeSubId !== sub.id}
                    <button
                      class="mini"
                      title="Work on this step"
                      on:click={() => startSub(active.id, sub.id)}>▸</button
                    >
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- ---------- the list ---------- -->
      <div class="pad tight">
        <h2>{s.phase === "active" ? "Everything else" : "Ready when you are"}</h2>
      </div>

      {#if !open.length && !done.length}
        <div class="pad">
          <p class="muted small">
            Nothing here yet. Add a task below, or plan the whole day in the dashboard.
          </p>
        </div>
      {/if}

      {#each open as m (m.id)}
        {@const warn = s.avoidanceOn && m.carries >= 3}
        {@const total = mainTotal(m, s, $nowMs)}
        <div class="card" class:warn>
          <div class="card-row">
            <div class="grow">
              <div class="title">
                {m.title}
                {#if m.remind}<span class="badge" title={m.remind.label}>⏲ {m.remind.short}</span>{/if}
                {#if m.estMs}<span class="badge">⏱ {fmtEst(m.estMs)}</span>{/if}
                {#if s.avoidanceOn && m.carries >= 1}
                  <span class="badge" class:warnb={warn} title="Moved {m.carries} times">
                    ↻ {m.carries}×
                  </span>
                {/if}
              </div>
              {#if warn}
                <div class="note">
                  You've moved this {m.carries} days running - are you avoiding it? Try just the
                  first small step.
                </div>
              {:else if m.subs.length}
                <div class="muted small">
                  {m.subs.filter((x) => x.done).length}/{m.subs.length} steps
                  {#if total}· {fmtEst(total)}{/if}
                </div>
              {:else if total}
                <div class="muted small">{fmtEst(total)}</div>
              {/if}
            </div>
            {#if m.subs.length}
              <button class="mini" title="Steps" on:click={() => toggleShowSubs(m.id)}>
                {m._showSubs ? "▾" : "⋔"}
              </button>
            {/if}
            <button
              class="btn small"
              on:click={() => (s.activeMainId ? switchToMain(m.id, true) : startTask(m.id))}
            >
              {s.activeMainId ? "Switch" : "Start ▸"}
            </button>
          </div>

          {#if m._showSubs}
            <div class="subs">
              {#each m.subs as sub (sub.id)}
                <div class="sub">
                  <input
                    type="checkbox"
                    checked={sub.done}
                    aria-label={sub.title}
                    on:change={() => toggleSubDone(m.id, sub.id)}
                  />
                  <span class="grow" class:strike={sub.done}>{sub.title}</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}

      {#if done.length}
        <div class="pad tight"><h2>Done · {done.length}</h2></div>
        {#each done as m (m.id)}
          <div class="card done-card">
            <div class="card-row">
              <div class="grow"><div class="title strike">{m.title}</div></div>
              <span class="muted small">{fmtEst(mainTotal(m, s, $nowMs))}</span>
              <button class="mini" title="Not actually done" on:click={() => reviveMain(m.id)}>
                ↺
              </button>
            </div>
          </div>
        {/each}
      {/if}

      <div class="pad">
        <input
          class="in"
          placeholder="Add a task, then press Enter"
          bind:value={draft}
          on:keydown={(e) => e.key === "Enter" && commitDraft()}
        />
      </div>
    </div>
  {/if}

  <!-- ================= FOOTER ================= -->
  {#if showFooter}
    <div class="foot">
      <button class="link" on:click={() => openDashboard("plan")}>Dashboard</button>
      <button class="link" on:click={() => setOverlay("backlog")}>Backlog</button>
      <span class="spacer"></span>
      <button class="link" on:click={() => setOverlay("endday")}>End day</button>
      <button class="link" on:click={quitApp}>Quit</button>
    </div>
  {/if}

  <!-- ================= OVERLAYS =================
       Rendered INSIDE .pop so the scrim is bounded by the window. -->
  {#if s.overlay === "checkin" && thing}
    <div class="scrim">
      <div class="sheet">
        <h3>Still on this?</h3>
        <p class="muted small">{thing.title} · {fmt(thingMs)}</p>
        <div class="stack">
          <button class="btn accent" on:click={closeOverlay}>Yes, still on it</button>
          <button class="btn" on:click={() => setOverlay("switch")}>No, I moved on</button>
          <button class="btn" on:click={() => startBreak(10)}>I need a break</button>
          <button class="link" on:click={muteCheckins}>Mute check-ins today</button>
        </div>
      </div>
    </div>
  {:else if s.overlay === "switch"}
    <div class="scrim">
      <div class="sheet">
        <h3>What are you on now?</h3>
        <div class="stack scroll-sm">
          {#each s.mains.filter((m) => !m.done && m.id !== s.activeMainId) as m (m.id)}
            <button class="btn" on:click={() => switchToMain(m.id, true)}>{m.title}</button>
          {/each}
          <input
            class="in"
            placeholder="Something else…"
            bind:value={interruptDraft}
            on:keydown={(e) => e.key === "Enter" && commitInterrupt()}
          />
          <button class="link" on:click={closeOverlay}>Cancel</button>
        </div>
      </div>
    </div>
  {:else if s.overlay === "done-choose"}
    <div class="scrim">
      <div class="sheet">
        <h3>Nice. What's next?</h3>
        <div class="stack scroll-sm">
          {#each s.mains.filter((m) => !m.done) as m (m.id)}
            <button class="btn" on:click={() => startTask(m.id)}>{m.title}</button>
          {/each}
          {#if !s.mains.some((m) => !m.done)}
            <p class="muted small">Everything on today's list is done.</p>
          {/if}
          <button class="btn ghost" on:click={() => startBreak(10)}>Take a break</button>
          <button class="link" on:click={closeOverlay}>Just stop for now</button>
        </div>
      </div>
    </div>
  {:else if s.overlay === "endday"}
    <div class="scrim">
      <div class="sheet">
        <h3>End the day?</h3>
        <p class="muted small">
          {fmtEst(tracked)} tracked · {done.length} done
          {#if s.mains.filter((m) => !m.done).length}
            · {s.mains.filter((m) => !m.done).length} will carry to tomorrow
          {/if}
        </p>
        <div class="stack">
          <button
            class="btn accent"
            on:click={() => {
              endDay();
              closeOverlay();
            }}>End day</button
          >
          <button class="btn" on:click={() => openDashboard("plan")}>Decide per task…</button>
          <button class="link" on:click={closeOverlay}>Not yet</button>
        </div>
      </div>
    </div>
  {:else if s.overlay === "restart"}
    <div class="scrim">
      <div class="sheet">
        <h3>Start today over?</h3>
        <p class="muted small">
          Clears today's tasks and timers. Your backlog, history and settings stay.
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
  {:else if s.overlay === "backlog"}
    <div class="scrim">
      <div class="sheet">
        <h3>Backlog</h3>
        <p class="muted small">Things for later. Nothing here is on today's list.</p>
        <div class="stack scroll-sm">
          {#each s.backlog as b (b.id)}
            <div class="card-row bl">
              <span class="grow">{b.title}</span>
              <button class="btn small" on:click={() => backlogToToday(b.id)}>→ Today</button>
              <button class="mini danger" title="Remove" on:click={() => deleteBacklog(b.id)}>
                ✕
              </button>
            </div>
          {/each}
          {#if !s.backlog.length}<p class="muted small">Empty.</p>{/if}
          <input
            class="in"
            placeholder="Add something for later…"
            bind:value={backlogDraft}
            on:keydown={(e) => e.key === "Enter" && commitBacklog()}
          />
          <button class="link" on:click={closeOverlay}>Close</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Wellness + welcome-back sit outside the overlay router: they are
       interruptions from the clock, not something the user navigated to. -->
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

  {#if $welcomeBack}
    <div class="scrim">
      <div class="sheet">
        <h3>Welcome back</h3>
        <p class="muted small">
          You were on "{$welcomeBack.title}" when Dopamigo last closed. Time was only
          counted up to the last save.
        </p>
        <div class="stack">
          <button class="btn accent" on:click={resumeWelcomeBack}>Pick it back up</button>
          <button class="btn" on:click={dismissWelcomeBack}>Something else</button>
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
  /* Layout only - all colour comes from the tokens in global.css. */
  .pop {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background: var(--bg);
    color: var(--ink);
  }
  .body,
  .scroll {
    flex: 1;
    overflow-y: auto;
  }
  .pad {
    padding: 10px 14px;
  }
  .pad.tight {
    padding-bottom: 2px;
  }
  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 9px;
    height: 100%;
    text-align: center;
    margin: auto;
  }
  .top,
  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    flex: none;
  }
  .top {
    border-bottom: 1px solid var(--line);
  }
  .foot {
    border-top: 1px solid var(--line);
  }
  .spacer {
    flex: 1;
  }
  .row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-top: 12px;
  }
  .scroll-sm {
    max-height: 340px;
    overflow-y: auto;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }

  h1 {
    font-size: 25px;
    margin: 2px 0;
    letter-spacing: -0.02em;
  }
  h2 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin: 0;
    color: var(--ink-soft);
  }
  h3 {
    font-size: 17px;
    margin: 0 0 3px;
    letter-spacing: -0.01em;
  }
  .eyebrow {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--ink-soft);
  }
  .muted {
    color: var(--ink-soft);
  }
  .small {
    font-size: 12px;
  }
  .strike {
    text-decoration: line-through;
    opacity: 0.6;
  }
  .path {
    font-family: var(--font-num);
    font-size: 11px;
    color: var(--ink-soft);
    overflow-wrap: anywhere;
    margin: 4px 0;
  }

  /* A hollow ring, matching the menu-bar mark. */
  .ring {
    width: 54px;
    height: 54px;
    border-radius: 50%;
    border: 5px solid var(--accent);
    opacity: 0.9;
  }

  .timer {
    font-family: var(--font-num);
    font-size: 33px;
    font-variant-numeric: tabular-nums;
    margin: 6px 0;
  }

  .hero {
    margin: 10px 14px 0;
    padding: 14px;
    border-radius: var(--r-lg);
    background: var(--hero-bg);
    border: 1px solid var(--hero-line);
  }
  .hero-title {
    font-size: 19px;
    font-weight: 620;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }

  .card {
    margin: 7px 14px;
    padding: 11px 12px;
    border-radius: var(--r-md);
    background: var(--card);
    border: 1px solid var(--line);
  }
  .card-row {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .card-row.bl {
    padding: 7px 0;
    border-bottom: 1px solid var(--line);
  }
  .title {
    font-weight: 560;
    overflow-wrap: anywhere;
  }
  .done-card {
    opacity: 0.65;
  }
  .card.warn {
    background: var(--warn-bg);
    border-color: var(--warn-line);
  }
  .note {
    font-size: 12px;
    color: var(--warn-ink);
    margin-top: 3px;
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

  .subs {
    margin-top: 9px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .sub {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
  }

  .brk {
    background: var(--break-bg);
    color: var(--break-ink);
  }

  /* Overlays are bounded by the popover, so the scrim is absolute not fixed. */
  .scrim {
    position: absolute;
    inset: 0;
    background: color-mix(in srgb, var(--ink) 42%, transparent);
    display: flex;
    align-items: flex-end;
    padding: 12px;
  }
  .sheet {
    width: 100%;
    padding: 15px;
    border-radius: var(--r-lg);
    background: var(--bg);
    border: 1px solid var(--line);
    box-shadow: 0 12px 34px color-mix(in srgb, var(--ink) 24%, transparent);
  }

  .toast {
    position: absolute;
    left: 14px;
    right: 14px;
    bottom: 50px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: var(--r-sm);
    background: var(--ink);
    color: var(--bg);
    font-size: 13px;
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

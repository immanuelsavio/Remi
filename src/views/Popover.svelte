<script lang="ts">
  /**
   * The tray popover: a 380x560 window that routes on `phase` and layers one
   * overlay on top.
   *
   * Full-repo equivalent: `showcase/Popover.svelte` + 6 views + 9 overlays + 7
   * shared components (~2500 lines). Here every phase and overlay is its own
   * component under `components/popover/`, wired up by this thin router.
   *
   * This window is the effect OWNER (`startClock({owner:true})`): it fires the
   * notifications, the reminders, the wellness nudges and the bounded check-ins,
   * and it owns the tray title. The dashboard is display-only.
   *
   * Every design token lives in `styles/global.css`, so both windows theme
   * identically.
   */
  import { onDestroy, onMount } from "svelte";
  import {
    app,
    boot,
    flushSave,
    initErrorCapture,
    initSync,
    registerQuitListener,
    startClock,
    stopClock,
    teardownQuitListener,
    teardownSync,
  } from "../store";
  import { computeStreaks, fmtEst, nowMs, todayTrackedMs } from "../view";

  import Recovery from "../components/popover/phases/Recovery.svelte";
  import Break from "../components/popover/phases/Break.svelte";
  import StartDay from "../components/popover/phases/StartDay.svelte";
  import Active from "../components/popover/phases/Active.svelte";
  import TaskList from "../components/popover/phases/TaskList.svelte";

  import Checkin from "../components/popover/overlays/Checkin.svelte";
  import Switch from "../components/popover/overlays/Switch.svelte";
  import DoneChoose from "../components/popover/overlays/DoneChoose.svelte";
  import EndDay from "../components/popover/overlays/EndDay.svelte";
  import Restart from "../components/popover/overlays/Restart.svelte";
  import Backlog from "../components/popover/overlays/Backlog.svelte";
  import Wellness from "../components/popover/overlays/Wellness.svelte";
  import WelcomeBack from "../components/popover/overlays/WelcomeBack.svelte";

  import Footer from "../components/popover/Footer.svelte";
  import Toast from "../components/popover/Toast.svelte";

  let ready = false;
  /** Shared between the Active hero's "Something came up" input and the
      Switch overlay - both bind to the same draft in the original file. */
  let interruptDraft = "";
  /** Lifted from the phase/overlay components: each is destroyed and
      recreated whenever `phase`/`overlay` changes away and back (e.g.
      starting a break, or closing and reopening the backlog overlay), but in
      the original single-file component these lived at the top level and
      survived those round trips. */
  let showInterrupt = false;
  let taskDraft = "";
  let backlogDraft = "";

  onMount(async () => {
    initErrorCapture();
    await boot();
    await initSync();
    // The popover owns background effects - see startClock's contract. It's
    // also the only window that hears the tray menu's quit-requested event
    // (see registerQuitListener), since it's always mounted.
    startClock({ owner: true });
    await registerQuitListener();
    ready = true;
    // Persist on the way out so nothing is lost if the process is killed.
    window.addEventListener("beforeunload", () => void flushSave());
  });

  onDestroy(() => {
    stopClock();
    teardownSync();
    teardownQuitListener();
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
</script>

<div class="pop">
  {#if !ready}
    <div class="center muted">Loading today…</div>

    <!-- ================= RECOVERY ================= -->
  {:else if s.phase === "recovery"}
    <Recovery />

    <!-- ================= BREAK ================= -->
  {:else if s.phase === "break"}
    <Break {breakLeft} />

    <!-- ================= START DAY ================= -->
  {:else if s.phase === "startday"}
    <StartDay {streaks} />
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
        <Active {active} {activeSub} {thing} {thingMs} bind:interruptDraft bind:showInterrupt />
      {/if}

      <TaskList {open} {done} bind:draft={taskDraft} />
    </div>
  {/if}

  <!-- ================= FOOTER ================= -->
  {#if showFooter}
    <Footer />
  {/if}

  <!-- ================= OVERLAYS =================
       Rendered INSIDE .pop so the scrim is bounded by the window. -->
  {#if s.overlay === "checkin" && thing}
    <Checkin {thing} {thingMs} />
  {:else if s.overlay === "switch"}
    <Switch bind:interruptDraft />
  {:else if s.overlay === "done-choose"}
    <DoneChoose />
  {:else if s.overlay === "endday"}
    <EndDay {tracked} {done} />
  {:else if s.overlay === "restart"}
    <Restart />
  {:else if s.overlay === "backlog"}
    <Backlog bind:backlogDraft />
  {/if}

  <!-- Wellness + welcome-back sit outside the overlay router: they are
       interruptions from the clock, not something the user navigated to. -->
  <Wellness />
  <WelcomeBack />
  <Toast />
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
  .body {
    flex: 1;
    overflow-y: auto;
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
  .top {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 14px;
    flex: none;
    border-bottom: 1px solid var(--line);
  }
  .spacer {
    flex: 1;
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
</style>

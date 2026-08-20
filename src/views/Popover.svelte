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
    setOverlay,
    startClock,
    stopClock,
    teardownQuitListener,
    teardownSync,
  } from "../store";
  import { computeStreaks, fmtEst, nowMs, todayTrackedMs } from "../view";
  import type { State } from "../view";

  import Recovery from "../components/popover/phases/Recovery.svelte";
  import Break from "../components/popover/phases/Break.svelte";
  import StartDay from "../components/popover/phases/StartDay.svelte";
  import Active from "../components/popover/phases/Active.svelte";
  import TaskList from "../components/popover/phases/TaskList.svelte";
  import TaskMap from "../components/popover/phases/TaskMap.svelte";

  import Checkin from "../components/popover/overlays/Checkin.svelte";
  import Switch from "../components/popover/overlays/Switch.svelte";
  import DoneChoose from "../components/popover/overlays/DoneChoose.svelte";
  import EndDay from "../components/popover/overlays/EndDay.svelte";
  import Restart from "../components/popover/overlays/Restart.svelte";
  import Backlog from "../components/popover/overlays/Backlog.svelte";
  import Wellness from "../components/popover/overlays/Wellness.svelte";
  import WelcomeBack from "../components/popover/overlays/WelcomeBack.svelte";

  import Footer from "../components/popover/Footer.svelte";
  import TopStrip from "../components/popover/TopStrip.svelte";
  import Toast from "../components/popover/Toast.svelte";
  import RemindSheet from "../components/shared/RemindSheet.svelte";

  let ready = false;
  /**
   * The TASK MAP is window-local UI, not a persisted phase.
   *
   * The showcase models it as `phase = "map"` with a `prevPhase` to get
   * back. Here that would write "map" into `state.json` and reopen the app
   * on a navigation screen days later - so it is a plain boolean instead,
   * and Back simply drops it, landing on whatever phase is actually current.
   */
  let showMap = false;
  /** The phase the map was opened from - see the reactive guard below. */
  let mapOpenedOn: State["phase"] | null = null;
  /** Shared between the Active screen and the Switch overlay - both write
      the same draft, as in the original single file. */
  let interruptDraft = "";
  /** Lifted from the phase/overlay components: each is destroyed and
      recreated whenever `phase`/`overlay` changes away and back (e.g.
      starting a break, or closing and reopening the backlog overlay), but in
      the original single-file component these lived at the top level and
      survived those round trips. */
  let taskDraft = "";
  let backlogDraft = "";
  let expandedId: string | null = null;

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
    // Best-effort ONLY - `beforeunload` cannot reliably await async work
    // before the webview tears down, so this is not the real persistence
    // barrier. The real guarantee is the quit-requested handshake (see
    // registerQuitListener): Rust asks the frontend to flush and waits for
    // it to explicitly call quit_app, rather than assuming any save here
    // landed.
    window.addEventListener("beforeunload", () => {
      void flushSave().catch(() => {
        /* best-effort; the quit handshake is the real barrier */
      });
    });
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
  /** Top-strip label: the day on the list screen, the task while working. */
  $: stripLabel =
    s.phase === "active" && active
      ? `${active.title}${activeSub ? " · step" : ""}`
      : `Day ${s.dayNum}${streaks.current > 1 ? ` · 🔥 ${streaks.current}` : ""} · ${fmtEst(tracked)}`;
  /**
   * Close the map when the PHASE changes underneath it.
   *
   * Compared against the phase captured when the map opened, not against
   * "any store update": `s` is a fresh object on every commit (each clock
   * checkpoint included), so a bare `$: showMap = false` would slam the map
   * shut a second after it opened.
   */
  $: if (showMap && s.phase !== mapOpenedOn) showMap = false;

  function openMap() {
    mapOpenedOn = s.phase;
    showMap = true;
  }
</script>

<div class="popover">
  {#if !ready}
    <div class="startday"><div class="lede">Loading today…</div></div>

    <!-- ================= RECOVERY ================= -->
  {:else if s.phase === "recovery"}
    <Recovery />

    <!-- ================= BREAK ================= -->
  {:else if s.phase === "break"}
    <Break {breakLeft} />

    <!-- ================= START DAY ================= -->
  {:else if s.phase === "startday"}
    <StartDay {streaks} />

    <!-- ================= TASK MAP ================= -->
  {:else if showMap}
    <TaskMap onBack={() => (showMap = false)} />
  {:else}
    <!-- ================= WORKING SCREENS ================= -->
    <div class="pop-body">
      <TopStrip label={stripLabel} onMap={openMap} />
      {#if s.phase === "active" && active && thing}
        <Active {active} {activeSub} {thing} {thingMs} />
      {:else}
        <TaskList bind:expandedId bind:draft={taskDraft} />
      {/if}
    </div>
    <Footer />
  {/if}

  <!-- ================= OVERLAYS =================
       Rendered INSIDE .popover so the scrim is bounded by the window. -->
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

  <!-- The reminder picker layers above whatever else is open, since it is
       raised FROM those screens. -->
  <RemindSheet />

  <!-- Wellness + welcome-back sit outside the overlay router: they are
       interruptions from the clock, not somewhere the user navigated. -->
  <Wellness />
  <WelcomeBack />
  <Toast />
</div>

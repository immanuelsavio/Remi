<script lang="ts">
  /**
   * The dashboard window (900x640): plan a day at desk scale, work it, and see
   * the evidence.
   *
   * Full-repo equivalent: `Dashboard.svelte` + 7 tab components + an import
   * modal (~1900 lines). Six tab components live under
   * `components/dashboard/tabs/`; this file is the thin router: tab strip,
   * lifecycle, derived state, and the shared overlays.
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
    app,
    boot,
    closeOverlay,
    dashTab,
    endDay,
    flushSave,
    getAutoUpdate,
    getDataFolder,
    initErrorCapture,
    initSync,
    reloadFromDisk,
    restartDay,
    startClock,
    startTask,
    stopClock,
    teardownSync,
    toast,
    trackTab,
    dismissWellness,
    snoozeWellness,
    wellnessCopy,
    wellnessNudge,
  } from "../store";
  import { computeStreaks, fmtEst, nowMs, todayISO, todayTrackedMs } from "../view";
  import type { DashTab, ParsedImport } from "../view";

  import Plan from "../components/dashboard/tabs/Plan.svelte";
  import Today from "../components/dashboard/tabs/Today.svelte";
  import Calendar from "../components/dashboard/tabs/Calendar.svelte";
  import Stats from "../components/dashboard/tabs/Stats.svelte";
  import Data from "../components/dashboard/tabs/Data.svelte";
  import Settings from "../components/dashboard/tabs/Settings.svelte";

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

  let dataFolder = "";
  let autoUpdate = false;

  // Draft/UI state for individual tabs, owned here (not in the tab
  // components) because each tab component is destroyed and recreated on
  // every switch - see the original single-file Dashboard, where all of this
  // lived at the top level and survived switching tabs.
  // Plan
  let planDraft = "";
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
  let confirmRestore = false;
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
        // queued debounce lands now rather than up to 250ms later. Best-effort:
        // the dashboard is display-only and not the effect owner, so it is
        // never the quit-handshake's flush path (see Popover.svelte).
        void flushSave().catch(() => {});
        void invoke("dashboard_closed").catch(() => {});
      });
    } catch {
      /* not in Tauri (browser dev) - live events still cover it */
    }

    // Best-effort ONLY - see Popover.svelte's beforeunload for why this is
    // not a real persistence barrier.
    window.addEventListener("beforeunload", () => void flushSave().catch(() => {}));
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
</script>

<div class="dash">
  <div class="head">
    <button
      class="brand"
      title="Go to Today"
      on:click={() => {
        dashTab.set("today");
        trackTab("today");
      }}
    >
      <span class="remi-mark"></span> Remi
    </button>
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
      <Plan bind:draft={planDraft} bind:stepDrafts bind:estDrafts bind:remindDrafts bind:noteOpen />

      <!-- ================= TODAY ================= -->
    {:else if tab === "today"}
      <Today {active} {activeSub} {thing} {live} {breakLeft} />

      <!-- ================= CALENDAR ================= -->
    {:else if tab === "calendar"}
      <Calendar bind:monthCursor />

      <!-- ================= STATS ================= -->
    {:else if tab === "stats"}
      <Stats />

      <!-- ================= DATA ================= -->
    {:else if tab === "data"}
      <Data {dataFolder} bind:importText bind:importPreview bind:restoreText bind:confirmRestore />

      <!-- ================= SETTINGS ================= -->
    {:else}
      <Settings {autoUpdate} bind:routinesText bind:confirmWipe />
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
          {fmtEst(tracked)} tracked · {s.mains.filter((m) => m.done).length} done. Anything unfinished
          carries to tomorrow, keeping its notes and steps.
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
    gap: 16px;
    padding: 0 20px;
    height: 56px;
    border-bottom: 1px solid var(--line);
    background: var(--bg-2);
    flex: none;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 17px;
    color: var(--ink);
    border: none;
    background: none;
    padding: 6px 4px;
    margin: 0 0 0 -4px;
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .brand:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .spacer {
    flex: 1;
  }
  .body {
    flex: 1;
    overflow-y: auto;
  }
  .pad {
    padding: 16px;
  }

  .tabs {
    display: flex;
    gap: 2px;
  }
  .tab {
    border: none;
    background: transparent;
    color: var(--ink-soft);
    font-family: var(--font-sans);
    font-weight: 600;
    font-size: 13.5px;
    padding: 9px 14px;
    border-radius: 8px;
    cursor: pointer;
  }
  .tab:hover:not(.on) {
    color: var(--ink);
  }
  .tab.on {
    background: var(--card);
    color: var(--ink);
    box-shadow: 0 2px 8px -4px rgba(0, 0, 0, 0.25);
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
  .grow {
    flex: 1;
    min-width: 0;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-top: 12px;
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

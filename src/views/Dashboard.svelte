<script lang="ts">
  /**
   * The dashboard window (900x640): plan a day at desk scale, work it, and see
   * the evidence.
   *
   * Seven tab components live under `components/dashboard/tabs/`; this file
   * is the thin router: tab strip, lifecycle, derived state, and the shared
   * overlays.
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
    addBacklog,
    backlogToToday,
    deleteBacklog,
    dismissWellness,
    snoozeWellness,
    wellnessCopy,
    wellnessNudge,
    appVersion,
    checkForUpdate,
    checkWhatsNew,
    loadAppVersion,
    startTour,
  } from "../store";
  import { computeStreaks, fmtEst, nowMs, todayISO, todayTrackedMs } from "../view";
  import type { DashTab } from "../view";

  import Plan from "../components/dashboard/tabs/Plan.svelte";
  import Today from "../components/dashboard/tabs/Today.svelte";
  import Calendar from "../components/dashboard/tabs/Calendar.svelte";
  import Stats from "../components/dashboard/tabs/Stats.svelte";
  import Data from "../components/dashboard/tabs/Data.svelte";
  import Notes from "../components/dashboard/tabs/Notes.svelte";
  import Settings from "../components/dashboard/tabs/Settings.svelte";
  import RemiMark from "../components/shared/RemiMark.svelte";
  import Mascot from "../components/shared/Mascot.svelte";
  import StartDayGate from "../components/dashboard/StartDayGate.svelte";
  import RoamingRemi from "../components/dashboard/RoamingRemi.svelte";
  import { mascotMood } from "../domain/mascot";
  import RemindSheet from "../components/shared/RemindSheet.svelte";
  import WhatsNew from "../components/dashboard/WhatsNew.svelte";
  import Tour from "../components/dashboard/Tour.svelte";

  const TABS: { id: DashTab; label: string }[] = [
    // Plan then Today: the order you actually move through a day.
    { id: "plan", label: "Plan" },
    { id: "today", label: "Today" },
    { id: "calendar", label: "Calendar" },
    { id: "stats", label: "Stats" },
    { id: "data", label: "Data" },
    { id: "notes", label: "Notes" },
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
  let stepDrafts: Record<string, string> = {};
  let estDrafts: Record<string, { h: number; m: number }> = {};
  // Overlays
  let backlogDraft = "";
  // Calendar
  let monthCursor = todayISO().slice(0, 7);
  // Data
  let importText = "";
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

    // Version, then the two version-dependent things. Both are best-effort
    // and neither blocks the UI: `checkWhatsNew` only speaks up after a real
    // version change, and the update check is silent unless there is news.
    await loadAppVersion();
    // First launch only. Never again unless asked for from Settings -
    // an onboarding flow that forgets it already ran is worse than none.
    if (!$app.tourSeen) startTour();
    void checkWhatsNew();
    // Honour the Settings toggle: "check automatically" has to actually
    // mean something, or it is just decoration. Manual checks from the Data
    // tab always run regardless.
    if (autoUpdate) void checkForUpdate(true);

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
  /**
   * The header mouse is the dashboard's equivalent of the menu-bar mark:
   * always present, and reporting the same thing the tray icon does. Every
   * other mount is tied to a screen you have to already be on, which left
   * an ordinary working day - tasks on the list, one of them running -
   * showing the mascot nowhere in this window at all.
   */
  $: headMood = mascotMood(s, $nowMs);

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
  <div class="dash-head">
    <button
      class="brand"
      title="Go to Today"
      on:click={() => {
        dashTab.set("today");
        trackTab("today");
      }}
    >
      {#if s.mascotOn}
        <Mascot mood={headMood} size={34} />
      {:else}
        <RemiMark size={22} />
      {/if}
      Remi
    </button>
    <div class="dtabs" role="tablist" aria-label="Dashboard sections">
      {#each TABS as t, i (t.id)}
        <button
          class="dtab"
          role="tab"
          id="tab-{t.id}"
          aria-selected={tab === t.id}
          aria-controls="panel"
          tabindex={tab === t.id ? 0 : -1}
          bind:this={tabRefs[i]}
          disabled={s.awaitingStart}
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
    <span class="hm">
      Day {s.dayNum} · {fmtEst(tracked)}
      {#if streaks.current > 1}· 🔥 {streaks.current}{/if}
    </span>
    <span class="beta" title="Remi {$appVersion} — still in beta">BETA</span>
  </div>

  <div class="dash-body" id="panel" role="tabpanel" aria-labelledby="tab-{tab}">
    {#if !ready}
      <div class="dsec-sub">Loading…</div>
    {:else if s.awaitingStart}
      <!-- The day has not begun. Nothing behind this gate is meaningful
           yet, and the carried tasks are the one thing that is. -->
      <StartDayGate />
    {:else if tab === "plan"}
      <Plan bind:stepDrafts bind:estDrafts />
    {:else if tab === "today"}
      <Today {active} {activeSub} {thing} {live} {breakLeft} />
    {:else if tab === "calendar"}
      <Calendar bind:monthCursor />
    {:else if tab === "stats"}
      <Stats />
    {:else if tab === "data"}
      <Data {dataFolder} bind:importText bind:restoreText bind:confirmRestore />
    {:else if tab === "notes"}
      <Notes />
    {:else}
      <Settings {autoUpdate} bind:routinesText bind:confirmWipe />
    {/if}
  </div>

  <!-- Wanders the bottom edge. Self-gating on `roamOn`, and its layer is
       pointer-events:none so it can never swallow a click. -->
  <RoamingRemi />

  <!-- ================= OVERLAYS =================
       Shared, so any tab can open them. "checkin" is deliberately absent: the
       popover owns bounded check-ins. -->
  {#if s.overlay === "endday"}
    <div class="scrim">
      <div class="sheet wide" role="dialog" aria-modal="true">
        <div class="s-in">
          <h3>End the day?</h3>
          <div class="s-text">
            {fmtEst(tracked)} tracked · {s.mains.filter((m) => m.done).length} done. Anything unfinished
            carries to tomorrow, keeping its notes and steps.
          </div>
          <button
            class="checkin-yes"
            on:click={() => {
              endDay();
              closeOverlay();
            }}>Wrap up the day</button
          >
          <button class="checkin-no" on:click={closeOverlay}>Not yet</button>
        </div>
      </div>
    </div>
  {:else if s.overlay === "restart"}
    <div class="scrim">
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="s-in">
          <h3>Start today over?</h3>
          <div class="s-text">
            Clears today's tasks and timers. Backlog, history and settings stay.
          </div>
          <button
            class="btn danger"
            style="width:100%; margin-top:16px;"
            on:click={() => {
              restartDay();
              closeOverlay();
            }}>Restart the day</button
          >
          <button class="checkin-no" on:click={closeOverlay}>Cancel</button>
        </div>
      </div>
    </div>
  {:else if s.overlay === "done-choose"}
    <div class="scrim">
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="s-in">
          <h3>Nice. What's next?</h3>
          <div class="pick-list">
            {#each s.mains.filter((m) => !m.done) as m (m.id)}
              <button class="pick" on:click={() => startTask(m.id)}>
                <span class="pick-head">
                  <span><span class="pt">{m.title}</span></span>
                  <span class="tag">start</span>
                </span>
              </button>
            {:else}
              <div class="s-text">Everything on today's list is done.</div>
            {/each}
          </div>
          <button class="checkin-no" style="margin-top:12px;" on:click={closeOverlay}>
            Just stop for now
          </button>
        </div>
      </div>
    </div>
  {:else if s.overlay === "backlog"}
    <div class="scrim">
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="s-in">
          <h3>Backlog</h3>
          <div class="s-text">Ideas and someday-tasks. Pull one into today when you're ready.</div>
          <div class="newmain-row">
            <input
              placeholder="Add to backlog…"
              autocomplete="off"
              bind:value={backlogDraft}
              on:keydown={(e) => {
                if (e.key !== "Enter" || !backlogDraft.trim()) return;
                addBacklog(backlogDraft);
                backlogDraft = "";
              }}
            />
            <button
              on:click={() => {
                if (!backlogDraft.trim()) return;
                addBacklog(backlogDraft);
                backlogDraft = "";
              }}>Add</button
            >
          </div>
          <div class="backlog-body" style="padding:10px 0 0;">
            {#each s.backlog as b (b.id)}
              <div class="bl-row">
                <span class="bt">{b.title}</span>
                <span class="rgt">
                  <button class="toToday" on:click={() => backlogToToday(b.id)}>→ Today</button>
                  <button
                    class="xdel"
                    title="Remove"
                    aria-label="Remove"
                    on:click={() => deleteBacklog(b.id)}>✕</button
                  >
                </span>
              </div>
            {:else}
              <div class="bl-empty">Empty — that's a good sign.</div>
            {/each}
          </div>
          <button class="checkin-no" on:click={closeOverlay}>Close</button>
        </div>
      </div>
    </div>
  {/if}

  <RemindSheet />
  <WhatsNew />
  <Tour />

  {#if $wellnessNudge}
    {@const c = wellnessCopy($wellnessNudge)}
    <div class="well-nudge" role="status">
      <span class="wn-ico" aria-hidden="true">{c.icon}</span>
      <span class="wn-body">
        <span class="wn-t">{c.title}</span>
        <span class="wn-m">{c.msg}</span>
      </span>
      <span class="wn-acts">
        <button class="wn-snooze" on:click={snoozeWellness}>Later</button>
        <button class="wn-ok" on:click={dismissWellness}>OK</button>
      </span>
    </div>
  {/if}

  {#if $toast}
    <div class="toast">
      <span class="tmsg">{$toast.msg}</span>
      {#if $toast.actionLabel}
        <button
          class="taction"
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
  .spacer {
    flex: 1;
  }
  /* Right-hand day summary in the header - the showcase's `.hist-head .hm`
     treatment, reused so the mono/faint register matches. */
  .hm {
    font-family: var(--font-num);
    font-size: 11px;
    color: var(--ink-faint);
    white-space: nowrap;
  }
  /* Says "don't trust this with anything precious yet" without nagging. */
  .beta {
    font-family: var(--font-num);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: #fff;
    background: var(--break);
    border-radius: 999px;
    padding: 3px 8px;
    flex: none;
  }
</style>

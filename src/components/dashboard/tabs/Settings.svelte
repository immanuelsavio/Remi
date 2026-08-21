<script lang="ts">
  import {
    app,
    dashTab,
    resetAndUninstall,
    startTour,
    setAccent,
    setAutoUpdate,
    setDayTarget,
    setFlag,
    setUserName,
    setMode,
    setPingMin,
    setStandardDaily,
    setWellnessEvery,
    setWellnessHour,
    setOverlay,
    toggleWellness,
    wellnessCopy,
    type BoolPref,
  } from "../../../store";
  import { ACCENTS, clockLabel } from "../../../view";
  import type { WellnessKey } from "../../../view";
  import Mascot from "../../shared/Mascot.svelte";
  import { NAME_MAX } from "../../../domain/name";

  export let autoUpdate: boolean;

  $: s = $app;

  // Lifted to the router and passed down bound: this tab is destroyed and
  // recreated on every tab switch, but in the original single-file component
  // these lived at the top level and survived switching tabs. routinesText's
  // initial value is seeded once by the router (mirroring the original's
  // onMount assignment from $app.standardDaily) rather than here, since this
  // component may be recreated many times after that initial seed.
  export let routinesText = "";
  export let confirmWipe = false;
  /** Ticked = the destructive path. Defaults off, deliberately. */
  let wipeHistory = false;

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

<div class="dsec-title">Settings</div>
<div class="dsec-sub">Everything you can control, in one place.</div>

<div class="settgrp">
  <h4>Help</h4>
  <div class="settrow">
    <div>
      <div class="st">Take the tour again</div>
      <div class="sd">
        A quick walk through adding tasks and steps, tagging, the clock, ending the day, reports and
        search. Runs once on a first launch; this is how you get it back.
      </div>
    </div>
    <button class="set-btn" on:click={startTour}>▸ Start the tour</button>
  </div>
</div>

<div class="settgrp">
  <h4>You</h4>
  <div class="settrow">
    <div>
      <div class="st">What should Remi call you?</div>
      <div class="sd">
        Used in greetings and a few bits of copy. Leave it empty and nothing anywhere says a name.
        Capped at {NAME_MAX} characters so it cannot push anything off screen.
      </div>
    </div>
    <input
      class="num-in"
      style="width:190px;"
      type="text"
      maxlength={NAME_MAX}
      placeholder="your name"
      value={s.userName}
      on:change={(e) => setUserName(e.currentTarget.value)}
      on:blur={(e) => setUserName(e.currentTarget.value)}
    />
  </div>
</div>

<div class="settgrp">
  <h4>Appearance</h4>
  <div class="settrow">
    <div>
      <div class="st">Mode</div>
      <div class="sd">Light or dark.</div>
    </div>
    <div class="seg-inline">
      <button class:on={s.mode === "light"} on:click={() => setMode("light")}>☀ Light</button>
      <button class:on={s.mode === "dark"} on:click={() => setMode("dark")}>☾ Dark</button>
    </div>
  </div>
  <div class="settrow">
    <div>
      <div class="st">Colour</div>
      <div class="sd">Remi's own accent comes from the app icon. Pick another if you'd rather.</div>
    </div>
    <div class="acc-swatches">
      {#each ACCENTS as [name, hex] (name)}
        <button
          class="acc-sw"
          class:on={s.accent === name}
          style="background:{hex}"
          title={name}
          aria-label={name}
          on:click={() => setAccent(name)}
        ></button>
      {/each}
    </div>
  </div>
  <div class="settrow">
    <div>
      <div class="st">Remi the mouse</div>
      <div class="sd">
        The mascot runs while your clock runs, sleeps through a break and cheers when the list is
        clear. Turn it off if movement in the corner of your eye is the last thing you need.
      </div>
    </div>
    <div class="mascot-pref">
      <!-- Live, not a still: the control shows you exactly what you are
           switching on, and disappears when you switch it off. -->
      <Mascot mood="run" size={56} />
      <input
        type="checkbox"
        checked={s.mascotOn}
        aria-label="Show the mascot"
        on:change={() => setFlag("mascotOn", !s.mascotOn)}
      />
    </div>
  </div>
  <div class="settrow">
    <div>
      <div class="st">Let Remi wander</div>
      <div class="sd">
        A mouse pottering along the bottom of this window that scurries to wherever you click.
        Purely for fun - it never covers anything and never swallows a click. Off by default,
        because movement in the corner of your eye is the exact thing this app is meant to protect.
      </div>
    </div>
    <input
      type="checkbox"
      checked={s.roamOn}
      disabled={!s.mascotOn}
      aria-label="Let Remi wander the dashboard"
      on:change={() => setFlag("roamOn", !s.roamOn)}
    />
  </div>
  <div class="settrow">
    <div>
      <div class="st">Wake-up sequence</div>
      <div class="sd">
        Starting your day wakes Remi first - it rubs its eyes and settles at its desk before the
        dashboard opens. Always skippable with a click. Turn this off to start instantly.
      </div>
    </div>
    <input
      type="checkbox"
      checked={s.wakeAnimation}
      disabled={!s.mascotOn}
      aria-label="Play the wake-up sequence"
      on:change={() => setFlag("wakeAnimation", !s.wakeAnimation)}
    />
  </div>
</div>

<div class="settgrp">
  <h4>Check-ins</h4>
  <div class="settrow">
    <div>
      <div class="st">Ping me while I work</div>
      <div class="sd">
        A gentle “still on this?” at 1×, 2× then 4× your interval, then it backs off for good.
      </div>
    </div>
    <div class="seg-inline">
      {#each [10, 15, 30, 0] as v (v)}
        <button class:on={s.pingMin === v} on:click={() => setPingMin(v)}>
          {v === 0 ? "Off" : `${v}m`}
        </button>
      {/each}
    </div>
  </div>
</div>

<div class="settgrp">
  <h4>Focus habits</h4>
  {#each FLAGS as f (f.key)}
    <div class="settrow">
      <div>
        <div class="st">{f.label}</div>
        <div class="sd">{f.hint}</div>
      </div>
      <input
        type="checkbox"
        checked={s[f.key]}
        aria-label={f.label}
        on:change={() => setFlag(f.key, !s[f.key])}
      />
    </div>
  {/each}
</div>

<div class="settgrp">
  <h4>Wellness nudges</h4>
  <div class="dsec-sub" style="margin:-2px 0 6px; font-size:11.5px;">
    Gentle, optional reminders to look after yourself. Off by default, one at a time, never during a
    break - and they never touch your task clock.
  </div>
  {#each WELLNESS_KEYS as key (key)}
    {@const c = s.wellness[key]}
    {@const copy = wellnessCopy(key)}
    <div class="settrow">
      <div>
        <div class="st">{copy.icon} {copy.title}</div>
        <div class="sd">{copy.msg}</div>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        {#if c.on && key === "lunch"}
          <select
            class="well-int"
            aria-label="Lunch hour"
            value={String(c.atHour ?? 13)}
            on:change={(e) => setWellnessHour(key, Number(e.currentTarget.value))}
          >
            {#each [11, 12, 13, 14] as h (h)}
              <option value={String(h)}>{clockLabel(h, 0)}</option>
            {/each}
          </select>
        {:else if c.on}
          <select
            class="well-int"
            aria-label="{copy.title} interval"
            value={String(c.everyMin ?? 60)}
            on:change={(e) => setWellnessEvery(key, Number(e.currentTarget.value))}
          >
            {#each [30, 45, 60, 90, 120] as o (o)}
              <option value={String(o)}>every {o < 60 ? `${o}m` : `${o / 60}h`}</option>
            {/each}
          </select>
        {/if}
        <input
          type="checkbox"
          checked={c.on}
          aria-label={copy.title}
          on:change={() => toggleWellness(key, !c.on)}
        />
      </div>
    </div>
  {/each}
</div>

<div class="settgrp">
  <h4>Day</h4>
  <div class="settrow">
    <div>
      <div class="st">Workday length</div>
      <div class="sd">Drives the “time given back” stat.</div>
    </div>
    <span class="num-field">
      <input
        class="num-in"
        type="number"
        min="1"
        max="16"
        step="0.5"
        aria-label="Workday length in hours"
        value={s.dayTargetMins / 60}
        on:change={(e) => setDayTarget(Math.round(Number(e.currentTarget.value) * 60))}
      />
      <span class="num-unit">hrs</span>
    </span>
  </div>
  <div class="settrow">
    <div>
      <div class="st">Streaks &amp; days off</div>
      <div class="sd">
        Mark PTO on the Calendar. Days off bridge your streak - they never break it.
      </div>
    </div>
    <button class="set-btn" on:click={() => dashTab.set("calendar")}>Open Calendar</button>
  </div>
  <div class="settrow">
    <div>
      <div class="st">Daily routines</div>
      <div class="sd">One per line. Added fresh to every new day, skipping anything carried.</div>
    </div>
  </div>
  <textarea class="imp-text" style="min-height:90px;" bind:value={routinesText}></textarea>
  <div class="bk-actions" style="margin-top:10px;">
    <button class="set-btn" on:click={() => setStandardDaily(routinesText.split("\n"))}>
      Save routines
    </button>
  </div>
</div>

<div class="settgrp">
  <h4>Updates</h4>
  <div class="settrow">
    <div>
      <div class="st">Check for updates automatically</div>
      <div class="sd">
        Looks for a new release when Remi starts. It never installs anything on its own - updating
        is always a button you press, on the Data tab.
      </div>
    </div>
    <input
      type="checkbox"
      checked={autoUpdate}
      aria-label="Automatic updates"
      on:change={async () => {
        autoUpdate = !autoUpdate;
        await setAutoUpdate(autoUpdate);
      }}
    />
  </div>
</div>

<div class="settgrp">
  <h4>Data</h4>
  <div class="settrow">
    <div>
      <div class="st">Version &amp; updates</div>
      <div class="sd">See what you're running, and take a new release when there is one.</div>
    </div>
    <button class="set-btn" on:click={() => dashTab.set("data")}>Open Data</button>
  </div>
  <div class="settrow">
    <div>
      <div class="st">Backup &amp; restore</div>
      <div class="sd">Export or restore your JSON on the Data tab.</div>
    </div>
    <button class="set-btn" on:click={() => dashTab.set("data")}>Open Data</button>
  </div>
  <div class="settrow">
    <div>
      <div class="st">Reset the day</div>
      <div class="sd">Clear today and start fresh (keeps backlog &amp; history).</div>
    </div>
    <button class="set-btn danger" on:click={() => setOverlay("restart")}>Restart day…</button>
  </div>
</div>

<div class="settgrp">
  <h4 style="color:var(--danger)">Danger zone</h4>
  {#if !confirmWipe}
    <div class="settrow">
      <div>
        <div class="st">Reset &amp; uninstall Remi</div>
        <div class="sd">
          Remove Remi's data and settings from this computer, then quit so you can delete the app.
        </div>
      </div>
      <button class="set-btn danger" on:click={() => (confirmWipe = true)}>
        Reset &amp; uninstall…
      </button>
    </div>
  {:else}
    <div class="bk-card" style="border-color:var(--danger);">
      <h4>Remove Remi's data from this machine?</h4>
      <p>This quits the app. Drag it to the Trash afterwards to finish removing it.</p>

      <!-- One question, asked plainly, rather than two buttons whose
           difference you have to infer from their labels. The destructive
           choice has to be TICKED before the destructive button appears. -->
      <label class="wipe-ask" class:armed={wipeHistory}>
        <input type="checkbox" bind:checked={wipeHistory} />
        <span>
          <span class="wa-l">Delete my history too</span>
          <span class="wa-h">
            {#if wipeHistory}
              Everything goes: days, streaks, backlog, notes, exports, your name and every setting.
              This cannot be undone.
            {:else}
              Your history, streaks, name and settings stay on this machine. Reinstall Remi and it
              picks up exactly where you left off.
            {/if}
          </span>
        </span>
      </label>

      <div class="bk-actions">
        <button class="set-btn" on:click={() => (confirmWipe = false)}>Cancel</button>
        <button
          class="set-btn"
          class:danger={wipeHistory}
          on:click={() => resetAndUninstall(!wipeHistory)}
        >
          {wipeHistory ? "Delete everything and quit" : "Uninstall, keep my history"}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .mascot-pref {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .wipe-ask {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    padding: 11px 13px;
    margin: 12px 0;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--card);
    cursor: pointer;
  }
  .wipe-ask.armed {
    border-color: var(--danger);
  }
  .wipe-ask input {
    margin-top: 2px;
    flex: none;
  }
  .wa-l {
    display: block;
    font-weight: 600;
    font-size: 13px;
    color: var(--ink);
  }
  .wa-h {
    display: block;
    font-size: 11.5px;
    color: var(--ink-soft);
    margin-top: 3px;
  }
</style>

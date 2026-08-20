<script lang="ts">
  import {
    app,
    dashTab,
    resetAndUninstall,
    setAccent,
    setAutoUpdate,
    setDayTarget,
    setFlag,
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
    break — and they never touch your task clock.
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
        Mark PTO on the Calendar. Days off bridge your streak — they never break it.
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
        Looks for a new release when Remi starts. It never installs anything on its own — updating
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
      <div class="bk-actions">
        <button class="set-btn" on:click={() => (confirmWipe = false)}>Cancel</button>
        <button class="set-btn" on:click={() => resetAndUninstall(true)}>Wipe, keep history</button>
        <button class="set-btn danger" on:click={() => resetAndUninstall(false)}>
          Remove everything
        </button>
      </div>
    </div>
  {/if}
</div>

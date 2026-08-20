<script lang="ts">
  import {
    app,
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
    toggleWellness,
    wellnessCopy,
    type BoolPref,
  } from "../../../store";
  import { ACCENTS } from "../../../view";
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

<div class="wrap">
  <h1>Settings</h1>

  <div class="line">
    <span class="grow">Appearance</span>
    <div class="seg">
      <button class="segbtn" class:on={s.mode === "light"} on:click={() => setMode("light")}>
        ☀ Light
      </button>
      <button class="segbtn" class:on={s.mode === "dark"} on:click={() => setMode("dark")}>
        ☾ Dark
      </button>
    </div>
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
      <div class="muted small">Stored for a future updater - this build does not self-update.</div>
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
      <p><b>Remove Remi's data from this machine?</b></p>
      <p class="muted small">
        This quits the app. Drag it to the Trash afterwards to finish removing it.
      </p>
      <div class="row">
        <button class="btn" on:click={() => (confirmWipe = false)}>Cancel</button>
        <button class="btn" on:click={() => resetAndUninstall(true)}> Wipe, keep history </button>
        <button class="btn danger-btn" on:click={() => resetAndUninstall(false)}>
          Remove everything
        </button>
      </div>
    </div>
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
  .row {
    display: flex;
    align-items: flex-end;
    gap: 9px;
    margin-top: 9px;
    flex-wrap: wrap;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 2px;
    border-bottom: 1px solid var(--line);
  }
  .card {
    margin: 11px 0;
    padding: 13px;
    border-radius: var(--r-md);
    background: var(--card);
    border: 1px solid var(--line);
  }
  .card.warn {
    background: var(--warn-bg);
    border-color: var(--warn-line);
  }
  .seg {
    display: flex;
    gap: 3px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px;
  }
  .segbtn {
    border: none;
    background: transparent;
    color: var(--ink-soft);
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: 999px;
    cursor: pointer;
  }
  .segbtn.on {
    background: var(--accent);
    color: #fff;
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
</style>

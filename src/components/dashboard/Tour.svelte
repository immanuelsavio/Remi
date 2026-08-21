<script lang="ts">
  /**
   * The guided tour, full screen.
   *
   * A full-height panel docked to one side, with the app live beside it.
   *
   * It was briefly a true full-screen overlay, which was a mistake: the
   * tour seeds a demo day precisely so there is something real to point at,
   * and covering the whole window hid the very thing being pointed at. It
   * was also a corner box before that, which was too cramped to ask
   * anything in.
   *
   * Docked full height is the resolution: room for the questions, and the
   * demo tasks stay visible and clickable the whole way through, so "try
   * adding a step" is an instruction you can actually follow.
   *
   * Two steps ASK instead of tell. Both bind straight to real settings, so
   * they always show what is currently true - which is what makes retaking
   * the tour a way to change your mind rather than a form that resets you.
   * Nothing on those steps is required: Next moves on whether or not
   * anything was touched.
   */
  import { onDestroy } from "svelte";

  import {
    app,
    endTour,
    setAccent,
    setFlag,
    setMode,
    setUserName,
    toggleWellness,
    wellnessCopy,
    tourBack,
    tourNext,
    tourStep,
  } from "../../store";
  import { NAME_MAX } from "../../domain/name";
  import { ACCENTS } from "../../view";
  import { stepAt, TOUR_LENGTH } from "../../domain/tour";
  import Mascot from "../shared/Mascot.svelte";

  $: s = $app;
  $: i = $tourStep;
  $: step = i === null ? null : stepAt(i);
  $: first = !s.tourSeen;

  // Shifts the dashboard clear of the docked panel while the tour is up, so
  // the demo tasks stay visible instead of hiding underneath it.
  $: if (typeof document !== "undefined") {
    document.body.classList.toggle("touring", i !== null);
  }

  onDestroy(() => {
    if (typeof document !== "undefined") document.body.classList.remove("touring");
  });

  /** The switches worth deciding up front. Everything else lives in Settings. */
  const PREFS = [
    {
      key: "notifyReminders",
      label: "Reminder notifications",
      hint: "A native banner when a reminder is due.",
    },
    {
      key: "privateNotifications",
      label: "Keep task names out of banners",
      hint: "Safer on a shared screen. The detail stays inside the app.",
    },
    {
      key: "trayTimer",
      label: "Show the timer in the menu bar",
      hint: "Ambient time awareness with nothing to click.",
    },
    {
      key: "loggingOptIn",
      label: "Anonymous usage counts",
      hint: "Buttons and screens only. Never task titles, notes or reminders. Nothing is transmitted.",
    },
  ] as const;

  const WELLNESS = ["water", "stand", "walk", "lunch", "breakr"] as const;

  function onKey(e: KeyboardEvent) {
    if (i === null) return;
    // Typing a name must not page the tour out from under you.
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
      if (e.key === "Enter") tourNext();
      return;
    }
    if (e.key === "Escape") endTour();
    if (e.key === "ArrowRight" || e.key === "Enter") tourNext();
    if (e.key === "ArrowLeft") tourBack();
  }
</script>

<svelte:window on:keydown={onKey} />

{#if i !== null && step}
  <div class="tourfull" role="dialog" aria-modal="true" aria-label="Guided tour">
    <div class="tf-top">
      <span class="tf-count">Step {i + 1} of {TOUR_LENGTH}</span>
      <button class="tf-x" aria-label="Close the tour" on:click={endTour}>✕</button>
    </div>

    <div class="tf-body">
      <div class="tf-card">
        <Mascot mood={step.ask ? "ready" : "idle"} size={110} />
        <h2>{step.title}</h2>
        {#each step.body as para (para)}
          <p>{para}</p>
        {/each}

        {#if step.ask === "name"}
          <div class="tf-ask">
            <!-- svelte-ignore a11y-autofocus -->
            <input
              class="tf-name"
              autofocus
              type="text"
              maxlength={NAME_MAX}
              placeholder="your name (optional)"
              value={s.userName}
              on:input={(e) => setUserName(e.currentTarget.value)}
            />
            <p class="tf-note">
              {#if s.userName}
                Remi will say "Good morning, {s.userName}".
              {:else}
                Left empty, nothing anywhere says a name.
              {/if}
            </p>
          </div>
        {:else if step.ask === "look"}
          <div class="tf-ask tf-prefs">
            <div class="tf-row">
              <span class="tp-l">Mode</span>
              <span class="seg-inline">
                <button class:on={s.mode === "light"} on:click={() => setMode("light")}>
                  ☀ Light
                </button>
                <button class:on={s.mode === "dark"} on:click={() => setMode("dark")}>☾ Dark</button
                >
              </span>
            </div>
            <div class="tf-row">
              <span class="tp-l">Colour</span>
              <span class="tf-sw">
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
              </span>
            </div>
            <label class="tf-pref">
              <input
                type="checkbox"
                checked={s.mascotOn}
                on:change={() => setFlag("mascotOn", !s.mascotOn)}
              />
              <span>
                <span class="tp-l">Show Remi</span>
                <span class="tp-h">The mouse that reports what the app is doing.</span>
              </span>
            </label>
          </div>
        {:else if step.ask === "prefs"}
          <div class="tf-ask tf-prefs">
            {#each PREFS as pref (pref.key)}
              <label class="tf-pref">
                <input
                  type="checkbox"
                  checked={s[pref.key]}
                  on:change={() => setFlag(pref.key, !s[pref.key])}
                />
                <span>
                  <span class="tp-l">{pref.label}</span>
                  <span class="tp-h">{pref.hint}</span>
                </span>
              </label>
            {/each}
            <p class="tf-sub">Wellness nudges</p>
            {#each WELLNESS as key (key)}
              {@const copy = wellnessCopy(key)}
              <label class="tf-pref">
                <input
                  type="checkbox"
                  checked={s.wellness[key].on}
                  on:change={() => toggleWellness(key, !s.wellness[key].on)}
                />
                <span>
                  <span class="tp-l">{copy.icon} {copy.title}</span>
                  <span class="tp-h">{copy.msg}</span>
                </span>
              </label>
            {/each}
            <p class="tf-note">
              {#if first}
                All off unless you say otherwise. They never touch your task clock.
              {:else}
                These are your current settings. Change what you like, or leave them and carry on.
              {/if}
            </p>
          </div>
        {/if}

        {#if step.aside}
          <p class="tf-aside">{step.aside}</p>
        {/if}
      </div>
    </div>

    <div class="tf-bar" aria-hidden="true">
      <span style="width:{((i + 1) / TOUR_LENGTH) * 100}%"></span>
    </div>

    <div class="tf-acts">
      <button class="tf-ghost" on:click={endTour}>
        {i === TOUR_LENGTH - 1 ? "Done" : "Skip the tour"}
      </button>
      <span class="tf-spacer"></span>
      {#if i > 0}
        <button class="tf-ghost" on:click={tourBack}>Back</button>
      {/if}
      <button class="tf-next" on:click={tourNext}>
        {i === TOUR_LENGTH - 1 ? "Finish" : "Next"}
      </button>
    </div>
  </div>
{/if}

<style>
  .tourfull {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(420px, 46vw);
    z-index: 300;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-right: 1px solid var(--line);
    box-shadow: 6px 0 26px rgba(0, 0, 0, 0.12);
  }
  /* Pushes the app clear of the panel so nothing important hides behind it,
     while leaving it fully visible and clickable. */
  :global(body.touring .dash-body) {
    padding-left: min(444px, calc(46vw + 24px));
  }
  .tf-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px 0;
  }
  .tf-count {
    font-family: var(--font-num);
    font-size: 10.5px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .tf-x {
    border: none;
    background: none;
    color: var(--ink-faint);
    font-size: 15px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 8px;
  }
  .tf-x:hover {
    color: var(--ink);
    background: var(--card);
  }
  .tf-body {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 24px;
    overflow-y: auto;
  }
  .tf-card {
    width: 100%;
    text-align: center;
  }
  .tf-card :global(.mascot) {
    margin: 0 auto 10px;
  }
  .tf-card h2 {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 21px;
    color: var(--ink);
    margin: 0 0 10px;
  }
  .tf-card p {
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--ink-soft);
    margin: 0 0 10px;
  }
  .tf-aside {
    font-size: 12px;
    color: var(--ink-faint);
    border-left: 2px solid var(--accent);
    padding-left: 10px;
    text-align: left;
    margin-top: 14px;
  }
  .tf-ask {
    margin: 16px 0 4px;
    text-align: left;
  }
  .tf-name {
    width: 100%;
    padding: 11px 13px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--card);
    color: var(--ink);
    font-size: 15px;
  }
  .tf-name:focus {
    outline: none;
    border-color: var(--accent);
  }
  .tf-note {
    font-size: 11.5px;
    color: var(--ink-faint);
    margin: 8px 0 0;
  }
  .tf-prefs {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tf-pref {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--card);
    cursor: pointer;
  }
  .tf-pref:hover {
    border-color: var(--accent);
  }
  .tf-pref input {
    margin-top: 2px;
    flex: none;
  }
  .tp-l {
    display: block;
    font-weight: 600;
    font-size: 13px;
    color: var(--ink);
  }
  .tp-h {
    display: block;
    font-size: 11.5px;
    color: var(--ink-soft);
    margin-top: 2px;
  }
  .tf-bar {
    height: 3px;
    background: var(--line);
    margin: 0 18px;
    border-radius: 2px;
    overflow: hidden;
  }
  .tf-bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 220ms ease;
  }
  .tf-acts {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 18px 18px;
  }
  .tf-spacer {
    flex: 1;
  }
  .tf-ghost,
  .tf-next {
    border-radius: 10px;
    padding: 9px 15px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink-soft);
  }
  .tf-ghost:hover {
    color: var(--ink);
    border-color: var(--accent);
  }
  .tf-next {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .tf-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--card);
  }
  .tf-sw {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
  }
  .tf-sub {
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-faint);
    margin: 12px 0 2px;
  }
</style>

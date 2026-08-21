<script lang="ts">
  /**
   * The guided tour, full screen.
   *
   * It began as a corner panel so it could point at a live screen without
   * covering it. That stopped being the right trade once the tour got its
   * own demo day: there is now nothing behind it worth peeking at during a
   * step, and a small box asking you to name yourself and set five
   * preferences reads like a cookie banner. Full screen gives the questions
   * room and makes the tour feel like a thing you are doing rather than a
   * thing nagging at you.
   *
   * Two steps ASK instead of tell. Both bind straight to real settings, so
   * they always show what is currently true - which is what makes retaking
   * the tour a way to change your mind rather than a form that resets you.
   * "Leave these as they are" is just Next; it is spelled out because a
   * screen full of switches otherwise implies you must touch them.
   */
  import { app, endTour, setFlag, setUserName, tourBack, tourNext, tourStep } from "../../store";
  import { NAME_MAX } from "../../domain/name";
  import { stepAt, TOUR_LENGTH } from "../../domain/tour";
  import Mascot from "../shared/Mascot.svelte";

  $: s = $app;
  $: i = $tourStep;
  $: step = i === null ? null : stepAt(i);
  $: first = !s.tourSeen;

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
      key: "mascotOn",
      label: "Show Remi",
      hint: "The mouse that reports what the app is doing.",
    },
    {
      key: "loggingOptIn",
      label: "Anonymous usage counts",
      hint: "Buttons and screens only. Never task titles, notes or reminders. Nothing is transmitted.",
    },
  ] as const;

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
            {#if !first}
              <p class="tf-note">
                These are your current settings. Change what you like, or leave them and carry on.
              </p>
            {/if}
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
        {#if i === TOUR_LENGTH - 1}
          Finish
        {:else if step.ask}
          Leave these as they are
        {:else}
          Next
        {/if}
      </button>
    </div>
  </div>
{/if}

<style>
  .tourfull {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    flex-direction: column;
    background: var(--bg);
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
    max-width: 560px;
    text-align: center;
  }
  .tf-card :global(.mascot) {
    margin: 0 auto 10px;
  }
  .tf-card h2 {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 26px;
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
</style>

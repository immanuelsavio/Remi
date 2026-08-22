<script lang="ts">
  /**
   * The guided tour, RENDERED.
   *
   * This file used to own the whole tour: navigation, timers, focus, DOM
   * automation, anchor searching and persistence. Eight fixes in an hour
   * came out of that, each one moving a symptom to a neighbour. It renders
   * now, and nothing else.
   *
   *   - navigation and beats: `store/tour.ts`, over the pure reducer in
   *     `domain/tour-nav.ts`
   *   - where to point: the registry in `store/tour-anchors.ts`, which
   *     elements write themselves into - no selectors, no polling
   *   - doing a beat: typed store commands, not synthetic keystrokes
   *
   * What is left here is genuinely view work: measuring the target,
   * choosing which side of it to sit on, and drawing the spotlight.
   *
   * Two shapes. A walkthrough step names an anchor and gets a bubble beside
   * it, with everything else blurred and still clickable - the tour asks
   * you to USE what it points at, so dimming must never become disabling.
   * A step that ASKS gets a centred card, because a speech bubble is a bad
   * container for a form.
   */
  import { onDestroy, onMount, tick } from "svelte";

  import {
    app,
    endTour,
    setAccent,
    setFlag,
    setMode,
    setCostume,
    setFullName,
    setUserName,
    toggleWellness,
    previewNotifications,
    setWellnessEvery,
    setWellnessHour,
    wellnessCopy,
    tourBack,
    tourNext,
    tourView,
    maybeAutoAdvance,
    openPopover,
    tourAnchors,
  } from "../../store";
  import { FULL_NAME_MAX, NAME_MAX } from "../../domain/name";
  import { ACCENTS, clockLabel } from "../../view";
  import { COSTUMES } from "../../domain/types";
  import Mascot from "../shared/Mascot.svelte";

  $: s = $app;
  $: v = $tourView;
  $: step = v.step;
  $: first = !s.tourSeen;

  /** A Svelte template cannot parse a TS `as` cast, so narrow here. */
  function pickCostume(val: string) {
    const found = COSTUMES.find(([k]) => k === val);
    if (found) setCostume(found[0]);
  }

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

  // ---- a modal owns the screen -------------------------------------------
  /**
   * A sheet or overlay is up, so the tour stands aside and goes inert.
   *
   * The controller works this out for itself (`tourPaused`); the view only
   * reads it. It used to be set from here, which meant the component wrote
   * a store it also read through `tourView` - and after one round trip
   * Svelte stopped updating, so the tour hid behind a sheet and never came
   * back when the sheet closed.
   */

  // ---- geometry -----------------------------------------------------------
  const BUBBLE_W = 330;
  const REMI_SIZE = 62;
  const GAP = 16;
  const MARGIN = 12;
  const SPEED = 620;

  type Side = "right" | "left" | "below" | "above";
  const SIDES: Side[] = ["right", "left", "below", "above"];

  let side: Side = "right";
  let gx = 0;
  let gy = 0;
  let ring: { x: number; y: number; w: number; h: number } | null = null;
  let groupH = REMI_SIZE;
  let placed = false;
  let walking = false;
  let walkMs = 0;
  let walkTimer: ReturnType<typeof setTimeout> | null = null;
  let scroller: HTMLElement | null = null;
  let follow: number | null = null;

  /**
   * The element this step points at, straight from the registry.
   *
   * The beat's own anchor is preferred; the step's is the fallback for a
   * beat whose control does not exist yet (press Next on "type a task"
   * without typing one and there is no task to add a step to). A fallback
   * is something to POINT at and nothing more - the controller never acts
   * on one.
   */
  $: wantKey = (step?.ask ? undefined : (v.beat?.anchor ?? step?.anchor)) ?? null;
  $: fallbackKey = step?.ask ? null : (step?.anchor ?? null);
  $: anchorEl =
    (wantKey && $tourAnchors[wantKey]) || (fallbackKey && $tourAnchors[fallbackKey]) || null;
  /** Pointing at the fallback, because the beat's own control is not there. */
  $: beatBlocked = !!v.beat?.anchor && !!anchorEl && anchorEl !== $tourAnchors[v.beat.anchor];

  /**
   * Which shape this step renders.
   *
   * There is deliberately no third "still looking" state. There was, and it
   * rendered NOTHING - so a search that ran long left the tour invisible
   * with the app showing through. The registry removes the wait entirely:
   * the element is either registered or it is not.
   */
  $: mode = !step ? "none" : !step.ask && anchorEl ? "walk" : "card";

  function reducedMotion(): boolean {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }

  const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));

  function moveTo(x: number, y: number) {
    const dist = Math.hypot(x - gx, y - gy);
    gx = x;
    gy = y;
    if (!placed || reducedMotion() || dist < 4) {
      placed = true;
      walking = false;
      walkMs = 0;
      return;
    }
    // Duration from DISTANCE, so speed is constant: a fixed duration makes
    // short hops crawl and long ones teleport, which reads as broken.
    walkMs = clamp((dist / SPEED) * 1000, 240, 900);
    walking = true;
    if (walkTimer) clearTimeout(walkTimer);
    walkTimer = setTimeout(() => (walking = false), walkMs);
  }

  function overlaps(x: number, y: number, w: number, h: number, r: DOMRect): boolean {
    return x < r.right && x + w > r.left && y < r.bottom && y + h > r.top;
  }

  /**
   * Sit beside the target, on whichever side has the most room.
   *
   * First-fit put the bubble in a sliver to the right while half the window
   * sat empty on the other side. Scoring by SLACK puts it where it is least
   * in the way, and a placement that would land on top of the target is
   * skipped rather than clamped onto it.
   */
  function measure() {
    const el = anchorEl;
    if (!el || !document.contains(el)) {
      ring = null;
      return;
    }
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const offScreen = r.bottom < 0 || r.top > vh;
    const top = clamp(r.top, 0, vh);
    const bottom = clamp(r.bottom, 0, vh);
    ring = offScreen
      ? null
      : { x: Math.max(0, r.left), y: top, w: Math.max(0, r.width), h: bottom - top };

    const groupW = BUBBLE_W + REMI_SIZE + 8;
    const h = Math.max(groupH, REMI_SIZE);
    const room: Record<Side, number> = {
      right: vw - r.right - GAP - MARGIN,
      left: r.left - GAP - MARGIN,
      below: vh - r.bottom - GAP - MARGIN,
      above: r.top - GAP - MARGIN,
    };
    const needs: Record<Side, number> = { right: groupW, left: groupW, below: h, above: h };
    const ranked = SIDES.slice().sort((a, b) => room[b] - needs[b] - (room[a] - needs[a]));

    const place = (which: Side) => {
      let x: number;
      let y: number;
      if (which === "right") {
        x = r.right + GAP;
        y = r.top + r.height / 2 - h / 2;
      } else if (which === "left") {
        x = r.left - GAP - groupW;
        y = r.top + r.height / 2 - h / 2;
      } else if (which === "below") {
        x = r.left + r.width / 2 - groupW / 2;
        y = r.bottom + GAP;
      } else {
        x = r.left + r.width / 2 - groupW / 2;
        y = r.top - GAP - h;
      }
      return { x: clamp(x, MARGIN, vw - groupW - MARGIN), y: clamp(y, MARGIN, vh - h - MARGIN) };
    };

    let chosen = ranked[0];
    let at = place(chosen);
    for (const cand of ranked) {
      const p = place(cand);
      if (room[cand] >= needs[cand] && !overlaps(p.x, p.y, groupW, h, r)) {
        chosen = cand;
        at = p;
        break;
      }
    }
    side = chosen;
    moveTo(at.x, at.y);
  }

  /**
   * Bring the target into view, then keep measuring until it settles.
   *
   * Smooth scrolling returns immediately and animates afterwards, so a
   * single measure right after reads the rect from BEFORE the scroll - off
   * screen for anything below the fold, which nulled the ring and took the
   * blur with it.
   */
  function reveal(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    if (r.top >= MARGIN && r.bottom <= window.innerHeight - MARGIN) return;
    try {
      el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
    } catch {
      el.scrollIntoView();
    }
    let frames = 0;
    const chase = () => {
      if (anchorEl !== el || frames++ > 45) return;
      measure();
      follow = requestAnimationFrame(chase);
    };
    follow = requestAnimationFrame(chase);
  }

  // Re-measure whenever the target, the bubble's height, or the step change.
  $: if (anchorEl) void reMeasure(anchorEl);
  async function reMeasure(el: HTMLElement) {
    await tick();
    measure();
    reveal(el);
  }
  $: if (groupH && anchorEl) measure();

  // Finishing the checklist may turn the page - the controller decides.
  $: if (v.allBeatsDone) maybeAutoAdvance();

  onMount(() => {
    scroller = document.querySelector<HTMLElement>(".dash-body");
    scroller?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
  });

  onDestroy(() => {
    scroller?.removeEventListener("scroll", measure);
    window.removeEventListener("resize", measure);
    if (walkTimer) clearTimeout(walkTimer);
    if (follow) cancelAnimationFrame(follow);
  });

  // ---- keyboard -----------------------------------------------------------
  let surface: HTMLElement | null = null;

  /**
   * Keys, scoped to the tour's own surface.
   *
   * A global handler over a live app is a trap. Enter used to page the tour
   * forward from any input anywhere - including the demo task box the step
   * points at, so following the instruction skipped the step that gave it.
   * Arrows navigated from ordinary app buttons. And all of it stayed live
   * while the tour was hidden behind a sheet.
   */
  function onKey(e: KeyboardEvent) {
    if (!v.active || v.paused) return;
    const el = e.target as HTMLElement | null;
    const mine = !!el && !!surface && surface.contains(el);
    const field = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
    const editing = field || (!!el && (el.tagName === "SELECT" || el.isContentEditable));

    if (e.key === "Enter") {
      // Only from a text field in the tour's own card, and never from a
      // button - the button's own click already fired.
      if (mine && field) tourNext();
      return;
    }
    if (e.key === "Escape") {
      // In an app field Escape means "cancel what I am typing".
      if (mine || !editing) endTour();
      return;
    }
    if (editing) return;
    // Arrows belong to the tour only while focus is inside it, or nowhere.
    if (el && el !== document.body && !mine) return;
    if (e.key === "ArrowRight") tourNext();
    if (e.key === "ArrowLeft") tourBack();
  }

  /**
   * Keep Tab inside a card while it claims to be modal.
   *
   * It declared `aria-modal` and trapped nothing, so Tab walked straight
   * out into the application behind it - which for a screen reader is a
   * dialog that lies about what it contains.
   */
  function onTrap(e: KeyboardEvent) {
    if (e.key !== "Tab" || !surface) return;
    const focusable = surface.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) return;
    const firstEl = focusable[0];
    const lastEl = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === firstEl) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && active === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  }
</script>

<svelte:window on:keydown={onKey} />

{#if v.active && step}
  {#if mode === "walk" && !v.paused}
    <!-- SPOTLIGHT + BUBBLE. The layer takes no pointer events, so the app
         underneath stays as clickable as it was. -->
    <div class="tour-layer">
      {#if ring}
        <!-- Four panels around the target rather than one overlay with a
             hole in it: a hole needs an SVG mask or a giant box-shadow, and
             neither can blur what is behind it. -->
        <div class="tour-dim" aria-hidden="true">
          <div style="left:0; top:0; right:0; height:{ring.y}px;"></div>
          <div style="left:0; top:{ring.y}px; width:{ring.x}px; height:{ring.h}px;"></div>
          <div style="left:{ring.x + ring.w}px; top:{ring.y}px; right:0; height:{ring.h}px;"></div>
          <div style="left:0; top:{ring.y + ring.h}px; right:0; bottom:0;"></div>
        </div>
        <div
          class="tour-ring"
          aria-hidden="true"
          style="left:{ring.x}px; top:{ring.y}px; width:{ring.w}px; height:{ring.h}px;"
        ></div>
      {/if}

      <div
        class="tour-group"
        class:on-left={side === "left"}
        class:stacked={side === "below" || side === "above"}
        bind:clientHeight={groupH}
        style="transform: translate3d({gx}px, {gy}px, 0); transition-duration: {walking
          ? walkMs
          : 0}ms;"
      >
        <div class="tour-remi" aria-hidden="true">
          <div class="tour-flip" style="transform: scaleX({side === 'left' ? 1 : -1});">
            <Mascot
              mood={walking ? "run" : (step.pose ?? "idle")}
              costume={step.costume ?? null}
              size={REMI_SIZE}
            />
          </div>
        </div>

        <div class="tour-bubble" bind:this={surface} role="dialog" aria-label="Guided tour">
          <div class="tb-top">
            <span class="tf-count">Step {v.progress.pos} of {v.progress.total}</span>
            <button class="tf-x" aria-label="Close the tour" on:click={endTour}>✕</button>
          </div>
          <h2>{step.title}</h2>
          {#each step.body as para (para)}
            <p>{para}</p>
          {/each}

          {#if v.beats.length}
            <!-- ONE instruction at a time. The ticks say how far through you
                 are without making you read four things. -->
            <div class="tb-beats">
              <span class="tb-dots" aria-hidden="true">
                {#each v.beats as b, bi (b.id)}
                  <i class:on={v.doneFlags[bi]}></i>
                {/each}
              </span>
              <span class="tb-count">{v.doneCount} of {v.beats.length}</span>
            </div>
            {#if v.lastDone}
              <p class="tb-cheer">✓ {v.lastDone.cheer}</p>
            {/if}
            {#if v.beat}
              <p class="tb-do">{v.beat.text}</p>
              {#if beatBlocked}
                <p class="tb-note">Not there yet - do the one before it first.</p>
              {/if}
            {:else}
              <p class="tb-do">That is a whole task. Everything else is a variation on it.</p>
            {/if}
          {/if}

          {#if step.aside}
            <p class="tf-aside">{step.aside}</p>
          {/if}
          <div class="tb-acts">
            <button class="tf-ghost sm" on:click={endTour}>Skip</button>
            <span class="tf-spacer"></span>
            <button class="tf-ghost sm" on:click={tourBack}>Back</button>
            <button class="tf-next sm" class:ready={v.allBeatsDone} on:click={tourNext}>
              {v.beat ? "Next" : v.lastStep ? "Finish" : "Next"}
            </button>
          </div>
          <div class="tf-bar" aria-hidden="true">
            <span style="width:{(v.progress.pos / v.progress.total) * 100}%"></span>
          </div>
        </div>
      </div>
    </div>
  {:else if mode === "card" && !v.paused}
    <!-- CARD: the steps that ask something, and the fallback for a walking
         step whose element is not on screen. -->
    <div class="tour-scrim">
      <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
      <div
        class="tourcard"
        bind:this={surface}
        role="dialog"
        aria-modal="true"
        aria-label="Guided tour"
        tabindex="-1"
        on:keydown={onTrap}
      >
        <div class="tf-top">
          <span class="tf-count">Step {v.progress.pos} of {v.progress.total}</span>
          <button class="tf-skip" on:click={endTour}>Skip tour</button>
          <button class="tf-x" aria-label="Close the tour" on:click={endTour}>✕</button>
        </div>

        <!-- OUTSIDE the scrolling body: as its first child the mouse
             scrolled away the moment a page had any height, so the costume
             picker was dressing something you had to scroll back up to see. -->
        <div class="tf-face">
          <Mascot
            mood={step.pose ?? (step.ask ? "ready" : "idle")}
            costume={step.costume ?? null}
            size={110}
          />
        </div>

        <div class="tf-body">
          <div class="tf-card">
            <h2>{step.title}</h2>
            {#each step.body as para (para)}
              <p>{para}</p>
            {/each}

            {#if step.ask === "nick"}
              <div class="tf-ask">
                <label class="tf-lbl" for="tour-nick">Nickname</label>
                <!-- svelte-ignore a11y-autofocus -->
                <input
                  id="tour-nick"
                  class="tf-name"
                  autofocus
                  type="text"
                  maxlength={NAME_MAX}
                  placeholder="Nickname"
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
            {:else if step.ask === "fullname"}
              <div class="tf-ask">
                <label class="tf-lbl" for="tour-full">Full Name</label>
                <!-- svelte-ignore a11y-autofocus -->
                <input
                  id="tour-full"
                  class="tf-name"
                  autofocus
                  type="text"
                  maxlength={FULL_NAME_MAX}
                  placeholder="Full Name"
                  value={s.fullName}
                  on:input={(e) => setFullName(e.currentTarget.value)}
                />
              </div>
            {:else if step.ask === "mascot"}
              <div class="tf-ask tf-prefs">
                <!-- Answering "no" here drops the two pages that follow, so
                     nobody is asked what an absent mouse should wear. -->
                <label class="tf-pref">
                  <input
                    type="checkbox"
                    checked={s.mascotOn}
                    on:change={() => setFlag("mascotOn", !s.mascotOn)}
                  />
                  <span>
                    <span class="tp-l">Show Remi</span>
                    <span class="tp-h">
                      {#if s.mascotOn}
                        On. The next two pages are about the outfit and the wandering.
                      {:else}
                        Off. The app runs exactly the same, without the mouse.
                      {/if}
                    </span>
                  </span>
                </label>
              </div>
            {:else if step.ask === "mouse"}
              <div class="tf-ask">
                <label class="tf-lbl" for="tour-costume">Outfit</label>
                <select
                  id="tour-costume"
                  class="tf-name"
                  value={s.mascotCostume}
                  on:change={(e) => pickCostume(e.currentTarget.value)}
                >
                  {#each COSTUMES as [key, label] (key)}
                    <option value={key}>{label}</option>
                  {/each}
                </select>
                <p class="tf-note">The mouse above is wearing it.</p>
                <label class="tf-pref">
                  <input
                    type="checkbox"
                    checked={s.roamOn}
                    on:change={() => setFlag("roamOn", !s.roamOn)}
                  />
                  <span>
                    <span class="tp-l">Let me wander the dashboard</span>
                    <span class="tp-h">Clicks pass straight through me.</span>
                  </span>
                </label>
              </div>
            {:else if step.ask === "look"}
              <div class="tf-ask tf-prefs">
                <div class="tf-row">
                  <span class="tp-l">Mode</span>
                  <span class="seg-inline">
                    <button class:on={s.mode === "light"} on:click={() => setMode("light")}>
                      ☀ Light
                    </button>
                    <button class:on={s.mode === "dark"} on:click={() => setMode("dark")}>
                      ☾ Dark
                    </button>
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
              </div>
            {:else if step.ask === "wellness"}
              <div class="tf-ask tf-prefs">
                {#each WELLNESS as key (key)}
                  {@const c = s.wellness[key]}
                  {@const copy = wellnessCopy(key)}
                  <!-- The interval appears the moment one is ticked. "Stand
                       up" without "how often" is half an answer, and finding
                       out it meant every 60 minutes only once it starts
                       interrupting you is the wrong time to find out. -->
                  <div class="tf-pref" class:on={c.on}>
                    <label class="tf-prefmain">
                      <input
                        type="checkbox"
                        checked={c.on}
                        on:change={() => toggleWellness(key, !c.on)}
                      />
                      <span>
                        <span class="tp-l">{copy.icon} {copy.title}</span>
                        <span class="tp-h">{copy.msg}</span>
                      </span>
                    </label>
                    {#if c.on && key === "lunch"}
                      <select
                        class="tf-when"
                        aria-label="{copy.title} time"
                        value={String(c.atHour ?? 13)}
                        on:change={(e) => setWellnessHour(key, Number(e.currentTarget.value))}
                      >
                        {#each [11, 12, 13, 14] as h (h)}
                          <option value={String(h)}>at {clockLabel(h, 0)}</option>
                        {/each}
                      </select>
                    {:else if c.on}
                      <select
                        class="tf-when"
                        aria-label="{copy.title} interval"
                        value={String(c.everyMin ?? 60)}
                        on:change={(e) => setWellnessEvery(key, Number(e.currentTarget.value))}
                      >
                        {#each [30, 45, 60, 90, 120] as o (o)}
                          <option value={String(o)}>every {o < 60 ? `${o}m` : `${o / 60}h`}</option>
                        {/each}
                      </select>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else if step.ask === "tray"}
              <div class="tf-ask">
                <button class="tf-send" on:click={openPopover}>Open it from the menu bar</button>
                <p class="tf-note">
                  It drops down under the mouse in your menu bar. Click anywhere else and it goes
                  away again - your work carries on either way.
                </p>
              </div>
            {:else if step.ask === "notify"}
              <div class="tf-ask">
                <button class="tf-send" on:click={previewNotifications}>
                  Send me a deadline and a water nudge
                </button>
                <p class="tf-note">
                  Two real notifications, a second apart - the kind a deadline sends, then the kind
                  a wellness nudge sends. The second also shows the in-app card, since that one
                  arrives both ways.
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
                <p class="tf-note">
                  {#if first}
                    Reminders and the menu-bar timer start on; the rest are yours to choose.
                  {:else}
                    These are your current settings. Change what you like, or leave them and carry
                    on.
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
          <span style="width:{(v.progress.pos / v.progress.total) * 100}%"></span>
        </div>

        <div class="tf-acts">
          <button class="tf-ghost" on:click={endTour}>
            {v.lastStep ? "Done" : "Skip the tour"}
          </button>
          <span class="tf-spacer"></span>
          <button class="tf-ghost" on:click={tourBack}>Back</button>
          <button class="tf-next" on:click={tourNext}>
            {v.lastStep ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}

<style>
  /* ================= WALKING ================= */
  /* Takes NO pointer events: the tour points at things you are meant to be
     able to press, so the layer must never stand between you and them. The
     bubble takes them back for its own buttons. */
  .tour-layer {
    position: fixed;
    inset: 0;
    z-index: 300;
    pointer-events: none;
  }
  /* Everything that is NOT the target, softened. Blur rather than a heavy
     dim: the surroundings stay recognisable as context while stopping
     being somewhere the eye can land. */
  .tour-dim > div {
    position: absolute;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(2.5px);
    transition:
      left 220ms ease,
      top 220ms ease,
      width 220ms ease,
      height 220ms ease;
  }
  /* The thing being described, ringed inside the gap in the blur. */
  .tour-ring {
    position: absolute;
    border: 2px solid var(--accent);
    border-radius: 12px;
    box-shadow:
      0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent),
      0 8px 26px -12px rgba(0, 0, 0, 0.5);
    transition:
      left 220ms ease,
      top 220ms ease,
      width 220ms ease,
      height 220ms ease;
  }
  .tour-group {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    transition-property: transform;
    transition-timing-function: cubic-bezier(0.34, 0.02, 0.28, 1);
    will-change: transform;
  }
  /* Standing on the far side, so the mouse is always between the bubble and
     the thing it is pointing at. */
  .tour-group.on-left {
    flex-direction: row-reverse;
  }
  .tour-group.stacked {
    align-items: flex-end;
  }
  .tour-remi {
    flex: none;
  }
  .tour-flip {
    transition: transform 160ms ease;
  }
  .tour-bubble {
    pointer-events: auto;
    width: 330px;
    box-sizing: border-box;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 12px 14px 10px;
    box-shadow: 0 18px 44px -18px rgba(0, 0, 0, 0.55);
  }
  .tb-top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .tb-top .tf-count {
    margin-right: auto;
  }
  .tour-bubble h2 {
    font-family: var(--font-serif);
    font-weight: 600;
    font-size: 16px;
    color: var(--ink);
    margin: 0 0 6px;
  }
  .tour-bubble p {
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--ink-soft);
    margin: 0 0 8px;
  }
  /* The checklist: a row of ticks, then the ONE thing to do next. */
  .tb-beats {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 0 6px;
  }
  .tb-dots {
    display: flex;
    gap: 4px;
  }
  .tb-dots i {
    width: 18px;
    height: 4px;
    border-radius: 2px;
    background: var(--line);
    transition: background 200ms ease;
  }
  .tb-dots i.on {
    background: var(--accent);
  }
  .tb-count {
    font-family: var(--font-num);
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .tour-bubble .tb-cheer {
    font-size: 12px;
    color: var(--success-ink);
    margin: 0 0 4px;
  }
  .tour-bubble .tb-note {
    font-size: 11.5px;
    color: var(--ink-faint);
    margin: 0 0 4px;
  }
  .tour-bubble .tb-do {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ink);
    margin: 0 0 4px;
  }
  /* Once every beat is done, Next is the obvious thing to press. */
  .tf-next.ready {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .tf-send {
    width: 100%;
    padding: 11px 13px;
    border: 1px solid var(--accent);
    border-radius: 10px;
    background: var(--accent);
    color: #fff;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .tf-send:hover {
    filter: brightness(1.06);
  }
  .tb-acts {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 10px 0 8px;
  }
  .sm {
    padding: 6px 11px !important;
    font-size: 12px !important;
  }
  .tour-bubble .tf-bar {
    margin: 0;
  }

  /* ================= CARD ================= */
  /* Soft, not opaque: the demo day the tour is describing stays readable
     behind the questions. */
  /* The same treatment the walking steps get. A card step has nothing to
     point at, so everything behind it is "does not have to be seen" - and
     a plain dim here next to a blur there made the tour look like two
     different things depending on which page you were on. */
  .tour-scrim {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(20, 16, 12, 0.34);
    backdrop-filter: blur(2.5px);
  }
  .tourcard {
    width: min(520px, 100%);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 18px;
    box-shadow: var(--shadow);
  }
  .tf-top {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 18px 0;
  }
  .tf-top .tf-count {
    margin-right: auto;
  }
  .tf-skip {
    border: 1px solid var(--line);
    background: var(--card);
    color: var(--ink-soft);
    border-radius: 999px;
    padding: 4px 11px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .tf-skip:hover {
    color: var(--ink);
    border-color: var(--accent);
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
  /* Fixed height so the mouse does not jump between pages as the body
     under it grows and shrinks. */
  .tf-face {
    flex: none;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    height: 118px;
    padding-top: 6px;
  }
  .tf-body {
    flex: 1;
    min-height: 0;
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
    margin: 10px 0 18px;
  }
  .tf-lbl {
    display: block;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--ink-faint);
    margin-bottom: 6px;
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
  /* A wellness row is a label AND a picker, so the label takes the click
     and the row is the container. */
  .tf-pref.on {
    border-color: var(--accent);
    flex-wrap: wrap;
  }
  .tf-prefmain {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    flex: 1;
    min-width: 0;
    cursor: pointer;
  }
  .tf-when {
    flex: none;
    align-self: center;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--font-num);
    font-size: 11.5px;
    padding: 5px 7px;
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

  @media (prefers-reduced-motion: reduce) {
    .tour-group,
    .tour-ring,
    .tour-flip,
    .tour-dim > div {
      transition: none !important;
    }
  }
</style>

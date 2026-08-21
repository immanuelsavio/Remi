<script lang="ts">
  /**
   * REMI, animated.
   *
   * Remi is already a mouse — it is on the app icon, in the menu bar and
   * curled over the check-ring in the wordmark. This is that same mouse
   * drawn as live SVG so it can *move*, and what it does is not decoration:
   * the pose is a readout of what the app is doing.
   *
   *   run    the clock is running — legs going, dust kicking up
   *   idle   the day is open, nothing is timed — sitting, breathing, waiting
   *   sleep  on a break — curled up, z's rising, clock genuinely paused
   *   cheer  the day is done — a hop, once, and then it holds
   *
   * That mapping is the point. A running mouse in the corner of the popover
   * says "time is being spent" faster than a number does, which matters when
   * the whole app exists for people whose sense of elapsed time is unreliable.
   *
   * Two ways to make it stop, and they compose rather than override:
   *   - `mascotOn` in Settings hides it completely (this component self-gates,
   *     so call sites do not each repeat the check)
   *   - `prefers-reduced-motion` at the OS level freezes it mid-pose; the
   *     global rule in `global.css` handles that for every animation in the
   *     app, which is why there is no media query here.
   *
   * Palette is the brand's three colours, hard-coded rather than themed:
   * this is the *logo animal*, and a mouse that changes colour with the
   * accent picker stops being the thing on the icon. The warm outline is
   * what keeps a cream body visible on a white background.
   */
  import { app } from "../../store";

  /** Local, not exported: a Svelte instance script cannot export a type,
      and no call site needs to name it - they all pass a literal. */
  type Mood = "run" | "idle" | "sleep" | "cheer" | "wake" | "desk";

  /** What the mouse is doing. Mirrors the app's own state at the call site. */
  export let mood: Mood = "idle";
  /** Rendered width in px; the drawing scales with it. */
  export let size = 64;
  /**
   * Accessible label. Empty (the default) marks it decorative — which is
   * usually right, because every screen that shows it also *says* in text
   * what is happening. Pass a label only where the mouse is the sole
   * indicator.
   */
  export let label = "";

  $: on = $app.mascotOn;
</script>

{#if on}
  <svg
    class="mascot {mood}"
    viewBox="0 0 96 64"
    width={size}
    height={(size * 64) / 96}
    role={label ? "img" : "presentation"}
    aria-label={label || undefined}
    aria-hidden={label ? undefined : "true"}
  >
    <!-- Dust kicked up behind a running mouse. Present in the markup for
         every mood and revealed by CSS, so switching moods never has to
         rebuild the tree. -->
    <g class="dust">
      <circle class="d1" cx="24" cy="52" r="3" />
      <circle class="d2" cx="16" cy="49" r="2.2" />
      <circle class="d3" cx="9" cy="51" r="1.6" />
    </g>

    <!-- Sleep only: three z's drifting up off the ear. -->
    <g class="zzz" aria-hidden="true">
      <text class="z1" x="70" y="17">z</text>
      <text class="z2" x="78" y="10">z</text>
      <text class="z3" x="86" y="4">z</text>
    </g>

    <g class="whole">
      <!-- Tail: one stroke, anchored at the rump so it can sweep. -->
      <path class="tail" d="M24 45 C 13 46, 7 39, 11 33 C 13 30, 17 30, 18 33" />

      <!-- Back legs, then body, then front legs: the near pair has to sit
           over the body or the mouse looks flat. -->
      <g class="leg back">
        <path class="l-b1" d="M32 49 L29 58" />
        <path class="l-b2" d="M39 50 L42 58" />
      </g>

      <g class="body">
        <!-- One blob tapering to a snout on the right. A mouse has no
             visible neck, so head and body are a single silhouette and the
             taper is what makes it point somewhere. -->
        <path
          class="hull"
          d="M84 38
             C 78 27, 66 22, 52 21
             C 34 20, 21 27, 21 39
             C 21 50, 34 55, 52 54
             C 68 53, 79 46, 84 38 Z"
        />

        <g class="ear">
          <circle class="ear-out" cx="52" cy="17" r="10" />
          <circle class="ear-in" cx="52" cy="17" r="5.8" />
        </g>

        <!-- The closed, contented eye from the wordmark. It opens (a dot)
             only when the mouse is running, because a sprint with your eyes
             shut reads as unconscious rather than busy. -->
        <path class="eye-shut" d="M64 33 q 4 4.5 8 0" />
        <circle class="eye-open" cx="68" cy="33" r="2.4" />

        <path class="nose" d="M83.4 38 a 2.5 2.5 0 1 0 0.01 0" />

        <!-- The eye-rubbing paw. A dedicated shape, not a rotated leg: a
             limb swung from the hip never actually reaches the face, it
             just waves somewhere near it. This lands on the eye. -->
        <ellipse class="rubpaw" cx="66" cy="40" rx="4.6" ry="3.6" />

        <g class="whiskers">
          <path d="M82 36 L 95 30" />
          <path d="M83 39 L 96 39" />
          <path d="M82 41 L 94 47" />
        </g>
      </g>

      <g class="leg front">
        <path class="l-f1" d="M62 51 L59 59" />
        <path class="l-f2" d="M69 49 L72 57" />
      </g>
    </g>

    <!-- The desk, painted AFTER the mouse so it OCCLUDES the lower body -
         that overlap is the whole reason it reads as "sitting at" rather
         than "lying next to". The paws rest on top of it. -->
    <g class="deskset" aria-hidden="true">
      <rect class="dk-screen" x="72" y="18" width="22" height="18" rx="2.5" />
      <rect class="dk-stand" x="81" y="36" width="4" height="8" rx="1" />
      <rect class="dk-top" x="26" y="44" width="70" height="4.5" rx="2.2" />
      <rect class="dk-leg" x="31" y="48" width="3.4" height="14" rx="1.7" />
      <rect class="dk-leg" x="89" y="48" width="3.4" height="14" rx="1.7" />
      <!-- Paws on the desktop, clear of the body so they read as paws and
           not as part of the silhouette. -->
      <ellipse class="dk-paw p1" cx="63" cy="41.5" rx="4.2" ry="3" />
      <ellipse class="dk-paw p2" cx="72" cy="41.5" rx="4.2" ry="3" />
    </g>
  </svg>
{/if}

<style>
  /* Brand palette, scoped to the drawing. Named here rather than reaching
     for the theme tokens on purpose - see the header note. */
  .mascot {
    --fur: #f7efe6;
    --fur-line: #c9ae95;
    --coral: #ec6a4a;
    --teal: #2b8794;
    display: block;
    flex: none;
    overflow: visible;
  }

  .hull {
    fill: var(--fur);
    stroke: var(--fur-line);
    stroke-width: 2;
  }
  .ear-out {
    fill: var(--fur);
    stroke: var(--fur-line);
    stroke-width: 2;
  }
  .ear-in {
    fill: var(--coral);
  }
  .nose {
    fill: var(--coral);
  }
  .tail,
  .leg path {
    fill: none;
    stroke: var(--fur-line);
    stroke-width: 3.4;
    stroke-linecap: round;
  }
  .eye-shut,
  .whiskers path {
    fill: none;
    stroke: var(--teal);
    stroke-width: 2.2;
    stroke-linecap: round;
  }
  .whiskers path {
    stroke-width: 1.6;
    opacity: 0.75;
  }
  .eye-open {
    fill: var(--teal);
    opacity: 0;
  }
  .dust circle {
    fill: var(--fur-line);
    opacity: 0;
  }
  .zzz text {
    fill: var(--teal);
    font-family: var(--font-serif, Georgia, serif);
    font-size: 13px;
    font-weight: 700;
    opacity: 0;
  }

  /* `view-box` lets transform-origin be given in the SVG's own coordinates,
     which is the only way to pivot a leg about its hip without wrapping
     every limb in its own nested <svg>. */
  .whole,
  .body,
  .ear,
  .tail,
  .leg path,
  .dust circle,
  .zzz text,
  .rubpaw,
  .dk-paw {
    transform-box: view-box;
    transform-origin: center;
  }
  .tail {
    transform-origin: 24px 45px;
  }
  .ear {
    transform-origin: 52px 26px;
  }
  .l-b1,
  .l-b2 {
    transform-origin: 35px 49px;
  }
  .l-f1,
  .l-f2 {
    transform-origin: 65px 50px;
  }

  /* The desk is hidden unless the mouse is actually at it. */
  .deskset {
    opacity: 0;
    pointer-events: none;
  }
  .dk-top,
  .dk-leg,
  .dk-stand {
    fill: var(--fur-line);
  }
  .dk-screen {
    fill: var(--card, #fff);
    stroke: var(--teal);
    stroke-width: 2.4;
  }
  .dk-paw {
    fill: var(--fur);
    stroke: var(--fur-line);
    stroke-width: 1.6;
  }
  /* The eye-rubbing paw: hidden except during `wake`. */
  .rubpaw {
    fill: var(--fur);
    stroke: var(--fur-line);
    stroke-width: 1.6;
    opacity: 0;
  }

  /* --------------------------------------------------------------- wake */
  /* Stirs, stretches, and rubs one eye with a front paw. The eye opens
     partway through - waking up is the transition, so it has to show both
     ends of it. */
  .wake .body {
    animation: m-stir 1.9s ease-in-out both;
  }
  .wake .ear {
    animation: m-perk 1.9s ease-out both;
  }
  .wake .rubpaw {
    animation: m-rub 1.9s ease-in-out both;
  }
  .wake .tail {
    animation: m-tail-slow 1.9s ease-in-out both;
  }
  .wake .eye-shut {
    animation: m-eye-close-out 1.9s steps(1, end) both;
  }
  .wake .eye-open {
    animation: m-eye-open-in 1.9s steps(1, end) both;
  }

  @keyframes m-stir {
    0% {
      transform: translateY(3px) scale(1);
    }
    35% {
      transform: translateY(1px) scale(1.06, 0.95);
    }
    70% {
      transform: translateY(-1px) scale(0.98, 1.05);
    }
    100% {
      transform: translateY(0) scale(1);
    }
  }
  @keyframes m-perk {
    0%,
    30% {
      transform: rotate(-16deg);
    }
    60% {
      transform: rotate(6deg);
    }
    100% {
      transform: rotate(0deg);
    }
  }
  /* The paw rises to the eye, scrubs twice in a small circle, drops. */
  @keyframes m-rub {
    0%,
    16% {
      opacity: 0;
      transform: translate(0, 6px);
    }
    26% {
      opacity: 1;
      transform: translate(0, -5px);
    }
    40% {
      transform: translate(3px, -7px);
    }
    52% {
      transform: translate(-2px, -5px);
    }
    64% {
      transform: translate(3px, -7px);
    }
    76% {
      opacity: 1;
      transform: translate(0, -5px);
    }
    92%,
    100% {
      opacity: 0;
      transform: translate(0, 6px);
    }
  }
  @keyframes m-eye-close-out {
    0%,
    64% {
      opacity: 1;
    }
    65%,
    100% {
      opacity: 0;
    }
  }
  @keyframes m-eye-open-in {
    0%,
    64% {
      opacity: 0;
    }
    65%,
    100% {
      opacity: 1;
    }
  }

  /* --------------------------------------------------------------- desk */
  .desk .deskset {
    opacity: 1;
    animation: m-fade-in 0.45s ease-out both;
  }
  /* Shifted left and up so the head clears the desk line and the snout
     points at the screen instead of through it. */
  .desk .whole {
    transform: translate(-20px, -8px) scale(0.9);
  }
  .desk .p1 {
    animation: m-tap 0.44s ease-in-out infinite;
  }
  .desk .p2 {
    animation: m-tap 0.44s ease-in-out infinite;
    animation-delay: -0.22s;
  }
  .desk .eye-open {
    opacity: 1;
  }
  .desk .eye-shut {
    opacity: 0;
  }
  .desk .body {
    animation: m-type-lean 1.6s ease-in-out infinite;
  }

  .desk .ear {
    animation: m-twitch 5.3s ease-in-out infinite;
  }
  .desk .tail {
    animation: m-tail-slow 3.4s ease-in-out infinite;
  }

  @keyframes m-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes m-type-lean {
    0%,
    100% {
      transform: rotate(0deg) translateY(0);
    }
    50% {
      transform: rotate(-1.5deg) translateY(-0.8px);
    }
  }
  @keyframes m-tap {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-2.2px);
    }
  }

  /* ---------------------------------------------------------------- run */
  .run .body {
    animation: m-bob 0.34s ease-in-out infinite;
  }
  .run .l-b1,
  .run .l-f2 {
    animation: m-stride 0.34s linear infinite;
  }
  .run .l-b2,
  .run .l-f1 {
    animation: m-stride 0.34s linear infinite;
    animation-delay: -0.17s;
  }
  .run .tail {
    animation: m-tail-fast 0.34s ease-in-out infinite;
  }
  .run .ear {
    animation: m-ear-flap 0.34s ease-in-out infinite;
  }
  .run .eye-open {
    opacity: 1;
  }
  .run .eye-shut {
    opacity: 0;
  }
  .run .d1 {
    animation: m-dust 0.6s linear infinite;
  }
  .run .d2 {
    animation: m-dust 0.6s linear infinite;
    animation-delay: -0.2s;
  }
  .run .d3 {
    animation: m-dust 0.6s linear infinite;
    animation-delay: -0.4s;
  }

  @keyframes m-bob {
    0%,
    100% {
      transform: translateY(0) rotate(-2deg);
    }
    50% {
      transform: translateY(-2.4px) rotate(0deg);
    }
  }
  @keyframes m-stride {
    0% {
      transform: rotate(26deg);
    }
    50% {
      transform: rotate(-26deg);
    }
    100% {
      transform: rotate(26deg);
    }
  }
  @keyframes m-tail-fast {
    0%,
    100% {
      transform: rotate(-14deg);
    }
    50% {
      transform: rotate(12deg);
    }
  }
  @keyframes m-ear-flap {
    0%,
    100% {
      transform: rotate(-5deg);
    }
    50% {
      transform: rotate(4deg);
    }
  }
  @keyframes m-dust {
    0% {
      opacity: 0.5;
      transform: translate(0, 0) scale(0.6);
    }
    100% {
      opacity: 0;
      transform: translate(-14px, -7px) scale(1.5);
    }
  }

  /* --------------------------------------------------------------- idle */
  /* Breathing, plus an ear twitch on a long off-beat cycle so it reads as
     alive rather than as a looping GIF. */
  .idle .body {
    animation: m-breathe 3.4s ease-in-out infinite;
  }
  .idle .tail {
    animation: m-tail-slow 3.4s ease-in-out infinite;
  }
  .idle .ear {
    animation: m-twitch 5.3s ease-in-out infinite;
  }

  @keyframes m-breathe {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.035);
    }
  }
  @keyframes m-tail-slow {
    0%,
    100% {
      transform: rotate(-6deg);
    }
    50% {
      transform: rotate(7deg);
    }
  }
  @keyframes m-twitch {
    0%,
    88%,
    100% {
      transform: rotate(0deg);
    }
    92% {
      transform: rotate(-11deg);
    }
    96% {
      transform: rotate(6deg);
    }
  }

  /* -------------------------------------------------------------- sleep */
  .sleep .whole {
    transform: translateY(3px);
  }
  .sleep .body {
    animation: m-breathe-slow 4.6s ease-in-out infinite;
  }
  .sleep .tail {
    transform: rotate(-16deg);
  }
  .sleep .whiskers {
    opacity: 0.45;
  }
  .sleep .z1 {
    animation: m-z 3.6s ease-out infinite;
  }
  .sleep .z2 {
    animation: m-z 3.6s ease-out infinite;
    animation-delay: 1.2s;
  }
  .sleep .z3 {
    animation: m-z 3.6s ease-out infinite;
    animation-delay: 2.4s;
  }

  @keyframes m-breathe-slow {
    0%,
    100% {
      transform: scale(1) translateY(0);
    }
    50% {
      transform: scale(1.05) translateY(-1px);
    }
  }
  @keyframes m-z {
    0% {
      opacity: 0;
      transform: translate(0, 4px) scale(0.7);
    }
    25% {
      opacity: 0.9;
    }
    100% {
      opacity: 0;
      transform: translate(6px, -14px) scale(1.15);
    }
  }

  /* -------------------------------------------------------------- cheer */
  /* Three hops, then still. A mascot that celebrates forever is a mascot you
     end up turning off. */
  .cheer .whole {
    animation: m-hop 0.52s ease-out 3;
  }
  .cheer .ear {
    animation: m-ear-flap 0.26s ease-in-out 6;
  }
  .cheer .tail {
    animation: m-tail-fast 0.26s ease-in-out 6;
  }

  @keyframes m-hop {
    0%,
    100% {
      transform: translateY(0) rotate(0deg);
    }
    30% {
      transform: translateY(-9px) rotate(-6deg);
    }
    60% {
      transform: translateY(0) rotate(2deg);
    }
  }
</style>

<script lang="ts">
  /**
   * A signpost pointing at the Start-the-tour button, with Remi beside it
   * dressed as a guide.
   *
   * Drawn rather than written, because a signpost says "this way" by
   * SHAPE. A pill of text saying the same words is just a label; an arrow
   * on a post is a direction, and the direction is the whole message.
   *
   * The arrow points right, at the button it sits next to. If this is ever
   * moved to the other side of something, the arrow has to be flipped with
   * it or it becomes a sign pointing at a wall.
   */
  import Mascot from "../shared/Mascot.svelte";

  /** Overall width in px. Everything scales from the viewBox. */
  export let size = 200;
</script>

<div class="signrow" style="width:{size}px">
  <svg class="sign" viewBox="0 0 132 96" width={size * 0.62} height={size * 0.62 * (96 / 132)}>
    <!-- Ground shadow, so the post is standing on something. -->
    <ellipse class="sg-shadow" cx="26" cy="90" rx="19" ry="3.4" />

    <!-- Post, its finial and its base. -->
    <circle class="sg-post" cx="26" cy="11" r="5.5" />
    <rect class="sg-post" x="22" y="12" width="8" height="72" rx="3.5" />
    <rect class="sg-post" x="14" y="82" width="24" height="6" rx="2.5" />
    <rect class="sg-post" x="18" y="76" width="16" height="7" rx="2.5" />

    <!-- The plaque: an arrow, pointing at the button beside it. -->
    <path class="sg-board" d="M24 27 H112 L130 42 L112 57 H24 Z" />
    <text class="sg-text" x="32" y="46">TOUR THIS WAY</text>
  </svg>

  <Mascot mood="ready" costume="guide" size={size * 0.46} />
</div>

<style>
  .signrow {
    display: flex;
    align-items: flex-end;
    gap: 2px;
  }
  .sign {
    display: block;
    flex: none;
    overflow: visible;
  }
  .sg-post {
    fill: var(--teal-post, #2b8794);
  }
  .sg-board {
    fill: var(--accent);
  }
  .sg-text {
    fill: #fff;
    font-family: var(--font-num);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .sg-shadow {
    fill: var(--ink);
    opacity: 0.09;
  }
</style>

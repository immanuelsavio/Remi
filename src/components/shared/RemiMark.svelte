<script lang="ts">
  /**
   * The Remi mark - the REAL app icon, not a CSS approximation.
   *
   * The showcase drew a two-circle SVG ring because it was a standalone
   * prototype with no bundled art. Here the actual `.app` icon is the brand,
   * so the dashboard header, the Start-my-day screen and the recovery screen
   * all show the same thing the user clicked in the Dock.
   *
   * Vite fingerprints and emits the PNG, so it is served from the app's own
   * origin - which is what `img-src 'self'` in the CSP allows.
   */
  import logo from "../../assets/remi-logo.png";

  /** Rendered edge length in px. */
  export let size = 22;
  /** Alt text; empty (the default) marks it decorative next to a text label. */
  export let alt = "";
</script>

<img
  class="remi-logo"
  src={logo}
  {alt}
  aria-hidden={alt ? undefined : "true"}
  style="width:{size}px;height:{size}px"
/>

<style>
  .remi-logo {
    display: block;
    flex: none;
    border-radius: 22%;
    object-fit: contain;
  }
</style>

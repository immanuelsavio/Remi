/**
 * Test environment gaps, filled once.
 *
 * jsdom implements no layout, so it has no `ResizeObserver` - which Svelte 5
 * uses internally for `bind:clientWidth` and friends. Without it, mounting
 * any component that measures itself throws, and the failure reads as a
 * component bug rather than a missing browser API.
 *
 * A no-op is the honest stub: there is nothing to observe in a document
 * with no layout, and a test that depends on a real resize callback would
 * be testing jsdom rather than the app.
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = NoopResizeObserver;
}

/**
 * A collision-free id.
 *
 * Deliberately NOT a per-window counter: the popover and dashboard are
 * separate JS module instances, so two counters would both mint "x7" and
 * one item could overwrite the other after a cross-window reload.
 * `crypto.randomUUID` exists in every webview Tauri ships; the fallback
 * keeps tests and odd runtimes working.
 */
export function nid(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

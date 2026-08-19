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

/**
 * A short, collision-resistant suffix for export filenames (backups, usage
 * logs) - milliseconds since epoch, base36, plus a short random tail.
 *
 * A calendar-date-only filename (`remi-backup-2026-08-19.json`) collides
 * on the SECOND export of the same day; `write_text_file` on the Rust side
 * is a plain overwrite, so the first export would be silently destroyed
 * with no warning. Milliseconds alone are enough in nearly all real
 * usage, but two exports triggered programmatically back-to-back (or a
 * fallback runtime with coarse timer resolution) could still land in the
 * same millisecond, so a short random tail is added as cheap insurance.
 */
export function exportSuffix(now: number = Date.now()): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  const tail = c?.randomUUID ? c.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${now.toString(36)}-${tail}`;
}

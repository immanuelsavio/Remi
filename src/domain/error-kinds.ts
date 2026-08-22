/**
 * A runtime error reduced to a FIXED category.
 *
 * An exception message is arbitrary text. It routinely carries a file
 * path (`/Users/<name>/...`), a URL, or a fragment of whatever the code
 * was handling - which can be the user's own task titles or notes. That
 * is content, and content must not be recorded while logging is off, nor
 * ride along in an export that calls itself content-free.
 *
 * A category is not content: it is one of a closed set written here, so
 * the log still answers "what kind of thing is breaking, and how often"
 * without recording anything the user typed.
 */
export const ERROR_KINDS = [
  "save",
  "load",
  "backend",
  "network",
  "permission",
  "type",
  "range",
  "syntax",
  "unknown",
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

/**
 * Map an error message onto one of the fixed kinds above.
 *
 * Deliberately crude, and deliberately pure: matching on lowercase
 * substrings of the MESSAGE only, never returning any part of it. A
 * message that matches nothing is `unknown` - never passed through.
 */
export function classifyError(msg: string): ErrorKind {
  const m = String(msg).toLowerCase();
  if (/permission|denied|not permitted|eacces|eperm/.test(m)) return "permission";
  if (/save|write|disk full|enospc/.test(m)) return "save";
  if (/load|read|parse|hydrate|enoent|no such file/.test(m)) return "load";
  if (/invoke|tauri|command|ipc|backend/.test(m)) return "backend";
  if (/network|fetch|http|timeout|offline|dns/.test(m)) return "network";
  if (/is not a function|undefined|null|not iterable|typeerror/.test(m)) return "type";
  if (/rangeerror|maximum call stack|out of memory/.test(m)) return "range";
  if (/syntaxerror|unexpected token|json/.test(m)) return "syntax";
  return "unknown";
}

/**
 * Where an error happened, reduced to a FILE NAME with no directories.
 *
 * `window.onerror` hands over a full URL or absolute path, which on a
 * user's machine contains their account name (and, for a custom data
 * folder, wherever they chose to put it).
 */
export function redactWhere(where: string): string {
  const raw = String(where);
  // Strip query/hash first, then take the last path segment.
  const clean = raw.split(/[?#]/)[0];
  const seg = clean.split(/[\\/]/).filter(Boolean).pop() ?? "";
  if (!seg || seg.includes(":")) return "app";
  return seg.slice(0, 40);
}

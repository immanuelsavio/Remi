/** TAGS: normalising, parsing and matching the labels on a task. */

/**
 * Clean one tag.
 *
 * Lowercased and trimmed so "Coding", "coding " and "CODING" are the same
 * tag - otherwise filtering by one silently misses the others, which is
 * the failure mode that makes tagging useless. Inner whitespace collapses
 * to single spaces; a leading "#" is dropped so typing it either way works.
 */
export function normalizeTag(raw: string): string {
  return String(raw).trim().replace(/^#+/, "").replace(/\s+/g, " ").toLowerCase().slice(0, 32);
}

/** Clean a whole list: normalise, drop blanks, de-duplicate, keep order. */
export function normalizeTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const t of list) {
    const clean = normalizeTag(String(t));
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out.slice(0, 12);
}

/** Split typed input on commas or spaces, so both habits work. */
export function parseTags(input: string): string[] {
  return normalizeTags(String(input).split(/[,\n]/));
}

/** Every distinct tag in use, most-used first, for suggestions. */
export function allTags(sources: { tags?: string[] }[]): string[] {
  const counts = new Map<string, number>();
  sources.forEach((x) => (x.tags ?? []).forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
}

/** Does this item carry every one of `wanted`? Empty `wanted` matches all. */
export function matchesTags(itemTags: string[] | undefined, wanted: string[]): boolean {
  if (!wanted.length) return true;
  const have = itemTags ?? [];
  return wanted.every((w) => have.includes(w));
}

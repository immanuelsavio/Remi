/**
 * NAME - what to call the person using this, and how to say it safely.
 *
 * The name is written by the user and then rendered inside headings, inside
 * buttons, and inside a popover that is only as wide as a menu bar. Nothing
 * downstream clamps it, so the clamp has to happen here, once, on the way
 * in - the same argument as `tags.ts`.
 */

/**
 * Longest name we will store, in characters.
 *
 * Chosen against the narrowest place it appears: the popover's Start-day
 * heading at 380px. Long enough for "Alexandra Rodriguez", short enough
 * that it cannot push a button off its row.
 */
export const NAME_MAX = 24;

/**
 * What Remi calls you until you say otherwise.
 *
 * A neutral placeholder rather than an empty string, so the greeting reads
 * as a greeting out of the box instead of a bare "Good morning." Clearing
 * the field in Settings still leaves it genuinely empty - the default is a
 * starting point, not a floor.
 */
export const DEFAULT_NAME = "User";

/**
 * Longest FULL name we will store.
 *
 * Roomier than the nickname because it lives in one place only - the
 * header of an exported work record, which is a wide printed page rather
 * than a heading in a 380px popover.
 */
export const FULL_NAME_MAX = 60;

/**
 * Clean a typed name: no control characters, no runs of whitespace, no
 * leading or trailing space, and never longer than `NAME_MAX`.
 *
 * Returns "" for anything unusable, which every caller treats as "no name
 * set" rather than as a name that happens to be blank.
 */
export function normalizeName(raw: string, max: number = NAME_MAX): string {
  if (typeof raw !== "string") return "";
  return (
    raw
      // Control characters would break a single-line heading outright.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max)
      // Slicing can land mid-word and leave a dangling space.
      .trim()
  );
}

/**
 * Attach the name to a phrase, or leave the phrase completely alone.
 *
 * The empty case matters more than the filled one: "Good morning, " with a
 * dangling comma is worse than never having asked for a name at all.
 */
export function withName(phrase: string, name: string): string {
  const n = normalizeName(name);
  return n ? `${phrase}, ${n}` : phrase;
}

/**
 * Time-of-day greeting for a 0-23 hour.
 *
 * The small hours count as morning. Someone still up at 2am is having a
 * long night, and "Good evening" at 2am reads as a bug.
 */
export function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

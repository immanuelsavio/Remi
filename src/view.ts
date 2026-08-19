/**
 * The view layer's import surface: the pure helpers a component needs, plus
 * the clock store, re-exported from one place.
 *
 * Without this, every `.svelte` file would import from BOTH the domain
 * layer (pure helpers) and the store facade (actions + stores), and a
 * reader would have to know which lives where. Components import actions
 * from `./store` and everything they merely READ from `./view`.
 */

export { nowMs } from "./store";

export {
  ACCENTS,
  type Accent,
  type DashTab,
  type Main,
  type Mode,
  type State,
  type Sub,
  type WellnessKey,
} from "./domain/types";
export {
  addDays,
  clockLabel,
  dateFromISO,
  isoOf,
  isWeekend,
  MONTHS_FULL,
  MONTHS_SHORT,
  prettyDate,
  todayISO,
} from "./domain/dates";
export { fmt, fmtEst, hoursStr } from "./domain/time";
export {
  completedToday,
  elapsedOf,
  mainTotal,
  todayAsRecord,
  todayTrackedMs,
  unfinishedToday,
} from "./domain/tasks";
export { canMarkPto, computeStreaks } from "./domain/streaks";
export { interruptionStats, timeSense } from "./domain/trainer";
export { IMPORT_PROMPT, parseImport, type ParsedImport } from "./domain/imports";

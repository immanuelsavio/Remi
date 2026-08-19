/**
 * The view layer's import surface: the pure helpers a component needs, plus the
 * clock store, re-exported from one place.
 *
 * Without this, every `.svelte` file would import from BOTH `model.ts` (pure
 * helpers) and `store.ts` (actions + stores), and a reader would have to know
 * which lives where. Components import actions from `./store` and everything
 * they merely READ from `./view`.
 */

export { nowMs } from "./store";

export {
  ACCENTS,
  MONTHS_FULL,
  MONTHS_SHORT,
  addDays,
  canMarkPto,
  clockLabel,
  completedToday,
  computeStreaks,
  dateFromISO,
  elapsedOf,
  fmt,
  fmtEst,
  hoursStr,
  interruptionStats,
  isWeekend,
  isoOf,
  mainTotal,
  parseImport,
  prettyDate,
  timeSense,
  todayAsRecord,
  todayISO,
  todayTrackedMs,
  unfinishedToday,
  IMPORT_PROMPT,
  type Accent,
  type DashTab,
  type Main,
  type Mode,
  type ParsedImport,
  type State,
  type Sub,
  type WellnessKey,
} from "./model";

/** Local-date formatting and arithmetic. Never UTC - a UTC date rolls the
 * day mid-afternoon for US users. */

/** Today's LOCAL date as YYYY-MM-DD. A UTC date would roll the day mid-evening. */
export function todayISO(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const MONTHS_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function prettyDate(d: Date): string {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** Parse YYYY-MM-DD as a LOCAL date (not UTC, which would shift the day). */
export function dateFromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function isoOf(d: Date): string {
  return todayISO(d);
}

/** Shift an ISO date by whole days, staying in local time. */
export function addDays(iso: string, delta: number): string {
  const d = dateFromISO(iso);
  d.setDate(d.getDate() + delta);
  return isoOf(d);
}

/** 12-hour clock label: `2pm`, `9:05am`. */
export function clockLabel(hh: number, mm: number): string {
  const ap = hh >= 12 ? "pm" : "am";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")}${ap}` : `${h12}${ap}`;
}

export function fmtHM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

export function isWeekend(iso: string): boolean {
  const dow = dateFromISO(iso).getDay();
  return dow === 0 || dow === 6;
}

/** Duration formatting for a live timer or an estimate/total. */

/** `h:mm:ss` for a live timer. */
export function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** Compact `2h 15m` / `45m` for an estimate or a total. */
export function fmtEst(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  return h ? `${h}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins}m`;
}

/** Alias kept because both names read better in different places. */
export const hoursStr = fmtEst;

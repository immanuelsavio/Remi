/**
 * Build a reminder from user input, anchored to REAL time.
 *   in : minutes from now
 *   by : a clock time today, rolling to tomorrow when already past
 *   on : an absolute datetime-local value
 */

import { clockLabel, fmtHM, MONTHS_SHORT } from "./dates";
import type { Remind, RemindKind, State } from "./types";

export function makeRemind(
  kind: RemindKind | "clear",
  raw: string | number,
  now: number = Date.now(),
): Remind | null {
  if (kind === "clear") return null;

  if (kind === "in") {
    const mins = Math.max(1, Math.round(Number(raw)));
    if (!Number.isFinite(mins)) return null;
    const short = `in ${fmtHM(mins)}`;
    return { kind, raw: String(mins), at: now + mins * 60000, label: `Remind ${short}`, short };
  }

  if (kind === "by") {
    const [hhRaw, mmRaw] = String(raw).split(":");
    const hh = Number(hhRaw);
    const mm = Number(mmRaw || 0);
    if (!Number.isFinite(hh) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    const d = new Date(now);
    d.setHours(hh, mm, 0, 0);
    let rolled = false;
    if (d.getTime() <= now) {
      d.setDate(d.getDate() + 1);
      rolled = true;
    }
    const lab = clockLabel(hh, mm);
    return {
      kind,
      raw: String(raw),
      at: d.getTime(),
      label: `Remind by ${lab}${rolled ? " (tomorrow)" : ""}`,
      short: `by ${lab}`,
    };
  }

  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return null;
  const short = `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${clockLabel(
    d.getHours(),
    d.getMinutes(),
  )}`;
  return { kind: "on", raw: String(raw), at: d.getTime(), label: `Remind on ${short}`, short };
}

/** Reminders that are due and not yet delivered, with where each lives. */
export function dueReminders(
  s: State,
  now: number,
): { title: string; remind: Remind; where: string }[] {
  const out: { title: string; remind: Remind; where: string }[] = [];
  s.mains.forEach((m) => {
    if (m.remind && !m.remind.delivered && m.remind.at <= now) {
      out.push({ title: m.title, remind: m.remind, where: `main|${m.id}` });
    }
    m.subs.forEach((x) => {
      if (x.remind && !x.remind.delivered && x.remind.at <= now) {
        out.push({ title: x.title, remind: x.remind, where: `sub|${m.id}~${x.id}` });
      }
    });
  });
  s.backlog.forEach((b) => {
    if (b.remind && !b.remind.delivered && b.remind.at <= now) {
      out.push({ title: b.title, remind: b.remind, where: `backlog|${b.id}` });
    }
  });
  return out;
}

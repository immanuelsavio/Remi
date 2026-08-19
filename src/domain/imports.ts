/** IMPORT - paste a plan from an assistant or a notes app. */

import { makeRemind } from "./reminders";
import type { Remind } from "./types";

/** The copyable prompt that makes an assistant emit the importable format. */
export const IMPORT_PROMPT = `After your task list, output it in EXACTLY this format so I can import it (nothing else, no bullets, no numbering):

Main Task 1
    Subtask 1 @ 2026-08-14 10:00
    Subtask 2 @ by 3pm
Main Task 2
    Subtask 1 @ in 1h30m
Main Task 3

Backlog:
    Backlog item 1 @ 2026-09-01 09:00
    Backlog item 2

Rules:
- One task per line. Main tasks start at the left margin.
- Subtasks are indented (4 spaces or a tab) under their main task.
- A reminder is optional: add " @ " then one of:
    @ 2026-08-14 10:00   (specific date & time, 24h)
    @ by 3pm             (a time today; rolls to tomorrow if already past)
    @ in 1h30m           (relative: 30m, 2h, 1h30m)
- Put a line "Backlog:" then indented items to add things I'll do later.`;

export interface ParsedImport {
  mains: {
    title: string;
    subs: { title: string; remind: Remind | null }[];
    remind: Remind | null;
  }[];
  backlog: { title: string; remind: Remind | null }[];
  errors: string[];
}

/** "@ <when>" -> a reminder. Accepts "in 1h30m", "by 3pm", "2026-08-14 10:00". */
export function parseWhen(w: string, now: number = Date.now()): Remind | null {
  const t = w.trim();
  let m: RegExpExecArray | null;

  m = /^in\s+(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/i.exec(t);
  if (m && (m[1] || m[2])) {
    return makeRemind("in", Number(m[1] || 0) * 60 + Number(m[2] || 0), now);
  }

  m = /^by\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(t);
  if (m) {
    let h = Number(m[1]);
    const mm = m[2] ? Number(m[2]) : 0;
    const ap = (m[3] || "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h > 23 || mm > 59) return null;
    return makeRemind("by", `${h}:${String(mm).padStart(2, "0")}`, now);
  }

  m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(t);
  if (m) {
    const p = (n: string | number) => String(Number(n)).padStart(2, "0");
    const iso = `${m[1]}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${m[5]}`;
    if (isNaN(new Date(iso).getTime())) return null;
    return makeRemind("on", iso, now);
  }
  return null;
}

/** Guards against pathological pasted input. */
export const IMPORT_LIMITS = { maxItems: 500, maxTitle: 200 };

/** Parse the structured text format into tasks, steps and backlog items. */
export function parseImport(text: string, now: number = Date.now()): ParsedImport {
  const mains: ParsedImport["mains"] = [];
  const backlog: ParsedImport["backlog"] = [];
  const errors: string[] = [];
  let inBacklog = false;
  let curMain: ParsedImport["mains"][number] | null = null;
  let count = 0;

  const lines = text.replace(/\r/g, "").split("\n");
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    if (!raw.trim()) continue;
    if (count >= IMPORT_LIMITS.maxItems) {
      errors.push(`Stopped at ${IMPORT_LIMITS.maxItems} items - the rest was ignored.`);
      break;
    }
    const indented = /^(\s{2,}|\t)/.test(raw);
    const line = raw.trim().replace(/^([-*•]|\d+[.)])\s+/, "");

    if (/^backlog\s*:?$/i.test(line)) {
      inBacklog = true;
      curMain = null;
      continue;
    }

    let remind: Remind | null = null;
    let title = line;
    const at = line.split(/\s+@\s+/);
    if (at.length >= 2) {
      title = at[0].trim();
      const parsed = parseWhen(at.slice(1).join(" @ ").trim(), now);
      if (parsed) remind = parsed;
      else errors.push(`Line ${idx + 1}: couldn't read reminder "${at[1]}"`);
    }
    if (!title) continue;
    if (title.length > IMPORT_LIMITS.maxTitle) {
      title = title.slice(0, IMPORT_LIMITS.maxTitle);
      errors.push(`Line ${idx + 1}: title was shortened.`);
    }

    count++;
    if (inBacklog) {
      backlog.push({ title, remind });
      continue;
    }
    if (indented && curMain) {
      curMain.subs.push({ title, remind });
    } else {
      const nm = { title, subs: [] as { title: string; remind: Remind | null }[], remind };
      mains.push(nm);
      curMain = nm;
    }
  }
  return { mains, backlog, errors };
}

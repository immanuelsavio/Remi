/** WORK RECORD: build the report, write it out, open it for printing. */

import { invoke } from "@tauri-apps/api/core";

import logoUrl from "../assets/remi-wordmark.png";
import { buildReport, selectDays, type ReportRange } from "../domain/report";
import { daySnapshot, enrichSnapshot } from "../domain/tasks";
import { todayISO, MONTHS_FULL } from "../domain/dates";
import { exportSuffix } from "../domain/ids";
import { S, showToast } from "./state";

/**
 * The logo as a `data:` URI, fetched once and cached.
 *
 * Fetched from the bundled asset rather than inlined at build time: base64
 * is a third larger than the bytes, and paying that in the main bundle for
 * a feature used occasionally is the wrong trade. The request is same-origin
 * against the app's own bundle, so it works offline.
 */
let logoCache: string | null = null;
async function logoDataUri(): Promise<string | undefined> {
  if (logoCache) return logoCache;
  try {
    const blob = await (await fetch(logoUrl)).blob();
    logoCache = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
    return logoCache;
  } catch {
    // A report without its logo is still a report.
    return undefined;
  }
}

/** Resolve a range choice to inclusive ISO bounds plus a human label. */
export function rangeBounds(
  range: ReportRange,
  today: string,
  custom?: { from: string; to: string },
): { from: string; to: string; label: string } {
  const year = today.slice(0, 4);
  const month = today.slice(0, 7);
  if (range === "year") {
    return { from: `${year}-01-01`, to: `${year}-12-31`, label: year };
  }
  if (range === "month") {
    const m = Number(month.slice(5, 7)) - 1;
    return { from: `${month}-01`, to: `${month}-31`, label: `${MONTHS_FULL[m]} ${year}` };
  }
  if (range === "custom" && custom?.from && custom?.to) {
    // Tolerate the dates arriving the wrong way round rather than silently
    // producing an empty report.
    const [from, to] =
      custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
    return { from, to, label: `${from} to ${to}` };
  }
  return { from: "0000-01-01", to: "9999-12-31", label: "Entire history" };
}

/**
 * Write a work record and open it.
 *
 * Today is folded in from live state, exactly as the calendar does: history
 * only gains a day when End Day archives it, and a report run at 4pm that
 * silently omitted today would be wrong in the least obvious way.
 */
export async function exportWorkRecord(
  range: ReportRange,
  includeInterruptions: boolean,
  custom?: { from: string; to: string },
  tags: string[] = [],
): Promise<void> {
  const s = S();
  const { from, to, label } = rangeBounds(range, todayISO(), custom);

  const archived = s.history.filter((h) => h.dateISO !== s.dateISO);
  const live = s.awaitingStart ? [] : [enrichSnapshot(s, daySnapshot(s, Date.now()))];
  const days = selectDays([...archived, ...live], from, to, tags);

  const html = buildReport(days, {
    includeInterruptions,
    logoDataUri: await logoDataUri(),
    generatedAt: Date.now(),
    rangeLabel: tags.length ? `${label} · ${tags.map((t) => `#${t}`).join(" ")}` : label,
  });

  try {
    const path = await invoke<string>("write_text_file", {
      name: `remi-work-record-${todayISO()}-${exportSuffix()}.html`,
      contents: html,
    });
    showToast(`Work record saved · ${days.length} day${days.length === 1 ? "" : "s"}`);
    // Opens in the browser, where Print gives you a PDF. Bundling a PDF
    // engine to produce something the OS already makes would be a lot of
    // weight for no gain.
    await invoke("open_in_default_app", { path });
  } catch (e) {
    showToast(`Couldn't save the work record: ${String(e)}`);
  }
}

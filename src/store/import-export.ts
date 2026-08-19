/** IMPORT / EXPORT: apply a parsed paste, and JSON backup export/restore. */

import { invoke } from "@tauri-apps/api/core";

import { applyTheme } from "../domain/theme";
import { mkMain, mkSub } from "../domain/defaults";
import { todayISO } from "../domain/dates";
import { nid } from "../domain/ids";
import { hydrate } from "../domain/hydration";
import { forPersist } from "../domain/persistence-shape";
import type { ParsedImport } from "../domain/imports";
import { flushSave } from "./persistence";
import { S, bankOrphanSession, commit, rolloverIfNewDay, setState, showToast } from "./state";

/** Apply a parsed import: tasks with their steps, plus backlog items. */
export function applyImport(parsed: ParsedImport): void {
  commit((s) => {
    parsed.mains.forEach((pm) => {
      const m = mkMain(
        pm.title,
        pm.subs.map((x) => {
          const sub = mkSub(x.title);
          sub.remind = x.remind;
          return sub;
        }),
      );
      m.remind = pm.remind;
      s.mains.push(m);
    });
    parsed.backlog.forEach((b) => {
      s.backlog.push({ id: nid(), title: b.title, remind: b.remind });
    });
  });
  const n = parsed.mains.length;
  const b = parsed.backlog.length;
  showToast(
    `Imported ${n} task${n === 1 ? "" : "s"}${b ? ` and ${b} backlog item${b === 1 ? "" : "s"}` : ""}`,
  );
}

/** Write a timestamped JSON backup into the data folder. */
export async function exportBackup(): Promise<void> {
  try {
    const path = await invoke<string>("write_text_file", {
      name: `remi-backup-${todayISO()}.json`,
      contents: JSON.stringify(forPersist(S()), null, 2),
    });
    showToast(`Saved to ${path}`);
  } catch (e) {
    showToast(`Export failed: ${String(e)}`);
  }
}

/**
 * Restore from a backup file's text.
 *
 * Goes through `hydrate`, so a hand-edited or foreign file can't inject a
 * shape the app can't run. The data folder is machine-local and
 * deliberately NOT restored - a backup made on another machine would point
 * at a path that may not exist here.
 */
export function restoreBackup(text: string): void {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    showToast("That file isn't valid JSON");
    return;
  }
  const next = hydrate(raw);
  if (!next.dateISO) {
    showToast("That file doesn't look like a Remi backup");
    return;
  }
  setState(rolloverIfNewDay(bankOrphanSession(next)));
  applyTheme(S().mode, S().accent);
  void flushSave();
  showToast("Backup restored");
}

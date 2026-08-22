/** IMPORT / EXPORT: apply a parsed paste, and JSON backup export/restore. */

import { invoke } from "@tauri-apps/api/core";

import { applyTheme } from "../domain/theme";
import { mkMain, mkSub } from "../domain/defaults";
import { todayISO } from "../domain/dates";
import { exportSuffix, nid } from "../domain/ids";
import { hydrate, looksLikeRemiState } from "../domain/hydration";
import { forPersist } from "../domain/persistence-shape";
import type { ParsedImport } from "../domain/imports";
import { allowOverwritingMalformedOnce, flushSave, StaleWriteError } from "./persistence";
import {
  S,
  bankOrphanSession,
  commit,
  rolloverIfNewDay,
  setState,
  showToast,
  state,
} from "./state";

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
      name: `remi-backup-${todayISO()}-${exportSuffix()}.json`,
      contents: JSON.stringify(forPersist(S()), null, 2),
    });
    showToast(`Saved to ${path}`);
  } catch (e) {
    showToast(`Export failed: ${String(e)}`);
  }
}

/** Why a restore attempt did not take effect. */
export type RestoreFailureReason = "invalid-json" | "invalid-shape" | "stale" | "save-failed";

export type RestoreResult =
  { ok: true } | { ok: false; reason: RestoreFailureReason; message: string };

/**
 * Restore from a backup file's text - a real barrier, not fire-and-forget.
 *
 * The RAW input is validated against real structural markers
 * (`looksLikeRemiState`) before it EVER mutates current state - hydrate
 * always produces a valid `State` (that's its job), so a post-hydrate
 * check can never reject anything and would let `{}` or any unrelated
 * JSON object silently wipe the current day. Once validated, `hydrate`
 * still coerces and clamps every field, so a hand-edited or foreign file
 * can't inject a shape the app can't run.
 *
 * The exact pre-restore in-memory state is kept, and restored verbatim if
 * persistence fails - "Backup restored" is only ever reported once the
 * write actually succeeded, never before. On a stale-write conflict (the
 * other window saved first), `flushSave` has already reloaded the current
 * on-disk state by the time this returns; that reloaded state is what's
 * left in memory, not the pre-restore state and not the failed attempt.
 *
 * The restored state carries the CURRENT window's `_rev`, not whatever
 * `_rev` the backup file itself was exported with - a backup made an hour
 * (or a version) ago restoring its own stale revision would make the CAS
 * check compare against ancient history instead of what's actually on
 * disk now.
 *
 * The data folder is machine-local and deliberately NOT restored - a
 * backup made on another machine would point at a path that may not exist
 * here.
 */
export async function restoreBackup(text: string): Promise<RestoreResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const message = "That file isn't valid JSON";
    showToast(message);
    return { ok: false, reason: "invalid-json", message };
  }
  if (!looksLikeRemiState(raw)) {
    const message = "That file doesn't look like a Remi backup";
    showToast(message);
    return { ok: false, reason: "invalid-shape", message };
  }

  // Exact pre-restore snapshot, for a precise rollback on failure - not a
  // re-derivation, the literal object currently in the store.
  const before = S();

  const currentRev = before._rev;
  const next = hydrate(raw);
  next._rev = currentRev; // never trust the backup's own possibly-stale revision
  setState(rolloverIfNewDay(bankOrphanSession(next)));
  applyTheme(S().mode, S().accent);

  try {
    // The one write allowed over an unreadable state file: refusing here
    // too would strand the user with a broken file and no way past it.
    allowOverwritingMalformedOnce();
    await flushSave();
    showToast("Backup restored");
    return { ok: true };
  } catch (e) {
    if (e instanceof StaleWriteError) {
      // flushSave already reloaded the current on-disk state into the
      // store before rejecting - leave that in place (it is real,
      // persisted content from the other window), do NOT roll back to
      // the pre-restore snapshot over top of it.
      showToast(e.message);
      return { ok: false, reason: "stale", message: e.message };
    }
    // Any other failure (disk full, permission denied): roll back to the
    // EXACT pre-restore state, both in memory and by leaving disk
    // untouched (the failed write never landed).
    state.set(before);
    applyTheme(before.mode, before.accent);
    const message = `Restore failed: ${String(e)}. Nothing was changed.`;
    showToast(message);
    return { ok: false, reason: "save-failed", message };
  }
}

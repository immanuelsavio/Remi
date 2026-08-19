/** BACKLOG: add, delete, promote to today. */

import { mkMain } from "../domain/defaults";
import { nid } from "../domain/ids";
import { S, commit, showToast } from "./state";

export function addBacklog(title: string): void {
  const t = title.trim();
  if (!t) return;
  commit((s) => void s.backlog.push({ id: nid(), title: t, remind: null }));
  showToast("Added to backlog");
}

export function deleteBacklog(id: string): void {
  const item = S().backlog.find((x) => x.id === id);
  commit((s) => void (s.backlog = s.backlog.filter((x) => x.id !== id)));
  if (item) {
    showToast("Removed from backlog", "Undo", () => {
      commit((s) => void s.backlog.push(item));
    });
  }
}

/** Move a backlog item into today - always an explicit user action. */
export function backlogToToday(id: string): void {
  const item = S().backlog.find((x) => x.id === id);
  if (!item) return;
  commit((s) => {
    const m = mkMain(item.title);
    m.remind = item.remind;
    m.note = item.note ?? "";
    s.mains.push(m);
    s.backlog = s.backlog.filter((x) => x.id !== id);
  });
  showToast(`"${item.title}" added to today`);
}

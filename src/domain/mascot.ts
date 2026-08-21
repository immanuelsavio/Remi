/**
 * MASCOT - which pose Remi the mouse should be holding.
 *
 * Pure, and `now` is a parameter like everywhere else in `domain/`, so the
 * rule is testable without fake timers and identical in both windows.
 *
 * The mouse is a status readout, not decoration, which means exactly one
 * question decides the pose: **is time accruing, and if not, why not?**
 * The order below is that question answered from the outside in.
 */

import type { State } from "./types";

export type MascotMood = "run" | "idle" | "sleep" | "cheer";

/**
 * The pose that matches what the app is currently doing.
 *
 * Precedence, and the reason for each rung:
 *
 *   1. `sleep`  — a break is running. This outranks a set `activeMainId`
 *                 because a break PARKS the task rather than clearing it;
 *                 if "a task is assigned" won, the mouse would sprint
 *                 through a break while the clock sat paused, which is the
 *                 one thing the pose exists to tell you.
 *   2. `run`    — a session is genuinely on the clock. `activeMainId` alone
 *                 is not enough: it survives with `startedAt: 0` for a
 *                 banked or parked session.
 *   3. `cheer`  — the list is finished, and there WAS a list. Gated on
 *                 `mains.length` because an empty day is not an
 *                 achievement.
 *   4. `idle`   — awake, waiting. The default, and the honest one.
 */
export function mascotMood(s: State, now: number): MascotMood {
  if (s.breakEndsAt > now) return "sleep";
  if (s.activeMainId && s.startedAt > 0) return "run";
  if (s.mains.length > 0 && s.mains.every((m) => m.done)) return "cheer";
  return "idle";
}

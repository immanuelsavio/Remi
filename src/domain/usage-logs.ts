/** USAGE LOGS - opt-in, and content-free by construction. */

import type { Metrics, State, WellnessKey } from "./types";

const FRICTION_MEANING: Record<string, string> = {
  rapid_repeat: "clicked the same control repeatedly - it may not be doing what they expect",
  tab_thrash: "bounced between screens/tabs a lot - may be hunting for something",
  interrupt_cancelled: "opened the switch/interrupt dialog then backed out - unsure what to pick",
  import_abandoned: "started an import then cancelled - the format or flow may be unclear",
  undo_used: "undid an action - a click did something unintended",
  error: "a runtime error occurred",
};

/**
 * The exportable usage payload: counts and settings only.
 *
 * NEVER includes task titles, notes, backlog text or reminder text. The
 * interruption section carries SHAPE only - how many, how long, how they
 * started - because the cause text is the user's own words about their
 * work.
 */
export function buildLogs(s: State) {
  const days: Metrics["days"] = {};
  Object.keys(s.metrics.days).forEach((dn) => {
    const b = s.metrics.days[dn];
    days[dn] = { events: { ...b.events }, clicks: { ...b.clicks }, friction: { ...b.friction } };
  });
  const totals: Record<string, number> = {};
  Object.values(s.metrics.days).forEach((d) =>
    Object.entries(d.friction || {}).forEach(([k, v]) => (totals[k] = (totals[k] || 0) + v)),
  );
  return {
    app: "remi",
    kind: "usage-logs",
    schema: 2,
    containsNoContent: true,
    currentDay: s.dayNum,
    settings: {
      checkinMin: s.pingMin,
      wellnessEnabled: (Object.keys(s.wellness) as WellnessKey[]).filter((k) => s.wellness[k].on),
      trainerOn: s.trainerOn,
      avoidanceOn: s.avoidanceOn,
    },
    byDay: days,
    interruptions: {
      todayCount: s.interruptions.length,
      todayTotalMs: s.interruptions.reduce((a, e) => a + (e.open ? 0 : e.durationMs || 0), 0),
      byVia: s.interruptions.reduce<Record<string, number>>((acc, e) => {
        acc[e.via] = (acc[e.via] || 0) + 1;
        return acc;
      }, {}),
    },
    frictionSummary: Object.entries(totals).map(([k, v]) => ({
      signal: k,
      count: v,
      means: FRICTION_MEANING[k] || k,
    })),
    errors: s.metrics.errors.slice(),
  };
}

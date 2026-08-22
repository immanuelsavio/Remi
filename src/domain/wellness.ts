/**
 * What each wellness nudge says.
 *
 * Pure data, in `domain`, because two store modules need it - the clock
 * fires them, and the tour previews one - and an action module may only
 * depend on `state.ts`. Copy is not behaviour, so it belongs here anyway.
 */
import type { WellnessKey } from "./types";

export const WELLNESS_COPY: Record<WellnessKey, { icon: string; title: string; msg: string }> = {
  water: { icon: "💧", title: "Water break", msg: "Take a sip of water." },
  stand: { icon: "🧍", title: "Stand up", msg: "Stand and stretch for a moment." },
  walk: { icon: "🚶", title: "Take a walk", msg: "A short walk resets your focus." },
  lunch: { icon: "🍽️", title: "Lunch time", msg: "Have you eaten? Step away for lunch." },
  breakr: { icon: "☕", title: "Take a break", msg: "You've been at it a while, take a breather." },
};

export function wellnessCopy(k: WellnessKey) {
  return WELLNESS_COPY[k];
}

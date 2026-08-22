/**
 * TOUR NAVIGATION, as one deterministic reducer.
 *
 * Every regression this tour shipped was a navigation bug, and every one of
 * them came from the same shape: three things could move the user - Back,
 * Next, and an automatic advance on a timer - with no rule about which won.
 * A deliberate Back would be undone by a timer armed before it. Completing
 * a beat would drag the bubble away from a beat someone had gone back to
 * read. Each fix patched one arithmetic edge and left the collision.
 *
 * So: one function, one transition per event, no timers and no DOM. Given
 * the same state and event it always produces the same result, which is
 * what makes it testable - and it had no tests at all while it was living
 * inside the component.
 *
 * The two drivers are explicit rather than emergent:
 *
 *   AUTO (`cursor === null`) - the bubble follows whatever is outstanding,
 *   and finishing the checklist may turn the page.
 *
 *   MANUAL (`cursor` set) - from the first Back or Next. The person is
 *   driving: nothing re-syncs the bubble and nothing turns the page for
 *   them. Manual lasts until the step changes.
 */

/** What the current step looks like, as far as navigation cares. */
export interface NavContext {
  /** Beats on this step. Zero for a step that just talks. */
  beats: number;
  /** First beat not yet done - equal to `beats` when the list is finished. */
  autoIdx: number;
  /** Visible step to move to, or null at that end of the tour. */
  nextStep: number | null;
  prevStep: number | null;
}

export interface NavState {
  /** Index into the script, or null when the tour is not running. */
  step: number | null;
  /** Manual beat cursor. Null means "follow what is outstanding". */
  cursor: number | null;
  /**
   * May finishing the checklist turn the page by itself?
   *
   * Set on ENTERING a step with work outstanding. Arriving at a checklist
   * that is already complete - which is what pressing Back onto one is -
   * must not bounce the user forward again a moment later.
   */
  armed: boolean;
}

export type NavEvent =
  | { type: "NEXT" }
  | { type: "BACK" }
  /** A beat's own control was used, so the checklist moved on its own. */
  | { type: "PROGRESS" }
  | { type: "EXIT" };

/** What the caller must DO as a result. Never performed in here. */
export type NavEffect =
  | { do: "none" }
  /** Carry out this beat with its example, through typed commands. */
  | { do: "fill"; beat: number }
  /**
   * Move to another step.
   *
   * The reducer cannot build the arriving state itself: `armed` depends on
   * the NEW step's beats, and the context it was handed describes the one
   * being left. Handing the target back and letting the caller re-derive
   * is what stops a page turn arming itself from the wrong checklist.
   */
  | { do: "goto"; step: number }
  | { do: "exit" };

export interface NavResult {
  state: NavState;
  effect: NavEffect;
}

export const INACTIVE: NavState = { step: null, cursor: null, armed: false };

/** Which beat is on screen. `beats` means "past the end - all done". */
export function beatIndex(ctx: NavContext, nav: NavState): number {
  return Math.max(0, Math.min(ctx.beats, nav.cursor ?? ctx.autoIdx));
}

/** Entering a step: back to AUTO, armed only if there is work to do. */
export function enterStep(step: number, ctx: NavContext): NavState {
  return { step, cursor: null, armed: ctx.autoIdx < ctx.beats };
}

/**
 * May the checklist turn the page on its own right now?
 *
 * All three conditions, and the third is the one that is easy to lose:
 * finished, still in AUTO, and armed on the way in.
 */
export function canAutoAdvance(ctx: NavContext, nav: NavState): boolean {
  return nav.armed && nav.cursor === null && ctx.beats > 0 && ctx.autoIdx >= ctx.beats;
}

export function reduce(ctx: NavContext, nav: NavState, ev: NavEvent): NavResult {
  const stay = (state: NavState, effect: NavEffect = { do: "none" }): NavResult => ({
    state,
    effect,
  });
  if (nav.step === null) return stay(nav);

  switch (ev.type) {
    case "EXIT":
      return { state: INACTIVE, effect: { do: "exit" } };

    case "PROGRESS":
      // Automatic progress may update where AUTO is looking, but it must
      // never move someone who has taken the wheel.
      return stay(nav);

    case "NEXT": {
      const at = beatIndex(ctx, nav);
      // Still something on the checklist: do THAT, and stay on the page.
      if (at < ctx.beats) {
        // Already done - stepped back onto it - so just move along rather
        // than doing it twice.
        const alreadyDone = at < ctx.autoIdx;
        return stay(
          { ...nav, cursor: Math.min(ctx.beats, at + 1) },
          alreadyDone ? { do: "none" } : { do: "fill", beat: at },
        );
      }
      // Checklist finished (or the step had none): turn the page.
      if (ctx.nextStep === null) return { state: INACTIVE, effect: { do: "exit" } };
      return stay(nav, { do: "goto", step: ctx.nextStep });
    }

    case "BACK": {
      const at = beatIndex(ctx, nav);
      if (at > 0) return stay({ ...nav, cursor: at - 1 });
      if (ctx.prevStep === null) return stay(nav);
      return stay(nav, { do: "goto", step: ctx.prevStep });
    }
  }
}

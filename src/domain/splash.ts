/**
 * The opening splash, as a decision rather than a component.
 *
 * The dashboard's webview is kept warm across a close - closing hides the
 * window - so "the app was opened" is not something the frontend can see
 * for itself: there is no mount, and focus is a different event entirely.
 * Rust emits `dashboard-opened` on a genuine hidden -> visible transition
 * (`windows/dashboard.rs`), and this reduces the resulting sequence of
 * events to two things the view needs: which RUN is on screen (a `{#key}`
 * remounts the splash and restarts its hold), and whether the window is
 * still covered.
 *
 * Pure, and time-free, so the awkward cases - a reload that finishes after
 * a second open, four opens in a row, a focus event that must change
 * nothing - are testable without a window, a timer or a mounted component.
 */

export interface SplashState {
  /** Which opening is on screen. Bumping it remounts the splash. */
  run: number;
  /** True while an opening is in progress and the window stays covered. */
  covered: boolean;
}

export const initialSplash = (): SplashState => ({ run: 0, covered: false });

/**
 * The window went from hidden to visible.
 *
 * Rapid repeated opens COLLAPSE rather than stack: each one bumps the run,
 * which restarts the single hold timer the (remounted) component owns.
 * There is no second timer to overlap with, and no queue of pending
 * splashes to drain.
 */
export function opened(s: SplashState): SplashState {
  return { run: s.run + 1, covered: true };
}

/**
 * The reload started by opening run `run` has finished.
 *
 * Ignored if a LATER open has already superseded it: that open's own
 * reload will clear the cover. Without this check, a slow reload from an
 * earlier open resolving late would lift the newer splash early - the one
 * failure mode a plain boolean cannot express.
 */
export function loaded(s: SplashState, run: number): SplashState {
  if (run !== s.run) return s;
  return { ...s, covered: false };
}

/**
 * Focus changed. Deliberately identity: alt-tabbing back to a window that
 * was already open has not opened anything, and replaying a three-second
 * splash over the work someone was looking at is a bug, not a flourish.
 */
export function focused(s: SplashState): SplashState {
  return s;
}

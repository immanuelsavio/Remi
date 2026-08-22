//! Shared popover state: where the tray icon is, and when it was last hidden.
//!
//! Both are Tauri-managed singletons rather than globals so they follow the
//! app handle's lifetime and stay testable/injectable.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// The tray icon's rectangle in physical px, captured from tray events.
///
/// `None` until the first tray event arrives - a Spotlight or Dock reopen
/// can show the popover before the menu bar has reported anything.
#[derive(Default)]
pub struct TrayAnchor(Mutex<Option<(f64, f64, f64, f64)>>);

impl TrayAnchor {
    pub fn set(&self, x: f64, y: f64, w: f64, h: f64) {
        if let Ok(mut g) = self.0.lock() {
            *g = Some((x, y, w, h));
        }
    }

    pub fn get(&self) -> Option<(f64, f64, f64, f64)> {
        self.0.lock().ok().and_then(|g| *g)
    }
}

/// How long after a hide a toggle-driven show is suppressed.
const DISMISS_DEBOUNCE: Duration = Duration::from_millis(200);

/// How long after a PROGRAMMATIC open the panel ignores losing focus.
///
/// Opening a non-activating panel from a focused dashboard produces a
/// `Focused(false)` on the panel itself almost immediately - the window
/// manager settling, not a person clicking elsewhere. Autohide could not
/// tell those apart, so the tour's "Open it from the menu bar" showed the
/// popover and hid it again in the same breath, which reads as a button
/// that does nothing.
///
/// Long enough to cover that settling; short enough that a real click-away
/// a moment later still closes the panel, which is the behaviour the whole
/// window depends on.
const OPENING_GRACE: Duration = Duration::from_millis(400);

/// Guard against the menu-bar double-handler race.
///
/// Clicking the tray icon while the popover is open fires TWO things, in
/// order: (1) the popover loses focus, so autohide hides it; THEN (2) the
/// tray click handler runs `toggle_popover`, which now sees
/// `is_visible() == false` and would re-show it - so the tray could never
/// DISMISS the popover, it just flickered and reopened. We record the last
/// hide and swallow a show that arrives within ~200ms of it. `Instant` is
/// monotonic, so this is pure UI timing, not wall-clock logic.
#[derive(Default)]
pub struct PopoverGuard {
    hidden_at: Mutex<Option<Instant>>,
    opening_at: Mutex<Option<Instant>>,
}

impl PopoverGuard {
    pub fn mark_hidden(&self) {
        if let Ok(mut g) = self.hidden_at.lock() {
            *g = Some(Instant::now());
        }
    }

    pub fn hidden_recently(&self) -> bool {
        self.hidden_at
            .lock()
            .ok()
            .and_then(|g| *g)
            .is_some_and(|t| t.elapsed() < DISMISS_DEBOUNCE)
    }

    /// A programmatic open has just happened - see `OPENING_GRACE`.
    ///
    /// Also clears the dismiss debounce: an explicit "open it" is not the
    /// second half of a tray toggle, and must not be swallowed as one.
    pub fn mark_opening(&self) {
        if let Ok(mut g) = self.opening_at.lock() {
            *g = Some(Instant::now());
        }
        if let Ok(mut g) = self.hidden_at.lock() {
            *g = None;
        }
    }

    /// Is the panel still settling into an open state?
    pub fn opening(&self) -> bool {
        self.opening_at
            .lock()
            .ok()
            .and_then(|g| *g)
            .is_some_and(|t| t.elapsed() < OPENING_GRACE)
    }

    /// The panel is closed (or being closed): the grace no longer applies.
    pub fn clear_opening(&self) {
        if let Ok(mut g) = self.opening_at.lock() {
            *g = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{PopoverGuard, TrayAnchor};
    use std::thread::sleep;
    use std::time::Duration;

    #[test]
    fn a_fresh_guard_is_neither_hiding_nor_opening() {
        let g = PopoverGuard::default();
        assert!(!g.hidden_recently());
        assert!(!g.opening());
    }

    #[test]
    fn opening_survives_the_blur_that_follows_it() {
        // The race this exists for: showing a non-activating panel from the
        // focused dashboard fires `Focused(false)` on the panel immediately
        // after it appears. Autohide must ignore that one.
        let g = PopoverGuard::default();
        g.mark_opening();
        assert!(
            g.opening(),
            "the opening panel was already fair game to hide"
        );
    }

    #[test]
    fn the_grace_expires_so_a_real_click_away_still_closes_it() {
        let g = PopoverGuard::default();
        g.mark_opening();
        sleep(Duration::from_millis(450));
        assert!(!g.opening(), "the panel could never be dismissed again");
    }

    #[test]
    fn opening_clears_a_pending_dismiss_debounce() {
        // An explicit "open it" is not the second half of a tray toggle.
        // Without this, a click that had just hidden the popover made the
        // next programmatic open a no-op.
        let g = PopoverGuard::default();
        g.mark_hidden();
        assert!(g.hidden_recently());
        g.mark_opening();
        assert!(
            !g.hidden_recently(),
            "an explicit open was swallowed as a toggle"
        );
    }

    #[test]
    fn closing_ends_the_grace_immediately() {
        let g = PopoverGuard::default();
        g.mark_opening();
        g.clear_opening();
        assert!(!g.opening());
    }

    #[test]
    fn repeated_opens_stay_open() {
        // Idempotent: "Open" twice must not toggle it closed, and the
        // second open renews the grace rather than ending it.
        let g = PopoverGuard::default();
        g.mark_opening();
        g.mark_opening();
        assert!(g.opening());
        assert!(!g.hidden_recently());
    }

    #[test]
    fn the_tray_anchor_starts_unknown_and_remembers_what_it_is_told() {
        let a = TrayAnchor::default();
        assert_eq!(a.get(), None);
        a.set(10.0, 0.0, 24.0, 24.0);
        assert_eq!(a.get(), Some((10.0, 0.0, 24.0, 24.0)));
    }
}

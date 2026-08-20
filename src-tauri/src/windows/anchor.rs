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
pub struct PopoverGuard(Mutex<Option<Instant>>);

impl PopoverGuard {
    pub fn mark_hidden(&self) {
        if let Ok(mut g) = self.0.lock() {
            *g = Some(Instant::now());
        }
    }

    pub fn hidden_recently(&self) -> bool {
        self.0
            .lock()
            .ok()
            .and_then(|g| *g)
            .is_some_and(|t| t.elapsed() < DISMISS_DEBOUNCE)
    }
}

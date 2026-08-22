//! The DASHBOARD window - a normal, ordinary application window.
//!
//! Deliberately NOT given the panel treatment in `super::panel`: the
//! dashboard is the "open the app" surface, so it should activate Remi,
//! take a real key window, and behave like any other window. Only the
//! popover is an overlay.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, WindowEvent};

use crate::paths::DASHBOARD_LABEL;

/// How long the frontend gets to tidy up and ask for the window to be
/// hidden before it is hidden regardless.
///
/// Long enough for a flush to land on a slow disk, short enough that a dead
/// webview does not read as a frozen window.
const CLOSE_GRACE_MS: u64 = 3000;

/// Set once the dashboard has registered its close listener.
///
/// The same handshake shape as `QuitReadiness`, for the same reason: an
/// emit proves only that the call did not error, never that anyone heard
/// it. Without this, a crash or a slow boot before the listener registers
/// would leave a window that cannot be closed at all.
#[derive(Default)]
pub struct DashboardCloseReadiness(AtomicBool);

impl DashboardCloseReadiness {
    pub fn mark_ready(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_ready(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Hide the dashboard. Called by the frontend once it has finished tidying
/// up - see `register_dashboard_hide_on_close`.
pub fn hide_dashboard(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(DASHBOARD_LABEL) {
        let _ = win.hide();
    }
}

/// Reveal and focus the dashboard.
///
/// `set_focus()` here is correct and intentional - the opposite of the
/// popover, which must never activate the app.
///
/// Emits `dashboard-opened` ONLY on a genuine hidden -> visible
/// transition, so the frontend can replay its opening splash. Closing the
/// dashboard hides the window and keeps the webview warm, so "the app was
/// opened" is not something the frontend can observe on its own: it gets
/// no mount, and focus is not the same event - the user alt-tabbing back
/// to an already-open window has not reopened anything, and replaying a
/// three-second splash over the work they were looking at would be a bug,
/// not a flourish.
///
/// The visibility read happens BEFORE `show()`, which is the whole
/// distinction; reading it after would report every call as already
/// visible.
pub fn show_dashboard(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(DASHBOARD_LABEL) {
        let announce = should_announce_open(win.is_visible());
        let _ = win.show();
        let _ = win.set_focus();
        if announce {
            let _ = win.emit("dashboard-opened", ());
        }
    }
}

/// Was this `show_dashboard` a genuine OPENING - hidden becoming visible?
///
/// Split out so the rule is testable without a window. An error reading
/// visibility means we do not know it was already up; treat that as "was
/// hidden", because a splash that plays once too often is a smaller
/// failure than a window that reveals itself with no sign it was opening.
fn should_announce_open(visible: tauri::Result<bool>) -> bool {
    !visible.unwrap_or(false)
}

/// Closing the dashboard ASKS the frontend to close, rather than hiding the
/// window out from under it. It hides rather than destroying either way,
/// keeping the webview warm so reopening is instant.
///
/// It used to hide immediately while the frontend separately flushed
/// whatever was in memory. During the tour that is the SAMPLE day - so
/// closing the window mid-tour persisted the demo as the authoritative
/// state, and the popover, which is still running and syncs from disk,
/// picked it up as the user's real day.
///
/// The frontend now restores the real day, waits for that to reach disk,
/// and only then asks for the window to be hidden. If saving fails it says
/// so and the window stays open, which is the honest outcome: hiding a
/// window whose state could not be written is how work disappears.
pub fn register_dashboard_hide_on_close(app: &AppHandle) {
    if let Some(dash) = app.get_webview_window(DASHBOARD_LABEL) {
        let handle = app.clone();
        dash.clone().on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let ready = handle
                    .try_state::<DashboardCloseReadiness>()
                    .is_some_and(|r| r.is_ready());
                if !ready {
                    // Nobody is listening and nobody ever will be - hiding
                    // directly is better than a window that cannot close.
                    let _ = dash.hide();
                    return;
                }
                let _ = handle.emit("dashboard-close-requested", ());
                // ...and a bounded fallback. Readiness latches once and is
                // never cleared, so a webview that dies, hangs or reloads
                // AFTER marking ready would leave this emitting into
                // nothing - a window that can never be closed, which is the
                // exact failure the handshake exists to prevent. If the
                // frontend has not asked us to hide within this window, it
                // is not going to.
                let w = dash.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(CLOSE_GRACE_MS));
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.hide();
                    }
                });
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::should_announce_open;

    /// The distinction the splash depends on: reopening a hidden window is
    /// an opening, and must replay it. Showing a window that is ALREADY up
    /// (which is how focus, or a second click on an open dashboard, arrives
    /// here) is not, and replaying three seconds of splash over the work
    /// someone was looking at would be a bug, not a flourish.
    #[test]
    fn a_hidden_window_becoming_visible_is_an_opening() {
        assert!(should_announce_open(Ok(false)));
    }

    #[test]
    fn showing_an_already_visible_window_is_not_an_opening() {
        assert!(!should_announce_open(Ok(true)));
    }

    #[test]
    fn an_unreadable_visibility_is_treated_as_an_opening() {
        // We do not know it was up. Playing the splash once too often is a
        // smaller failure than revealing the window with no sign of it.
        assert!(should_announce_open(Err(tauri::Error::WebviewNotFound)));
    }
}

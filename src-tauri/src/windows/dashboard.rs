//! The DASHBOARD window - a normal, ordinary application window.
//!
//! Deliberately NOT given the panel treatment in `super::panel`: the
//! dashboard is the "open the app" surface, so it should activate Remi,
//! take a real key window, and behave like any other window. Only the
//! popover is an overlay.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, WindowEvent};

use crate::paths::DASHBOARD_LABEL;

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
pub fn show_dashboard(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(DASHBOARD_LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
    }
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
                if ready {
                    let _ = handle.emit("dashboard-close-requested", ());
                } else {
                    // Nobody is listening and nobody ever will be - hiding
                    // directly is better than a window that cannot close.
                    let _ = dash.hide();
                }
            }
        });
    }
}

//! The DASHBOARD window - a normal, ordinary application window.
//!
//! Deliberately NOT given the panel treatment in `super::panel`: the
//! dashboard is the "open the app" surface, so it should activate Remi,
//! take a real key window, and behave like any other window. Only the
//! popover is an overlay.

use tauri::{AppHandle, Manager, WindowEvent};

use crate::paths::DASHBOARD_LABEL;

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

/// Closing the dashboard hides it rather than destroying it, keeping the
/// webview warm so reopening is instant and no state has to be rehydrated.
pub fn register_dashboard_hide_on_close(app: &AppHandle) {
    if let Some(dash) = app.get_webview_window(DASHBOARD_LABEL) {
        dash.clone().on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = dash.hide();
            }
        });
    }
}

//! The app's two windows.
//!
//! They are deliberately different animals, which is why they live in
//! separate modules:
//!
//! * `popover` - the menu-bar overlay. On macOS it is converted into a
//!   non-activating `NSPanel` (`panel`) so it can float over another app's
//!   fullscreen Space without activating Remi and dragging the user out of
//!   that Space.
//! * `dashboard` - an ordinary application window. No panel treatment, no
//!   always-on-top; opening it is what "opening the app" means.
//!
//! `anchor` holds the small pieces of shared popover state (where the tray
//! icon is, and when the popover was last dismissed).

mod anchor;
mod dashboard;
#[cfg(target_os = "macos")]
mod panel;
mod popover;

/// No-op panel shims off macOS: the fullscreen-Space problem, and the
/// `NSPanel` machinery that solves it, are macOS-only. Windows and Linux
/// use the plain window as-is.
#[cfg(not(target_os = "macos"))]
mod panel {
    pub fn make_overlay_panel(_win: &tauri::WebviewWindow) {}
    pub fn key_and_order_front(_win: &tauri::WebviewWindow) {}
}

pub use anchor::{PopoverGuard, TrayAnchor};
pub use dashboard::{register_dashboard_hide_on_close, show_dashboard};
pub use popover::{prepare_popover_overlay, register_autohide, show_popover, toggle_popover};

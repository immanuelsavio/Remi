//! The POPOVER window - the menu-bar overlay: placement and lifecycle.
//!
//! On macOS this window is converted into a non-activating `NSPanel` (see
//! `super::panel`), which is what lets it draw over another app's
//! fullscreen Space without yanking the user out of it.

use tauri::{AppHandle, Manager, PhysicalPosition, WindowEvent};

use super::anchor::{PopoverGuard, TrayAnchor};
use crate::paths::POPOVER_LABEL;

/// Fallback popover width if the window hasn't reported a size yet. Must
/// match `app.windows[popover].width` in `tauri.conf.json`.
const FALLBACK_WIDTH: f64 = 380.0;
/// Fallback monitor width when no monitor can be identified.
const FALLBACK_MONITOR_WIDTH: f64 = 1440.0;
/// Gap between the menu bar / tray icon and the popover's top edge, in px.
const TRAY_GAP: f64 = 2.0;
/// Minimum gap between the popover and a screen edge, in px.
const EDGE_MARGIN: f64 = 4.0;

/// Apply the overlay treatment once at startup, so the very FIRST tray
/// click already behaves correctly rather than depending on ordering
/// inside `show_popover`.
pub fn prepare_popover_overlay(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(POPOVER_LABEL) {
        super::panel::make_overlay_panel(&win);
    }
}

/// Tray click: show if hidden, dismiss if shown.
pub fn toggle_popover(app: &AppHandle) {
    let Some(win) = app.get_webview_window(POPOVER_LABEL) else {
        return;
    };
    match win.is_visible() {
        Ok(true) => {
            app.state::<PopoverGuard>().mark_hidden();
            hide_popover(&win);
        }
        _ => {
            if app.state::<PopoverGuard>().hidden_recently() {
                return; // this click WAS the dismiss; see `PopoverGuard`
            }
            show_popover(app);
        }
    }
}

/// Where the popover should sit, in physical px, given the tray anchor.
///
/// Split out from `show_popover` so the geometry is a pure function of its
/// inputs: everything here is arithmetic on numbers the caller supplies, so
/// it can be reasoned about (and unit-tested) without a live window.
fn popover_position(
    anchor: Option<(f64, f64, f64, f64)>,
    win_w: f64,
    mon_x: f64,
    mon_y: f64,
    mon_w: f64,
    scale: f64,
) -> (f64, f64) {
    let (x, y) = match anchor {
        // Centre it under the icon, just below the menu bar.
        Some((tx, ty, tw, th)) => (tx + tw / 2.0 - win_w / 2.0, ty + th + TRAY_GAP),
        // No tray event seen yet (e.g. a Spotlight reopen): sit near the
        // top-right where menu-bar extras live, rather than mid-screen,
        // which would not read as a menu-bar popover at all.
        None => (
            mon_x + mon_w - win_w - 12.0 * scale,
            mon_y + 24.0 * scale + TRAY_GAP,
        ),
    };
    // Clamp so a right-edge icon can't push the window off-screen. `min`
    // before `max` so a window wider than the monitor still lands on it.
    let x = x
        .min(mon_x + mon_w - win_w - EDGE_MARGIN)
        .max(mon_x + EDGE_MARGIN);
    (x, y)
}

/// Anchor the popover under the tray icon, then show it.
///
/// Positioning happens BEFORE the show so the window never flashes at its
/// old location. The panel treatment is re-applied on every show because
/// macOS can reset a window's level as activation state changes.
pub fn show_popover(app: &AppHandle) {
    let Some(win) = app.get_webview_window(POPOVER_LABEL) else {
        return;
    };
    let win_w = win
        .outer_size()
        .map(|s| s.width as f64)
        .unwrap_or(FALLBACK_WIDTH);
    let monitor = win.current_monitor().ok().flatten();
    let (mon_x, mon_y, mon_w, scale) = monitor
        .as_ref()
        .map(|m| {
            (
                m.position().x as f64,
                m.position().y as f64,
                m.size().width as f64,
                m.scale_factor(),
            )
        })
        .unwrap_or((0.0, 0.0, FALLBACK_MONITOR_WIDTH, 2.0));

    let (x, y) = popover_position(
        app.state::<TrayAnchor>().get(),
        win_w,
        mon_x,
        mon_y,
        mon_w,
        scale,
    );
    let _ = win.set_position(PhysicalPosition::new(x, y));

    // Deliberately NOT `set_always_on_top(true)`. tao implements that as
    // `set_level_async(NSFloatingWindowLevel)` - it QUEUES the level change
    // onto the main queue, so it lands AFTER the synchronous level set just
    // below and silently clobbers it back down to floating (3), which is
    // not high enough to draw over a fullscreen Space. The status level
    // applied by the panel conversion is strictly above floating anyway, so
    // it subsumes "always on top". (This is also why the popover window is
    // NOT declared `alwaysOnTop` in `tauri.conf.json`.)
    super::panel::make_overlay_panel(&win);
    let _ = win.show();
    // Key status WITHOUT app activation - only possible because the window
    // is now a non-activating panel. See `panel::key_and_order_front`.
    super::panel::key_and_order_front(&win);
}

fn hide_popover(win: &tauri::WebviewWindow) {
    let _ = win.hide();
}

/// Click-away autohide: hide the popover the moment it loses focus.
pub fn register_autohide(app: &AppHandle) {
    let Some(win) = app.get_webview_window(POPOVER_LABEL) else {
        return;
    };
    let w = win.clone();
    let h = app.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            h.state::<PopoverGuard>().mark_hidden();
            hide_popover(&w);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::popover_position;

    /// A 1440-wide monitor at the origin, 2x scale, 380-wide popover.
    const W: f64 = 380.0;

    #[test]
    fn centres_under_the_tray_icon() {
        // Icon 24 wide at x=700 -> centre 712 -> left edge 712 - 190.
        let (x, y) = popover_position(Some((700.0, 0.0, 24.0, 24.0)), W, 0.0, 0.0, 1440.0, 2.0);
        assert_eq!(x, 522.0);
        assert_eq!(y, 26.0, "sits just under the icon, not on top of it");
    }

    #[test]
    fn clamps_a_right_edge_icon_back_onto_the_screen() {
        // An icon at the very right would put the left edge at 1418, i.e.
        // 358px of the popover off-screen.
        let (x, _) = popover_position(Some((1430.0, 0.0, 24.0, 24.0)), W, 0.0, 0.0, 1440.0, 2.0);
        assert_eq!(x, 1440.0 - W - 4.0);
    }

    #[test]
    fn clamps_a_left_edge_icon_back_onto_the_screen() {
        let (x, _) = popover_position(Some((0.0, 0.0, 24.0, 24.0)), W, 0.0, 0.0, 1440.0, 2.0);
        assert_eq!(x, 4.0);
    }

    #[test]
    fn without_an_anchor_it_sits_top_right_not_mid_screen() {
        let (x, y) = popover_position(None, W, 0.0, 0.0, 1440.0, 2.0);
        assert_eq!(x, 1440.0 - W - 24.0);
        assert_eq!(y, 50.0);
        assert!(x > 1440.0 / 2.0, "must read as a menu-bar popover");
    }

    #[test]
    fn respects_a_secondary_monitors_origin() {
        // A monitor to the right of the primary: coordinates are global, so
        // the popover must land on THAT monitor, not the primary.
        let (x, _) = popover_position(None, W, 1440.0, 0.0, 1920.0, 2.0);
        assert!(x >= 1440.0, "placed on the secondary monitor");
        assert_eq!(x, 1440.0 + 1920.0 - W - 24.0);
    }
}

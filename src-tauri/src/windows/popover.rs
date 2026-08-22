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
            hide_popover_guarded(app, &win);
        }
        _ => {
            if app.state::<PopoverGuard>().hidden_recently() {
                return; // this click WAS the dismiss; see `PopoverGuard`
            }
            show_popover(app);
        }
    }
}

/// One monitor, as physical-pixel geometry: `(x, y, w, h, scale)`.
pub type MonitorRect = (f64, f64, f64, f64, f64);

/// Which monitor contains a point (the centre of the tray icon).
///
/// The popover used to take its bounds from `win.current_monitor()` - the
/// monitor the popover WAS on, which after a display switch is the one it
/// was last shown on, not the one whose menu bar was just clicked. The
/// clamp then pulled the window back onto the old screen, so clicking the
/// tray on a second display (in particular a fullscreen Space there) opened
/// the popover on the first.
///
/// The tray anchor is the only input that says where the click happened, so
/// it is what chooses the monitor.
pub fn monitor_for_point(monitors: &[MonitorRect], point: (f64, f64)) -> Option<usize> {
    let (px, py) = point;
    monitors
        .iter()
        .position(|&(x, y, w, h, _)| px >= x && px < x + w && py >= y && py < y + h)
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
    let anchor = app.state::<TrayAnchor>().get();

    // The monitor whose menu bar was CLICKED, not the one the popover was
    // last shown on - see `monitor_for_point`.
    let rects: Vec<MonitorRect> = win
        .available_monitors()
        .map(|ms| {
            ms.iter()
                .map(|m| {
                    (
                        m.position().x as f64,
                        m.position().y as f64,
                        m.size().width as f64,
                        m.size().height as f64,
                        m.scale_factor(),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let by_anchor = anchor
        .and_then(|(tx, ty, tw, th)| monitor_for_point(&rects, (tx + tw / 2.0, ty + th / 2.0)))
        .map(|i| rects[i]);
    let (mon_x, mon_y, mon_w, scale) = by_anchor
        .or_else(|| {
            // No anchor, or an anchor on no known monitor (a display
            // unplugged between the click and this call): the popover's own
            // monitor is the next best answer, then the fallback.
            win.current_monitor().ok().flatten().map(|m| {
                (
                    m.position().x as f64,
                    m.position().y as f64,
                    m.size().width as f64,
                    m.size().height as f64,
                    m.scale_factor(),
                )
            })
        })
        .map(|(x, y, w, _h, scale)| (x, y, w, scale))
        .unwrap_or((0.0, 0.0, FALLBACK_MONITOR_WIDTH, 2.0));

    let (x, y) = popover_position(anchor, win_w, mon_x, mon_y, mon_w, scale);
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
    // Arm the opening grace BEFORE showing. Making a non-activating panel
    // key produces a `Focused(false)` on it almost immediately - the window
    // manager settling, not a person clicking away - and autohide could not
    // tell the two apart, so a programmatic open showed the panel and hid
    // it again in the same breath.
    app.state::<PopoverGuard>().mark_opening();
    let _ = win.show();
    // Key status WITHOUT app activation - only possible because the window
    // is now a non-activating panel. See `panel::key_and_order_front`.
    super::panel::key_and_order_front(&win);
}

fn hide_popover(win: &tauri::WebviewWindow) {
    let _ = win.hide();
}

/// Hide, and end any opening grace with it - a closed panel is not
/// "settling into open", and a grace left running would swallow the next
/// genuine click-away.
fn hide_popover_guarded(app: &AppHandle, win: &tauri::WebviewWindow) {
    app.state::<PopoverGuard>().clear_opening();
    hide_popover(win);
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
            let guard = h.state::<PopoverGuard>();
            // The blur that programmatic opening causes is not a dismissal.
            // A real click-away arrives after the grace and still closes.
            if guard.opening() {
                return;
            }
            guard.mark_hidden();
            hide_popover(&w);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{monitor_for_point, popover_position, MonitorRect};

    /// A primary 1440-wide screen at the origin, and a second one to its
    /// right - the ordinary two-display layout.
    const TWO: [MonitorRect; 2] = [
        (0.0, 0.0, 1440.0, 900.0, 2.0),
        (1440.0, 0.0, 1920.0, 1080.0, 1.0),
    ];

    #[test]
    fn picks_the_monitor_the_tray_icon_was_clicked_on() {
        // A tray icon near the right of the SECOND display.
        assert_eq!(monitor_for_point(&TWO, (3000.0, 12.0)), Some(1));
        assert_eq!(monitor_for_point(&TWO, (700.0, 12.0)), Some(0));
    }

    #[test]
    fn a_point_on_no_monitor_picks_nothing() {
        // A display unplugged between the click and the show.
        assert_eq!(monitor_for_point(&TWO, (9999.0, 12.0)), None);
        assert_eq!(monitor_for_point(&[], (0.0, 0.0)), None);
    }

    #[test]
    fn monitor_edges_belong_to_exactly_one_screen() {
        // The seam between two displays must not match both, or the clamp
        // depends on iteration order.
        assert_eq!(monitor_for_point(&TWO, (1440.0, 5.0)), Some(1));
        assert_eq!(monitor_for_point(&TWO, (1439.0, 5.0)), Some(0));
    }

    #[test]
    fn a_secondary_monitor_clamps_within_its_own_bounds() {
        // The bug: bounds came from the popover's old monitor, so a click
        // on the second display was clamped back onto the first.
        let (x, y) = popover_position(Some((3400.0, 0.0, 24.0, 24.0)), W, 1440.0, 0.0, 1920.0, 1.0);
        assert!(x >= 1440.0, "the popover was pulled onto the other screen");
        assert_eq!(x, 1440.0 + 1920.0 - W - 4.0);
        assert_eq!(y, 26.0);
    }

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

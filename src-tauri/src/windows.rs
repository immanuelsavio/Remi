//! POPOVER + DASHBOARD windows - positioning and lifecycle.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, PhysicalPosition, WindowEvent};

use crate::paths::{DASHBOARD_LABEL, POPOVER_LABEL};

/// Let a window draw over ANOTHER app's fullscreen Space, not just switch
/// between ordinary desktop Spaces.
///
/// Two things are required together, not just one:
///
/// 1. `NSWindowCollectionBehavior.canJoinAllSpaces | .fullScreenAuxiliary` -
///    `WebviewWindow::set_visible_on_all_workspaces` (Tauri's public API)
///    only sets `canJoinAllSpaces`, which moves a window along when you
///    switch Spaces but does NOT let it render above a Space that's
///    actually in fullscreen. `.fullScreenAuxiliary` has no Tauri-level
///    accessor.
/// 2. A high enough window LEVEL. Tauri's `alwaysOnTop` only reaches
///    `NSFloatingWindowLevel` (3) - real fullscreen Spaces composite above
///    that. `NSStatusWindowLevel` (25, the same level real menu-bar status
///    items render at) is what actually clears a fullscreen Space's layer;
///    without this the collection-behavior flags alone are not sufficient,
///    which is why the first attempt at this (behavior only, no level
///    change) still didn't show over fullscreen apps.
///
/// Both are set via the raw `NSWindow` from `ns_window()`. Best-effort: if
/// the window doesn't exist yet or the pointer cast fails, this silently
/// no-ops rather than panicking the whole app over a cosmetic behavior.
#[cfg(target_os = "macos")]
fn apply_overlay_collection_behavior(win: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSStatusWindowLevel, NSWindowCollectionBehavior};

    let Ok(ptr) = win.ns_window() else { return };
    if ptr.is_null() {
        return;
    }
    // SAFETY: `ns_window()` hands back a valid, retained `NSWindow*` for the
    // lifetime of this call (Tauri autoreleases it into the current pool);
    // `objc2` types are `#[repr(transparent)]` over the raw pointer, so this
    // cast is the standard way to recover a typed reference from Tauri's
    // "raw window handle" escape hatch.
    let ns_window: &objc2_app_kit::NSWindow = unsafe { &*(ptr as *const objc2_app_kit::NSWindow) };
    let behavior = ns_window.collectionBehavior()
        | NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::FullScreenAuxiliary;
    ns_window.setCollectionBehavior(behavior);
    ns_window.setLevel(NSStatusWindowLevel);
    if std::env::var_os("REMI_DEBUG_WINDOW").is_some() {
        eprintln!(
            "[remi] overlay applied: behavior={:?} level={}",
            ns_window.collectionBehavior(),
            ns_window.level()
        );
    }
}

#[cfg(not(target_os = "macos"))]
fn apply_overlay_collection_behavior(_win: &tauri::WebviewWindow) {}

/// Apply the overlay treatment to the popover once at startup.
///
/// `show_popover` re-applies this on every show (cheap, and macOS can reset
/// a window's level when the app's activation state changes), but doing it
/// once at boot means the very first tray click already has the right
/// behavior rather than depending on ordering inside that call.
pub fn prepare_popover_overlay(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(POPOVER_LABEL) {
        apply_overlay_collection_behavior(&win);
    }
}

/// The tray icon's rectangle in physical px, captured from tray events.
#[derive(Default)]
pub struct TrayAnchor(Mutex<Option<(f64, f64, f64, f64)>>);

impl TrayAnchor {
    pub fn set(&self, x: f64, y: f64, w: f64, h: f64) {
        if let Ok(mut g) = self.0.lock() {
            *g = Some((x, y, w, h));
        }
    }
    fn get(&self) -> Option<(f64, f64, f64, f64)> {
        self.0.lock().ok().and_then(|g| *g)
    }
}

/// How long after a hide a toggle-driven show is suppressed.
const DISMISS_DEBOUNCE: Duration = Duration::from_millis(200);

/// Guard against the menubar double-handler race.
///
/// Clicking the tray icon while the popover is open fires TWO things, in
/// order: (1) the popover loses focus -> autohide hides it; THEN (2) the
/// tray click handler runs `toggle_popover`, which now sees
/// `is_visible() == false` and would re-show it - so the tray could never
/// DISMISS the popover, it just flickered and reopened. We record the last
/// hide and swallow a show that arrives within ~200ms of it. `Instant` is
/// monotonic, so this is pure UI timing, not wall-clock logic.
#[derive(Default)]
pub struct PopoverGuard(Mutex<Option<Instant>>);

impl PopoverGuard {
    fn mark_hidden(&self) {
        if let Ok(mut g) = self.0.lock() {
            *g = Some(Instant::now());
        }
    }
    fn hidden_recently(&self) -> bool {
        self.0
            .lock()
            .ok()
            .and_then(|g| *g)
            .is_some_and(|t| t.elapsed() < DISMISS_DEBOUNCE)
    }
}

pub fn toggle_popover(app: &AppHandle) {
    let Some(win) = app.get_webview_window(POPOVER_LABEL) else {
        return;
    };
    match win.is_visible() {
        Ok(true) => {
            app.state::<PopoverGuard>().mark_hidden();
            hide_popover_window(app, &win);
        }
        _ => {
            if app.state::<PopoverGuard>().hidden_recently() {
                return; // this click was the dismiss; see PopoverGuard
            }
            show_popover(app);
        }
    }
}

/// Anchor the popover under the tray icon, then show + focus it.
///
/// Positioning happens BEFORE `show()` so the window never flashes at its
/// old location. The overlay treatment (status level + all-Spaces /
/// fullscreen-auxiliary collection behavior) is re-applied on every show
/// because a menu-bar (Accessory) app's window can otherwise open BEHIND
/// the frontmost app, and macOS can reset a window's level as activation
/// state changes.
pub fn show_popover(app: &AppHandle) {
    let Some(win) = app.get_webview_window(POPOVER_LABEL) else {
        return;
    };
    let win_w = win.outer_size().map(|s| s.width as f64).unwrap_or(380.0);
    let monitor = win.current_monitor().ok().flatten();
    let (mon_x, mon_w, mon_y) = monitor
        .as_ref()
        .map(|m| {
            (
                m.position().x as f64,
                m.size().width as f64,
                m.position().y as f64,
            )
        })
        .unwrap_or((0.0, 1440.0, 0.0));

    let (mut x, y) = match app.state::<TrayAnchor>().get() {
        // Centre it under the icon, just below the menu bar.
        Some((tx, ty, tw, th)) => (tx + tw / 2.0 - win_w / 2.0, ty + th + 2.0),
        // No tray event seen yet (e.g. a Spotlight reopen): sit near the
        // top-right where menu-bar extras live, rather than mid-screen -
        // which would not read as a menu-bar popover at all.
        None => {
            let scale = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(2.0);
            (
                mon_x + mon_w - win_w - 12.0 * scale,
                mon_y + 24.0 * scale + 2.0,
            )
        }
    };
    // Clamp so a right-edge icon can't push the window off-screen.
    x = x.min(mon_x + mon_w - win_w - 4.0).max(mon_x + 4.0);
    let _ = win.set_position(PhysicalPosition::new(x, y));

    // Deliberately NOT `set_always_on_top(true)` here. tao implements that as
    // `set_level_async(NSFloatingWindowLevel)` - it QUEUES the level change
    // onto the main queue, so it lands AFTER the synchronous level we set
    // just below and silently clobbers it back down to floating (3). Floating
    // is not high enough to draw over a fullscreen Space, which is exactly the
    // bug this whole function exists to fix. The status level applied by
    // `apply_overlay_collection_behavior` is already strictly above floating,
    // so it subsumes "always on top" anyway.
    apply_overlay_collection_behavior(&win);
    let _ = win.show();
    let _ = win.set_focus();
}

fn hide_popover_window(_app: &AppHandle, win: &tauri::WebviewWindow) {
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
            hide_popover_window(&h, &w);
        }
    });
}

/// Reveal + focus the dashboard. It is a NORMAL window (config-declared,
/// hidden at startup) - no always-on-top, no panel treatment.
pub fn show_dashboard(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(DASHBOARD_LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Dashboard close hides rather than destroys, keeping the webview warm so
/// reopening is instant.
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

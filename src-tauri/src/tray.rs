//! TRAY - the menu-bar icon (drawn in code, no PNG on disk).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::menu::{Menu, MenuEvent, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::windows::{show_dashboard, show_popover, toggle_popover};

/// Set once the frontend (the popover, the effect owner) has successfully
/// registered its `quit-requested` listener - see the frontend's
/// `registerQuitListener()` and the `quit_listener_ready` command below.
///
/// This is the real quit HANDSHAKE: `app.emit(...).is_ok()` only proves the
/// emit call itself didn't error, never that anyone received it. Without
/// this flag, a crash or slow boot between process start and the listener
/// registering would make Quit silently do nothing - the tray click would
/// emit into the void forever. With it, Rust can tell the difference
/// between "the frontend is listening, trust the handshake" and "nobody
/// will ever hear this, fall back to exiting directly".
#[derive(Default)]
pub struct QuitReadiness(AtomicBool);

/// Set the instant a DELIBERATE exit begins.
///
/// A menu-bar app does not stop existing because no window happens to be on
/// screen - the tray icon IS the app, and both windows spend most of their
/// life hidden rather than closed. Tauri's default is to exit once it
/// believes the last window is gone, which for this app meant silent
/// death: exit code 0, no panic, no save, and the user's only clue was that
/// the icon vanished. `ExitRequested` is refused unless this says the exit
/// was asked for.
#[derive(Default)]
pub struct Quitting(AtomicBool);

impl Quitting {
    pub fn begin(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_quitting(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

impl QuitReadiness {
    pub fn mark_ready(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    /// The listener is going away (a reload, a teardown, a webview that
    /// stopped answering). Latched forever, readiness meant a popover that
    /// reloaded or crashed AFTER marking itself ready left every later Quit
    /// emitting into nothing - with `Quitting` never set, so `ExitRequested`
    /// refused every other exit too, and Remi could not be quit at all.
    pub fn mark_unready(&self) {
        self.0.store(false, Ordering::SeqCst);
    }
    pub fn is_ready(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// How long a quit request waits for the frontend to say it HEARD it.
///
/// Not a save budget: the flush that follows may take as long as it needs,
/// and a failed one deliberately keeps the app open. This bounds only "is
/// anybody there".
const QUIT_ACK_MS: u64 = 1500;

/// One quit conversation, identified - the same shape as the dashboard's
/// `CloseRequests`, for the same reason.
///
/// A boolean cannot distinguish "the save is slow", "the save failed and
/// the app is staying open on purpose", and "the webview is gone". An id
/// plus a receipt can: the receipt says someone is there, and everything
/// after that is theirs to decide.
#[derive(Default)]
pub struct QuitRequests {
    current: AtomicU64,
    acked: AtomicBool,
    next: AtomicU64,
}

impl QuitRequests {
    /// Start a request, or `None` if one is already in flight - pressing
    /// Quit twice observes the shutdown already happening.
    pub fn begin(&self) -> Option<u64> {
        if self.current.load(Ordering::SeqCst) != 0 {
            return None;
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        self.current.store(id, Ordering::SeqCst);
        self.acked.store(false, Ordering::SeqCst);
        Some(id)
    }
    pub fn ack(&self, id: u64) {
        if self.current.load(Ordering::SeqCst) == id {
            self.acked.store(true, Ordering::SeqCst);
        }
    }
    pub fn is_current(&self, id: u64) -> bool {
        id != 0 && self.current.load(Ordering::SeqCst) == id
    }
    pub fn was_acked(&self, id: u64) -> bool {
        self.is_current(id) && self.acked.load(Ordering::SeqCst)
    }
    /// The conversation is over: the app is going away, or the save failed
    /// and it is staying. Either way a later Quit may start a fresh one -
    /// which is what keeps a failed save from making the app unquittable.
    pub fn finish(&self, id: u64) {
        if self.is_current(id) {
            self.current.store(0, Ordering::SeqCst);
            self.acked.store(false, Ordering::SeqCst);
        }
    }
}

/// The live tray icon, kept so the title can be updated as the clock runs.
/// Stored rather than rebuilt: recreating a tray icon makes it flicker and
/// lose its position in the menu bar.
#[derive(Default)]
pub struct TrayHandle(pub Mutex<Option<tauri::tray::TrayIcon>>);

/// The menu-bar mark: the app's mascot silhouette, pre-chroma-keyed to a
/// transparent 64x64 RGBA buffer and embedded at compile time (no PNG
/// decoder dependency needed - see `assets/tray_mark.rgba`).
///
/// A template image is a solid mark: macOS recolours it for light/dark menu
/// bars, so shape (opacity) is all that matters; RGB is ignored.
const TRAY_MARK_RGBA: &[u8] = include_bytes!("../assets/tray_mark.rgba");
const TRAY_MARK_SIZE: u32 = 64;

pub fn tray_image() -> tauri::image::Image<'static> {
    tauri::image::Image::new(TRAY_MARK_RGBA, TRAY_MARK_SIZE, TRAY_MARK_SIZE)
}

/// Show text next to the menu-bar icon. macOS only (documented as
/// unsupported on Windows; Linux panels may ignore it), so this is a silent
/// no-op elsewhere.
pub fn apply_tray_title(app: &AppHandle, title: Option<String>) {
    let Some(handle) = app.try_state::<TrayHandle>() else {
        return;
    };
    // CLONE the icon out and DROP the lock before calling into the tray.
    // `TrayIcon` is a cheap handle; holding the mutex across `set_title` (a
    // main thread UI call) let a once-a-second title update block the tray's
    // own click handler - the icon stopped opening the popover.
    let tray = match handle.0.lock() {
        Ok(g) => g.as_ref().cloned(),
        Err(_) => None,
    };
    if let Some(tray) = tray {
        let _ = tray.set_title(title.as_deref());
    }
}

const MENU_OPEN: &str = "open";
const MENU_DASHBOARD: &str = "dashboard";
const MENU_QUIT: &str = "quit";

/// Pull the icon rectangle (physical px) out of any tray event.
pub fn event_rect(event: &TrayIconEvent) -> Option<(f64, f64, f64, f64)> {
    let rect = match event {
        TrayIconEvent::Click { rect, .. }
        | TrayIconEvent::DoubleClick { rect, .. }
        | TrayIconEvent::Enter { rect, .. }
        | TrayIconEvent::Move { rect, .. }
        | TrayIconEvent::Leave { rect, .. } => rect,
        _ => return None,
    };
    let pos = rect.position.to_physical::<f64>(1.0);
    let size = rect.size.to_physical::<f64>(1.0);
    Some((pos.x, pos.y, size.width, size.height))
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        MENU_OPEN => show_popover(app),
        MENU_DASHBOARD => show_dashboard(app),
        MENU_QUIT => request_quit(app),
        _ => {}
    }
}

/// Do NOT sleep-then-exit here: a fixed delay is a guess against the
/// frontend's debounce timer and can race a save that hasn't landed yet.
/// Instead, ask the frontend (the popover, the effect owner) to flush its
/// pending save and call `quit_app` itself once that's actually done - the
/// same path the dashboard's Quit button already uses (`requestQuit` in
/// `store/persistence.ts`).
///
/// This is a real HANDSHAKE, not a hopeful emit: `QuitReadiness` is only
/// set once the frontend has confirmed (via the `quit_listener_ready`
/// command) that its `quit-requested` listener is actually registered.
/// `app.emit(...).is_ok()` alone proves nothing - it only means the emit
/// call itself didn't error, not that anyone is listening.
///
/// If the frontend never reached that point (e.g. a crash during boot,
/// before `registerQuitListener()` ran), there is genuinely nobody who
/// will ever call `quit_app` - falling back to `app.exit(0)` directly is
/// the deliberate, honest choice here, not a guess: it only fires when we
/// KNOW no handshake partner exists, never as a race against one that
/// does.
pub fn request_quit(app: &AppHandle) {
    let ready = app
        .try_state::<QuitReadiness>()
        .is_some_and(|r| r.is_ready());
    if !ready {
        // Nobody could ever answer. Exiting directly is the honest choice.
        exit_now(app);
        return;
    }
    let Some(id) = app.try_state::<QuitRequests>().and_then(|r| r.begin()) else {
        // A shutdown is already under way; asking twice does not start a
        // second one over the top of it.
        return;
    };
    let _ = app.emit("quit-requested", id);

    // The bounded fallback asks ONE question: did anyone hear us? It never
    // guesses at the save. An acked request belongs to the frontend - a
    // slow write takes as long as it takes, and a failed one deliberately
    // keeps the app open with the error on screen.
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(QUIT_ACK_MS));
        let Some(reqs) = h.try_state::<QuitRequests>() else {
            return;
        };
        if !reqs.is_current(id) || reqs.was_acked(id) {
            return;
        }
        // Silence. The webview reloaded, crashed or hung after marking
        // itself ready - the case that used to leave Remi unquittable.
        if let Some(r) = h.try_state::<QuitReadiness>() {
            r.mark_unready();
        }
        reqs.finish(id);
        exit_now(&h);
    });
}

/// Exit deliberately: mark it first, or `main.rs`'s `ExitRequested` guard
/// refuses it and the app becomes unquittable.
pub fn exit_now(app: &AppHandle) {
    if let Some(q) = app.try_state::<Quitting>() {
        q.begin();
    }
    app.exit(0);
}

/// Build and register the tray icon.
///
/// Right-click opens the menu; left-click toggles the popover
/// (`show_menu_on_left_click(false)` is what keeps those separate). The menu
/// exists because a tray-only app otherwise has no way to quit at all.
pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, MENU_OPEN, "Open Remi", true, None::<&str>)?;
    let dash = MenuItem::with_id(app, MENU_DASHBOARD, "Open Dashboard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit Remi", true, Some("CmdOrCtrl+Q"))?;
    let menu = Menu::with_items(app, &[&open, &dash, &quit])?;

    let tray = TrayIconBuilder::new()
        .tooltip("Remi")
        .icon(tray_image())
        // macOS: recolour the mark to match a light or dark menu bar.
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            // Record the icon rect from EVERY event so the popover can
            // anchor under it. (We anchor manually because the positioner's
            // TrayCenter returned screen-centre on macOS in testing.)
            if let Some((x, y, w, h)) = event_rect(&event) {
                app.state::<crate::windows::TrayAnchor>().set(x, y, w, h);
            }
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_popover(app);
            }
        })
        .build(app)?;

    if let Ok(mut g) = app.state::<TrayHandle>().0.lock() {
        *g = Some(tray);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quit_readiness_starts_false_and_latches_true_once_marked() {
        let r = QuitReadiness::default();
        assert!(!r.is_ready(), "must start false - no handshake yet");
        r.mark_ready();
        assert!(r.is_ready());
        // Marking again is idempotent, not a toggle.
        r.mark_ready();
        assert!(r.is_ready());
    }

    #[test]
    fn readiness_can_be_withdrawn_when_the_listener_goes_away() {
        // A popover that reloads or crashes AFTER marking itself ready used
        // to leave Quit emitting into nothing forever, with `Quitting`
        // never set - so the exit guard refused every other exit too and
        // Remi could not be quit at all.
        let r = QuitReadiness::default();
        r.mark_ready();
        r.mark_unready();
        assert!(!r.is_ready());
    }

    #[test]
    fn one_quit_at_a_time() {
        let q = QuitRequests::default();
        let first = q.begin().expect("the first quit starts");
        assert!(
            q.begin().is_none(),
            "a second Quit started its own shutdown"
        );
        q.finish(first);
        assert!(q.begin().is_some());
    }

    #[test]
    fn a_failed_save_leaves_the_app_quittable() {
        // The failure branch finishes the request, so the NEXT Quit is a
        // fresh conversation rather than being swallowed by a latch.
        let q = QuitRequests::default();
        let id = q.begin().unwrap();
        q.ack(id);
        q.finish(id); // the save failed; the app stayed open
        let again = q.begin();
        assert!(again.is_some(), "a failed save made the app unquittable");
        assert_ne!(again, Some(id), "the retry reused the old request id");
    }

    #[test]
    fn an_ack_from_a_stale_request_does_not_count() {
        let q = QuitRequests::default();
        let id = q.begin().unwrap();
        q.ack(id + 7);
        assert!(!q.was_acked(id), "a stale ack silenced the fallback");
    }

    #[test]
    fn an_unacked_request_is_still_current_so_the_fallback_can_act() {
        let q = QuitRequests::default();
        let id = q.begin().unwrap();
        assert!(q.is_current(id));
        assert!(!q.was_acked(id));
    }

    #[test]
    fn tray_image_is_a_transparent_template_mark() {
        let img = tray_image();
        assert_eq!((img.width(), img.height()), (64, 64));
        assert_eq!(img.rgba().len(), (64 * 64 * 4) as usize);
        let px = |x: usize, y: usize| img.rgba()[(y * 64 + x) * 4 + 3];
        assert_eq!(px(0, 0), 0, "corner is transparent, not a filled square");
        // Somewhere in the mark's interior must be opaque - otherwise the
        // whole image chroma-keyed away to nothing.
        let has_opaque_pixel = (0..64)
            .flat_map(|y| (0..64).map(move |x| (x, y)))
            .any(|(x, y)| px(x, y) > 200);
        assert!(has_opaque_pixel, "the mark itself must be opaque somewhere");
    }
}

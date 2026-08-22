//! The DASHBOARD window - a normal, ordinary application window.
//!
//! Deliberately NOT given the panel treatment in `super::panel`: the
//! dashboard is the "open the app" surface, so it should activate Remi,
//! take a real key window, and behave like any other window. Only the
//! popover is an overlay.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use tauri::{AppHandle, Emitter, Manager, WindowEvent};

use crate::paths::DASHBOARD_LABEL;

/// How long a close request waits for the frontend to say it HEARD it.
///
/// This is not a save budget. It is the only question a native fallback can
/// honestly answer: is anyone there? A webview that has crashed, reloaded
/// or hung answers nothing; one that is merely writing a large day to a
/// slow disk answers instantly and then takes as long as it takes.
const CLOSE_ACK_MS: u64 = 1500;

/// Set once the dashboard has registered its close listener.
///
/// The same handshake shape as `QuitReadiness`, for the same reason: an
/// emit proves only that the call did not error, never that anyone heard
/// it. Without this, a crash or a slow boot before the listener registers
/// would leave a window that cannot be closed at all.
///
/// It is CLEARED again when the listener goes away (a reload, a teardown).
/// Latched forever, a webview that died after marking itself ready left
/// every later close emitting into nothing - the exact failure the
/// handshake exists to prevent.
#[derive(Default)]
pub struct DashboardCloseReadiness(AtomicBool);

impl DashboardCloseReadiness {
    pub fn mark_ready(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn mark_unready(&self) {
        self.0.store(false, Ordering::SeqCst);
    }
    pub fn is_ready(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// One close conversation, identified.
///
/// The old shape was a boolean plus an unconditional three-second hide, and
/// it had no way to tell these apart:
///
/// - the frontend said the save FAILED and deliberately kept the window
///   open (the fallback hid it anyway, contradicting the message on
///   screen);
/// - the close succeeded, the user reopened the dashboard inside the same
///   three seconds, and the stale fallback hid the window they had just
///   asked for;
/// - the user clicked close twice, and two fallback threads raced;
/// - the webview was genuinely dead.
///
/// An id per request answers all four: a fallback only ever acts on ITS own
/// request, and only while that request is still the current one.
#[derive(Default)]
pub struct CloseRequests {
    /// The id of the request currently in flight, or 0 for none.
    current: AtomicU64,
    /// Whether the frontend has confirmed receipt of `current`.
    acked: AtomicBool,
    next: AtomicU64,
}

impl CloseRequests {
    /// Start a request, or `None` if one is already in flight.
    ///
    /// Duplicate close clicks share the one conversation rather than
    /// starting a second: two requests would mean two fallbacks, and the
    /// second's answer would arrive for a window the first had already
    /// dealt with.
    pub fn begin(&self) -> Option<u64> {
        if self.current.load(Ordering::SeqCst) != 0 {
            return None;
        }
        let id = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        self.current.store(id, Ordering::SeqCst);
        self.acked.store(false, Ordering::SeqCst);
        Some(id)
    }

    /// The frontend heard request `id`. Ignored for a stale id.
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

    /// This conversation is over - it succeeded, failed, or was abandoned.
    pub fn finish(&self, id: u64) {
        if self.is_current(id) {
            self.current.store(0, Ordering::SeqCst);
            self.acked.store(false, Ordering::SeqCst);
        }
    }

    /// The dashboard was opened: nothing pending applies to it any more.
    ///
    /// Without this, a close that completed and a user who reopened the
    /// window within the fallback window met each other - and the window
    /// they had just asked for vanished.
    pub fn invalidate(&self) {
        self.current.store(0, Ordering::SeqCst);
        self.acked.store(false, Ordering::SeqCst);
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
        // Opening invalidates anything pending: a close that is still being
        // answered belongs to the window the user has just asked to see.
        if let Some(reqs) = app.try_state::<CloseRequests>() {
            reqs.invalidate();
        }
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
                let Some(id) = handle.try_state::<CloseRequests>().and_then(|r| r.begin()) else {
                    // A close is already in flight. Two requests would mean
                    // two fallbacks, and the second's answer would arrive
                    // for a window the first had already dealt with.
                    return;
                };
                let _ = handle.emit("dashboard-close-requested", id);
                // ...and a bounded fallback that asks ONE question: did
                // anyone hear us? A webview that has crashed, reloaded or
                // hung answers nothing. One that is merely writing a large
                // day to a slow disk answers instantly and then takes as
                // long as it needs - and a save that FAILS deliberately
                // keeps the window open, which the old unconditional hide
                // overrode while the UI said the opposite.
                let w = dash.clone();
                let h = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(CLOSE_ACK_MS));
                    let Some(reqs) = h.try_state::<CloseRequests>() else {
                        return;
                    };
                    // Not our request any more: it finished, or the window
                    // was reopened and everything pending was invalidated.
                    // Hiding here is how a reopened dashboard used to
                    // vanish a moment after the user asked for it.
                    if !reqs.is_current(id) {
                        return;
                    }
                    if reqs.was_acked(id) {
                        return; // someone is there; it is their call now
                    }
                    // Nobody answered. Mark the listener unready so the
                    // next close does not wait on it again, and hide.
                    if let Some(r) = h.try_state::<DashboardCloseReadiness>() {
                        r.mark_unready();
                    }
                    reqs.finish(id);
                    let _ = w.hide();
                });
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{should_announce_open, CloseRequests, DashboardCloseReadiness};

    #[test]
    fn one_close_at_a_time_however_many_times_it_is_asked_for() {
        // Two requests would mean two fallbacks, and the second's answer
        // would arrive for a window the first had already dealt with.
        let r = CloseRequests::default();
        let first = r.begin().expect("the first close starts");
        assert!(
            r.begin().is_none(),
            "a second close started its own request"
        );
        r.finish(first);
        assert!(r.begin().is_some(), "a later close could not start");
    }

    #[test]
    fn an_ack_belongs_to_its_own_request_only() {
        let r = CloseRequests::default();
        let id = r.begin().unwrap();
        r.ack(id + 99); // some other, stale conversation
        assert!(!r.was_acked(id));
        r.ack(id);
        assert!(r.was_acked(id));
    }

    #[test]
    fn reopening_the_dashboard_invalidates_a_pending_close() {
        // The failure: close succeeds, the user reopens inside the fallback
        // window, and the stale fallback hides the window they just asked
        // for.
        let r = CloseRequests::default();
        let id = r.begin().unwrap();
        r.invalidate(); // show_dashboard
        assert!(!r.is_current(id), "a stale fallback could still act");
        assert!(r.begin().is_some(), "reopening left the door locked");
    }

    #[test]
    fn a_finished_request_is_no_longer_current() {
        let r = CloseRequests::default();
        let id = r.begin().unwrap();
        r.finish(id);
        assert!(!r.is_current(id));
        assert!(!r.was_acked(id));
    }

    #[test]
    fn finishing_someone_elses_request_does_nothing() {
        let r = CloseRequests::default();
        let mine = r.begin().unwrap();
        r.finish(mine + 5);
        assert!(r.is_current(mine), "an unrelated id closed a live request");
    }

    #[test]
    fn readiness_can_be_cleared_when_the_listener_goes_away() {
        // Latched forever, a webview that died after marking itself ready
        // left every later close emitting into nothing.
        let r = DashboardCloseReadiness::default();
        assert!(!r.is_ready());
        r.mark_ready();
        assert!(r.is_ready());
        r.mark_unready();
        assert!(!r.is_ready(), "a dead listener still counted as present");
    }

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

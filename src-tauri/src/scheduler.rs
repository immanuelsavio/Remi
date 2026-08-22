//! THE NATIVE SCHEDULER - the part of the clock that cannot be suspended.
//!
//! Every background effect used to hang off a `setInterval` in the popover
//! webview: reminders, wellness nudges, break-end notifications, the tray
//! title, and the 20-second checkpoint that bounds how much tracked time a
//! crash can cost. The popover is hidden almost all of its life, and macOS
//! is free to throttle or suspend a hidden WKWebView's timers - so the
//! guarantee "a crash costs at most 20 seconds" rested on a timer the OS
//! had no obligation to run.
//!
//! This module is the process's own heartbeat, on a real OS thread:
//!
//! 1. It TICKS: an event carrying the current time, once a second. Arriving
//!    IPC wakes a throttled webview promptly, where its own coalesced timer
//!    would not - so the effects that must stay in the frontend (they are
//!    the domain's logic, and a second copy of them in Rust would be a
//!    second thing to keep right) run when they should.
//! 2. It CHECKPOINTS: if nobody has saved a running session for long
//!    enough, it banks the time itself, in the one way that needs no domain
//!    knowledge at all - see `state_io::touch_saved_at`.
//! 3. It holds the EFFECT LEASE: exactly one window runs effects, and if
//!    that window stops answering, another may take over. Ownership used to
//!    be a compile-time constant (`owner: true` in the popover), so a
//!    suspended popover meant nobody ran effects at all while a perfectly
//!    awake dashboard sat there.
//!
//! What is deliberately NOT here: reminder scheduling, wellness timing, the
//! day rollover, the notification copy. Those are domain logic with one
//! source of truth in `src/domain`, and porting them would create two
//! implementations that must agree forever. The heartbeat wakes the window
//! that owns them instead.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter};

use crate::paths::data_folder;

/// How often the heartbeat fires.
const TICK_MS: u64 = 1000;

/// How long a lease survives without a heartbeat from its holder.
///
/// Long enough that an ordinary busy moment (a big render, a slow save)
/// never loses the lease; short enough that a genuinely suspended window
/// does not keep the app quiet for a noticeable time.
pub const LEASE_MS: u64 = 5_000;

/// How stale a running session's last save must be before the native
/// checkpoint steps in.
///
/// Deliberately longer than the frontend's own 20-second checkpoint: this
/// is a fallback for when that has stopped happening, not a second
/// scheduler competing with it.
pub const NATIVE_CHECKPOINT_MS: u64 = 30_000;

/// Who runs background effects, and when they last said they were alive.
///
/// A LEASE rather than a flag. The failure a flag cannot express is the one
/// that actually happens: the owner is still *there* - the webview exists,
/// its module state is intact - but the OS has stopped running its timers,
/// so it neither does the work nor releases it.
#[derive(Default)]
pub struct EffectLease {
    holder: Mutex<Option<String>>,
    last_seen: AtomicU64,
}

impl EffectLease {
    /// Claim the lease, or renew it. Returns whether the caller now holds it.
    ///
    /// A window may take a lease that has EXPIRED, but never one that is
    /// live: two owners means duplicate notifications, and a bounded
    /// check-in consumed in a window nobody is looking at.
    pub fn claim(&self, window: &str, now: u64) -> bool {
        let mut holder = self.holder.lock().unwrap_or_else(|e| e.into_inner());
        let expired = now.saturating_sub(self.last_seen.load(Ordering::SeqCst)) > LEASE_MS;
        match holder.as_deref() {
            Some(current) if current == window => {
                self.last_seen.store(now, Ordering::SeqCst);
                true
            }
            Some(_) if !expired => false,
            _ => {
                *holder = Some(window.to_string());
                self.last_seen.store(now, Ordering::SeqCst);
                true
            }
        }
    }

    /// Give the lease up deliberately (a window going away).
    pub fn release(&self, window: &str) {
        let mut holder = self.holder.lock().unwrap_or_else(|e| e.into_inner());
        if holder.as_deref() == Some(window) {
            *holder = None;
            self.last_seen.store(0, Ordering::SeqCst);
        }
    }

    /// Who holds a LIVE lease right now, if anyone.
    ///
    /// The app itself never needs to ask - `claim` answers the only
    /// question a window has, which is "is it mine" - but the expiry rule
    /// is the whole point of a lease, and it deserves to be asserted
    /// directly rather than inferred from who happens to win a claim.
    #[cfg(test)]
    pub fn holder(&self, now: u64) -> Option<String> {
        let holder = self.holder.lock().unwrap_or_else(|e| e.into_inner());
        if now.saturating_sub(self.last_seen.load(Ordering::SeqCst)) > LEASE_MS {
            return None;
        }
        holder.clone()
    }
}

/// Epoch milliseconds, as the frontend understands them.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Start the heartbeat. Called once, from `setup`.
pub fn start(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(TICK_MS));
        let now = now_ms();
        // Wake whoever is listening. A throttled webview gets this long
        // before its own coalesced timer would have run.
        let _ = handle.emit("remi-tick", now);
        // ...and bank a running session ourselves if nobody else has. The
        // lock is the same one every save takes, so this can never
        // interleave with a webview's write.
        crate::commands::with_save_lock(|| {
            let _ = crate::state_io::touch_saved_at(&data_folder(), now, NATIVE_CHECKPOINT_MS);
        });
    });
}

#[cfg(test)]
mod tests {
    use super::{EffectLease, LEASE_MS};

    #[test]
    fn the_first_claimant_gets_the_lease() {
        let lease = EffectLease::default();
        assert!(lease.claim("popover", 1_000));
        assert_eq!(lease.holder(1_000).as_deref(), Some("popover"));
    }

    #[test]
    fn a_live_lease_cannot_be_taken_from_its_holder() {
        // Two owners means duplicate notifications, and a bounded check-in
        // consumed in a window nobody is looking at.
        let lease = EffectLease::default();
        assert!(lease.claim("popover", 1_000));
        assert!(!lease.claim("dashboard", 1_000 + LEASE_MS));
        assert_eq!(lease.holder(1_000 + LEASE_MS).as_deref(), Some("popover"));
    }

    #[test]
    fn a_holder_that_stops_answering_loses_it() {
        // The failure a boolean cannot express: the popover is still there,
        // but macOS has suspended its timers, so it neither does the work
        // nor gives it up.
        let lease = EffectLease::default();
        assert!(lease.claim("popover", 1_000));
        let later = 1_000 + LEASE_MS + 1;
        assert_eq!(lease.holder(later), None, "a silent holder kept the lease");
        assert!(lease.claim("dashboard", later), "nobody could take over");
        assert_eq!(lease.holder(later).as_deref(), Some("dashboard"));
    }

    #[test]
    fn renewing_keeps_it_indefinitely() {
        let lease = EffectLease::default();
        let mut t = 1_000;
        for _ in 0..10 {
            assert!(lease.claim("popover", t));
            t += LEASE_MS - 1;
        }
        assert_eq!(lease.holder(t).as_deref(), Some("popover"));
    }

    #[test]
    fn the_original_holder_can_take_it_back_when_it_wakes_up() {
        // The popover coming back must be able to resume ownership rather
        // than leaving effects in the window that only stood in for it.
        let lease = EffectLease::default();
        lease.claim("popover", 1_000);
        let later = 1_000 + LEASE_MS + 1;
        lease.claim("dashboard", later);
        // The dashboard now goes quiet in its turn.
        let later_still = later + LEASE_MS + 1;
        assert!(lease.claim("popover", later_still));
        assert_eq!(lease.holder(later_still).as_deref(), Some("popover"));
    }

    #[test]
    fn releasing_frees_it_immediately() {
        let lease = EffectLease::default();
        lease.claim("popover", 1_000);
        lease.release("popover");
        assert_eq!(lease.holder(1_000), None);
        assert!(lease.claim("dashboard", 1_000));
    }

    #[test]
    fn releasing_a_lease_you_do_not_hold_does_nothing() {
        let lease = EffectLease::default();
        lease.claim("popover", 1_000);
        lease.release("dashboard");
        assert_eq!(lease.holder(1_000).as_deref(), Some("popover"));
    }
}

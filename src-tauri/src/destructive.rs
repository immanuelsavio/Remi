//! ONE-TIME AUTHORIZATION for the commands that delete the user's data.
//!
//! "Wipe and start over" and "Remove everything" are confirmed in the
//! webview, which is the right place to ASK - but the confirmation and the
//! deletion were separate facts, and only the second one was enforced. Any
//! code running in the webview could call `reset_and_uninstall_app`
//! directly and every file Remi owns would be gone, with no dialog and no
//! record that a person was ever involved.
//!
//! The IPC surface is listed in `SECURITY.md` as in scope precisely because
//! a webview compromise is the threat model. The CSP makes that unlikely
//! today; "unlikely" is not the standard for an irreversible delete.
//!
//! So the destructive commands now need a TICKET, and a ticket comes from
//! one place: a native confirmation dialog, drawn by the OS, outside the
//! webview entirely. A ticket is
//!
//! - bound to the KIND of action it was granted for, so a confirmation for
//!   "wipe, keep history" cannot be spent on "delete everything";
//! - single-use, consumed on redemption;
//! - short-lived, so one lying around is not a standing permission.

use std::sync::Mutex;

/// How long a confirmation stays good for.
///
/// Long enough to cover a slow flush and a user reading one more sentence;
/// short enough that a ticket is not a standing permission to delete
/// everything.
pub const TICKET_TTL_MS: u64 = 120_000;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Ticket {
    kind: String,
    token: String,
    issued: u64,
}

/// The one outstanding confirmation, if any.
#[derive(Default)]
pub struct Destructive(Mutex<Option<Ticket>>);

impl Destructive {
    /// Record a confirmation the user just gave, and hand back its token.
    ///
    /// Issuing replaces any previous ticket: at most one confirmation is
    /// ever outstanding, so a ticket abandoned by a cancelled flow cannot
    /// be redeemed later by something else.
    pub fn issue(&self, kind: &str, token: String, now: u64) -> String {
        let mut slot = self.0.lock().unwrap_or_else(|e| e.into_inner());
        *slot = Some(Ticket {
            kind: kind.to_string(),
            token: token.clone(),
            issued: now,
        });
        token
    }

    /// Spend a ticket. `Err` explains why not, and the ticket is gone
    /// either way when it matched.
    pub fn redeem(&self, kind: &str, token: &str, now: u64) -> Result<(), String> {
        let mut slot = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let Some(ticket) = slot.clone() else {
            return Err("That needs to be confirmed again.".into());
        };
        // Wrong action, wrong token: leave the real ticket alone rather than
        // letting a bad guess burn a confirmation the user did give.
        if ticket.kind != kind || ticket.token != token {
            return Err("That confirmation was for something else.".into());
        }
        *slot = None; // single use, consumed whether or not the work succeeds
        if now.saturating_sub(ticket.issued) > TICKET_TTL_MS {
            return Err("That confirmation timed out. Please try again.".into());
        }
        Ok(())
    }
}

/// A token nobody can guess: 32 hex characters, from the OS where it has
/// one to give.
///
/// Straight from `/dev/urandom` rather than through a new dependency - one
/// read of 16 bytes does not need a crate. The fallback mixes the clock,
/// the pid and a counter, which is weak by comparison and deliberately
/// never the normal path: it exists so that a machine without
/// `/dev/urandom` refuses deletions in a confusing way rather than
/// panicking.
pub fn new_token() -> String {
    use std::io::Read as _;
    let mut bytes = [0u8; 16];
    let ok = std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .is_ok();
    if !ok {
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0)
            ^ (std::process::id() as u64).rotate_left(32)
            ^ SEQ.fetch_add(0x9E37_79B9_7F4A_7C15, std::sync::atomic::Ordering::Relaxed);
        bytes[..8].copy_from_slice(&n.to_le_bytes());
        bytes[8..].copy_from_slice(&n.rotate_left(17).to_be_bytes());
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Ask the OS - not the webview - to confirm an irreversible action.
///
/// macOS draws this with `osascript`, so it is a real system dialog that
/// page content cannot fabricate, suppress or click. Cancel is the default
/// button: the safe answer is the one a stray Return key gives.
#[cfg(target_os = "macos")]
pub fn confirm_natively(title: &str, body: &str) -> bool {
    use std::process::Command;
    // The strings are ours (see `commands.rs`), never user input, but they
    // are still interpolated into an AppleScript literal - so quotes and
    // backslashes are escaped rather than trusted.
    let esc = |s: &str| s.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "display dialog \"{}\" with title \"{}\" buttons {{\"Cancel\", \"Continue\"}} \
         default button \"Cancel\" with icon caution",
        esc(body),
        esc(title)
    );
    Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map(|out| {
            // A cancelled dialog exits non-zero; only the Continue button
            // produces a successful run naming that button.
            out.status.success() && String::from_utf8_lossy(&out.stdout).contains("Continue")
        })
        .unwrap_or(false)
}

/// Other platforms have no native dialog wired up here yet, so the ticket
/// is the whole guarantee: the flow still has to ask for one, and it is
/// still single-use and short-lived, but the confirmation itself is the
/// webview's. Documented rather than pretended about.
#[cfg(not(target_os = "macos"))]
pub fn confirm_natively(_title: &str, _body: &str) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::{new_token, Destructive, TICKET_TTL_MS};

    #[test]
    fn a_ticket_is_spent_once() {
        let d = Destructive::default();
        let t = d.issue("uninstall", new_token(), 1_000);
        assert!(d.redeem("uninstall", &t, 1_000).is_ok());
        assert!(
            d.redeem("uninstall", &t, 1_000).is_err(),
            "one confirmation authorised two deletions"
        );
    }

    #[test]
    fn a_ticket_is_bound_to_its_action() {
        // A confirmation for "wipe, keep my history" must not be spendable
        // on "delete everything".
        let d = Destructive::default();
        let t = d.issue("wipe", new_token(), 1_000);
        assert!(d.redeem("uninstall", &t, 1_000).is_err());
        // ...and the real ticket survives the mismatch.
        assert!(d.redeem("wipe", &t, 1_000).is_ok());
    }

    #[test]
    fn a_wrong_token_does_not_burn_the_real_one() {
        let d = Destructive::default();
        let t = d.issue("wipe", new_token(), 1_000);
        assert!(d.redeem("wipe", "0000", 1_000).is_err());
        assert!(d.redeem("wipe", &t, 1_000).is_ok());
    }

    #[test]
    fn a_ticket_expires() {
        let d = Destructive::default();
        let t = d.issue("wipe", new_token(), 1_000);
        assert!(d.redeem("wipe", &t, 1_000 + TICKET_TTL_MS + 1).is_err());
    }

    #[test]
    fn nothing_can_be_redeemed_without_a_confirmation() {
        let d = Destructive::default();
        assert!(d.redeem("uninstall", &new_token(), 1).is_err());
    }

    #[test]
    fn issuing_again_invalidates_the_abandoned_one() {
        // A confirmation the user backed out of must not sit around
        // waiting to authorise something else.
        let d = Destructive::default();
        let first = d.issue("wipe", new_token(), 1_000);
        let second = d.issue("wipe", new_token(), 2_000);
        assert_ne!(first, second);
        assert!(d.redeem("wipe", &first, 2_000).is_err());
        assert!(d.redeem("wipe", &second, 2_000).is_ok());
    }

    #[test]
    fn tokens_are_not_guessable_and_not_repeated() {
        let a = new_token();
        let b = new_token();
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}

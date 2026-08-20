# Changelog

All notable changes to Remi are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Task map** — every task with its steps as branches. Switch to any node,
  or promote a step into a task of its own with `⤴`, keeping the time it
  already accrued.
- **Notes tab** in the dashboard — free text beside any task or step, which
  travels with the task across day boundaries and into backups.
- **Reminder picker** — set a reminder **in** a duration, **by** a clock
  time today (rolling to tomorrow if it has passed), or **on** an explicit
  date and time.
- **Import sheet** with a live preview and a copy-the-formatting-prompt
  button, reachable from both Plan and Data.
- **Confirmation on removing a step** — asks whether to complete it or
  delete it, because a step is often the only record that the work happened.
- Seventh accent colour, `remi`, sampled from the application icon and now
  the default.
- The real application icon is used for the brand mark on the dashboard,
  the Start-my-day screen and the recovery screen.

### Added

- **In-app updates.** Remi checks GitHub's releases API for a newer version
  (at startup if enabled in Settings, or on demand from Data), shows the
  release notes, and updates on a button press. The install reuses
  `install.sh` rather than reimplementing it, so the download is still
  SHA-256 verified against the release's `checksums.txt` before anything is
  replaced, and a detached helper waits for Remi to exit before swapping the
  bundle. Previously `autoUpdate` was a stored boolean that nothing read.
- **What's new**, shown once after the version changes under you. Never on a
  fresh install.
- **BETA badge** in the dashboard header and on the version card.
- **Feedback box** in Data. Free text, saved locally, and included in the log
  export so a bug report arrives with its evidence. The exported file's
  `containsNoContent` flag flips to `false` when a note is present rather
  than quietly carrying prose in a file that claims to have none.
- `BACKLOG.md`, for work we have decided about but not done — including
  signing backups so history cannot be forged.

### Changed

- **Usage logging is now ON by default** during the beta. It remains a
  one-click switch, switching it off stops collection immediately, and an
  existing install that had it off stays off — only the absence of the key
  is read as "on".
- **Restoring a backup takes a file, not pasted text.** The picker accepts
  `.json` only and the contents are parsed before anything is offered, so a
  renamed text file is rejected up front rather than part-way through a
  restore.

### Fixed

- **The popover now draws over other apps' fullscreen Spaces.** The window
  is converted to a non-activating `NSPanel`; a plain `NSWindow` ignores
  `NSWindowStyleMaskNonactivatingPanel`, so giving it key status activated
  the app and macOS switched Spaces away from whatever was fullscreen.
  Status window level and `canJoinAllSpaces | fullScreenAuxiliary` are
  necessary but were never sufficient on their own.
- Removed `alwaysOnTop` from the popover's window config. `tao` implements
  it as an **async** `set_level_async(NSFloatingWindowLevel)`, which landed
  after setup and silently clobbered the status window level back down to
  floating.
- Interruptions raised by a check-in are now recorded with
  `via: "checkin"`. `switchReason` was never actually set anywhere, so
  every switch was filed as a deliberate interrupt, skewing the Stats
  breakdown.
- The task map no longer closes itself on the next store commit.

### Changed

- The whole interface now matches the approved visual reference: the
  showcase's component styles are shared through `global.css` rather than
  reimplemented per component.
- `src-tauri/src/windows.rs` split into a `windows/` module — `popover`,
  `dashboard`, `panel`, `anchor` — with popover placement extracted as a
  pure function and covered by unit tests.
- Corrected a comment in `Cargo.toml` that wrongly claimed collection
  behaviour made `tauri-nspanel` unnecessary. The panel conversion is now
  implemented directly with `objc2`, which was already a dependency.

### Legal

- Licensed under the **PolyForm Noncommercial License 1.0.0**: free to use,
  modify and share for non-commercial purposes; commercial use requires
  permission.
- Added `THIRD-PARTY-NOTICES.md`, listing every bundled Rust crate and npm
  package with its licence. MIT and Apache-2.0 both require their notices to
  travel with a distribution, so this is a compliance requirement rather
  than a courtesy. Regenerate it with
  `scripts/gen-third-party-notices.py`.
- Added `PRIVACY.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  issue and pull-request templates, and Dependabot configuration.

### Security

- **Test harness:** `mktemp -d` failures are now fatal. BSD `mktemp` ignores
  `$TMPDIR` unless given an explicit template; when it failed, the empty
  result was interpolated into destructive paths, pointing the uninstaller
  tests at the real `/Applications/Remi.app` and `/Library` instead of a
  throwaway `$HOME`.

## [0.1.0] — unreleased

First tagged release. Menu-bar popover and dashboard, tasks and steps,
interruption evidence, time-sense trainer, streaks with PTO and revive,
wellness nudges, backlog, calendar, import/export, atomic state I/O with
recovery, and one-time migration from the legacy Dopamigo MVP data
location.

[Unreleased]: https://github.com/immanuelsavio/Remi/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/immanuelsavio/Remi/releases/tag/v0.1.0

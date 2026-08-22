# Security Policy

## Supported versions

Remi is pre-1.0. Only the latest released version receives fixes.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |
| < 0.1   | ❌        |

## Reporting a vulnerability

**Please do not open a public issue.**

Report privately through GitHub's
[security advisory form](https://github.com/immanuelsavio/Remi/security/advisories/new),
which creates a private thread with the maintainer.

Please include:

- what the issue is, and what an attacker could do with it
- the steps to reproduce it
- the version of Remi and of macOS you saw it on

You can expect an acknowledgement within a week. If the report is valid,
you will be told when a fix is planned and credited in the release notes
unless you would rather not be.

## Scope

Remi is a local desktop application with no server component, so the
interesting surface is narrow. Things worth reporting:

- **`install.sh` / `uninstall.sh`** — these run shell code from the internet
  and delete files. Checksum-verification bypasses, archive path traversal,
  unsafe path handling, or anything that makes the uninstaller delete
  outside its intended targets.
- **State file handling** — anything that makes a malformed `state.json`
  cause code execution, or silently destroy the user's data instead of
  preserving it for recovery.
- **The IPC surface** — the Tauri commands in `src-tauri/src/commands.rs`.
- **Notification content leaks** — the "private notifications" setting
  exists so task names stay out of banners during a screen share; a way
  around it is a real bug.

Out of scope:

- The app is **ad-hoc signed and not Apple-notarized**. That is a known,
  documented state, not a vulnerability — see the README. It means macOS
  Gatekeeper will warn on first open unless the installer clears the
  quarantine flag.
- Anything requiring an attacker to already have write access to the user's
  home directory or the installed app bundle.

## What the in-app updater does, and what it proves

The updater resolves the release tag to its **commit SHA** and fetches
`install.sh` from that commit. A tag is only a pointer - `git tag -f` moves
it - so "from the tag" pinned a name rather than a file; a SHA cannot be
made to mean something else later. If the SHA cannot be resolved, the
update is refused rather than falling back to the tag.

Be clear about what that is and is not:

- It **is** immutability: the script that runs is the script that shipped
  with the release you were shown, byte for byte.
- It is **not** authenticity. The SHA, the archive and the checksum all
  come from the same GitHub release, so anyone who could publish a release
  under this repository could publish a consistent set of all three. What
  would close that is notarisation, or a manifest signed with a key that
  does not live in the repository. Neither exists yet; this is a beta
  distribution model, deliberately described as one.

Release builds are additionally gated: a tag whose commit is not an
ancestor of `origin/main` is refused, and the GitHub Release is created as
a **draft** so nothing is downloadable until a human has smoke-tested the
ARM and Intel builds on real hardware and published it.

## What the installer does

For transparency, since it is the piece that asks for the most trust:
`install.sh` downloads a release archive, verifies its SHA-256 against the
`checksums.txt` published in the same release **before** extracting
anything, and then removes the `com.apple.quarantine` attribute from the
installed bundle **only**. It never disables Gatekeeper, never changes any
system setting, and touches no other application.

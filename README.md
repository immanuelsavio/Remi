# Remi

A macOS/Windows menu-bar day tracker for people with ADHD. It lives in the
menu bar (no Dock icon), opens as a small popover under its tray icon, and
has a second, larger command-center window for planning and evidence.

Remi's subject is interruptions: not just "how long did you work on
this?" but "how long did this _take_, wall-clock, from first touch to
done?" — and what stole the difference. See [docs/product.md](docs/product.md)
for the full picture.

## Supported platforms

macOS and Windows. Linux builds are possible (Tauri supports it) but
untested here.

## Prerequisites

- Node.js 20+, npm
- Rust stable (`rustup`), with `cargo`, `rustfmt`, `clippy`
- macOS: Xcode Command Line Tools
- Windows: MSVC Rust toolchain + WebView2 runtime

See [docs/development.md](docs/development.md) for details and
troubleshooting.

## First-time installation

```bash
npm install
```

## Development

```bash
npm run app       # tauri dev - launches the real menu-bar app
npm run release   # bundle a real .app / .dmg / .exe
```

Look at your **menu bar**, not your Dock. Click the mark to open the
popover.

## macOS install and uninstall

Remi is ad-hoc signed for now, not Apple-notarized. The installer verifies
the downloaded release archive against the release's `checksums.txt` before
extracting it, then removes the quarantine flag from the installed
`Remi.app` bundle only. It does not disable Gatekeeper or change quarantine
settings for anything else on your Mac.

The repository must be public for the raw `curl` command and GitHub Release
asset downloads to work without authentication.

Safer inspect-first install:

```bash
curl -fsSLo remi-install.sh https://raw.githubusercontent.com/immanuelsavio/remi/main/install.sh
less remi-install.sh
bash remi-install.sh --launch
```

Direct install:

```bash
curl -fsSL https://raw.githubusercontent.com/immanuelsavio/remi/main/install.sh | bash
```

By default this installs to `~/Applications/Remi.app`. Use `--system` for
`/Applications/Remi.app`, `--version v0.1.0` for a specific release, and
`--launch` to open Remi after installation. Re-running the installer upgrades
the app in place and rolls back if the replacement copy fails.

Uninstall the app while keeping your data:

```bash
curl -fsSLo remi-uninstall.sh https://raw.githubusercontent.com/immanuelsavio/remi/main/uninstall.sh
bash remi-uninstall.sh
```

Use `--system` if Remi was installed to `/Applications`. To permanently
delete Remi's settings and data as well, run:

```bash
bash remi-uninstall.sh --purge --yes
```

That purge is not reversible. A normal uninstall leaves `~/Remi` and
`~/Library/Application Support/com.immanuelsavio.remi` in place so a later
reinstall picks up where you left off.

## Release checklist

Before publishing a macOS release, make sure all version fields match:

```bash
bash scripts/check-versions.sh
```

Run the manual dry-run workflow first. It builds both Apple Silicon and
Intel macOS app bundles, verifies ad-hoc signatures and architectures, and
uploads artifacts without publishing a GitHub Release.

```bash
gh workflow run dry-run.yml --ref main
```

When the dry run is good, tag the matching version. The release workflow
reruns validation, builds both macOS architectures, creates
`Remi-VERSION-macos-aarch64.tar.gz`,
`Remi-VERSION-macos-x86_64.tar.gz`, and `checksums.txt`, then publishes the
GitHub Release only after every job succeeds.

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Tests and verification

```bash
npm test          # frontend unit tests
npm run check     # Svelte + TypeScript type check
npm run verify    # everything, including cargo test/fmt/clippy - as CI runs it
```

## Data locations

State lives at `~/Remi/state.json` (with a `.bak` and a recovery folder
for damaged files). Settings live in the OS application-config directory
under `com.immanuelsavio.remi`. See
[docs/data-durability.md](docs/data-durability.md).

## Documentation

- [docs/product.md](docs/product.md) — what the app does and why
- [docs/architecture.md](docs/architecture.md) — how the pieces fit
  together
- [docs/timing-and-interruptions.md](docs/timing-and-interruptions.md) —
  the session-transaction and interruption-evidence contract
- [docs/data-durability.md](docs/data-durability.md) — the state I/O
  contract and legacy-data migration
- [docs/development.md](docs/development.md) — setup, commands,
  troubleshooting
- [docs/manual-smoke-test.md](docs/manual-smoke-test.md) — the checklist
  for what only a human clicking the real app can verify
- [docs/legacy/INSTRUCTIONS.md](docs/legacy/INSTRUCTIONS.md) — the
  original, comprehensive build document this codebase was reconstructed
  from, preserved for provenance

## A note on the name

This repository is named **Remi**; that's also the app's current product
name, bundle identifier (`com.immanuelsavio.remi`), and default data
folder (`~/Remi`). An earlier development build used the temporary name
**Dopamigo** (`com.dopamigo.mvp`, `~/Dopamigo MVP`); if you have data from
that build, Remi copies it in automatically on first launch and leaves
the original untouched — see
[docs/data-durability.md](docs/data-durability.md#legacy-dopamigo-mvp--remi-migration).

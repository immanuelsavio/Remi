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

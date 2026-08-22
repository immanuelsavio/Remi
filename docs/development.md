# Development

## Prerequisites

- Node.js 20+
- npm
- Rust stable toolchain with `cargo`, `rustfmt`, `clippy` (install via
  [rustup](https://rustup.rs))
- macOS: Xcode Command Line Tools (`xcode-select -p` to check)
- Windows: MSVC Rust toolchain + WebView2 runtime
- Linux: Tauri's system libraries (webkit2gtk, etc. — see the [Tauri
  prerequisites guide](https://tauri.app/start/prerequisites/))

## First-time setup

```bash
npm install
```

If a prior npm version blocked esbuild's postinstall script, current npm
(11+) generally does not require `npm approve-scripts` — `npm install`
alone is sufficient on this project's dependency set. If you hit a similar
prompt, run whatever `npm` itself instructs (`npm approve-builds` on
newer npm, `npm approve-scripts esbuild` on older).

## Commands

| Command                | Does                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `npm run app`          | Dev mode (`tauri dev`)                                                                    |
| `npm run release`      | Bundle a real `.app` / `.dmg` / `.exe`                                                    |
| `npm test`             | Frontend unit tests (vitest)                                                              |
| `npm run check`        | Svelte + TypeScript type check                                                            |
| `npm run format`       | Format with Prettier                                                                      |
| `npm run format:check` | Check formatting without writing                                                          |
| `npm run lint`         | Type check + format check                                                                 |
| `npm run verify`       | Full suite: test, check, format:check, build, cargo test, cargo fmt --check, cargo clippy |

Rust commands, run directly if you're not going through `npm run verify`:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

## Finding the tray icon

Look at your **menu bar** (macOS) or **system tray** (Windows), not your
Dock/taskbar. `LSUIElement` (macOS) / `skipTaskbar` keep it out of the
Dock and app switcher by design — see
[timing-and-interruptions.md](timing-and-interruptions.md) and the
architecture doc for why.

## Opening the command center

Click the tray icon to open the popover, then use its "Dashboard" link —
or click a task in the popover's "Switch to" flow, which also opens the
dashboard on the relevant tab.

## Data locations

- State: `~/Remi/state.json` (+ `.bak`, + a `Remi Recovery/` folder for
  damaged files)
- Settings: `~/Library/Application Support/com.immanuelsavio.remi/settings.json`
  (macOS path shown; Windows/Linux use the platform's standard config
  dir)

See [data-durability.md](data-durability.md) for the full contract,
including the one-time legacy-data migration from the old Dopamigo MVP
build.

## Notification permissions

The first native notification triggers the OS permission prompt (macOS:
System Settings → Notifications). If notifications seem silent, check
that Remi has permission there. The in-app UI (toasts, overlays) works
regardless of OS notification permission.

## Troubleshooting

**No tray icon appears.** Confirm the app actually launched (check
Activity Monitor / Task Manager) — a tray-only app has no other visible
window until you click its icon. On macOS, wait a moment after launch;
`ActivationPolicy::Accessory` plus a slow icon-set can occasionally lag
by a second.

**Port 5178 already in use.** `tauri dev` starts Vite on port 5178
(`devUrl` in `src-tauri/tauri.conf.json`). Kill whatever else is bound to
it, or stop a stale `npm run app` process.

**WebView2 missing (Windows).** Tauri 2 requires the WebView2 runtime.
Most Windows 11 installs have it; on Windows 10 install it from
Microsoft's [WebView2 downloads
page](https://developer.microsoft.com/microsoft-edge/webview2/).

**macOS privacy prompts.** The first notification and the first "reveal
in Finder" (Data tab → Open folder) may trigger a permission prompt.
Approving them is required for those specific features; declining
doesn't break the rest of the app.

**esbuild install scripts blocked.** On some npm/Node combinations npm
refuses to run a dependency's install script without explicit approval.
Run `npm install` again — current npm surfaces the exact command to
approve it with in its own output; there's no longer a fixed
`npm approve-scripts esbuild` incantation across all npm versions.

## The frontend toolchain

Svelte 5, Vite 7, Vitest 3. The components are written in Svelte 4 style
(`export let`, `$:`, `on:click`) and compile in Svelte 5's legacy mode -
this was a security upgrade, not a rewrite, and nothing was converted to
runes.

Two consequences worth knowing before writing a mounted test:

- Components are mounted with `mount()` / `unmount()`; `new Component(...)`
  and `$destroy`/`$set` were removed in Svelte 5.
- Effects run ASYNCHRONOUSLY. `onMount` has not happened when `mount()`
  returns, so a test that mounts and immediately asserts on what the
  component did needs `flushSync()` first. `Splash.svelte.test.ts` is the
  worked example, including the `.svelte.test.ts` suffix that lets a test
  file use runes.

`vite.config.ts` asks for the `browser` resolve condition under test:
without it Vitest loads Svelte's SSR build, where `onMount` never runs and
a component whose behaviour lives there tests as doing nothing at all.
`src/test-setup.ts` stubs `ResizeObserver`, which jsdom lacks and Svelte 5
uses internally for `bind:clientHeight`.

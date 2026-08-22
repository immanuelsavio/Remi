// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Remi - the Rust shell: application wiring, plugin init, state
//! registration, command registration, run-event dispatch.
//!
//! What it owns, by module:
//!   * `paths`     - where settings.json and the data folder live
//!   * `state_io`  - durable JSON with atomic write + .bak recovery
//!   * `settings`  - generic JSON settings.json read-modify-write
//!   * `migration` - one-time legacy Dopamigo MVP -> Remi data migration
//!   * `commands`  - the IPC surface the Svelte frontend calls
//!   * `tray`      - the menu-bar icon (drawn in code, no PNG on disk)
//!   * `updater`   - release checks, and handing an update to install.sh
//!   * `windows`   - the popover/dashboard windows and their lifecycle
//!
//! The frontend owns the state SHAPE. Rust treats it as opaque
//! `serde_json::Value` and only guarantees the durability contract, so the
//! schema can evolve in TypeScript without a Rust change.

mod commands;
mod migration;
mod paths;
mod settings;
mod state_io;
mod tray;
mod updater;
mod windows;

use tray::{QuitReadiness, TrayHandle};
use windows::{
    prepare_popover_overlay, register_autohide, register_dashboard_hide_on_close, show_dashboard,
    PopoverGuard, TrayAnchor,
};

fn main() {
    tauri::Builder::default()
        // A second launch (double-clicking the .app again, or a Dock/
        // Spotlight/Desktop-shortcut open while Remi is already running)
        // opens the DASHBOARD, not the tray popover - the popover's clock
        // and effects are already running in the background (this window
        // boots and starts its clock at app launch regardless of
        // visibility; see Popover.svelte's header note), so "opening the
        // app" should surface the planning/evidence view, matching what a
        // normal app icon click means, while the tray stays a click-to-open
        // overlay.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_dashboard(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .manage(TrayHandle::default())
        .manage(TrayAnchor::default())
        .manage(PopoverGuard::default())
        .manage(QuitReadiness::default())
        .invoke_handler(tauri::generate_handler![
            commands::load_app_state,
            commands::save_app_state,
            commands::get_data_folder,
            commands::open_data_folder,
            commands::get_standard_daily,
            commands::set_standard_daily_list,
            commands::get_auto_update,
            commands::set_auto_update,
            commands::notify,
            commands::write_text_file,
            commands::write_autobackup,
            commands::open_in_default_app,
            commands::set_tray_title,
            commands::open_dashboard,
            commands::dashboard_closed,
            commands::quit_app,
            commands::factory_reset_app,
            commands::reset_and_uninstall_app,
            commands::quit_listener_ready,
            commands::get_app_version,
            commands::get_seen_version,
            commands::set_seen_version,
            updater::check_for_update,
            updater::install_update,
        ])
        .setup(|app| {
            // macOS: run as an Accessory (menu-bar) app - no Dock icon, no
            // app switcher entry. Load-bearing, not cosmetic: Accessory is
            // what lets the popover float over every Space. `Info.plist`'s
            // LSUIElement does the same thing earlier, avoiding a Dock-icon
            // flash at launch.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // One-time, conservative copy of legacy Dopamigo MVP data into
            // Remi's own location. No-op after the first successful check,
            // and a no-op entirely if Remi already has its own data.
            let _ = migration::run_startup_migration();

            let handle = app.handle();
            tray::build_tray(handle)?;
            register_autohide(handle);
            register_dashboard_hide_on_close(handle);
            // Give the popover its over-fullscreen treatment up front, so the
            // first tray click already behaves correctly.
            prepare_popover_overlay(handle);
            // Launching Remi (Applications, Dock, Desktop shortcut, first
            // run) opens the dashboard - the tray icon and its clock/effects
            // are already running underneath (the popover webview boots and
            // starts ticking regardless of visibility), so this is the
            // "widget started, overlay not popped open" behavior: the menu
            // bar mark is live, but the visible surface you land on is the
            // dashboard, matching what opening any normal app means.
            show_dashboard(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Re-opening an already-running .app on macOS does NOT start a
            // second process - LaunchServices sends a Reopen event instead,
            // so single-instance never fires. Without this, pressing Enter
            // on Remi in Spotlight, or clicking its Dock/Desktop icon,
            // appears to do nothing (there are no windows to restore in a
            // tray-only app). Opens the dashboard, matching single-instance
            // relaunch above - the tray popover is a click-to-open overlay,
            // not what "open the app" means.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = &event {
                show_dashboard(app);
            }
            let _ = (app, &event);
        });
}

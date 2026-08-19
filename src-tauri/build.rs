//! Tauri's build script.
//!
//! The bundle icon set (`icons/icon.icns`, `icon.ico`, `icon.png`, and the
//! PNG sizes `bundle.icon` in `tauri.conf.json` references) is CHECKED IN,
//! generated once from `assets/app-icon-512.png` via:
//!
//!     npx tauri icon assets/app-icon-512.png -o src-tauri/icons
//!
//! Nothing needs generating here anymore - `tauri::generate_context!()`
//! finds `icons/icon.png` directly.

fn main() {
    tauri_build::build();
}

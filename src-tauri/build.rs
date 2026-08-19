//! Tauri's build script.
//!
//! `tauri::generate_context!()` REQUIRES a default window icon to exist on
//! disk (`icons/icon.png`); there is no config switch to opt out. The real
//! checked-in source lives at `assets/icon.png` (derived from the app's
//! mascot mark); this script copies it into the generated `icons/` folder,
//! which is a build artifact like `dist/` or `target/` and is gitignored.

use std::fs;
use std::path::Path;

fn main() {
    if let Err(e) = place_icon() {
        // A missing icon fails the build in `generate_context!` with a much
        // less helpful message, so say what actually happened.
        panic!("could not place icons/icon.png: {e}");
    }
    tauri_build::build();
}

fn place_icon() -> std::io::Result<()> {
    let dir = Path::new("icons");
    fs::create_dir_all(dir)?;
    fs::copy("assets/icon.png", dir.join("icon.png"))?;
    println!("cargo:rerun-if-changed=assets/icon.png");
    println!("cargo:rerun-if-changed=build.rs");
    Ok(())
}

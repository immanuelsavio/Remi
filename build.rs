//! Tauri's build script - plus a tiny PNG generator.
//!
//! `tauri::generate_context!()` REQUIRES a default window icon to exist on disk
//! (`icons/icon.png`); there is no config switch to opt out. This packet is
//! text-only source, so rather than commit a binary we draw the icon here, in
//! code, before handing off to `tauri_build::build()`.
//!
//! The generated `icons/` folder is a build artifact, like `dist/` or `target/`.
//! Delete it any time; the next build recreates it. Swap `draw_icon` for a real
//! designed asset whenever you want - nothing else depends on this.
//!
//! Writing PNG by hand needs no image crate: a `stored` (uncompressed) deflate
//! block is a legal zlib stream, so the only real work is CRC-32 and Adler-32.

use std::fs;
use std::path::Path;

fn main() {
    if let Err(e) = write_icon() {
        // A missing icon fails the build in `generate_context!` with a much less
        // helpful message, so say what actually happened.
        panic!("could not generate icons/icon.png: {e}");
    }
    tauri_build::build();
}

/// Icon canvas size. 512 is what macOS wants for a crisp `.app` icon.
const SIZE: u32 = 512;

fn write_icon() -> std::io::Result<()> {
    let dir = Path::new("icons");
    fs::create_dir_all(dir)?;
    let path = dir.join("icon.png");
    // Only write once: rewriting every build would re-trigger the rerun check.
    if !path.exists() {
        fs::write(&path, encode_png(&draw_icon(), SIZE, SIZE))?;
    }
    // Re-run only if this script changes, not on every touched file.
    println!("cargo:rerun-if-changed=build.rs");
    Ok(())
}

/// Draw the app mark: an amber ring on a cream tile, matching the accent
/// (`#e0762a`) and light surface (`#fbf8f4`) tokens in `src/global.css`.
///
/// Returns RGBA rows, top to bottom. The tray icon is drawn separately in
/// `main.rs` (`tray_image`) because that one must be a bare transparent mark.
fn draw_icon() -> Vec<u8> {
    let n = SIZE as f32;
    let c = (n - 1.0) / 2.0;
    // Ring geometry as a fraction of the canvas, so it scales with SIZE.
    let (outer, inner) = (n * 0.34, n * 0.215);
    let radius = n * 0.22; // rounded-tile corner radius

    let mut px = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    for y in 0..SIZE {
        for x in 0..SIZE {
            let (fx, fy) = (x as f32, y as f32);
            // Rounded-rect coverage: distance outside the inset corner circle.
            let dx = (fx - c).abs() - (n / 2.0 - radius);
            let dy = (fy - c).abs() - (n / 2.0 - radius);
            let corner = if dx > 0.0 && dy > 0.0 {
                radius - (dx * dx + dy * dy).sqrt()
            } else {
                1.0
            };
            let tile = corner.clamp(0.0, 1.0);

            // Ring coverage, antialiased over one pixel on both edges.
            let d = ((fx - c).powi(2) + (fy - c).powi(2)).sqrt();
            let ring = (outer - d).clamp(0.0, 1.0) * (d - inner).clamp(0.0, 1.0);

            // Composite: accent ring over the cream tile, all times tile alpha.
            let mix = |bg: u8, fg: u8| (bg as f32 * (1.0 - ring) + fg as f32 * ring) as u8;
            px.extend_from_slice(&[
                mix(0xfb, 0xe0),
                mix(0xf8, 0x76),
                mix(0xf4, 0x2a),
                (tile * 255.0) as u8,
            ]);
        }
    }
    px
}

/// Encode 8-bit RGBA pixels as a PNG.
fn encode_png(rgba: &[u8], w: u32, h: u32) -> Vec<u8> {
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();

    // IHDR: 8-bit (depth 8), truecolour+alpha (colour type 6), no interlace.
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&w.to_be_bytes());
    ihdr.extend_from_slice(&h.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    chunk(&mut out, b"IHDR", &ihdr);

    // Raw scanlines, each prefixed with filter type 0 (None).
    let stride = (w * 4) as usize;
    let mut raw = Vec::with_capacity((h as usize) * (stride + 1));
    for row in 0..h as usize {
        raw.push(0);
        raw.extend_from_slice(&rgba[row * stride..(row + 1) * stride]);
    }
    chunk(&mut out, b"IDAT", &zlib_stored(&raw));
    chunk(&mut out, b"IEND", &[]);
    out
}

/// Wrap `data` in a PNG chunk: length, type, data, CRC-32 over type+data.
fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let mut crc_input = kind.to_vec();
    crc_input.extend_from_slice(data);
    out.extend_from_slice(&crc32(&crc_input).to_be_bytes());
}

/// A zlib stream using only `stored` deflate blocks - valid, just uncompressed.
/// PNG size is irrelevant here (the file is a build artifact), and this avoids
/// pulling in a compression crate for one icon.
fn zlib_stored(data: &[u8]) -> Vec<u8> {
    // CMF=0x78 (deflate, 32K window), FLG=0x01 -> 0x7801 % 31 == 0, as required.
    let mut z = vec![0x78, 0x01];
    let mut rest = data;
    loop {
        // Each stored block carries at most 65535 bytes.
        let take = rest.len().min(0xFFFF);
        let (block, tail) = rest.split_at(take);
        let last = tail.is_empty();
        z.push(if last { 1 } else { 0 }); // BFINAL, BTYPE=00 (stored)
        z.extend_from_slice(&(take as u16).to_le_bytes());
        z.extend_from_slice(&(!(take as u16)).to_le_bytes()); // one's complement
        z.extend_from_slice(block);
        if last {
            break;
        }
        rest = tail;
    }
    z.extend_from_slice(&adler32(data).to_be_bytes());
    z
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            // The reflected CRC-32 polynomial (0xEDB88320).
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &byte in data {
        a = (a + byte as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

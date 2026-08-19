#!/usr/bin/env bash
# Fails if package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json,
# package-lock.json, and src-tauri/Cargo.lock disagree on the app version.
# Run before tagging a release - a mismatch here means release asset names
# (Remi-VERSION-macos-*.tar.gz) won't match what's actually inside them.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

pkg_version=$(node -pe "require('./package.json').version")
lock_version=$(node -pe "require('./package-lock.json').version")
cargo_version=$(grep -m1 '^version = ' src-tauri/Cargo.toml | sed -E 's/version = "(.*)"/\1/')
tauri_version=$(node -pe "require('./src-tauri/tauri.conf.json').version")
cargo_lock_version=$(awk '/^name = "remi"$/{f=1} f && /^version = /{print; exit}' src-tauri/Cargo.lock | sed -E 's/version = "(.*)"/\1/')

echo "package.json:          $pkg_version"
echo "package-lock.json:      $lock_version"
echo "src-tauri/Cargo.toml:   $cargo_version"
echo "src-tauri/tauri.conf.json: $tauri_version"
echo "src-tauri/Cargo.lock:   $cargo_lock_version"

versions=("$pkg_version" "$lock_version" "$cargo_version" "$tauri_version" "$cargo_lock_version")
for v in "${versions[@]}"; do
  if [[ "$v" != "$pkg_version" ]]; then
    echo "ERROR: version mismatch - all files must report the same version" >&2
    exit 1
  fi
done

echo "OK: all version fields agree ($pkg_version)"

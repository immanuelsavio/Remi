#!/usr/bin/env bash
# Tests for install.sh. Every test runs with HOME pointed at a throwaway
# temp directory and REMI_INSTALL_API_BASE pointed at a local fake HTTP
# server - the real $HOME, real ~/Applications, and real GitHub are never
# touched.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
# shellcheck source=tests/scripts/lib.sh
source ./lib.sh

HOST_ARCH="$(uname -m)"
VERSION="9.9.9"
TAG="v$VERSION"

# --- test: successful install (host arch) -----------------------------------
test_successful_install() {
  local api_root fake_home
  api_root="$(mktemp -d)"
  fake_home="$(mktemp -d)"
  local arch; arch="$( [[ "$HOST_ARCH" == arm64 ]] && echo aarch64 || echo x86_64 )"
  local asset="Remi-${VERSION}-macos-${arch}.tar.gz"

  build_release_assets "$api_root" "$VERSION" "$arch" "$HOST_ARCH"
  local addr; addr="$(start_fake_server "$api_root")"
  write_release_json "$api_root" "http://$addr" "$TAG" "$asset" "checksums.txt"

  HOME="$fake_home" REMI_INSTALL_API_BASE="http://$addr" bash "$INSTALL_SH" >/tmp/install-out.$$ 2>&1
  local rc=$?
  assert_eq "successful install exits 0" "0" "$rc"
  assert_true "app bundle installed" test -d "$fake_home/Applications/Remi.app"
  assert_true "installed binary exists" test -f "$fake_home/Applications/Remi.app/Contents/MacOS/remi"

  stop_fake_server "$api_root"
  rm -rf "$api_root" "$fake_home" /tmp/install-out.$$
}

# --- test: checksum mismatch is rejected before extraction -------------------
test_checksum_mismatch_rejected() {
  local api_root fake_home
  api_root="$(mktemp -d)"
  fake_home="$(mktemp -d)"
  local arch; arch="$( [[ "$HOST_ARCH" == arm64 ]] && echo aarch64 || echo x86_64 )"
  local asset="Remi-${VERSION}-macos-${arch}.tar.gz"

  build_release_assets "$api_root" "$VERSION" "$arch" "$HOST_ARCH"
  # Corrupt the checksum file so it no longer matches the asset.
  echo "0000000000000000000000000000000000000000000000000000000000000000  $asset" > "$api_root/checksums.txt"
  local addr; addr="$(start_fake_server "$api_root")"
  write_release_json "$api_root" "http://$addr" "$TAG" "$asset" "checksums.txt"

  HOME="$fake_home" REMI_INSTALL_API_BASE="http://$addr" bash "$INSTALL_SH" >/tmp/install-out.$$ 2>&1
  local rc=$?
  assert_true "checksum mismatch exits nonzero" test "$rc" -ne 0
  assert_false "app NOT installed on checksum failure" test -d "$fake_home/Applications/Remi.app"

  stop_fake_server "$api_root"
  rm -rf "$api_root" "$fake_home" /tmp/install-out.$$
}

# --- test: missing release / HTTP failure -------------------------------------
test_missing_release_fails_cleanly() {
  local fake_home; fake_home="$(mktemp -d)"
  # Nothing listening on this port.
  HOME="$fake_home" REMI_INSTALL_API_BASE="http://127.0.0.1:1" bash "$INSTALL_SH" >/tmp/install-out.$$ 2>&1
  local rc=$?
  assert_true "unreachable API exits nonzero" test "$rc" -ne 0
  rm -rf "$fake_home" /tmp/install-out.$$
}

# --- test: malicious archive with path traversal is rejected -----------------
test_path_traversal_archive_rejected() {
  local api_root fake_home stage
  api_root="$(mktemp -d)"
  fake_home="$(mktemp -d)"
  stage="$(mktemp -d)"
  local arch; arch="$( [[ "$HOST_ARCH" == arm64 ]] && echo aarch64 || echo x86_64 )"
  local asset="Remi-${VERSION}-macos-${arch}.tar.gz"

  build_fake_app_bundle "$stage/Remi.app" "$HOST_ARCH"
  # Craft a tar.gz with a genuine ../ traversal entry via Python's tarfile,
  # which lets us set an arbitrary (unsafe) member name directly instead of
  # fighting GNU vs BSD tar flag differences.
  python3 - "$stage" "$api_root/$asset" <<'PYEOF'
import sys, tarfile, os
stage, out = sys.argv[1], sys.argv[2]
with tarfile.open(out, "w:gz") as tf:
    tf.add(os.path.join(stage, "Remi.app"), arcname="Remi.app")
    tf.add(os.path.join(stage, "Remi.app", "Contents", "Info.plist"), arcname="../../etc/passwd-evil")
PYEOF
  ( cd "$api_root" && shasum -a 256 "$asset" > checksums.txt )
  local addr; addr="$(start_fake_server "$api_root")"
  write_release_json "$api_root" "http://$addr" "$TAG" "$asset" "checksums.txt"

  HOME="$fake_home" REMI_INSTALL_API_BASE="http://$addr" bash "$INSTALL_SH" >/tmp/install-out.$$ 2>&1
  local rc=$?
  assert_true "traversal archive exits nonzero" test "$rc" -ne 0
  assert_false "no file escaped to /etc" test -f /etc/passwd-evil
  assert_false "app NOT installed when archive has traversal entry" test -d "$fake_home/Applications/Remi.app"

  stop_fake_server "$api_root"
  rm -rf "$api_root" "$fake_home" "$stage" /tmp/install-out.$$
  rm -f /etc/passwd-evil 2>/dev/null || true
}

# --- test: symlink inside archive is rejected --------------------------------
test_symlink_archive_rejected() {
  local api_root fake_home stage
  api_root="$(mktemp -d)"
  fake_home="$(mktemp -d)"
  stage="$(mktemp -d)"
  local arch; arch="$( [[ "$HOST_ARCH" == arm64 ]] && echo aarch64 || echo x86_64 )"
  local asset="Remi-${VERSION}-macos-${arch}.tar.gz"

  build_fake_app_bundle "$stage/Remi.app" "$HOST_ARCH"
  ln -s /etc "$stage/Remi.app/evil-link"
  ( cd "$stage" && tar -czf "$api_root/$asset" Remi.app )
  ( cd "$api_root" && shasum -a 256 "$asset" > checksums.txt )
  local addr; addr="$(start_fake_server "$api_root")"
  write_release_json "$api_root" "http://$addr" "$TAG" "$asset" "checksums.txt"

  HOME="$fake_home" REMI_INSTALL_API_BASE="http://$addr" bash "$INSTALL_SH" >/tmp/install-out.$$ 2>&1
  local rc=$?
  assert_true "archive with symlink exits nonzero" test "$rc" -ne 0
  assert_false "app NOT installed when archive has a symlink" test -d "$fake_home/Applications/Remi.app"

  stop_fake_server "$api_root"
  rm -rf "$api_root" "$fake_home" "$stage" /tmp/install-out.$$
}

# --- test: refuses to install over a running instance -------------------------
test_refuses_when_running() {
  local api_root fake_home
  api_root="$(mktemp -d)"
  fake_home="$(mktemp -d)"
  local arch; arch="$( [[ "$HOST_ARCH" == arm64 ]] && echo aarch64 || echo x86_64 )"
  local asset="Remi-${VERSION}-macos-${arch}.tar.gz"

  build_release_assets "$api_root" "$VERSION" "$arch" "$HOST_ARCH"
  local addr; addr="$(start_fake_server "$api_root")"
  write_release_json "$api_root" "http://$addr" "$TAG" "$asset" "checksums.txt"

  # Simulate an already-installed, currently-running Remi at the target
  # path. A copied+renamed system binary (e.g. /bin/sleep) gets SIGKILLed
  # instantly by macOS's code-signing enforcement once its path/identity
  # no longer matches its signature, so this needs a real compiled,
  # naturally-unsigned binary instead - build_fake_app_bundle already
  # makes exactly that (an infinite-loop C program).
  mkdir -p "$fake_home/Applications"
  build_fake_app_bundle "$fake_home/Applications/Remi.app" "$HOST_ARCH"
  "$fake_home/Applications/Remi.app/Contents/MacOS/remi" &
  local fake_pid=$!
  sleep 0.3 # let pgrep actually see it

  HOME="$fake_home" REMI_INSTALL_API_BASE="http://$addr" bash "$INSTALL_SH" >/tmp/install-out.$$ 2>&1
  local rc=$?
  assert_true "install refuses while running" test "$rc" -ne 0
  assert_true "refusal mentions running" grep -qi "running" /tmp/install-out.$$

  kill "$fake_pid" 2>/dev/null || true
  wait "$fake_pid" 2>/dev/null || true
  stop_fake_server "$api_root"
  rm -rf "$api_root" "$fake_home" /tmp/install-out.$$
}

# --- test: upgrade replaces an existing (non-running) install ----------------
test_upgrade_preserves_success() {
  local api_root fake_home
  api_root="$(mktemp -d)"
  fake_home="$(mktemp -d)"
  local arch; arch="$( [[ "$HOST_ARCH" == arm64 ]] && echo aarch64 || echo x86_64 )"
  local asset="Remi-${VERSION}-macos-${arch}.tar.gz"

  build_release_assets "$api_root" "$VERSION" "$arch" "$HOST_ARCH"
  local addr; addr="$(start_fake_server "$api_root")"
  write_release_json "$api_root" "http://$addr" "$TAG" "$asset" "checksums.txt"

  mkdir -p "$fake_home/Applications/Remi.app/Contents/MacOS"
  echo "old-version-marker" > "$fake_home/Applications/Remi.app/Contents/MacOS/marker.txt"

  HOME="$fake_home" REMI_INSTALL_API_BASE="http://$addr" bash "$INSTALL_SH" >/tmp/install-out.$$ 2>&1
  local rc=$?
  assert_eq "upgrade over stopped previous install succeeds" "0" "$rc"
  assert_false "old marker file gone after upgrade" test -f "$fake_home/Applications/Remi.app/Contents/MacOS/marker.txt"
  assert_true "new binary present after upgrade" test -f "$fake_home/Applications/Remi.app/Contents/MacOS/remi"

  stop_fake_server "$api_root"
  rm -rf "$api_root" "$fake_home" /tmp/install-out.$$
}

# --- test: paths containing spaces ------------------------------------------
test_install_path_with_spaces() {
  local api_root fake_home
  api_root="$(mktemp -d)"
  fake_home="$(mktemp -d "/tmp/remi home test.XXXXXX")"
  local arch; arch="$( [[ "$HOST_ARCH" == arm64 ]] && echo aarch64 || echo x86_64 )"
  local asset="Remi-${VERSION}-macos-${arch}.tar.gz"

  build_release_assets "$api_root" "$VERSION" "$arch" "$HOST_ARCH"
  local addr; addr="$(start_fake_server "$api_root")"
  write_release_json "$api_root" "http://$addr" "$TAG" "$asset" "checksums.txt"

  HOME="$fake_home" REMI_INSTALL_API_BASE="http://$addr" bash "$INSTALL_SH" >/tmp/install-out.$$ 2>&1
  local rc=$?
  assert_eq "install succeeds when HOME contains spaces" "0" "$rc"
  assert_true "bundle present under spaced path" test -d "$fake_home/Applications/Remi.app"

  stop_fake_server "$api_root"
  rm -rf "$api_root" "$fake_home" /tmp/install-out.$$
}

echo "== install.sh tests (host arch: $HOST_ARCH) =="
test_successful_install
test_checksum_mismatch_rejected
test_missing_release_fails_cleanly
test_path_traversal_archive_rejected
test_symlink_archive_rejected
test_refuses_when_running
test_upgrade_preserves_success
test_install_path_with_spaces

report_and_exit

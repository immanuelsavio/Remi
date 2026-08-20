#!/usr/bin/env bash
# Shared helpers for install.sh / uninstall.sh tests. Every test gets its
# own throwaway HOME and fake "GitHub" HTTP server - real Remi data at the
# real $HOME is never touched.
#
# Deliberately NOT `-e`: this file is sourced into test scripts that call
# install.sh/uninstall.sh and inspect their exit codes, including cases
# that are EXPECTED to fail (checksum mismatch, refuse-while-running,
# etc). Since `source` runs in the caller's shell, `-e` here would abort
# the whole test script the instant one of those expected-nonzero calls
# returns, before the test ever reaches its assertion.
set -uo pipefail

# Scratch space for every temp file and throwaway HOME these tests create.
#
# Honours $TMPDIR rather than hardcoding /tmp: macOS gives each user a
# private per-session TMPDIR, and sandboxed or CI shells may not be able to
# write to /tmp at all. Note that BSD `mktemp` IGNORES $TMPDIR unless it is
# given an explicit template path - it asks the OS for the per-user temp dir
# instead - which is why `new_tmpdir` below always passes a full template
# rooted here rather than calling a bare `mktemp -d`.
TMP_ROOT="${TMPDIR:-/tmp}"
TMP_ROOT="${TMP_ROOT%/}"

# Make a throwaway directory, or abort the whole run.
#
# THIS GUARD IS LOAD-BEARING, not defensive tidiness. These tests build
# destructive paths by hand - "$fake_home/Applications/Remi.app",
# "$fake_home/Library/Application Support/...", "$fake_home/Remi" - and
# then delete them. If `mktemp` fails and its empty output is captured
# into $fake_home, every one of those paths becomes an ABSOLUTE system
# path: the real /Applications/Remi.app, the real /Library, the real
# /Remi. A silent failure here would point the uninstall tests at the
# user's actual installation. Fail loudly instead.
new_tmpdir() {
  local d
  d="$(mktemp -d "$TMP_ROOT/remi-test.XXXXXX")" || d=""
  if [[ -z "$d" || ! -d "$d" ]]; then
    printf 'FATAL: could not create a temp dir under %s - refusing to run destructive tests against absolute paths\n' "$TMP_ROOT" >&2
    exit 1
  fi
  printf '%s\n' "$d"
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC2034 # used by test files that source this library
INSTALL_SH="$REPO_ROOT/install.sh"
# shellcheck disable=SC2034 # used by test files that source this library
UNINSTALL_SH="$REPO_ROOT/uninstall.sh"

PASS_COUNT=0
FAIL_COUNT=0

pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf '  PASS: %s\n' "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); printf '  FAIL: %s\n' "$1" >&2; }

assert_true() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi
}

assert_false() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then fail "$desc (expected failure, got success)"; else pass "$desc"; fi
}

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    pass "$desc"
  else
    fail "$desc (expected [$expected], got [$actual])"
  fi
}

report_and_exit() {
  echo ""
  echo "$PASS_COUNT passed, $FAIL_COUNT failed."
  [[ $FAIL_COUNT -eq 0 ]]
}

# Builds a fake Remi.app bundle with a real (tiny) Mach-O-ish stand-in
# executable at Contents/MacOS/remi. `file` only needs to report an
# architecture string; a real compiled no-op binary satisfies that
# honestly without needing the actual Tauri build.
build_fake_app_bundle() {
  local dest="$1" arch_flag="$2" # arch_flag: arm64 | x86_64
  mkdir -p "$dest/Contents/MacOS"
  cat > "$dest/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.immanuelsavio.remi</string>
  <key>CFBundleName</key><string>Remi</string>
</dict></plist>
EOF
  local src
  src="$(mktemp "$TMP_ROOT/remi-fakebin.XXXXXX.c")"
  cat > "$src" <<'EOF'
int main(void) { for(;;) { } return 0; }
EOF
  if [[ "$arch_flag" == "$(uname -m | sed 's/arm64/arm64/;s/x86_64/x86_64/')" ]]; then
    cc -arch "$arch_flag" -o "$dest/Contents/MacOS/remi" "$src"
  else
    # Cross-arch: best effort, may not be available on every runner.
    cc -arch "$arch_flag" -o "$dest/Contents/MacOS/remi" "$src" 2>/dev/null \
      || cc -o "$dest/Contents/MacOS/remi" "$src"
  fi
  rm -f "$src"
  chmod +x "$dest/Contents/MacOS/remi"
}

# Packs a fake release: Remi-<version>-macos-<arch>.tar.gz + checksums.txt,
# served from a local directory tree that install.sh reaches via a
# file://-backed fake GitHub API (see fake_github_release_dir below).
build_release_assets() {
  local out_dir="$1" version="$2" arch="$3" host_arch_flag="$4"
  # `cd ""` is a no-op that SUCCEEDS in bash, so an empty $out_dir would let
  # the redirects below write checksums.txt into the repo instead of the
  # throwaway release dir. Refuse rather than litter.
  if [[ -z "$out_dir" || ! -d "$out_dir" ]]; then
    printf 'FATAL: build_release_assets needs an existing output dir, got %q\n' "$out_dir" >&2
    exit 1
  fi
  local stage
  stage="$(new_tmpdir)"
  build_fake_app_bundle "$stage/Remi.app" "$host_arch_flag"

  local asset_name="Remi-${version}-macos-${arch}.tar.gz"
  ( cd "$stage" && tar -czf "$out_dir/$asset_name" Remi.app )
  ( cd "$out_dir" && shasum -a 256 "$asset_name" >> checksums.txt )
  rm -rf "$stage"
}

# Starts a local HTTP server rooted at $1, prints "host:port pid" on stdout.
# install.sh talks to it via REMI_INSTALL_API_BASE instead of the real
# GitHub API - fully real HTTP, just not the real internet.
start_fake_server() {
  local root="$1"
  local port
  port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
  # Backgrounded directly in THIS shell (not inside a `( ... & )` subshell)
  # and disowned - otherwise, when this whole script is itself invoked as
  # `bash script.sh` whose own stdout is captured by a caller (piped to a
  # log file, or read via command substitution), the server process
  # inherits that pipe's write end even through </dev/null >/dev/null
  # redirects on the command itself, because a subshell wrapping a
  # backgrounded job doesn't fully detach its inherited FDs the way
  # disown does. Without this, every `$(...)` substitution afterwards
  # blocks forever waiting for ALL holders of that pipe to close -
  # including this long-lived server.
  local prev_dir; prev_dir="$(pwd)"
  cd "$root" || return 1
  python3 -m http.server "$port" --bind 127.0.0.1 </dev/null >/dev/null 2>&1 &
  echo $! > "$root/.server.pid"
  disown
  cd "$prev_dir" || return 1
  # Wait for the server to actually accept connections before returning.
  for _ in $(seq 1 50); do
    if curl -fsS "http://127.0.0.1:$port/" >/dev/null 2>&1; then break; fi
    sleep 0.1
  done
  echo "127.0.0.1:$port"
}

stop_fake_server() {
  local root="$1"
  if [[ -f "$root/.server.pid" ]]; then
    kill "$(cat "$root/.server.pid")" 2>/dev/null || true
    rm -f "$root/.server.pid"
  fi
}

# Writes a fake GitHub "release" API response (releases/latest shape) into
# $1/releases/latest and $1/releases/tags/<tag>, pointing browser_download_url
# at assets served from the SAME fake server root.
write_release_json() {
  local api_root="$1" base_url="$2" tag="$3"; shift 3
  local entries=()
  for name in "$@"; do
    entries+=("{\"name\":\"$name\",\"browser_download_url\":\"$base_url/$name\"}")
  done
  local joined
  joined=$(IFS=,; echo "${entries[*]}")
  mkdir -p "$api_root/releases/tags"
  cat > "$api_root/releases/latest" <<EOF
{"tag_name": "$tag", "assets": [$joined]}
EOF
  cp "$api_root/releases/latest" "$api_root/releases/tags/$tag"
}

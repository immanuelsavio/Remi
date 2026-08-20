#!/usr/bin/env bash
# Tests for uninstall.sh. Every test uses --app-path to target a throwaway
# fake bundle and a fake $HOME - the real installed Remi.app and real
# ~/Remi data are never touched.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1
# shellcheck source=tests/scripts/lib.sh
source ./lib.sh

HOST_ARCH="$(uname -m)"
BUNDLE_ID="com.immanuelsavio.remi"

# --- test: app-only uninstall removes the bundle, preserves data ------------
test_app_only_preserves_data() {
  local fake_home app_path
  fake_home="$(new_tmpdir)"
  app_path="$fake_home/Applications/Remi.app"
  mkdir -p "$fake_home/Applications"
  build_fake_app_bundle "$app_path" "$HOST_ARCH"

  local settings_dir="$fake_home/Library/Application Support/$BUNDLE_ID"
  mkdir -p "$settings_dir"
  echo '{"dataFolder":""}' > "$settings_dir/settings.json"
  mkdir -p "$fake_home/Remi"
  echo '{"mains":[]}' > "$fake_home/Remi/state.json"

  HOME="$fake_home" bash "$UNINSTALL_SH" --app-path "$app_path" >"$TMP_ROOT/uninstall-out.$$" 2>&1
  local rc=$?
  assert_eq "app-only uninstall exits 0" "0" "$rc"
  assert_false "app bundle removed" test -d "$app_path"
  assert_true "state.json preserved" test -f "$fake_home/Remi/state.json"
  assert_true "settings.json preserved" test -f "$settings_dir/settings.json"

  rm -rf "$fake_home" "$TMP_ROOT/uninstall-out.$$"
}

# --- test: full purge removes app + data + settings --------------------------
test_full_purge_removes_everything() {
  local fake_home app_path
  fake_home="$(new_tmpdir)"
  app_path="$fake_home/Applications/Remi.app"
  mkdir -p "$fake_home/Applications"
  build_fake_app_bundle "$app_path" "$HOST_ARCH"

  local settings_dir="$fake_home/Library/Application Support/$BUNDLE_ID"
  mkdir -p "$settings_dir"
  echo '{"dataFolder":""}' > "$settings_dir/settings.json"
  mkdir -p "$fake_home/Remi"
  echo '{"mains":[]}' > "$fake_home/Remi/state.json"
  echo '{}' > "$fake_home/Remi/remi-backup-2026-01-01-abc123.json"

  HOME="$fake_home" bash "$UNINSTALL_SH" --app-path "$app_path" --purge --yes >"$TMP_ROOT/uninstall-out.$$" 2>&1
  local rc=$?
  assert_eq "purge uninstall exits 0" "0" "$rc"
  assert_false "app bundle removed" test -d "$app_path"
  assert_false "data folder removed" test -d "$fake_home/Remi"
  assert_false "settings dir removed" test -d "$settings_dir"

  rm -rf "$fake_home" "$TMP_ROOT/uninstall-out.$$"
}

# --- test: purge without --yes is refused ------------------------------------
test_purge_requires_yes() {
  local fake_home app_path
  fake_home="$(new_tmpdir)"
  app_path="$fake_home/Applications/Remi.app"
  mkdir -p "$fake_home/Applications"
  build_fake_app_bundle "$app_path" "$HOST_ARCH"
  mkdir -p "$fake_home/Remi"
  echo '{"mains":[]}' > "$fake_home/Remi/state.json"

  HOME="$fake_home" bash "$UNINSTALL_SH" --app-path "$app_path" --purge >"$TMP_ROOT/uninstall-out.$$" 2>&1
  local rc=$?
  assert_true "purge without --yes exits nonzero" test "$rc" -ne 0
  assert_true "app bundle NOT removed without confirmation" test -d "$app_path"
  assert_true "data NOT removed without confirmation" test -f "$fake_home/Remi/state.json"

  rm -rf "$fake_home" "$TMP_ROOT/uninstall-out.$$"
}

# --- test: repeated (idempotent) app-only uninstall --------------------------
test_repeated_uninstall_is_safe() {
  local fake_home app_path
  fake_home="$(new_tmpdir)"
  app_path="$fake_home/Applications/Remi.app"
  mkdir -p "$fake_home/Applications"
  build_fake_app_bundle "$app_path" "$HOST_ARCH"

  HOME="$fake_home" bash "$UNINSTALL_SH" --app-path "$app_path" >"$TMP_ROOT/uninstall-out1.$$" 2>&1
  local rc1=$?
  HOME="$fake_home" bash "$UNINSTALL_SH" --app-path "$app_path" >"$TMP_ROOT/uninstall-out2.$$" 2>&1
  local rc2=$?
  assert_eq "first uninstall exits 0" "0" "$rc1"
  assert_eq "second (repeated) uninstall also exits 0" "0" "$rc2"

  rm -rf "$fake_home" "$TMP_ROOT/uninstall-out1.$$" "$TMP_ROOT/uninstall-out2.$$"
}

# --- test: repeated full purge is safe ---------------------------------------
test_repeated_purge_is_safe() {
  local fake_home app_path
  fake_home="$(new_tmpdir)"
  app_path="$fake_home/Applications/Remi.app"
  mkdir -p "$fake_home/Applications"
  build_fake_app_bundle "$app_path" "$HOST_ARCH"
  mkdir -p "$fake_home/Remi"
  echo '{"mains":[]}' > "$fake_home/Remi/state.json"

  HOME="$fake_home" bash "$UNINSTALL_SH" --app-path "$app_path" --purge --yes >"$TMP_ROOT/uninstall-out1.$$" 2>&1
  local rc1=$?
  HOME="$fake_home" bash "$UNINSTALL_SH" --app-path "$app_path" --purge --yes >"$TMP_ROOT/uninstall-out2.$$" 2>&1
  local rc2=$?
  assert_eq "first purge exits 0" "0" "$rc1"
  assert_eq "second (repeated) purge also exits 0" "0" "$rc2"

  rm -rf "$fake_home" "$TMP_ROOT/uninstall-out1.$$" "$TMP_ROOT/uninstall-out2.$$"
}

# --- test: refuses unsafe app-path targets -----------------------------------
test_rejects_unsafe_paths() {
  local fake_home
  fake_home="$(new_tmpdir)"

  HOME="$fake_home" bash "$UNINSTALL_SH" --app-path "$fake_home" >"$TMP_ROOT/uninstall-out.$$" 2>&1
  local rc=$?
  assert_true "refuses to target HOME itself" test "$rc" -ne 0
  assert_true "HOME still exists" test -d "$fake_home"

  rm -rf "$fake_home" "$TMP_ROOT/uninstall-out.$$"
}

# --- test: quits a running instance before removing it -----------------------
test_quits_running_instance_first() {
  local fake_home app_path
  fake_home="$(new_tmpdir)"
  app_path="$fake_home/Applications/Remi.app"
  mkdir -p "$fake_home/Applications"
  build_fake_app_bundle "$app_path" "$HOST_ARCH"

  "$app_path/Contents/MacOS/remi" &
  local fake_pid=$!
  sleep 0.3

  # osascript can't "quit" our fake infinite-loop binary (it isn't a real
  # app named Remi), so the uninstaller's wait loop will time out and
  # refuse - which is the CORRECT, safe behavior: it must never rm -rf a
  # bundle out from under a process that's still running. Kill it partway
  # through so the test also covers the case where the process exits on
  # its own during the wait.
  ( sleep 1.5 && kill "$fake_pid" 2>/dev/null ) &
  local killer_pid=$!

  HOME="$fake_home" bash "$UNINSTALL_SH" --app-path "$app_path" >"$TMP_ROOT/uninstall-out.$$" 2>&1
  local rc=$?
  assert_eq "uninstall succeeds once the process exits" "0" "$rc"
  assert_false "app bundle removed after process exited" test -d "$app_path"

  wait "$killer_pid" 2>/dev/null || true
  kill "$fake_pid" 2>/dev/null || true
  rm -rf "$fake_home" "$TMP_ROOT/uninstall-out.$$"
}

# --- test: custom dataFolder from settings.json is respected on purge -------
test_purge_respects_custom_data_folder() {
  local fake_home app_path custom_data
  fake_home="$(new_tmpdir)"
  custom_data="$(new_tmpdir)"
  app_path="$fake_home/Applications/Remi.app"
  mkdir -p "$fake_home/Applications"
  build_fake_app_bundle "$app_path" "$HOST_ARCH"

  local settings_dir="$fake_home/Library/Application Support/$BUNDLE_ID"
  mkdir -p "$settings_dir"
  printf '{"dataFolder":"%s"}' "$custom_data" > "$settings_dir/settings.json"
  echo '{"mains":[]}' > "$custom_data/state.json"

  HOME="$fake_home" bash "$UNINSTALL_SH" --app-path "$app_path" --purge --yes >"$TMP_ROOT/uninstall-out.$$" 2>&1
  local rc=$?
  assert_eq "purge with custom data folder exits 0" "0" "$rc"
  assert_false "custom data folder removed" test -d "$custom_data"

  rm -rf "$fake_home" "$TMP_ROOT/uninstall-out.$$"
  rm -rf "$custom_data" 2>/dev/null || true
}

echo "== uninstall.sh tests (host arch: $HOST_ARCH) =="
test_app_only_preserves_data
test_full_purge_removes_everything
test_purge_requires_yes
test_repeated_uninstall_is_safe
test_repeated_purge_is_safe
test_rejects_unsafe_paths
test_quits_running_instance_first
test_purge_respects_custom_data_folder

report_and_exit

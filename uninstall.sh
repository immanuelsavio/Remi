#!/usr/bin/env bash
# Uninstalls Remi on macOS.
#
# By default, removes ONLY the app bundle - all your tasks, backlog,
# settings, and exported files are left in place so a later reinstall
# picks up exactly where you left off.
#
# Pass --purge --yes to also permanently delete Remi's data: settings,
# the data folder (state, backups, recovery snapshots, usage exports)
# and any stray temp files. This is NOT reversible.
#
# Usage:
#   bash uninstall.sh                 # remove the app only, keep data
#   bash uninstall.sh --system        # target /Applications/Remi.app
#   bash uninstall.sh --purge --yes   # also permanently delete all data
#
# Options:
#   --system        Uninstall from /Applications/Remi.app instead of
#                    $HOME/Applications/Remi.app.
#   --purge         Also delete Remi's settings and data folder.
#                    Requires --yes to actually run (safety confirmation).
#   --yes           Confirms a --purge run. Ignored without --purge.
#   --app-path P    Override the app bundle path directly (mainly for tests).

set -euo pipefail

SYSTEM_UNINSTALL=0
PURGE=0
CONFIRMED=0
APP_PATH_OVERRIDE=""
APP_NAME="Remi.app"
BUNDLE_IDENTIFIER="com.immanuelsavio.remi"

log()  { printf '%s\n' "$*"; }
err()  { printf 'Error: %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --system) SYSTEM_UNINSTALL=1; shift ;;
    --purge) PURGE=1; shift ;;
    --yes) CONFIRMED=1; shift ;;
    --app-path) APP_PATH_OVERRIDE="${2:-}"; [[ -n "$APP_PATH_OVERRIDE" ]] || die "--app-path requires a value"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || die "This uninstaller only supports macOS. Detected: $(uname -s)"

if [[ $PURGE -eq 1 && $CONFIRMED -ne 1 ]]; then
  die "--purge permanently deletes your Remi data. Re-run with --purge --yes to confirm."
fi

FAILURES=()
note_failure() { FAILURES+=("$1"); err "$1"; }

# --- Reject unsafe deletion targets outright --------------------------------
#
# A target that resolves to empty, "/", a home directory, or a shared
# Applications folder itself (as opposed to Remi.app inside it) must never
# be handed to `rm -rf`, no matter how it got there.
reject_unsafe_path() {
  local p="$1"
  local label="$2"
  [[ -n "$p" ]] || die "$label resolved to an empty path - refusing to touch it."
  case "$p" in
    "/"|"$HOME"|/Applications|"$HOME/Applications")
      die "$label resolved to $p, which looks like a shared/root/home directory, not something Remi owns. Refusing to delete it." ;;
  esac
}

# --- Locate the app bundle ---------------------------------------------------

if [[ -n "$APP_PATH_OVERRIDE" ]]; then
  APP_PATH="$APP_PATH_OVERRIDE"
elif [[ $SYSTEM_UNINSTALL -eq 1 ]]; then
  APP_PATH="/Applications/$APP_NAME"
else
  APP_PATH="$HOME/Applications/$APP_NAME"
fi
reject_unsafe_path "$APP_PATH" "App bundle path"

# --- Quit Remi cleanly before touching anything -----------------------------
#
# Remi has its own save-and-quit path (menu bar -> Quit, or AppleScript
# `quit`) that flushes state to disk before exiting. Killing the process
# directly could uninstall out from under an in-flight save.
if pgrep -f "$APP_PATH/Contents/MacOS/remi" >/dev/null 2>&1; then
  log "Remi is running - asking it to quit and save first..."
  osascript -e 'tell application "Remi" to quit' >/dev/null 2>&1 || true

  WAITED=0
  while pgrep -f "$APP_PATH/Contents/MacOS/remi" >/dev/null 2>&1; do
    if [[ $WAITED -ge 10 ]]; then
      die "Remi did not quit within 10 seconds. Quit it manually (menu bar icon -> Quit) and re-run this script - uninstalling a running app risks losing unsaved state."
    fi
    sleep 1
    WAITED=$((WAITED + 1))
  done
  log "Remi quit cleanly."
fi

# --- Remove the app bundle ---------------------------------------------------

if [[ -d "$APP_PATH" ]]; then
  if [[ -L "$APP_PATH" ]]; then
    die "$APP_PATH is a symlink, not a real app bundle - refusing to follow it. Investigate manually."
  fi
  if rm -rf "$APP_PATH"; then
    log "Removed $APP_PATH."
  else
    note_failure "Could not remove $APP_PATH (permission denied?)."
  fi
else
  log "No app bundle found at $APP_PATH - nothing to remove there."
fi

# --- Optional full purge of user data ---------------------------------------

if [[ $PURGE -eq 1 ]]; then
  log ""
  log "Purging Remi's settings and data (this cannot be undone)..."

  SETTINGS_DIR="$HOME/Library/Application Support/$BUNDLE_IDENTIFIER"
  SETTINGS_FILE="$SETTINGS_DIR/settings.json"
  reject_unsafe_path "$SETTINGS_DIR" "Settings directory"

  DATA_FOLDER="$HOME/Remi"
  if [[ -f "$SETTINGS_FILE" ]]; then
    CUSTOM_FOLDER="$(
      node -e '
        try {
          const fs = require("fs");
          const v = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
          if (typeof v.dataFolder === "string" && v.dataFolder.trim()) process.stdout.write(v.dataFolder);
        } catch {}
      ' "$SETTINGS_FILE" 2>/dev/null || true
    )"
    if [[ -n "$CUSTOM_FOLDER" ]]; then
      DATA_FOLDER="$CUSTOM_FOLDER"
    fi
  fi
  reject_unsafe_path "$DATA_FOLDER" "Data folder"

  if [[ -L "$DATA_FOLDER" ]]; then
    note_failure "$DATA_FOLDER is a symlink - refusing to follow it. Remove manually if intended."
  elif [[ -d "$DATA_FOLDER" ]]; then
    if rm -rf "$DATA_FOLDER"; then
      log "Removed data folder $DATA_FOLDER (state, backups, recovery snapshots, exports)."
    else
      note_failure "Could not remove data folder $DATA_FOLDER."
    fi
  else
    log "No data folder found at $DATA_FOLDER."
  fi

  if [[ -L "$SETTINGS_DIR" ]]; then
    note_failure "$SETTINGS_DIR is a symlink - refusing to follow it. Remove manually if intended."
  elif [[ -d "$SETTINGS_DIR" ]]; then
    if rm -rf "$SETTINGS_DIR"; then
      log "Removed settings directory $SETTINGS_DIR."
    else
      note_failure "Could not remove settings directory $SETTINGS_DIR."
    fi
  else
    log "No settings directory found at $SETTINGS_DIR."
  fi

  # Remi has no autostart/login-item registration and no cache directory as
  # of this writing - nothing else to purge. If that changes, add removal
  # here and update docs/data-durability.md's inventory of what Remi writes.
else
  log ""
  log "App removed. Your Remi data was left in place:"
  log "  Settings: \$HOME/Library/Application Support/$BUNDLE_IDENTIFIER/settings.json"
  log "  Data:     \$HOME/Remi (or your configured data folder)"
  log "Re-installing Remi will pick this data back up. Run with --purge --yes to delete it permanently."
fi

if [[ ${#FAILURES[@]} -gt 0 ]]; then
  log ""
  err "Uninstall completed with ${#FAILURES[@]} failure(s):"
  for f in "${FAILURES[@]}"; do err "  - $f"; done
  exit 1
fi

log ""
log "Uninstall complete."

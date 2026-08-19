#!/usr/bin/env bash
# Installs Remi on macOS from a GitHub Release, without sudo by default.
#
# Remi is open-source, ad-hoc signed (not a paid Apple Developer ID) and
# NOT notarized by Apple. This script verifies the downloaded archive's
# SHA-256 checksum against checksums.txt published in the same release
# BEFORE extracting anything, then - only after that verification passes -
# removes the com.apple.quarantine flag from the installed app bundle so
# it opens without a Gatekeeper prompt. Nothing else on your Mac is
# touched: Gatekeeper itself is never disabled, and no other app's
# quarantine attribute is touched.
#
# Safer alternative to `curl | bash`: inspect this script before running it.
#   curl -fsSLo remi-install.sh https://raw.githubusercontent.com/immanuelsavio/remi/main/install.sh
#   less remi-install.sh
#   bash remi-install.sh
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/immanuelsavio/remi/main/install.sh | bash
#   bash install.sh [--system] [--launch] [--version vX.Y.Z]
#
# Options:
#   --system          Install to /Applications/Remi.app instead of
#                      $HOME/Applications/Remi.app (may prompt for sudo).
#   --launch          Launch Remi after a successful install.
#   --version vX.Y.Z  Install a specific tagged release instead of latest.
#   --repo owner/name Override the GitHub repo (default immanuelsavio/remi).

set -euo pipefail

REPO="immanuelsavio/remi"
SYSTEM_INSTALL=0
LAUNCH_AFTER=0
REQUESTED_VERSION=""
APP_NAME="Remi.app"

log()  { printf '%s\n' "$*"; }
err()  { printf 'Error: %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --system) SYSTEM_INSTALL=1; shift ;;
    --launch) LAUNCH_AFTER=1; shift ;;
    --version) REQUESTED_VERSION="${2:-}"; [[ -n "$REQUESTED_VERSION" ]] || die "--version requires a value"; shift 2 ;;
    --repo) REPO="${2:-}"; [[ -n "$REPO" ]] || die "--repo requires a value"; shift 2 ;;
    -h|--help)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done

# --- Platform checks -------------------------------------------------------

[[ "$(uname -s)" == "Darwin" ]] || die "Remi's installer only supports macOS. Detected: $(uname -s)"

case "$(uname -m)" in
  arm64)  ARCH="aarch64" ;;
  x86_64) ARCH="x86_64" ;;
  *) die "Unsupported architecture: $(uname -m) (Remi ships aarch64 and x86_64 builds only)" ;;
esac
log "Detected macOS on $ARCH."

for cmd in curl shasum tar mktemp; do
  command -v "$cmd" >/dev/null 2>&1 || die "Required command not found: $cmd"
done

# --- Resolve install location -----------------------------------------------

if [[ $SYSTEM_INSTALL -eq 1 ]]; then
  INSTALL_DIR="/Applications"
else
  INSTALL_DIR="$HOME/Applications"
fi
INSTALL_PATH="$INSTALL_DIR/$APP_NAME"

# --- Refuse to overwrite a running instance ---------------------------------

if pgrep -f "$INSTALL_PATH/Contents/MacOS/remi" >/dev/null 2>&1; then
  die "Remi is currently running from $INSTALL_PATH. Quit Remi (menu bar icon -> Quit) and re-run this installer."
fi

# --- Temp workspace, always cleaned up --------------------------------------

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/remi-install.XXXXXX")"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT INT TERM

# --- Resolve release + asset URLs -------------------------------------------

# REMI_INSTALL_API_BASE lets tests point this at a local fake server instead
# of the real GitHub API. Not documented for end users - normal installs
# never set it.
API_BASE="${REMI_INSTALL_API_BASE:-https://api.github.com/repos/$REPO}"
if [[ -n "$REQUESTED_VERSION" ]]; then
  RELEASE_JSON_URL="$API_BASE/releases/tags/$REQUESTED_VERSION"
else
  RELEASE_JSON_URL="$API_BASE/releases/latest"
fi

log "Looking up release metadata..."
RELEASE_JSON="$WORK_DIR/release.json"
HTTP_CODE="$(curl -fsSL -w '%{http_code}' -o "$RELEASE_JSON" "$RELEASE_JSON_URL" || echo "000")"
if [[ "$HTTP_CODE" != "200" ]]; then
  die "Could not fetch release metadata from $RELEASE_JSON_URL (HTTP $HTTP_CODE). Is the repository public and does the release exist?"
fi

TAG="$(grep -m1 '"tag_name"' "$RELEASE_JSON" | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
[[ -n "$TAG" ]] || die "Could not determine release tag from GitHub API response."
VERSION="${TAG#v}"
log "Installing Remi $TAG."

ASSET_NAME="Remi-${VERSION}-macos-${ARCH}.tar.gz"
CHECKSUMS_NAME="checksums.txt"

asset_url() {
  local name="$1"
  # -o isolates just the matching "browser_download_url": "..." pair before
  # extraction - critical when the whole API response is on one line (as a
  # minified response, or this script's own test fixtures, may be): without
  # -o, sed's capture group is not anchored to grep's match and can grab a
  # DIFFERENT asset's URL later on the same line.
  grep -om1 "\"browser_download_url\": *\"[^\"]*/$name\"" "$RELEASE_JSON" \
    | sed -E 's/.*"browser_download_url": *"([^"]+)".*/\1/'
}

ASSET_URL="$(asset_url "$ASSET_NAME")"
CHECKSUMS_URL="$(asset_url "$CHECKSUMS_NAME")"
[[ -n "$ASSET_URL" ]] || die "Release $TAG has no asset named $ASSET_NAME."
[[ -n "$CHECKSUMS_URL" ]] || die "Release $TAG has no $CHECKSUMS_NAME asset - cannot verify integrity, refusing to install."

log "Downloading $ASSET_NAME..."
curl -fsSL -o "$WORK_DIR/$ASSET_NAME" "$ASSET_URL" || die "Download failed: $ASSET_URL"
curl -fsSL -o "$WORK_DIR/$CHECKSUMS_NAME" "$CHECKSUMS_URL" || die "Download failed: $CHECKSUMS_URL"

# --- Verify checksum BEFORE extracting anything -----------------------------

log "Verifying checksum..."
EXPECTED_LINE="$(grep -F "$ASSET_NAME" "$WORK_DIR/$CHECKSUMS_NAME" || true)"
[[ -n "$EXPECTED_LINE" ]] || die "$ASSET_NAME is not listed in $CHECKSUMS_NAME. Refusing to install unverified content."
(
  cd "$WORK_DIR"
  echo "$EXPECTED_LINE" | shasum -a 256 -c - --status
) || die "Checksum verification FAILED for $ASSET_NAME. The download may be corrupted or tampered with. Aborting."
log "Checksum OK."

# --- Extract into an isolated staging dir, rejecting unsafe archive content -

STAGE_DIR="$WORK_DIR/stage"
mkdir -p "$STAGE_DIR"

# Reject path traversal and absolute paths before ever calling tar -x.
if tar -tzf "$WORK_DIR/$ASSET_NAME" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  die "Archive contains unsafe paths (absolute path or ..). Aborting without extracting."
fi

tar -xzf "$WORK_DIR/$ASSET_NAME" -C "$STAGE_DIR" || die "Failed to extract $ASSET_NAME."

# Reject symlinks anywhere in the extracted tree - a malicious archive could
# otherwise point a path outside the staging dir.
if find "$STAGE_DIR" -type l | grep -q .; then
  die "Extracted archive contains symlinks, which is not expected for a Remi release. Aborting."
fi

APP_BUNDLES=("$STAGE_DIR"/*.app)
[[ ${#APP_BUNDLES[@]} -eq 1 && -d "${APP_BUNDLES[0]}" ]] || die "Expected exactly one .app bundle in the archive, found ${#APP_BUNDLES[@]}."
EXTRACTED_APP="${APP_BUNDLES[0]}"
[[ "$(basename "$EXTRACTED_APP")" == "$APP_NAME" ]] || die "Unexpected bundle name: $(basename "$EXTRACTED_APP") (expected $APP_NAME)."

BINARY_PATH="$EXTRACTED_APP/Contents/MacOS/remi"
[[ -f "$BINARY_PATH" ]] || die "Extracted bundle is missing its executable at Contents/MacOS/remi."
FILE_OUTPUT="$(file "$BINARY_PATH")"
case "$ARCH" in
  aarch64) echo "$FILE_OUTPUT" | grep -q "arm64" || die "Binary architecture mismatch: expected arm64, got: $FILE_OUTPUT" ;;
  x86_64)  echo "$FILE_OUTPUT" | grep -q "x86_64" || die "Binary architecture mismatch: expected x86_64, got: $FILE_OUTPUT" ;;
esac
log "Verified bundle: $APP_NAME ($ARCH)."

# --- Install (with rollback-capable upgrade) --------------------------------

mkdir -p "$INSTALL_DIR"

PREVIOUS_BACKUP=""
if [[ -d "$INSTALL_PATH" ]]; then
  log "Existing install found at $INSTALL_PATH - upgrading."
  PREVIOUS_BACKUP="$WORK_DIR/previous.app"
  mv "$INSTALL_PATH" "$PREVIOUS_BACKUP" || die "Could not move aside the existing installation for upgrade."
fi

if ! cp -R "$EXTRACTED_APP" "$INSTALL_PATH"; then
  err "Failed to copy new version into place."
  if [[ -n "$PREVIOUS_BACKUP" ]]; then
    err "Rolling back to the previous installation."
    rm -rf "$INSTALL_PATH"
    mv "$PREVIOUS_BACKUP" "$INSTALL_PATH" || err "Rollback ALSO failed - $INSTALL_PATH may be missing. Previous version was at $PREVIOUS_BACKUP before this script exits."
  fi
  die "Install failed."
fi

log "Installed to $INSTALL_PATH."

# --- Quarantine: explain, then remove only from this bundle -----------------

log ""
log "Remi is open-source and ad-hoc signed, but is NOT notarized by Apple"
log "(that requires a paid Apple Developer Program membership). The archive's"
log "SHA-256 checksum was verified above against the published release, so"
log "this script will remove the macOS quarantine flag from JUST the"
log "installed $APP_NAME bundle - not from any other app, and Gatekeeper"
log "itself is left fully enabled system-wide."
log ""

if xattr -dr com.apple.quarantine "$INSTALL_PATH" 2>/dev/null; then
  log "Quarantine flag removed from $INSTALL_PATH."
else
  log "Could not remove the quarantine flag automatically."
  log "If macOS blocks Remi with an 'unidentified developer' warning, open it manually:"
  log "  System Settings -> Privacy & Security -> scroll to Security -> \"Open Anyway\" next to Remi."
fi

log ""
log "Remi installed successfully: $INSTALL_PATH"

if [[ $LAUNCH_AFTER -eq 1 ]]; then
  log "Launching Remi..."
  open "$INSTALL_PATH"
fi

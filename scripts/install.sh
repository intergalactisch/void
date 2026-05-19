#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

BUNDLE_DIR="src-tauri/target/release/bundle/macos"
ENTITLEMENTS="src-tauri/Entitlements.plist"
INSTALL_DIR="/Applications"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

die() {
  echo "Error: $*" >&2
  exit 1
}

read_plist() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$2" 2>/dev/null || true
}

find_source_app() {
  if [ -d "$BUNDLE_DIR/Void.app" ]; then
    printf '%s\n' "$BUNDLE_DIR/Void.app"
    return
  fi

  find "$BUNDLE_DIR" -maxdepth 1 -type d -name '*.app' -print -quit 2>/dev/null || true
}

choose_signing_identity() {
  if [ -n "${SIGNING_IDENTITY:-}" ]; then
    printf '%s\n' "$SIGNING_IDENTITY"
    return
  fi

  if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
    printf '%s\n' "$APPLE_SIGNING_IDENTITY"
    return
  fi

  local identities
  identities="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(.*\)".*/\1/p' || true)"

  local identity
  identity="$(printf '%s\n' "$identities" | grep '^Developer ID Application:' | head -n 1 || true)"
  if [ -n "$identity" ]; then
    printf '%s\n' "$identity"
    return
  fi

  identity="$(printf '%s\n' "$identities" | grep '^Apple Development:' | head -n 1 || true)"
  if [ -n "$identity" ]; then
    printf '%s\n' "$identity"
    return
  fi

  identity="$(printf '%s\n' "$identities" | grep '^Mac Developer:' | head -n 1 || true)"
  if [ -n "$identity" ]; then
    printf '%s\n' "$identity"
    return
  fi

  identity="$(printf '%s\n' "$identities" | grep -Fx 'Void Code Signing' | head -n 1 || true)"
  if [ -n "$identity" ]; then
    printf '%s\n' "$identity"
    return
  fi

  identity="$(printf '%s\n' "$identities" | head -n 1 || true)"
  if [ -n "$identity" ]; then
    printf '%s\n' "$identity"
    return
  fi

  printf '%s\n' "-"
}

stop_running_app() {
  local app_name="$1"
  local bundle_id="$2"
  local process_name="$3"

  if ! pgrep -x "$process_name" >/dev/null 2>&1; then
    return
  fi

  echo "Stopping running $app_name..."
  osascript -e "tell application id \"$bundle_id\" to quit" >/dev/null 2>&1 || true
  killall "$process_name" >/dev/null 2>&1 || true

  for _ in {1..40}; do
    if ! pgrep -x "$process_name" >/dev/null 2>&1; then
      return
    fi
    sleep 0.25
  done

  die "$app_name is still running. Quit it and retry."
}

sign_app() {
  local app_path="$1"
  local identity="$2"

  local sign_args=(
    --force
    --deep
    --options runtime
    --entitlements "$ENTITLEMENTS"
    --sign "$identity"
  )

  if [ "$identity" != "-" ]; then
    sign_args+=(--timestamp)
  fi

  if codesign "${sign_args[@]}" "$app_path"; then
    return
  fi

  if [ "$identity" != "-" ]; then
    echo "Timestamped signing failed; retrying without timestamp..."
    codesign --force --deep --options runtime --entitlements "$ENTITLEMENTS" --sign "$identity" "$app_path"
    return
  fi

  return 1
}

maybe_notarize() {
  local app_path="$1"
  local identity="$2"
  local profile="${NOTARYTOOL_PROFILE:-${APPLE_NOTARY_PROFILE:-}}"

  if [ -z "$profile" ]; then
    return
  fi

  if [[ "$identity" != Developer\ ID\ Application:* ]]; then
    echo "Skipping notarization: a Developer ID Application identity is required."
    return
  fi

  command -v ditto >/dev/null 2>&1 || die "ditto is required for notarization packaging."
  command -v xcrun >/dev/null 2>&1 || die "xcrun is required for notarization."

  local archive
  archive="$(mktemp -t void-notary-XXXXXX.zip)"
  rm -f "$archive"

  echo "Submitting $app_name for notarization..."
  ditto -c -k --keepParent "$app_path" "$archive"
  xcrun notarytool submit "$archive" --keychain-profile "$profile" --wait
  rm -f "$archive"

  echo "Stapling notarization ticket..."
  xcrun stapler staple "$app_path"
  xcrun stapler validate "$app_path"
}

refresh_macos_registration() {
  local app_path="$1"
  local legacy_path="$2"

  if [ -x "$LSREGISTER" ]; then
    echo "Registering with LaunchServices..."
    "$LSREGISTER" -u "$legacy_path" >/dev/null 2>&1 || true
    "$LSREGISTER" -u "$app_path" >/dev/null 2>&1 || true
    "$LSREGISTER" -f "$app_path" >/dev/null 2>&1 || true
  fi

  echo "Refreshing Spotlight metadata..."
  mdimport -i "$app_path" >/dev/null 2>&1 || true
  touch "$app_path"
}

[ "$(uname -s)" = "Darwin" ] || die "macOS install only works on Darwin/macOS."
[ -d "$BUNDLE_DIR" ] || die "$BUNDLE_DIR not found. Run 'npm run tauri:install' to build before installing."
[ -f "$ENTITLEMENTS" ] || die "$ENTITLEMENTS not found."
[ -d "$INSTALL_DIR" ] || die "$INSTALL_DIR not found."
[ -w "$INSTALL_DIR" ] || die "$INSTALL_DIR is not writable by the current user."

APP_PATH="$(find_source_app)"
[ -n "$APP_PATH" ] && [ -d "$APP_PATH" ] || die "No .app bundle found in $BUNDLE_DIR. Run 'tauri build --bundles app' first."

INFO_PLIST="$APP_PATH/Contents/Info.plist"
[ -f "$INFO_PLIST" ] || die "$INFO_PLIST not found."

app_name="$(read_plist CFBundleDisplayName "$INFO_PLIST")"
[ -n "$app_name" ] || app_name="$(read_plist CFBundleName "$INFO_PLIST")"
[ -n "$app_name" ] || app_name="$(basename "$APP_PATH" .app)"

bundle_id="$(read_plist CFBundleIdentifier "$INFO_PLIST")"
[ -n "$bundle_id" ] || die "CFBundleIdentifier missing from $INFO_PLIST."

process_name="$(read_plist CFBundleExecutable "$INFO_PLIST")"
[ -n "$process_name" ] || process_name="$(basename "$APP_PATH" .app)"

INSTALL_APP_PATH="$INSTALL_DIR/$app_name.app"
LEGACY_APP_PATH="$INSTALL_DIR/void.app"
identity="$(choose_signing_identity)"

echo "Preparing $app_name for installation..."
echo "Source bundle: $APP_PATH"
echo "Bundle id: $bundle_id"

if [ "$identity" = "-" ]; then
  echo "Signing identity: ad-hoc hardened runtime (no Apple code-signing identity found)"
else
  echo "Signing identity: $identity"
fi

stop_running_app "$app_name" "$bundle_id" "$process_name"

echo "Installing to $INSTALL_APP_PATH..."
rm -rf "$INSTALL_APP_PATH" "$LEGACY_APP_PATH"
ditto --rsrc --extattr "$APP_PATH" "$INSTALL_APP_PATH"

echo "Removing quarantine attributes..."
xattr -cr "$INSTALL_APP_PATH"

echo "Patching Info.plist usage descriptions..."
INSTALLED_INFO_PLIST="$INSTALL_APP_PATH/Contents/Info.plist"
patch_plist_string() {
  local key="$1"
  local value="$2"
  /usr/libexec/PlistBuddy -c "Add :$key string '$value'" "$INSTALLED_INFO_PLIST" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Set :$key '$value'" "$INSTALLED_INFO_PLIST"
}
patch_plist_string NSDesktopFolderUsageDescription "Void reads and writes your notes folder on the Desktop."
patch_plist_string NSDocumentsFolderUsageDescription "Void reads and writes your notes folder if you store it in Documents."
patch_plist_string NSDownloadsFolderUsageDescription "Void reads and writes your notes folder if you store it in Downloads."

echo "Signing installed app..."
sign_app "$INSTALL_APP_PATH" "$identity"

maybe_notarize "$INSTALL_APP_PATH" "$identity"

echo "Verifying installed app signature..."
codesign --verify --deep --strict --verbose=2 "$INSTALL_APP_PATH"

echo "Installed signature:"
codesign --display --verbose=2 "$INSTALL_APP_PATH" 2>&1 | sed -n '1,14p'

if [[ "$identity" == Developer\ ID\ Application:* ]]; then
  echo "Running Gatekeeper assessment..."
  spctl --assess --type execute --verbose=4 "$INSTALL_APP_PATH"
else
  echo "Gatekeeper note: local installs without a Developer ID certificate use ad-hoc/development signing."
  echo "Gatekeeper may reject quarantined copies, so this installer removes quarantine on /Applications."
fi

refresh_macos_registration "$INSTALL_APP_PATH" "$LEGACY_APP_PATH"

resolved_id="$(osascript -e "id of app \"$app_name\"" 2>/dev/null || true)"
if [ "$resolved_id" != "$bundle_id" ]; then
  echo "Warning: LaunchServices has not resolved $app_name to $bundle_id yet."
else
  echo "LaunchServices resolves $app_name to $bundle_id."
fi

echo "Installed $app_name to $INSTALL_APP_PATH"
echo "You can open it with: open -b $bundle_id"

if ! mdfind "kMDItemCFBundleIdentifier == '$bundle_id'" | grep -Fx "$INSTALL_APP_PATH" >/dev/null 2>&1; then
  echo "Note: Spotlight has not indexed $app_name yet. If it still does not appear, run: sudo mdutil -E /"
fi

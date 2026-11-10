#!/bin/bash
# Builds "Crescent": the official Zen Browser for macOS, re-skinned to feel like Arc,
# with every AI feature switched off. Runs on macOS only (needs hdiutil + codesign).
#
#   ./build.sh                      # latest Zen release
#   ZEN_VERSION=1.24.1b ./build.sh  # a specific Zen release
#   APP_NAME="My Browser" ./build.sh
#
# Output: dist/<APP_NAME>.dmg
set -euo pipefail

APP_NAME="${APP_NAME:-Crescent}"
BUNDLE_ID="${BUNDLE_ID:-app.crescent.browser}"
ZEN_VERSION="${ZEN_VERSION:-latest}"

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$HERE/build"
DIST="$HERE/dist"
PLIST=/usr/libexec/PlistBuddy

[[ "$(uname)" == "Darwin" ]] || { echo "This script must run on macOS." >&2; exit 1; }

step() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }

rm -rf "$WORK" && mkdir -p "$WORK" "$DIST"

# ---------------------------------------------------------------------------
step "1/6  Downloading Zen ($ZEN_VERSION)"
if [[ "$ZEN_VERSION" == "latest" ]]; then
  URL="https://github.com/zen-browser/desktop/releases/latest/download/zen.macos-universal.dmg"
else
  URL="https://github.com/zen-browser/desktop/releases/download/$ZEN_VERSION/zen.macos-universal.dmg"
fi
curl -fL --retry 3 -o "$WORK/zen.dmg" "$URL"

# ---------------------------------------------------------------------------
step "2/6  Copying Zen.app out of the disk image"
MNT="$WORK/mnt"
mkdir -p "$MNT"
hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$WORK/zen.dmg" >/dev/null
APP="$WORK/$APP_NAME.app"
ditto "$MNT/Zen.app" "$APP"
hdiutil detach "$MNT" -quiet || hdiutil detach "$MNT" -force -quiet
xattr -cr "$APP"
C="$APP/Contents"
R="$C/Resources"
echo "Zen version: $($PLIST -c 'Print :CFBundleShortVersionString' "$C/Info.plist")"

# ---------------------------------------------------------------------------
step "3/6  Adding the Arc mods (no-AI policy, Arc defaults, CSS, auto-archive)"
mkdir -p "$R/distribution" "$R/defaults/pref"
cp "$HERE/mods/policies.json"                         "$R/distribution/policies.json"
cp "$HERE/mods/defaults/pref/crescent-autoconfig.js"   "$R/defaults/pref/crescent-autoconfig.js"
cp "$HERE/mods/crescent.cfg"                           "$R/crescent.cfg"
rm -rf "$R/crescent" && cp -R "$HERE/mods/crescent"     "$R/crescent"

# ---------------------------------------------------------------------------
step "4/6  Renaming to \"$APP_NAME\" and swapping the icon"
cp "$HERE/icon/AppIcon.icns" "$R/firefox.icns"
set_plist() { $PLIST -c "Set :$1 $2" "$C/Info.plist" 2>/dev/null || $PLIST -c "Add :$1 string $2" "$C/Info.plist"; }
set_plist CFBundleName        "$APP_NAME"
set_plist CFBundleDisplayName "$APP_NAME"
set_plist CFBundleIdentifier  "$BUNDLE_ID"
set_plist CFBundleGetInfoString "$APP_NAME (based on Zen)"
$PLIST -c "Delete :CFBundleIconName" "$C/Info.plist" 2>/dev/null || true  # force the .icns icon

# ---------------------------------------------------------------------------
step "5/6  Re-signing (ad-hoc) so macOS will run the modified app"
# Changing any file breaks Zen's original signature. We sign it ourselves ("ad-hoc"),
# keeping Zen's permissions (JIT, camera, mic, ...) but dropping the two that only
# Zen's own Apple developer account is allowed to use.
rm -f "$C/embedded.provisionprofile"
RESTRICTED=(com.apple.application-identifier
            com.apple.developer.team-identifier
            com.apple.developer.web-browser.public-key-credential
            keychain-access-groups)

sign() {  # sign <path>
  local target="$1" ents
  ents="$(mktemp "$WORK/ents.XXXXXX")"
  if codesign -d --entitlements - --xml "$target" > "$ents" 2>/dev/null && [[ -s "$ents" ]]; then
    for k in "${RESTRICTED[@]}"; do $PLIST -c "Delete :$k" "$ents" >/dev/null 2>&1 || true; done
    codesign --force --sign - --options runtime --entitlements "$ents" "$target"
  else
    codesign --force --sign - "$target"
  fi
  rm -f "$ents"
}

# a) every loose Mach-O binary/dylib, deepest first
while IFS= read -r f; do
  if file -b "$f" | grep -q "Mach-O"; then sign "$f"; fi
done < <(find "$C" -type f | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2-)
# b) nested bundles (.framework / .app), deepest first
while IFS= read -r b; do sign "$b"; done \
  < <(find "$C" -mindepth 1 -type d \( -name "*.framework" -o -name "*.app" \) | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2-)
# c) the app itself
sign "$APP"
codesign --verify --deep --strict "$APP" && echo "Signature OK"

# ---------------------------------------------------------------------------
step "6/6  Building $APP_NAME.dmg"
STAGE="$WORK/dmg"
mkdir -p "$STAGE"
mv "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
DMG="$DIST/$APP_NAME.dmg"
rm -f "$DMG"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$DMG" >/dev/null
echo
echo "Done: $DMG"
echo "Open it, drag $APP_NAME into Applications, then see README.md > 'First launch'."

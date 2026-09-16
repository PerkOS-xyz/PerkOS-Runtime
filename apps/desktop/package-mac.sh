#!/usr/bin/env bash
# PerkOS.app + DMG for macOS (Apple Silicon).
#   npm run package:mac --prefix apps/desktop
# Output: release/PerkOS-<version>-arm64.dmg and release/mac-arm64/PerkOS.app.
#
# Signing: uses the "Developer ID Application" identity that expires last
# (FLOOR_SIGN_IDENTITY=<sha1|name> to pick another), hardened runtime. Without
# one the build is ad-hoc signed and only runs on the Mac that built it. Notarization runs when Apple credentials are present:
#   APPLE_KEYCHAIN_PROFILE=<profile stored with `xcrun notarytool store-credentials`>
#   or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
# Version: apps/desktop/package.json "version"; the git short SHA becomes
# CFBundleVersion and shows in Settings › About.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WEB="$HERE/../web"
VERSION="$(node -p "require('$HERE/package.json').version")"
SHA="$(git -C "$HERE" rev-parse --short HEAD 2>/dev/null || echo local)"
echo "PerkOS $VERSION ($SHA)"

echo "1/4 next build (standalone)"
(cd "$WEB" && npm run build)

echo "2/4 icon + DMG background"
bash "$HERE/make-icns.sh" "$HERE/icon.png" "$HERE/build/icon.icns"
python3 "$HERE/make-dmg-background.py" "$HERE/icon.png" "$HERE/build/dmg-background.png" "$VERSION"

echo "3/4 electron-builder (dmg) + signing"
# By SHA-1: names can be ambiguous when the keychain holds several Developer ID
# certificates. FLOOR_SIGN_IDENTITY=<hash or exact name> forces one. Signing
# and notarization happen in after-pack.cjs; electron-builder only packs.
IDENTITY="$(python3 "$HERE/pick-identity.py")"
NOTARIZE=false
if [ -n "${APPLE_KEYCHAIN_PROFILE:-}" ] || { [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ]; }; then NOTARIZE=true; fi
[ -n "$IDENTITY" ] && echo "identity: Developer ID ($IDENTITY) · notarize: $NOTARIZE" || echo "identity: none (ad-hoc) · notarize: skipped"
(cd "$HERE" && FLOOR_SIGN_HASH="$IDENTITY" CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64 \
  --config.buildVersion="$SHA" --config.extraMetadata.buildSha="$SHA" --config.mac.identity=null --config.mac.notarize=false)

echo "4/4 verify"
APP="$HERE/release/mac-arm64/PerkOS.app"
DMG="$HERE/release/PerkOS-$VERSION-arm64.dmg"
codesign --verify --deep --strict "$APP" && echo "app signature ok"
if [ -n "$IDENTITY" ]; then
  codesign --force --timestamp --sign "$IDENTITY" "$DMG" && echo "dmg signed"
  if [ "$NOTARIZE" = true ]; then
    echo "notarizing dmg (this can take a few minutes)"
    if [ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]; then
      xcrun notarytool submit "$DMG" --wait --keychain-profile "$APPLE_KEYCHAIN_PROFILE" ${APPLE_KEYCHAIN:+--keychain "$APPLE_KEYCHAIN"}
    else
      xcrun notarytool submit "$DMG" --wait --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID"
    fi
    xcrun stapler staple "$DMG" && echo "dmg notarized and stapled"
  fi
  spctl --assess --type exec -vv "$APP" 2>&1 | tail -2 || true
fi
du -sh "$APP" "$DMG"
echo "$DMG"

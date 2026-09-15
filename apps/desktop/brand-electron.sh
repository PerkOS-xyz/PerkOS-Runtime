#!/usr/bin/env bash
# Marca el Electron.app de desarrollo como PerkOS: nombre en Cmd+Tab / Dock /
# menu y el icono del bundle. En dev Electron muestra "Electron" porque el
# nombre sale del Info.plist del binario, no de app.setName(). El .app
# empaquetado no necesita esto (electron-builder pone productName + icns).
#
# Seguro: la firma del binario de npm es ad-hoc, asi que tras parchear se
# re-firma ad-hoc. Se corre en postinstall (npm ci lo reaplica). Solo macOS.
set -euo pipefail
[ "$(uname)" = "Darwin" ] || exit 0

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HERE/node_modules/electron/dist/Electron.app"
PLIST="$APP/Contents/Info.plist"
ICNS="$APP/Contents/Resources/electron.icns"
NAME="${PERKOS_APP_NAME:-PerkOS}"
SRC="$HERE/icon.png"
[ -f "$PLIST" ] || { echo "brand-electron: no Electron.app yet"; exit 0; }

# Nombre. El bundle id NO se toca: cambiarlo mueve los permisos de macOS
# (microfono) a otra identidad y vuelven a pedirse.
/usr/libexec/PlistBuddy -c "Set :CFBundleName $NAME" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $NAME" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string $NAME" "$PLIST"

# Icono: PNG -> iconset cuadrado (el logo es 894x964, se centra en lienzo) -> icns.
if [ -f "$SRC" ]; then
  TMP="$(mktemp -d)"
  SET="$TMP/perkos.iconset"
  mkdir -p "$SET"
  for s in 16 32 64 128 256 512 1024; do
    sips -s format png -z "$s" "$s" --padToHeightWidth "$s" "$s" "$SRC" --out "$SET/icon_${s}x${s}.png" >/dev/null 2>&1 || true
  done
  # Nombres que iconutil espera (1x y 2x).
  cp "$SET/icon_32x32.png"     "$SET/icon_16x16@2x.png"
  cp "$SET/icon_64x64.png"     "$SET/icon_32x32@2x.png"
  cp "$SET/icon_256x256.png"   "$SET/icon_128x128@2x.png"
  cp "$SET/icon_512x512.png"   "$SET/icon_256x256@2x.png"
  cp "$SET/icon_1024x1024.png" "$SET/icon_512x512@2x.png"
  rm -f "$SET/icon_64x64.png" "$SET/icon_1024x1024.png"
  iconutil -c icns "$SET" -o "$TMP/perkos.icns" && cp "$TMP/perkos.icns" "$ICNS"
  rm -rf "$TMP"
fi

# Re-firma ad-hoc (la original tambien es ad-hoc). Sin esto macOS rechaza el
# bundle modificado.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1
echo "brand-electron: $NAME · $(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$PLIST")"

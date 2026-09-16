#!/usr/bin/env bash
# Empaqueta PerkOS Floor como .app (macOS, Apple Silicon).
#   npm run package:mac --prefix apps/desktop
# Deja release/mac-arm64/PerkOS.app. Requisitos: apps/web/.env.local con
# las NEXT_PUBLIC_* (se incrustan en la build) y, para correr el .app,
# ~/.perkos-floor/env con las claves del servidor (BANKR_API_KEY, BASE_RPC_URL,
# KNOWLEDGE_*). Firma ad-hoc: sirve en la Mac donde se construye; para
# distribuir hace falta Developer ID + notarizacion.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WEB="$HERE/../web"

echo "1/5 next build (standalone)"
(cd "$WEB" && npm run build)

echo "2/5 icon"
bash "$HERE/make-icns.sh" "$HERE/icon.png" "$HERE/build/icon.icns"

echo "3/5 electron-builder"
(cd "$HERE" && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --arm64)

APP="$HERE/release/mac-arm64/PerkOS.app"
RES="$APP/Contents/Resources/web"

echo "4/5 web server into the bundle"
# A mano y no via extraResources: el matcher de electron-builder deja fuera
# node_modules, y el servidor standalone lo necesita entero.
rm -rf "$RES"; mkdir -p "$RES/.next"
rsync -a --exclude '.env*' --exclude '*.log' --exclude 'scripts/' --exclude 'tsconfig*' --exclude 'next-env.d.ts' \
  "$WEB/.next/standalone/" "$RES/"
rsync -a "$WEB/.next/static/" "$RES/.next/static/"
rsync -a "$WEB/public/" "$RES/public/"
# onnxruntime abre su dylib con dlopen; el trazado de Next no la ve.
ORT="node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64"
mkdir -p "$RES/$ORT" && cp "$WEB/$ORT"/* "$RES/$ORT/"
BROKEN="$(find "$RES" -type l ! -exec test -e {} \; -print)"
[ -z "$BROKEN" ] || { echo "broken symlinks:"; echo "$BROKEN"; exit 1; }

echo "5/5 ad-hoc sign"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "signed (ad-hoc)"
du -sh "$APP"
echo "$APP"

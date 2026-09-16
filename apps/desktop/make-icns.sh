#!/usr/bin/env bash
# PNG -> .icns para el bundle. El logo vertical (894x964, con nombre) se centra
# en un lienzo cuadrado transparente con un 6 % de margen, como pide macOS.
#   bash make-icns.sh icon.png build/icon.icns
set -euo pipefail
SRC="$1"; OUT="$2"
mkdir -p "$(dirname "$OUT")"
TMP="$(mktemp -d)"; SET="$TMP/icon.iconset"; mkdir -p "$SET"
python3 - "$SRC" "$SET" <<'PY'
import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA"); im = im.crop(im.getbbox())
side = 1024; margin = 0.06
box = int(side * (1 - 2 * margin))
scale = min(box / im.width, box / im.height)
im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
for s, name in [(16, "icon_16x16"), (32, "icon_16x16@2x"), (32, "icon_32x32"), (64, "icon_32x32@2x"), (128, "icon_128x128"), (256, "icon_128x128@2x"), (256, "icon_256x256"), (512, "icon_256x256@2x"), (512, "icon_512x512"), (1024, "icon_512x512@2x")]:
    canvas.resize((s, s), Image.LANCZOS).save(f"{out}/{name}.png")
PY
iconutil -c icns "$SET" -o "$OUT"
rm -rf "$TMP"
echo "icns: $OUT"

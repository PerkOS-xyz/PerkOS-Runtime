# DMG window background: dark PerkOS field, the logo on the left where the app
# lands, an arrow to the Applications link on the right.
#   python3 make-dmg-background.py icon.png build/dmg-background.png 0.2.0
#
# The image is painted LARGER than the window (CANVAS vs WIN below). Finder does
# not always honour the window size stored in the DMG, and a window even a few
# points taller than the image showed a white band under the icons. The extra
# field is plain background, so any window between WIN and CANVAS still looks
# right; the layout itself is laid out on the WIN grid, anchored top left.
import sys
from PIL import Image, ImageDraw, ImageFont

src, out, version = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ""

WIN_W, WIN_H = 800, 560        # window in apps/desktop/package.json › build.dmg.window
CANVAS_W, CANVAS_H = 1000, 700  # painted field, wider and taller on purpose


def render(scale):
    w, h = CANVAS_W * scale, CANVAS_H * scale
    im = Image.new("RGBA", (w, h), (8, 11, 20, 255))
    d = ImageDraw.Draw(im)
    for y in range(h):  # soft vertical gradient over the whole field
        t = y / h
        d.line([(0, y), (w, y)], fill=(int(8 + 8 * t), int(11 + 10 * t), int(20 + 18 * t), 255))
    logo = Image.open(src).convert("RGBA"); logo = logo.crop(logo.getbbox())
    lh = 45 * scale; logo = logo.resize((round(logo.width * lh / logo.height), lh), Image.LANCZOS)
    im.paste(logo, (37 * scale, 29 * scale), logo)
    try:
        f = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 16 * scale)
        f2 = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 15 * scale)
    except Exception:
        f = f2 = ImageFont.load_default()
    d.text((96 * scale, 40 * scale), f"PERKOS  {version}".strip(), fill=(150, 160, 190, 255), font=f)
    mid = WIN_W // 2
    d.text((mid * scale, 473 * scale), "DRAG PERKOS TO APPLICATIONS", fill=(120, 130, 160, 255), font=f2, anchor="mm")
    d.text((mid * scale, 504 * scale), "They draft. You approve.", fill=(236, 27, 105, 255), font=f2, anchor="mm")
    # arrow between the two icons (icons sit at x=227 and x=573, y=280)
    x0, x1, y = 333 * scale, 467 * scale, 280 * scale
    d.line([(x0, y), (x1, y)], fill=(236, 27, 105, 255), width=4 * scale)
    d.polygon([(x1, y), (x1 - 19 * scale, y - 12 * scale), (x1 - 19 * scale, y + 12 * scale)], fill=(236, 27, 105, 255))
    return im


render(1).save(out)
render(2).save(out.replace(".png", "@2x.png"))
print("dmg background:", out, f"{CANVAS_W}x{CANVAS_H} for a {WIN_W}x{WIN_H} window")

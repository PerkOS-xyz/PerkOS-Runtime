# DMG window background (600x420, plus @2x): dark PerkOS field, the logo on the
# left where the app lands, an arrow to the Applications link on the right.
#   python3 make-dmg-background.py icon.png build/dmg-background.png 0.2.0
import sys
from PIL import Image, ImageDraw, ImageFont

src, out, version = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ""

def render(scale):
    w, h = 600 * scale, 420 * scale
    im = Image.new("RGBA", (w, h), (8, 11, 20, 255))
    d = ImageDraw.Draw(im)
    for y in range(h):  # soft vertical gradient
        t = y / h
        d.line([(0, y), (w, y)], fill=(int(8 + 8 * t), int(11 + 10 * t), int(20 + 18 * t), 255))
    logo = Image.open(src).convert("RGBA"); logo = logo.crop(logo.getbbox())
    lh = 34 * scale; logo = logo.resize((round(logo.width * lh / logo.height), lh), Image.LANCZOS)
    im.paste(logo, (28 * scale, 22 * scale), logo)
    try:
        f = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 12 * scale)
        f2 = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 11 * scale)
    except Exception:
        f = f2 = ImageFont.load_default()
    d.text((72 * scale, 30 * scale), f"PERKOS  {version}".strip(), fill=(150, 160, 190, 255), font=f)
    d.text((300 * scale, 355 * scale), "DRAG PERKOS TO APPLICATIONS", fill=(120, 130, 160, 255), font=f2, anchor="mm")
    d.text((300 * scale, 378 * scale), "They draft. You approve.", fill=(236, 27, 105, 255), font=f2, anchor="mm")
    # arrow between the two icons (icons sit at x=170 and x=430, y=210)
    x0, x1, y = 250 * scale, 350 * scale, 210 * scale
    d.line([(x0, y), (x1, y)], fill=(236, 27, 105, 255), width=3 * scale)
    d.polygon([(x1, y), (x1 - 14 * scale, y - 9 * scale), (x1 - 14 * scale, y + 9 * scale)], fill=(236, 27, 105, 255))
    return im

render(1).save(out)
render(2).save(out.replace(".png", "@2x.png"))
print("dmg background:", out)

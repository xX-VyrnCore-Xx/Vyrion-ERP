#!/usr/bin/env python3
"""Regenerates the installer artwork (Windows wizard banners, macOS DMG background).

The outputs are committed, so builds do not need Pillow. Run this only when the artwork
changes:  python3 tools/installer-assets/generate.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[2] / "apps/desktop/src-tauri/installer"
BG = (11, 11, 15)
ACCENT_A = (139, 124, 246)
ACCENT_B = (91, 156, 245)
TEXT = (237, 237, 242)
MUTED = (154, 154, 168)
FONTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]
BOLD = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def font(paths: list[str], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in paths:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def gradient(size: tuple[int, int]) -> Image.Image:
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = (x / max(w - 1, 1) + y / max(h - 1, 1)) / 2
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(ACCENT_A, ACCENT_B))
    return img


LEFT = (176, 163, 252)
RIGHT = (91, 156, 245)


def mark(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], fill=None) -> None:
    """The two-tone 'V' of the app icon, scaled into `box` (`fill` draws it in one colour)."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    # Geometry of the 1024 px icon: the V spans x 286..738, y 300..742.
    def pt(px: float, py: float) -> tuple[float, float]:
        return (x0 + (px - 286) / 452 * w, y0 + (py - 300) / 442 * h)

    left = [pt(286, 300), pt(424, 300), pt(512, 566), pt(512, 742)]
    right = [pt(512, 566), pt(600, 300), pt(738, 300), pt(512, 742)]
    draw.polygon(left, fill=fill or LEFT)
    draw.polygon(right, fill=fill or RIGHT)


def sidebar() -> None:
    """Welcome and finish pages of the Windows wizard: 164 x 314."""
    img = gradient((164, 314))
    d = ImageDraw.Draw(img)
    # darken the lower part so the text stays readable
    shade = Image.new("RGB", img.size, BG)
    mask = Image.linear_gradient("L").resize(img.size)
    img = Image.composite(shade, img, mask.point(lambda v: int(v * 0.85)))
    d = ImageDraw.Draw(img)
    mark(d, (40, 46, 124, 130))
    d.text((82, 200), "Vyrion ERP", font=font(BOLD, 17), fill=TEXT, anchor="ma")
    d.text((82, 226), "ERP · CRM · IT", font=font(FONTS, 11), fill=MUTED, anchor="ma")
    d.text((82, 290), "VyrnCore Enterprises", font=font(FONTS, 9), fill=MUTED, anchor="ma")
    img.save(OUT / "sidebar.bmp", "BMP")


def header() -> None:
    """Top banner of the inner wizard pages: 150 x 57."""
    img = Image.new("RGB", (150, 57), BG)
    d = ImageDraw.Draw(img)
    mark(d, (14, 12, 46, 44))
    d.text((56, 28), "Vyrion ERP", font=font(BOLD, 14), fill=TEXT, anchor="lm")
    img.save(OUT / "header.bmp", "BMP")


def dmg() -> None:
    """Background of the macOS disk image window: 660 x 400 (matches tauri.conf.json)."""
    w, h = 660, 400
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)
    band = gradient((w, 6))
    img.paste(band, (0, 0))
    mark(d, (28, 24, 60, 56))
    d.text((72, 40), "Vyrion ERP", font=font(BOLD, 20), fill=TEXT, anchor="lm")
    # numbered steps
    f_b, f_s = font(BOLD, 13), font(FONTS, 11)
    steps = [
        ("1", "Trascina Vyrion ERP in Applicazioni"),
        ("2", "Se macOS dice \u00abdanneggiata\u00bb, apri il Terminale e incolla:"),
        ("3", "Per disinstallare: trascina l'app nel Cestino"),
    ]
    for i, (n, text) in enumerate(steps):
        y = 292 + i * 26 + (20 if i == 2 else 0)
        d.ellipse((60, y - 10, 80, y + 10), fill=ACCENT_A)
        d.text((70, y), n, font=f_b, fill=BG, anchor="mm")
        d.text((92, y), text, font=f_s if i else font(BOLD, 12), fill=TEXT if i == 0 else MUTED, anchor="lm")
    # the command, in a box under step 2 (the app is not notarized by Apple)
    cmd = 'xattr -dr com.apple.quarantine "/Applications/Vyrion ERP.app"'
    d.rounded_rectangle((92, 331, 590, 351), radius=5, fill=(26, 26, 33), outline=(60, 60, 75))
    d.text((100, 341), cmd, font=font(["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"] + FONTS, 10), fill=ACCENT_B, anchor="lm")
    d.text((w - 28, h - 16), "Funziona offline, senza server", font=f_s, fill=MUTED, anchor="rm")
    # arrow between the app icon (x=180) and the Applications folder (x=480)
    d.line((250, 190, 410, 190), fill=ACCENT_B, width=4)
    d.polygon([(412, 176), (440, 190), (412, 204)], fill=ACCENT_B)
    img.save(OUT / "dmg-background.png", "PNG", optimize=True)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    sidebar()
    header()
    dmg()
    print("written to", OUT)

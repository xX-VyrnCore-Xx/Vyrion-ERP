#!/usr/bin/env python3
"""Regenerates the installer artwork (Windows wizard banners, macOS DMG background).

The outputs are committed, so builds do not need Pillow. Run this only when the artwork
changes:  python3 tools/installer-assets/generate.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

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
    """Background of the macOS disk image window: 660 x 400 (matches tauri.conf.json).

    Finder draws the icon names itself (black or white, depending on the system look), so the
    two icons sit on mid-tone violet plates that keep both readable.
    """
    w, h = 660, 400
    scale = 2  # draw at 2x, then reduce: smooth edges
    img = Image.new("RGB", (w * scale, h * scale), BG)
    d = ImageDraw.Draw(img)
    S = lambda *v: tuple(int(x * scale) for x in v)  # noqa: E731

    # soft glow behind the title
    glow = Image.new("RGB", img.size, BG)
    gd = ImageDraw.Draw(glow)
    gd.ellipse(S(130, -140, 530, 120), fill=(38, 32, 78))
    glow = glow.filter(ImageFilter.GaussianBlur(60 * scale))
    img.paste(glow)
    d = ImageDraw.Draw(img)
    img.paste(gradient((w * scale, 6 * scale)), (0, 0))

    # title
    f_title = font(BOLD, 20 * scale)
    title = "Installa Vyrion ERP"
    tw = d.textlength(title, font=f_title) / scale
    left = (w - (28 + 12 + tw)) / 2
    mark(d, S(left, 26, left + 28, 54))
    d.text(S(left + 40, 40), title, font=f_title, fill=TEXT, anchor="lm")

    # plates behind the two icons (app at x=180, Applications at x=480; icon centre y=170)
    for cx in (180, 480):
        box = (cx - 95, 76, cx + 95, 256)
        top, bottom = (166, 154, 250), (128, 112, 241)
        grad = Image.new("RGB", (190 * scale, 180 * scale))
        gp = ImageDraw.Draw(grad)
        for row in range(180 * scale):
            t = row / (180 * scale - 1)
            gp.line((0, row, 190 * scale, row), fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
        mask = Image.new("L", grad.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, grad.width - 1, grad.height - 1), radius=22 * scale, fill=255)
        img.paste(grad, S(box[0], box[1]), mask)
        d = ImageDraw.Draw(img)
        d.rounded_rectangle(S(*box), radius=22 * scale, outline=(190, 181, 252), width=scale)

    # dashed arrow between the plates
    y = 160
    x = 292
    while x < 372:
        d.line(S(x, y, x + 12, y), fill=ACCENT_B, width=4 * scale)
        x += 20
    d.polygon([S(376, y - 14), S(404, y), S(376, y + 14)], fill=ACCENT_B)
    d.text(S(330, y - 26), "trascina", font=font(FONTS, 12 * scale), fill=MUTED, anchor="mm")

    # steps panel
    d.rounded_rectangle(S(28, 282, 632, 384), radius=14 * scale, fill=(20, 20, 27), outline=(44, 44, 56), width=scale)
    f_b, f_s = font(BOLD, 13 * scale), font(FONTS, 12 * scale)
    steps = [
        (298, "1", "Trascina Vyrion ERP nella cartella Applicazioni.", TEXT),
        (322, "2", "Se macOS dice \u00abdanneggiata\u00bb, apri il Terminale e incolla:", MUTED),
        (366, "3", "Per disinstallare: trascina l'app nel Cestino.", MUTED),
    ]
    for cy, n, text, colour in steps:
        d.ellipse(S(46, cy - 9, 64, cy + 9), fill=ACCENT_A)
        d.text(S(55, cy), n, font=f_b, fill=BG, anchor="mm")
        d.text(S(76, cy), text, font=f_s, fill=colour, anchor="lm")
    cmd = 'xattr -dr com.apple.quarantine "/Applications/Vyrion ERP.app"'
    d.rounded_rectangle(S(76, 335, 612, 355), radius=5 * scale, fill=(10, 10, 14), outline=(60, 60, 75), width=scale)
    mono = font(["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"] + FONTS, 11 * scale)
    d.text(S(86, 345), cmd, font=mono, fill=ACCENT_B, anchor="lm")

    img = img.resize((w, h), Image.LANCZOS)
    img.save(OUT / "dmg-background.png", "PNG", optimize=True)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    sidebar()
    header()
    dmg()
    print("written to", OUT)

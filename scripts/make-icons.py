#!/usr/bin/env python3
"""Génère les PNG de l'icône Umbra : croissant ambre lumineux sur fond nuit.

Note : ImageDraw n'applique pas la transparence (il écrase les pixels), donc
chaque halo est dessiné sur un calque séparé puis composé avec alpha_composite.
"""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "web" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

BG_CENTER = (43, 35, 28)
BG_EDGE = (12, 10, 9)
MOON_TOP = (255, 230, 176)
MOON_MID = (245, 178, 62)
MOON_BOT = (186, 116, 26)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def layer(size):
    return Image.new("RGBA", (size, size), (0, 0, 0, 0))


def make(size: int, maskable: bool = False) -> Image.Image:
    S = size * 4
    cx = cy = S // 2
    pad = int(S * 0.085) if maskable else 0
    radius = S // 2 - pad

    # 1. fond radial (cercles concentriques empilés)
    img = layer(S)
    d = ImageDraw.Draw(img)
    for r in range(radius, 0, -1):
        t = (r / radius) ** 1.4
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=lerp(BG_CENTER, BG_EDGE, t) + (255,))

    # 2. halo ambré diffus
    halo = layer(S)
    hr = int(radius * 0.62)
    ImageDraw.Draw(halo).ellipse([cx - hr, cy - hr, cx + hr, cy + hr], fill=MOON_MID + (90,))
    img = Image.alpha_composite(img, halo.filter(ImageFilter.GaussianBlur(S * 0.05)))

    # 3. disque interne + anneau fin
    inner = layer(S)
    di = ImageDraw.Draw(inner)
    ring = int(radius * 0.765)
    di.ellipse([cx - ring, cy - ring, cx + ring, cy + ring], fill=MOON_MID + (20,))
    di.ellipse([cx - ring, cy - ring, cx + ring, cy + ring], outline=MOON_MID + (80,), width=max(2, S // 170))
    img = Image.alpha_composite(img, inner)

    # 4. croissant : disque ambré dégradé, percé d'un disque décalé
    R = int(radius * 0.60)
    grad = Image.new("RGB", (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / S
        col = lerp(MOON_TOP, MOON_MID, t / 0.55) if t < 0.55 else lerp(MOON_MID, MOON_BOT, (t - 0.55) / 0.45)
        gd.line([(0, y), (S, y)], fill=col)
    disc_mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(disc_mask).ellipse(
        [cx - R, cy - R - int(R * 0.03), cx + R, cy + R - int(R * 0.03)], fill=255
    )
    moon = Image.merge("RGBA", (*grad.split(), disc_mask))

    cut = Image.new("L", (S, S), 255)
    off = int(R * 0.46)
    ImageDraw.Draw(cut).ellipse(
        [cx - R + off, cy - R - int(R * 0.10), cx + R + off, cy + R - int(R * 0.10)], fill=0
    )
    moon.putalpha(Image.composite(moon.split()[3], Image.new("L", (S, S), 0), cut))

    # 5. lueur du croissant puis croissant net
    glow = moon.filter(ImageFilter.GaussianBlur(S * 0.022))
    img = Image.alpha_composite(img, glow)
    img = Image.alpha_composite(img, moon)

    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    make(192).save(OUT / "icon-192.png")
    make(512).save(OUT / "icon-512.png")
    make(512, maskable=True).save(OUT / "maskable-512.png")
    make(180).save(OUT / "apple-touch-icon.png")
    make(32).save(OUT / "favicon-32.png")
    print("icônes générées :", sorted(p.name for p in OUT.glob("*.png")))

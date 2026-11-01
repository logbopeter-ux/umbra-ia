#!/usr/bin/env python3
"""
Génère les ressources Android d'Umbra à partir de l'icône de l'application :
  • icônes launcher (mipmap-*dpi) + version ronde + avant-plan adaptatif
  • écrans de démarrage (splash) portrait & paysage
  • couleurs de thème (fond nuit, accent ambre)
"""
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
MOBILE = HERE.parent
WEB_ICONS = MOBILE.parent / "web" / "icons"
RES = MOBILE / "android" / "app" / "src" / "main" / "res"

BG = (16, 13, 12)
ACCENT = (245, 178, 62)

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def load_icon(size: int) -> Image.Image:
    src = WEB_ICONS / "icon-512.png"
    img = Image.open(src).convert("RGBA")
    return img.resize((size, size), Image.LANCZOS)


def rounded(img: Image.Image, radius_ratio=0.22) -> Image.Image:
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def circle(img: Image.Image) -> Image.Image:
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def make_launcher():
    for dpi, scale in DENSITIES.items():
        folder = RES / f"mipmap-{dpi}"
        folder.mkdir(parents=True, exist_ok=True)
        size = int(48 * scale)
        icon = load_icon(size * 4)
        rounded(icon).resize((size, size), Image.LANCZOS).save(folder / "ic_launcher.png")
        circle(icon).resize((size, size), Image.LANCZOS).save(folder / "ic_launcher_round.png")
        # avant-plan adaptatif : 108dp de zone, l'icône occupe les 2/3 centraux
        fg_size = int(108 * scale)
        canvas = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
        inner = load_icon(int(fg_size * 0.66))
        canvas.paste(inner, ((fg_size - inner.size[0]) // 2, (fg_size - inner.size[1]) // 2), inner)
        canvas.save(folder / "ic_launcher_foreground.png")


def make_splash():
    sizes = {
        "drawable": (480, 800),
        "drawable-port-mdpi": (320, 480),
        "drawable-port-hdpi": (480, 800),
        "drawable-port-xhdpi": (720, 1280),
        "drawable-port-xxhdpi": (960, 1600),
        "drawable-port-xxxhdpi": (1280, 1920),
        "drawable-land-mdpi": (480, 320),
        "drawable-land-hdpi": (800, 480),
        "drawable-land-xhdpi": (1280, 720),
        "drawable-land-xxhdpi": (1600, 960),
        "drawable-land-xxxhdpi": (1920, 1280),
    }
    base_logo = load_icon(512)
    for folder_name, (w, h) in sizes.items():
        folder = RES / folder_name
        folder.mkdir(parents=True, exist_ok=True)
        canvas = Image.new("RGBA", (w, h), BG + (255,))
        logo_size = int(min(w, h) * 0.32)
        logo = base_logo.resize((logo_size, logo_size), Image.LANCZOS)
        canvas.paste(logo, ((w - logo_size) // 2, (h - logo_size) // 2 - int(h * 0.04)), logo)
        d = ImageDraw.Draw(canvas)
        # nom sous le logo
        ty = (h + logo_size) // 2 - int(h * 0.02)
        d.line([(w // 2 - 26, ty), (w // 2 + 26, ty)], fill=ACCENT + (110,), width=max(2, w // 320))
        canvas.convert("RGB").save(folder / "splash.png")


def make_colors():
    values = RES / "values"
    values.mkdir(parents=True, exist_ok=True)
    (values / "colors.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#F5B23E</color>
    <color name="colorPrimaryDark">#100D0C</color>
    <color name="colorAccent">#F5B23E</color>
    <color name="umbraBackground">#100D0C</color>
</resources>
""",
        encoding="utf-8",
    )
    # thème : fond nuit partout, pas de barre d'action
    (values / "styles.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<resources>

    <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
        <item name="android:windowBackground">@color/umbraBackground</item>
        <item name="android:statusBarColor">@color/umbraBackground</item>
        <item name="android:navigationBarColor">@color/umbraBackground</item>
    </style>

    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="android:windowBackground">@color/umbraBackground</item>
        <item name="android:statusBarColor">@color/umbraBackground</item>
    </style>

    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
        <item name="android:statusBarColor">@color/umbraBackground</item>
    </style>
</resources>
""",
        encoding="utf-8",
    )
    # fond de l'icône adaptative
    (RES / "drawable" / "ic_launcher_background.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#100D0C" />
</shape>
""",
        encoding="utf-8",
    )


if __name__ == "__main__":
    make_launcher()
    make_splash()
    make_colors()
    print("Ressources Android générées (icônes, splash, couleurs).")

#!/usr/bin/env python3
"""
App-Symbol für Android aus dem Logo bauen – mit Rand zum Maskieren.

    python3 tools/android-symbole.py

Android schneidet das Symbol je nach Gerät rund, eckig oder als Tropfen zu
(adaptive icon, 108 dp). Sicher sichtbar ist nur der Kreis in der Mitte
(66 dp). `cargo tauri icon` legt das Logo aber randlos auf die ganze Fläche –
dann fehlen die Ecken. Hier wird das Logo (appdata/wmap-1024.png, freigestellt)
so verkleinert, dass sein äußerster Punkt im sicheren Kreis liegt, auf den
Hintergrund des maskierbaren Web-Symbols (appdata/wmap-maskable-512.png).

Ergebnis: appdata/icons/android/ – tools/android-einbinden.py kopiert es
in die App.
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / 'appdata/wmap-1024.png'
MASKABLE = ROOT / 'appdata/wmap-maskable-512.png'
OUT = ROOT / 'appdata/icons/android'

# Dichte → Kantenlänge: Vordergrund 108 dp, altes Symbol 48 dp
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
# Radius des sicheren Kreises (66 dp von 108) – etwas Luft dazu
SAFE = 33 / 108 * 0.96


def logo_radius(img):
    """Weitester sichtbarer Punkt vom Mittelpunkt, als Anteil der Kantenlänge"""
    alpha = img.getchannel('A')
    w, h = img.size
    px = alpha.load()
    far = 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if px[x, y] > 40:
                far = max(far, math.hypot(x - w / 2, y - h / 2))
    return far / w


def foreground(logo, size, scale):
    fg = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    s = round(size * scale)
    fg.alpha_composite(logo.resize((s, s), Image.LANCZOS), ((size - s) // 2, (size - s) // 2))
    return fg


def main():
    logo = Image.open(LOGO).convert('RGBA')
    bg = Image.open(MASKABLE).convert('RGB').getpixel((4, 4))
    scale = SAFE / logo_radius(logo)
    for name, f in DENSITIES.items():
        d = OUT / f'mipmap-{name}'
        d.mkdir(parents=True, exist_ok=True)
        foreground(logo, round(108 * f), scale).save(d / 'ic_launcher_foreground.png')
        # Altes Symbol (vor Android 8) und rundes: Hintergrund + Logo, 48 dp
        n = round(48 * f)
        full = Image.new('RGBA', (n, n), bg + (255,))
        # Auf 48 dp entspricht der sichtbare Teil 72 dp des Vordergrunds
        full.alpha_composite(foreground(logo, n, scale * 108 / 72))
        mask = Image.new('L', (n * 4, n * 4), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, n * 4 - 1, n * 4 - 1), radius=n * 4 // 5, fill=255)
        square = Image.new('RGBA', (n, n), (0, 0, 0, 0))
        square.paste(full, mask=mask.resize((n, n), Image.LANCZOS))
        square.save(d / 'ic_launcher.png')
        mask = Image.new('L', (n * 4, n * 4), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, n * 4 - 1, n * 4 - 1), fill=255)
        round_ = Image.new('RGBA', (n, n), (0, 0, 0, 0))
        round_.paste(full, mask=mask.resize((n, n), Image.LANCZOS))
        round_.save(d / 'ic_launcher_round.png')
    (OUT / 'values').mkdir(exist_ok=True)
    (OUT / 'values/ic_launcher_background.xml').write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'  <color name="ic_launcher_background">#{bg[0]:02x}{bg[1]:02x}{bg[2]:02x}</color>\n</resources>\n',
        encoding='utf-8')
    print(f'Android-Symbole in {OUT.relative_to(ROOT)} – Logo auf {scale:.0%} der Fläche, Hintergrund #{bg[0]:02x}{bg[1]:02x}{bg[2]:02x}')


if __name__ == '__main__':
    main()

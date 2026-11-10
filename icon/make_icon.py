#!/usr/bin/env python3
"""Draws the app icon (original artwork, Arc-inspired pastel palette, crescent moon mark) and writes
AppIcon.png (1024px) and AppIcon.icns.  Needs Pillow:  pip3 install pillow"""
import math, os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SS = 2                      # supersampling factor for smooth edges
N = 1024 * SS
MARGIN = 100 * SS           # Apple's icon grid: 824px tile inside 1024px canvas
TILE = N - 2 * MARGIN
RADIUS = 185 * SS

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

# Soft pastel "mesh" gradient: blend four corner colours.
TL, TR = (255, 184, 172), (196, 170, 255)   # peach, lavender
BL, BR = (255, 140, 190), (120, 170, 255)   # pink, sky blue
def gradient(size):
    small = Image.new("RGB", (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            u, v = x / 63, y / 63
            top, bot = lerp(TL, TR, u), lerp(BL, BR, u)
            px[x, y] = lerp(top, bot, v)
    return small.resize((size, size), Image.BICUBIC)

canvas = Image.new("RGBA", (N, N), (0, 0, 0, 0))

# drop shadow under the tile
shadow = Image.new("RGBA", (N, N), (0, 0, 0, 0))
ImageDraw.Draw(shadow).rounded_rectangle(
    [MARGIN, MARGIN + 12 * SS, N - MARGIN, N - MARGIN + 12 * SS], RADIUS, fill=(0, 0, 0, 90))
canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(18 * SS)))

# gradient tile
mask = Image.new("L", (N, N), 0)
ImageDraw.Draw(mask).rounded_rectangle([MARGIN, MARGIN, N - MARGIN, N - MARGIN], RADIUS, fill=255)
tile = Image.new("RGBA", (N, N), (0, 0, 0, 0))
tile.paste(gradient(TILE), (MARGIN, MARGIN))
tile.putalpha(mask)
canvas.alpha_composite(tile)

# soft top light (smooth vertical fade, clipped to the tile)
fade = Image.new("L", (1, 256))
for y in range(256):
    fade.putpixel((0, y), int(60 * max(0.0, 1 - y / 140)))
fade = fade.resize((N, N))
light = Image.new("RGBA", (N, N), (255, 255, 255, 0))
lm = Image.new("L", (N, N), 0); lm.paste(fade, mask=mask)
light.putalpha(lm)
canvas.alpha_composite(light)

# The mark: a white crescent moon with a small star.
mark = Image.new("RGBA", (N, N), (0, 0, 0, 0))
d = ImageDraw.Draw(mark)
cx, cy, r = N // 2 - 20 * SS, N // 2 + 10 * SS, 270 * SS
d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))
# cut the bite out of the moon
bite = Image.new("L", (N, N), 0)
bx, by, br = cx + 150 * SS, cy - 110 * SS, 235 * SS
ImageDraw.Draw(bite).ellipse([bx - br, by - br, bx + br, by + br], fill=255)
alpha = mark.getchannel("A"); alpha.paste(0, mask=bite); mark.putalpha(alpha)
# four-point star
sx, sy, a, b = cx + 215 * SS, cy - 205 * SS, 62 * SS, 16 * SS
d.polygon([(sx, sy - a), (sx + b, sy - b), (sx + a, sy), (sx + b, sy + b),
           (sx, sy + a), (sx - b, sy + b), (sx - a, sy), (sx - b, sy - b)], fill=(255, 255, 255, 235))
# soft shadow for the mark
ms = Image.new("RGBA", (N, N), (0, 0, 0, 0))
ms.putalpha(mark.getchannel("A").point(lambda a: a * 0.28))
ms = ms.filter(ImageFilter.GaussianBlur(14 * SS))
canvas.alpha_composite(ms, (0, 8 * SS))
canvas.alpha_composite(mark)

icon = canvas.resize((1024, 1024), Image.LANCZOS)
icon.save(os.path.join(HERE, "AppIcon.png"))
icon.save(os.path.join(HERE, "AppIcon.icns"),
          sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)])
print("wrote AppIcon.png and AppIcon.icns")

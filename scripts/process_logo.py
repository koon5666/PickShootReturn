#!/usr/bin/env python3
"""Transform the PickShootReturn logo for the dark theme:
   - white background  -> transparent
   - dark (black/navy) -> white
   - blue              -> amber/yellow (#e8b84b, the app accent)
Input : public/logo-src.png   Output: public/logo.png
"""
import sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "public/logo-src.png"
OUT = sys.argv[2] if len(sys.argv) > 2 else "public/logo.png"

YELLOW = (232, 184, 75)   # #e8b84b
WHITE = (255, 255, 255)

img = Image.open(SRC).convert("RGBA")
px = img.load()
w, h = img.size

for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        ink = 255 - min(r, g, b)          # how far from white = opacity of the ink
        if ink < 18 or a < 10:            # background / near-white -> transparent
            px[x, y] = (0, 0, 0, 0)
            continue
        is_blue = b > 120 and (b - r) > 40 and (b - g) > 25
        color = YELLOW if is_blue else WHITE
        alpha = min(255, int(ink * 1.25))  # solid shapes stay solid, edges fade
        px[x, y] = (color[0], color[1], color[2], alpha)

img.save(OUT)
print(f"wrote {OUT} ({w}x{h})")

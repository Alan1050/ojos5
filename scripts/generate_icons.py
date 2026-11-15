"""Render the code-native Ojos eye mark. Requires Pillow only to regenerate assets."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "images"
BLUE = "#0b1b3b"
CYAN = "#22e3ff"


def render(size, background, color, scale=1):
    side = size * 3
    image = Image.new("RGBA", (side, side), background)
    draw = ImageDraw.Draw(image)

    def curve(points):
        result = []
        for step in range(201):
            t = step / 200
            weights = ((1-t)**3, 3*(1-t)**2*t, 3*(1-t)*t*t, t**3)
            result.append(tuple(sum(weights[i] * points[i][axis] for i in range(4)) for axis in (0, 1)))
        return result

    def pt(x, y):
        return ((0.5 + (x - 0.5) * scale) * side, (0.5 + (y - 0.5) * scale) * side)

    outline = curve([pt(.17, .5), pt(.34, .2), pt(.66, .2), pt(.83, .5)])
    outline += curve([pt(.83, .5), pt(.66, .8), pt(.34, .8), pt(.17, .5)])
    draw.line(outline, fill=color, width=round(side * .031 * scale), joint="curve")
    draw.ellipse([pt(.4, .4), pt(.6, .6)], outline=color, width=round(side * .03 * scale))
    return image.resize((size, size), Image.Resampling.LANCZOS)


render(1024, BLUE, CYAN).convert("RGB").save(ASSETS / "icon.png")
render(48, BLUE, CYAN).convert("RGB").save(ASSETS / "favicon.png")
render(512, "#00000000", CYAN).save(ASSETS / "splash-icon.png")
render(512, "#00000000", CYAN, .75).save(ASSETS / "android-icon-foreground.png")
render(432, "#00000000", "#ffffff", .75).save(ASSETS / "android-icon-monochrome.png")
Image.new("RGB", (512, 512), BLUE).save(ASSETS / "android-icon-background.png")

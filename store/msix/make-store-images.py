"""Draws the MSIX visual assets (Start menu, taskbar, tile and Store logos)
from the app icon drawing in scripts/make-icon.py. No new artwork: every image
is the same icon, scaled. Run it again after the icon changes and commit the
PNGs in store/msix/Images:

    python -I store/msix/make-store-images.py

The icon script draws at 1024 px and returns the 256 px icon. This script
keeps the 1024 px drawing and downsamples it once to each size, so the large
logos (up to 600 px) are not enlarged from the 256 px icon.
"""

import argparse
import importlib.util
import re
import sys
from pathlib import Path

# Loading make-icon.py must not leave a __pycache__ folder in scripts/.
sys.dont_write_bytecode = True

from PIL import Image

STORE_MSIX = Path(__file__).resolve().parent
REPO_ROOT = STORE_MSIX.parent.parent

# Wide tiles fill their whole canvas with this colour and centre the icon on
# it. None would leave a transparent canvas, as on the square tiles.
WIDE_FILL = "tile"  # the icon's own tile colour, from make-icon.py
# Tiles keep the icon at about two thirds of the tile height, as Windows' own
# tiles do.
TILE_ICON_FRACTION = 0.66


def icon_script_path():
    """Reads IconScript from app.psd1 so the image source is named in one place."""
    text = (STORE_MSIX / "app.psd1").read_text(encoding="utf-8-sig")
    match = re.search(r"^\s*IconScript\s*=\s*'([^']+)'", text, re.MULTILINE)
    if not match:
        raise SystemExit("app.psd1 has no IconScript entry.")
    return REPO_ROOT / Path(match.group(1).replace("\\", "/"))


def load_icon_module(path):
    spec = importlib.util.spec_from_file_location("leanslides_make_icon", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def master_drawing(module):
    """Returns (large, small): the drawing before and after draw()'s resize.

    draw() ends by resizing its large drawing to 256 px. The resize is watched
    for that one call to keep the large drawing; nothing is redrawn here, so
    the logos always follow make-icon.py.
    """
    captured = []
    depth = [0]
    original = Image.Image.resize

    def watch(self, size, *args, **kwargs):
        # Pillow resizes RGBA by converting to premultiplied alpha and calling
        # resize again; only the outermost call is draw()'s own.
        if depth[0] == 0:
            captured.append(self.copy())
        depth[0] += 1
        try:
            return original(self, size, *args, **kwargs)
        finally:
            depth[0] -= 1

    Image.Image.resize = watch
    try:
        small = module.draw()
    finally:
        Image.Image.resize = original
    if len(captured) != 1:
        raise SystemExit("draw() in make-icon.py no longer ends with a single resize.")
    large = captured[0]
    if large.size != (module.SIZE, module.SIZE) or small.size != (256, 256):
        raise SystemExit(
            "Unexpected icon sizes: large {0}, small {1}.".format(large.size, small.size))
    if large.mode != "RGBA" or small.mode != "RGBA":
        raise SystemExit("The icon drawing is not RGBA.")
    if original(large, (256, 256), Image.LANCZOS).tobytes() != small.tobytes():
        raise SystemExit("The kept drawing does not reduce to draw()'s 256 px icon.")
    return large, small


def round_half_even(value):
    # The sizes the other Lean apps' logos use: .NET Math.Round, which rounds halves to
    # even, the same as Python's round().
    return int(round(value))


def image_list():
    """(file name, canvas width, canvas height, icon size, fill)."""
    images = []
    for scale in (100, 125, 150, 200, 400):
        f = scale / 100.0
        s44 = round_half_even(44 * f)
        images.append(("Square44x44Logo.scale-{0}.png".format(scale), s44, s44, s44, None))
        s150 = round_half_even(150 * f)
        images.append(("Square150x150Logo.scale-{0}.png".format(scale), s150, s150,
                       round_half_even(s150 * TILE_ICON_FRACTION), None))
        w = round_half_even(310 * f)
        h = round_half_even(150 * f)
        images.append(("Wide310x150Logo.scale-{0}.png".format(scale), w, h,
                       round_half_even(h * TILE_ICON_FRACTION), WIDE_FILL))
        s50 = round_half_even(50 * f)
        images.append(("StoreLogo.scale-{0}.png".format(scale), s50, s50, s50, None))
    for target in (16, 24, 32, 48, 256):
        # Plated and unplated are the same full-bleed icon, as in the other Lean apps: the
        # icon carries its own dark tile, so it needs no plate behind it.
        images.append(("Square44x44Logo.targetsize-{0}.png".format(target),
                       target, target, target, None))
        images.append(("Square44x44Logo.altform-unplated_targetsize-{0}.png".format(target),
                       target, target, target, None))
    return images


def render(large, tile_colour, width, height, icon, fill):
    if fill == "tile":
        background = tuple(tile_colour[:3]) + (255,)
    elif fill is None:
        background = (0, 0, 0, 0)
    else:
        raise ValueError(fill)
    canvas = Image.new("RGBA", (width, height), background)
    scaled = large.resize((icon, icon), Image.LANCZOS)
    # A half pixel goes to the left and top margins, where the other Lean apps' logos
    # put it too.
    left = (width - icon + 1) // 2
    top = (height - icon + 1) // 2
    canvas.alpha_composite(scaled, (left, top))
    return canvas


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output", type=Path, default=STORE_MSIX / "Images")
    args = parser.parse_args()

    module = load_icon_module(icon_script_path())
    large, _ = master_drawing(module)
    tile_colour = module.TILE
    args.output.mkdir(parents=True, exist_ok=True)
    for name, width, height, icon, fill in image_list():
        image = render(large, tile_colour, width, height, icon, fill)
        if image.size != (width, height):
            raise SystemExit("{0} is {1}, expected {2}x{3}".format(name, image.size, width, height))
        image.save(args.output / name, optimize=True)
        print("{0} {1}x{2}".format(name, width, height))
    return 0


if __name__ == "__main__":
    sys.exit(main())

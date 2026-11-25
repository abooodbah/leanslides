"""Draws LeanSlides.ico: the family's dark tile with a light landscape slide,
a blue title bar and two text lines, on a small stand. Run with
`python -I scripts/make-icon.py` from the repository root; it writes
src/windows/LeanSlides.ico and assets/icon.png."""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SCALE = 4  # draw at 4x and downsample for smooth edges
SIZE = 256 * SCALE

TILE = (26, 25, 23, 255)
CARD = (249, 248, 245, 255)
EDGE = (222, 218, 210, 255)
BLUE = (37, 84, 214, 255)
INK = (28, 27, 25, 255)


def s(value):
    return int(round(value * SCALE))


def draw():
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    pen = ImageDraw.Draw(image)
    pen.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=s(56), fill=TILE)
    # The stand: a short post under the slide and a foot.
    pen.rounded_rectangle([s(121), s(176), s(135), s(206)], radius=s(4), fill=EDGE)
    pen.rounded_rectangle([s(92), s(200), s(164), s(212)], radius=s(6), fill=EDGE)
    # The slide, 16:9-ish.
    pen.rounded_rectangle([s(36), s(58), s(220), s(180)], radius=s(10), fill=CARD)
    pen.rounded_rectangle([s(60), s(84), s(146), s(98)], radius=s(7), fill=BLUE)
    pen.rounded_rectangle([s(60), s(116), s(196), s(127)], radius=s(5.5), fill=INK)
    pen.rounded_rectangle([s(60), s(142), s(164), s(153)], radius=s(5.5), fill=INK)
    return image.resize((256, 256), Image.LANCZOS)


def main():
    icon = draw()
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    icon.save(ROOT / "src" / "windows" / "LeanSlides.ico", sizes=sizes)
    assets = ROOT / "assets"
    assets.mkdir(exist_ok=True)
    icon.resize((64, 64), Image.LANCZOS).save(assets / "icon.png")


if __name__ == "__main__":
    main()

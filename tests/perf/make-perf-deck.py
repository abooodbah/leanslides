"""Writes large.pptx for the start-up and memory measurements: SLIDES slides,
each with a title, four bullets, speaker notes and its own 1280 x 720 picture.
The pictures differ per slide (so nothing is shared between slides) and carry
one bit of noise in green so they do not compress to almost nothing.

Run with `python -I tests/perf/make-perf-deck.py OUTPUT_FOLDER`. The output is
byte-for-byte the same on every run (fixed timestamps, fixed order, a fixed
pseudo-random sequence)."""

import hashlib
import importlib.util
import struct
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
SLIDES = 240
WIDTH = 1280
HEIGHT = 720

spec = importlib.util.spec_from_file_location(
    "host_fixtures", HERE.parent / "hosts" / "fixtures" / "make-host-fixtures.py")
fx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fx)


def picture_png(seed):
    """A 1280 x 720 RGB picture: a top-to-bottom gradient whose colours depend
    on the slide, plus 0 or 1 of noise in the green channel from SHAKE-256.
    Each byte of the gradient is at most 244, so adding the rows as big
    integers never carries from one byte into the next."""
    base = ((seed * 53) % 190, (seed * 97) % 190, (seed * 31) % 190)
    mask = int.from_bytes(b"\x00\x01\x00" * WIDTH, "big")
    rows = []
    for y in range(HEIGHT):
        shade = y * 54 // HEIGHT
        gradient = int.from_bytes(bytes(channel + shade for channel in base) * WIDTH, "big")
        noise = int.from_bytes(hashlib.shake_256(f"{seed}:{y}".encode()).digest(WIDTH * 3), "big") & mask
        rows.append(b"\x00" + (gradient + noise).to_bytes(WIDTH * 3, "big"))

    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    header = struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(b"".join(rows), 6)) + chunk(b"IEND", b""))


def content_slide(number):
    picture = ('<p:pic><p:nvPicPr><p:cNvPr id="10" name="Picture 10"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
               '<p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>' +
               fx.xfrm(6400800, 1825625, 5181600, 2914650) +
               '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>')
    bullets = "".join(fx.para(f"Point {point} of slide {number}") for point in range(1, 5))
    return fx.slide(
        fx.sp(2, '<p:ph type="title"/>', "", fx.para(f"Slide {number} of {SLIDES}")) +
        fx.sp(3, '<p:ph idx="1"/>', fx.xfrm(838200, 1825625, 5334000, 4351338), bullets) +
        picture)


def make(folder):
    overrides = (
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.'
        'presentationml.presentation.main+xml"/>'
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.'
        'theme+xml"/>'
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-'
        'officedocument.presentationml.slideMaster+xml"/>'
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-'
        'officedocument.presentationml.slideLayout+xml"/>')
    for index in range(1, SLIDES + 1):
        overrides += (f'<Override PartName="/ppt/slides/slide{index}.xml" ContentType="application/'
                      'vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
                      f'<Override PartName="/ppt/notesSlides/notesSlide{index}.xml" ContentType="application/'
                      'vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>')
    entries = [
        ("[Content_Types].xml",
         fx.HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
         '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
         '<Default Extension="xml" ContentType="application/xml"/>'
         '<Default Extension="png" ContentType="image/png"/>' + overrides + "</Types>", True),
        ("_rels/.rels", fx.rels([("rId1", "officeDocument", "ppt/presentation.xml")]), True),
        ("ppt/presentation.xml",
         fx.part("presentation",
                 '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' +
                 "".join(f'<p:sldId id="{256 + i}" r:id="rId{i + 2}"/>' for i in range(SLIDES)) +
                 '</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>'
                 '<p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/>'
                 '</a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle>'),
         True),
        ("ppt/_rels/presentation.xml.rels",
         fx.rels([("rId1", "slideMaster", "slideMasters/slideMaster1.xml")] +
                 [(f"rId{i + 2}", "slide", f"slides/slide{i + 1}.xml") for i in range(SLIDES)] +
                 [(f"rId{SLIDES + 2}", "theme", "theme/theme1.xml")]), True),
        ("ppt/theme/theme1.xml", fx.theme(), True),
        ("ppt/slideMasters/slideMaster1.xml", fx.master(), True),
        ("ppt/slideMasters/_rels/slideMaster1.xml.rels",
         fx.rels([("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"),
                  ("rId2", "theme", "../theme/theme1.xml")]), True),
        ("ppt/slideLayouts/slideLayout1.xml", fx.layout(), True),
        ("ppt/slideLayouts/_rels/slideLayout1.xml.rels",
         fx.rels([("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")]), True),
    ]
    for number in range(1, SLIDES + 1):
        entries.append((f"ppt/slides/slide{number}.xml", content_slide(number), True))
        entries.append((f"ppt/slides/_rels/slide{number}.xml.rels", fx.rels([
            ("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"),
            ("rId2", "notesSlide", f"../notesSlides/notesSlide{number}.xml"),
            ("rId3", "image", f"../media/image{number}.png")]), True))
        entries.append((f"ppt/notesSlides/notesSlide{number}.xml",
                        fx.notes(f"Speaker notes for slide {number}."), True))
        entries.append((f"ppt/media/image{number}.png", picture_png(number), False))
    folder.mkdir(parents=True, exist_ok=True)
    fx.write_zip(folder / "large.pptx", entries)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: make-perf-deck.py OUTPUT_FOLDER")
    make(Path(sys.argv[1]).resolve())

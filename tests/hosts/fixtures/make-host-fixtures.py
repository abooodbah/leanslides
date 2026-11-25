"""Writes the host smoke fixtures beside this script:

  smoke.pptx    three slides: a title slide, a bulleted slide with speaker
                notes, a picture and a link, and a slide with a table
  fallback.odp  an OpenDocument presentation, which LeanSlides recognises but
                does not show, so the smoke test must fail on it

Run with `python -I tests/hosts/fixtures/make-host-fixtures.py`. The output is
byte-for-byte the same on every run (fixed timestamps, fixed order)."""

import struct
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
STAMP = (2026, 1, 1, 0, 0, 0)

NS = (' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
      ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"')
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'


def write_zip(path, entries):
    import zipfile
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data, compress in entries:
            info = zipfile.ZipInfo(name, STAMP)
            info.compress_type = zipfile.ZIP_DEFLATED if compress else zipfile.ZIP_STORED
            archive.writestr(info, data.encode("utf-8") if isinstance(data, str) else data)


def rels(items):
    body = ""
    for item in items:
        external = ' TargetMode="External"' if len(item) > 3 else ""
        body += f'<Relationship Id="{item[0]}" Type="{REL}{item[1]}" Target="{item[2]}"{external}/>'
    return (HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + body + "</Relationships>")


def part(root, body, attributes=""):
    return f"{HEAD}<p:{root}{NS}{attributes}>{body}</p:{root}>"


def xfrm(x, y, w, h):
    return f'<a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm>'


def sp(shape_id, ph, sp_pr, text, nv_extra=""):
    tx = f"<p:txBody><a:bodyPr/><a:lstStyle/>{text}</p:txBody>" if text else ""
    return (f'<p:sp><p:nvSpPr><p:cNvPr id="{shape_id}" name="Shape {shape_id}"/><p:cNvSpPr{nv_extra}/>'
            f"<p:nvPr>{ph}</p:nvPr></p:nvSpPr><p:spPr>{sp_pr}</p:spPr>{tx}</p:sp>")


def tree(shapes):
    return ('<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
            "<p:grpSpPr/>" + shapes + "</p:spTree>")


def para(text, level=0):
    ppr = f'<a:pPr lvl="{level}"/>' if level else ""
    return f'<a:p>{ppr}<a:r><a:rPr lang="en-US"/><a:t>{text}</a:t></a:r></a:p>'


def png(width, height, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))

    def chunk(kind, data):
        return (struct.pack(">I", len(data)) + kind + data
                + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def theme():
    names = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4",
             "accent5", "accent6", "hlink", "folHlink"]
    values = ["000000", "FFFFFF", "44546A", "E7E6E6", "4472C4", "ED7D31", "A5A5A5", "FFC000",
              "5B9BD5", "70AD47", "0563C1", "954F72"]
    colors = "".join(f'<a:{n}><a:srgbClr val="{v}"/></a:{n}>' for n, v in zip(names, values))
    return (HEAD + f'<a:theme{NS} name="Smoke"><a:themeElements><a:clrScheme name="Smoke">{colors}'
            '</a:clrScheme><a:fontScheme name="Smoke"><a:majorFont><a:latin typeface="Segoe UI"/>'
            '<a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/>'
            '<a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Smoke">'
            '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
            '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/>'
            '</a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/>'
            '</a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
            '<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
            '<a:effectStyleLst/><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
            '</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>')


def master():
    shapes = (sp(2, '<p:ph type="title"/>', xfrm(838200, 365125, 10515600, 1325563), para("Title")) +
              sp(3, '<p:ph type="body" idx="1"/>', xfrm(838200, 1825625, 10515600, 4351338), para("Body")))
    styles = ('<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/>'
              '</a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle>'
              '<a:lvl1pPr marL="228600" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>'
              '<a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/>'
              '</a:defRPr></a:lvl1pPr><a:lvl2pPr marL="685800" indent="-228600"><a:buChar char="&#8226;"/>'
              '<a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/>'
              '</a:lvl1pPr></p:otherStyle></p:txStyles>')
    return part("sldMaster",
                '<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' + tree(shapes) +
                '</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" '
                'accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" '
                'folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/>'
                '</p:sldLayoutIdLst>' + styles)


def layout():
    shapes = (sp(2, '<p:ph type="title"/>', "", "<a:p><a:endParaRPr/></a:p>") +
              sp(3, '<p:ph idx="1"/>', "", "<a:p><a:endParaRPr/></a:p>"))
    return part("sldLayout", '<p:cSld name="Title and Content">' + tree(shapes) + "</p:cSld>", ' type="obj"')


def slide(shapes):
    return part("sld", "<p:cSld>" + tree(shapes) + "</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>")


def smoke_slides():
    first = slide(
        sp(2, '<p:ph type="title"/>', "", para("LeanSlides smoke test")) +
        sp(3, '<p:ph idx="1"/>', "", para("A small deck the Windows host opens in CI")))
    picture = ('<p:pic><p:nvPicPr><p:cNvPr id="10" name="Picture 10"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>'
               '<p:blipFill><a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>' +
               xfrm(8382000, 1825625, 2971800, 2971800) +
               '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>')
    link = ('<a:p><a:r><a:rPr lang="en-US"/><a:t>Read more at </a:t></a:r><a:r><a:rPr lang="en-US">'
            '<a:hlinkClick r:id="rId4"/></a:rPr><a:t>example.com</a:t></a:r></a:p>')
    second = slide(
        sp(2, '<p:ph type="title"/>', "", para("Bullets, a picture and a link")) +
        sp(3, '<p:ph idx="1"/>', xfrm(838200, 1825625, 7239000, 4351338),
           para("First point") + para("A second-level point", 1) + para("Second point") + link) +
        picture)
    table = ('<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="20" name="Table 20"/><p:cNvGraphicFramePr/>'
             '<p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="838200" y="1825625"/>'
             '<a:ext cx="10515600" cy="1483360"/></p:xfrm><a:graphic>'
             '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>'
             '<a:tblPr firstRow="1"/><a:tblGrid><a:gridCol w="5257800"/><a:gridCol w="5257800"/></a:tblGrid>')
    for row in (("Measure", "Value"), ("Slides", "3"), ("Pictures", "1"), ("Tables", "1")):
        table += '<a:tr h="370840">'
        for cell in row:
            table += (f'<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1800"/>'
                      f'<a:t>{cell}</a:t></a:r></a:p></a:txBody><a:tcPr><a:lnB w="12700"><a:solidFill>'
                      f'<a:schemeClr val="tx1"/></a:solidFill></a:lnB></a:tcPr></a:tc>')
        table += "</a:tr>"
    table += "</a:tbl></a:graphicData></a:graphic></p:graphicFrame>"
    third = slide(sp(2, '<p:ph type="title"/>', "", para("A table")) + table)
    return [first, second, third]


def notes(text):
    shapes = (sp(2, '<p:ph type="sldImg"/>', "", "") +
              sp(3, '<p:ph type="body" idx="1"/>', "", para(text)))
    return part("notes", "<p:cSld>" + tree(shapes) + "</p:cSld>")


def make_smoke():
    slides = smoke_slides()
    overrides = (
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.'
        'presentationml.presentation.main+xml"/>'
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.'
        'theme+xml"/>'
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-'
        'officedocument.presentationml.slideMaster+xml"/>'
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-'
        'officedocument.presentationml.slideLayout+xml"/>'
        '<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-'
        'officedocument.presentationml.notesSlide+xml"/>'
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.'
        'core-properties+xml"/>')
    for index in range(len(slides)):
        overrides += (f'<Override PartName="/ppt/slides/slide{index + 1}.xml" ContentType="application/'
                      'vnd.openxmlformats-officedocument.presentationml.slide+xml"/>')
    entries = [
        ("[Content_Types].xml",
         HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
         '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
         '<Default Extension="xml" ContentType="application/xml"/>'
         '<Default Extension="png" ContentType="image/png"/>' + overrides + "</Types>", True),
        ("_rels/.rels", rels([("rId1", "officeDocument", "ppt/presentation.xml"),
                              ("rId2", "metadata/core-properties", "docProps/core.xml")]), True),
        ("docProps/core.xml",
         HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/'
         'core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>LeanSlides smoke test'
         '</dc:title><dc:creator>LeanSlides tests</dc:creator></cp:coreProperties>', True),
        ("ppt/presentation.xml",
         part("presentation",
              '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' +
              "".join(f'<p:sldId id="{256 + i}" r:id="rId{i + 2}"/>' for i in range(len(slides))) +
              '</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>'
              '<p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/>'
              '</a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle>'), True),
        ("ppt/_rels/presentation.xml.rels",
         rels([("rId1", "slideMaster", "slideMasters/slideMaster1.xml")] +
              [(f"rId{i + 2}", "slide", f"slides/slide{i + 1}.xml") for i in range(len(slides))] +
              [(f"rId{len(slides) + 2}", "theme", "theme/theme1.xml")]), True),
        ("ppt/theme/theme1.xml", theme(), True),
        ("ppt/slideMasters/slideMaster1.xml", master(), True),
        ("ppt/slideMasters/_rels/slideMaster1.xml.rels",
         rels([("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"),
               ("rId2", "theme", "../theme/theme1.xml")]), True),
        ("ppt/slideLayouts/slideLayout1.xml", layout(), True),
        ("ppt/slideLayouts/_rels/slideLayout1.xml.rels",
         rels([("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")]), True),
    ]
    for index, xml in enumerate(slides):
        items = [("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml")]
        if index == 1:
            items += [("rId2", "notesSlide", "../notesSlides/notesSlide1.xml"),
                      ("rId3", "image", "../media/image1.png"),
                      ("rId4", "hyperlink", "https://example.com/", "External")]
        entries.append((f"ppt/slides/slide{index + 1}.xml", xml, True))
        entries.append((f"ppt/slides/_rels/slide{index + 1}.xml.rels", rels(items), True))
    entries.append(("ppt/notesSlides/notesSlide1.xml",
                    notes("Mention that the picture is a plain PNG served from memory."), True))
    entries.append(("ppt/media/image1.png", png(64, 64, (68, 114, 196)), False))
    write_zip(HERE / "smoke.pptx", entries)


def make_fallback():
    write_zip(HERE / "fallback.odp", [
        ("mimetype", "application/vnd.oasis.opendocument.presentation", False),
        ("META-INF/manifest.xml",
         HEAD + '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">'
         '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.'
         'opendocument.presentation"/></manifest:manifest>', True),
    ])


if __name__ == "__main__":
    make_smoke()
    make_fallback()

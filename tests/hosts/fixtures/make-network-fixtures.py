"""Writes network.pptm beside this script: a macro-enabled deck whose every
outside reference points at http://127.0.0.1:47913/, where the network check
(tests/hosts/Observe-Network.ps1) listens. A request that arrives there means
LeanSlides or WebView2 tried to fetch something the deck names. The deck has:

  slide 1  a picture linked (r:link) to the listener and a hyperlink to it
  slide 2  a picture whose embed relationship is external, and a picture fill
           of a shape linked to the listener
  slide 3  a video linked to the listener, with an embedded poster picture
  slide 4  an OLE object linked to the listener, with its stored picture
  slide 5  a background picture linked to the listener; hyperlinks with
           file:, javascript: and mailto: targets; speaker notes with a link
  package  a vbaProject.bin (four bytes, not a real VBA project) and the
           macro-enabled content type, so the core reports macros

Run with `python -I tests/hosts/fixtures/make-network-fixtures.py`. The output
is byte-for-byte the same on every run."""

import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
LISTENER = "http://127.0.0.1:47913/"

spec = importlib.util.spec_from_file_location("host_fixtures", HERE / "make-host-fixtures.py")
fx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fx)


def picture(shape_id, blip, box):
    return (f'<p:pic><p:nvPicPr><p:cNvPr id="{shape_id}" name="Picture {shape_id}"/><p:cNvPicPr/><p:nvPr/>'
            f'</p:nvPicPr><p:blipFill>{blip}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>' +
            fx.xfrm(*box) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>')


def linked_para(text, rel):
    return (f'<a:p><a:r><a:rPr lang="en-US"><a:hlinkClick r:id="{rel}"/></a:rPr>'
            f'<a:t>{text}</a:t></a:r></a:p>')


def title(text):
    return fx.sp(2, '<p:ph type="title"/>', "", fx.para(text))


def slides():
    one = fx.slide(
        title("Linked picture and hyperlink") +
        picture(10, '<a:blip r:link="rId2"/>', (838200, 1825625, 2971800, 2971800)) +
        fx.sp(11, "", fx.xfrm(4572000, 1825625, 6096000, 1000000), linked_para("Listener link", "rId3")))
    two = fx.slide(
        title("External embed and linked fill") +
        picture(10, '<a:blip r:embed="rId2"/>', (838200, 1825625, 2971800, 2971800)) +
        fx.sp(11, "", fx.xfrm(4572000, 1825625, 2971800, 2971800) +
              '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>'
              '<a:blipFill><a:blip r:link="rId3"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>', ""))
    video = ('<p:pic><p:nvPicPr><p:cNvPr id="10" name="Video 10"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr>'
             '<a:videoFile r:link="rId2"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip r:embed="rId3"/>'
             '<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>' +
             fx.xfrm(838200, 1825625, 5334000, 3000000) +
             '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>')
    three = fx.slide(title("Linked video") + video)
    ole = ('<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="10" name="Object 10"/><p:cNvGraphicFramePr/>'
           '<p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="838200" y="1825625"/><a:ext cx="5334000" '
           'cy="3000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/'
           'presentationml/2006/ole"><p:oleObj name="Worksheet" r:id="rId2" progId="Excel.Sheet.12" '
           'imgW="5334000" imgH="3000000"><p:link updateAutomatic="1"/><p:pic><p:nvPicPr>'
           '<p:cNvPr id="11" name="Object 10 picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill>'
           '<a:blip r:embed="rId3"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>' +
           fx.xfrm(838200, 1825625, 5334000, 3000000) +
           '</p:spPr></p:pic></p:oleObj></a:graphicData></a:graphic></p:graphicFrame>')
    four = fx.slide(title("Linked OLE object") + ole)
    five = fx.part(
        "sld",
        '<p:cSld><p:bg><p:bgPr><a:blipFill><a:blip r:link="rId2"/><a:stretch><a:fillRect/></a:stretch>'
        '</a:blipFill><a:effectLst/></p:bgPr></p:bg>' +
        fx.tree(title("Background and other links") +
                fx.sp(11, "", fx.xfrm(838200, 1825625, 10515600, 3000000),
                      linked_para("A file link", "rId3") + linked_para("A script link", "rId4") +
                      linked_para("A mail link", "rId5"))) +
        "</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>")
    return [one, two, three, four, five]


def slide_rels(number):
    layout = [("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml")]
    if number == 1:
        return layout + [("rId2", "image", LISTENER + "linked-picture.png", "External"),
                         ("rId3", "hyperlink", LISTENER + "hyperlink", "External")]
    if number == 2:
        return layout + [("rId2", "image", LISTENER + "external-embed.png", "External"),
                         ("rId3", "image", LISTENER + "linked-fill.png", "External")]
    if number == 3:
        return layout + [("rId2", "video", LISTENER + "video.mp4", "External"),
                         ("rId3", "image", "../media/image1.png")]
    if number == 4:
        return layout + [("rId2", "oleObject", LISTENER + "worksheet.xlsx", "External"),
                         ("rId3", "image", "../media/image1.png")]
    return layout + [("rId2", "image", LISTENER + "background.png", "External"),
                     ("rId3", "hyperlink", "file:///C:/Windows/win.ini", "External"),
                     ("rId4", "hyperlink", "javascript:fetch('" + LISTENER + "script')", "External"),
                     ("rId5", "hyperlink", "mailto:nobody@example.invalid", "External"),
                     ("rId6", "notesSlide", "../notesSlides/notesSlide1.xml")]


def notes_with_link():
    shapes = (fx.sp(2, '<p:ph type="sldImg"/>', "", "") +
              fx.sp(3, '<p:ph type="body" idx="1"/>', "", linked_para("A link in the notes", "rId2")))
    return fx.part("notes", "<p:cSld>" + fx.tree(shapes) + "</p:cSld>")


def make():
    deck = slides()
    overrides = (
        '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.ms-powerpoint.'
        'presentation.macroEnabled.main+xml"/>'
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.'
        'theme+xml"/>'
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-'
        'officedocument.presentationml.slideMaster+xml"/>'
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-'
        'officedocument.presentationml.slideLayout+xml"/>'
        '<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-'
        'officedocument.presentationml.notesSlide+xml"/>')
    for index in range(1, len(deck) + 1):
        overrides += (f'<Override PartName="/ppt/slides/slide{index}.xml" ContentType="application/'
                      'vnd.openxmlformats-officedocument.presentationml.slide+xml"/>')
    entries = [
        ("[Content_Types].xml",
         fx.HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
         '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
         '<Default Extension="xml" ContentType="application/xml"/>'
         '<Default Extension="png" ContentType="image/png"/>'
         '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>' + overrides +
         "</Types>", True),
        ("_rels/.rels", fx.rels([("rId1", "officeDocument", "ppt/presentation.xml")]), True),
        ("ppt/presentation.xml",
         fx.part("presentation",
                 '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' +
                 "".join(f'<p:sldId id="{256 + i}" r:id="rId{i + 2}"/>' for i in range(len(deck))) +
                 '</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>'),
         True),
        ("ppt/_rels/presentation.xml.rels",
         fx.HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
         f'<Relationship Id="rId1" Type="{fx.REL}slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
         "".join(f'<Relationship Id="rId{i + 2}" Type="{fx.REL}slide" Target="slides/slide{i + 1}.xml"/>'
                 for i in range(len(deck))) +
         f'<Relationship Id="rId{len(deck) + 2}" Type="{fx.REL}theme" Target="theme/theme1.xml"/>'
         f'<Relationship Id="rId{len(deck) + 3}" Type="http://schemas.microsoft.com/office/2006/relationships/'
         'vbaProject" Target="vbaProject.bin"/></Relationships>', True),
        ("ppt/vbaProject.bin", b"\x00\x01\x02\x03", False),
        ("ppt/theme/theme1.xml", fx.theme(), True),
        ("ppt/slideMasters/slideMaster1.xml", fx.master(), True),
        ("ppt/slideMasters/_rels/slideMaster1.xml.rels",
         fx.rels([("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"),
                  ("rId2", "theme", "../theme/theme1.xml")]), True),
        ("ppt/slideLayouts/slideLayout1.xml", fx.layout(), True),
        ("ppt/slideLayouts/_rels/slideLayout1.xml.rels",
         fx.rels([("rId1", "slideMaster", "../slideMasters/slideMaster1.xml")]), True),
        ("ppt/notesSlides/notesSlide1.xml", notes_with_link(), True),
        ("ppt/notesSlides/_rels/notesSlide1.xml.rels",
         fx.rels([("rId1", "slide", "../slides/slide5.xml"),
                  ("rId2", "hyperlink", LISTENER + "notes-link", "External")]), True),
        ("ppt/media/image1.png", fx.png(64, 36, (112, 173, 71)), False),
    ]
    for number, xml in enumerate(deck, start=1):
        entries.append((f"ppt/slides/slide{number}.xml", xml, True))
        entries.append((f"ppt/slides/_rels/slide{number}.xml.rels", fx.rels(slide_rels(number)), True))
    fx.write_zip(HERE / "network.pptm", entries)


if __name__ == "__main__":
    make()

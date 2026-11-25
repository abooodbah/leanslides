"""Writes community-garden-plan.pptx, the deck shown in the website and Store
screenshots. Everything in it is made up here; no outside file is used.

Run with `python -I docs/images/screenshot-source/make-demo-deck.py`
(python-pptx 1.0.2). The deck is written next to this script."""

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.util import Emu, Pt

HERE = Path(__file__).resolve().parent
GREEN = RGBColor(0x2F, 0x6B, 0x4F)
LEAF = RGBColor(0x8C, 0xC0, 0x84)
SAND = RGBColor(0xF4, 0xEF, 0xE4)
INK = RGBColor(0x22, 0x26, 0x22)
CLAY = RGBColor(0xC8, 0x6B, 0x3C)

deck = Presentation()
deck.slide_width = Emu(12192000)
deck.slide_height = Emu(6858000)
title_layout = deck.slide_layouts[0]
content_layout = deck.slide_layouts[1]
title_only = deck.slide_layouts[5]


def background(slide, color):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color


def style_title(shape, color=GREEN, size=40):
    for paragraph in shape.text_frame.paragraphs:
        for run in paragraph.runs:
            run.font.color.rgb = color
            run.font.size = Pt(size)
            run.font.bold = True


def notes(slide, text):
    slide.notes_slide.notes_text_frame.text = text


# 1. Title
slide = deck.slides.add_slide(title_layout)
background(slide, GREEN)
slide.shapes.title.text = "Maple Street community garden"
style_title(slide.shapes.title, RGBColor(0xFF, 0xFF, 0xFF), 48)
slide.placeholders[1].text = "Spring planting plan and budget"
for run in slide.placeholders[1].text_frame.paragraphs[0].runs:
    run.font.color.rgb = LEAF
    run.font.size = Pt(24)
notes(slide, "Welcome everyone. This plan covers the beds, the schedule and the budget for spring.")

# 2. Goals
slide = deck.slides.add_slide(content_layout)
background(slide, SAND)
slide.shapes.title.text = "What we want this season"
style_title(slide.shapes.title)
body = slide.placeholders[1].text_frame
items = [
    ("Twelve raised beds, four of them wheelchair height", 0),
    ("A shared tool shed with a sign-out sheet", 0),
    ("Weekly open hours", 0),
    ("Saturday 9:00 to 12:00", 1),
    ("Wednesday 17:00 to 19:00", 1),
    ("A seed library at the front gate", 0),
]
for index, (text, level) in enumerate(items):
    paragraph = body.paragraphs[0] if index == 0 else body.add_paragraph()
    paragraph.text = text
    paragraph.level = level
    for run in paragraph.runs:
        run.font.color.rgb = INK
        run.font.size = Pt(24 if level == 0 else 20)
notes(slide, "The wheelchair-height beds were the most requested item in the autumn survey.")

# 3. Plan as shapes
slide = deck.slides.add_slide(title_only)
background(slide, SAND)
slide.shapes.title.text = "From soil to harvest"
style_title(slide.shapes.title)
steps = ["Test the soil", "Build the beds", "Plant seedlings", "Water rota", "Harvest day"]
width, height, gap = Emu(1960000), Emu(1100000), Emu(260000)
left = Emu((12192000 - (5 * width + 4 * gap)) // 2)
for index, step in enumerate(steps):
    x = left + index * (width + gap)
    shape = slide.shapes.add_shape(MSO_SHAPE.CHEVRON if index else MSO_SHAPE.PENTAGON, x, Emu(2900000), width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = GREEN if index % 2 == 0 else CLAY
    shape.line.fill.background()
    frame = shape.text_frame
    frame.text = step
    frame.paragraphs[0].alignment = PP_ALIGN.CENTER
    for run in frame.paragraphs[0].runs:
        run.font.size = Pt(18)
        run.font.bold = True
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
notes(slide, "Soil test results come back in two weeks. Beds go in the weekend after.")

# 4. Budget table
slide = deck.slides.add_slide(title_only)
background(slide, SAND)
slide.shapes.title.text = "Budget"
style_title(slide.shapes.title)
rows = [
    ("Item", "Quantity", "Cost"),
    ("Cedar boards", "48", "$1,150"),
    ("Soil and compost", "9 m³", "$720"),
    ("Tool shed kit", "1", "$640"),
    ("Seeds and seedlings", "-", "$310"),
    ("Total", "", "$2,820"),
]
table = slide.shapes.add_table(len(rows), 3, Emu(1600000), Emu(1900000), Emu(9000000), Emu(3600000)).table
for r, row in enumerate(rows):
    for c, value in enumerate(row):
        cell = table.cell(r, c)
        cell.text = value
        paragraph = cell.text_frame.paragraphs[0]
        paragraph.alignment = PP_ALIGN.RIGHT if c and r else PP_ALIGN.LEFT
        for run in paragraph.runs:
            run.font.size = Pt(20)
            run.font.bold = r in (0, len(rows) - 1)
notes(slide, "The city grant covers $2,000. The rest comes from the plant sale.")

# 5. Closing
slide = deck.slides.add_slide(title_layout)
background(slide, GREEN)
slide.shapes.title.text = "See you on Saturday"
style_title(slide.shapes.title, RGBColor(0xFF, 0xFF, 0xFF), 44)
slide.placeholders[1].text = "Bring gloves. We bring the coffee."
for run in slide.placeholders[1].text_frame.paragraphs[0].runs:
    run.font.color.rgb = LEAF
    run.font.size = Pt(24)
notes(slide, "Sign-up sheet is by the door.")

deck.core_properties.title = "Maple Street community garden"
deck.core_properties.author = "LeanSlides"
deck.save(HERE / "community-garden-plan.pptx")

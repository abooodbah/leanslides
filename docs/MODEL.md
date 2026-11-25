# Slide model

The core turns each slide into one JSON object that the reader draws. Every
inherited value is already resolved: the reader never looks at the master,
the layout, or the theme. This file is the contract between
`src/core` and `assets/`.

Units: positions and sizes are in EMU (914,400 per inch, 12,700 per point).
Font sizes and spacing in points. Angles in degrees, clockwise. Colours are
`"#rrggbb"` strings with a separate `alpha` from 0 to 1 where it is not 1.

## Slide

```json
{"index": 0, "w": 12192000, "h": 6858000, "hidden": true,
 "background": Fill,
 "shapes": [Shape, ...]}
```

`shapes` is in drawing order: the master's own shapes, then the layout's, then
the slide's. Master and layout shapes are left out when the slide or layout
sets `showMasterSp="0"`. Placeholders from the master and layout are never
drawn on their own; only the slide's placeholders are drawn, with the
properties they inherit. Shapes from the master and the layout carry
`"layer": "master"` or `"layer": "layout"`. `hidden` is present only for a
slide saved with `show="0"`. ActiveX controls come last.

## Shape

Every shape has `kind`, `id` (the file's `cNvPr` id), `name`, `x`, `y`, `w`,
`h`, and optionally `rot`, `flipH`, `flipV`, and `ph` (the placeholder type,
for example `"title"`). Coordinates are absolute on the slide, also for shapes
inside groups. A child's box is where it sits before its group turns or
flips: the reader applies the group's `rot`, `flipH`, and `flipV` about the
group's centre to all of its children.

| kind | extra keys |
| --- | --- |
| `shape` | `geom`, `fill`, `line`, `text` |
| `picture` | `media` or `missing`, `crop`, `geom`, `fill`, `line`, `alpha` |
| `group` | `children` (shapes), `diagram: true` for a SmartArt drawing |
| `table` | `cols` (widths), `rows`; `h` is the sum of the row heights |
| `object` | `feature`, `label`, and `media` when the file stores a picture for it |

- `geom`: `{"preset": "roundRect", "adj": {"adj": 16667}}`, or
  `{"paths": [{"w": 100, "h": 100, "fill": true, "stroke": true,
  "d": [["M", x, y], ["L", x, y], ["C", x1, y1, x2, y2, x, y],
  ["Q", x1, y1, x, y], ["A", wR, hR, startAngle, swingAngle], ["Z"]]}]}`
  for custom geometry, in path units scaled to the shape box.
- `missing` on a picture: `"metafile"` (EMF or WMF), `"unsupported-image"`,
  `"linked"` (outside the file, never fetched), or `"absent"`.
- `crop`: `[left, top, right, bottom]` as fractions of the picture (negative
  values pad).
- `object.feature`: one of the not-drawn feature codes in `SlideCore.h`
  (`chart`, `smartart`, `ole-object`, `video`, `audio`, `model-3d`, `ink`,
  `equation`), or `activex` for an ActiveX control (never run). `media` or
  `missing` describes the stored picture as for a picture. SmartArt whose file stores its drawing is not an object: its
  stored shapes are emitted as a `group`.

## Fill and line

```json
{"type": "none"}
{"type": "solid", "color": "#4472c4", "alpha": 0.5}
{"type": "gradient", "path": "linear", "angle": 90,
 "stops": [{"pos": 0, "color": "#ffffff"}, {"pos": 1, "color": "#000000"}]}
{"type": "picture", "media": "ppt/media/image1.png", "crop": [0,0,0,0], "tile": false}
{"type": "pattern", "pattern": "dkDnDiag", "color": "#000000", "background": "#ffffff"}
```

A line is `null` (no line) or
`{"w": 12700, "color": "#000000", "dash": "solid", "cap": "flat",
"head": {"type": "triangle", "w": "med", "len": "med"}, "tail": null}`.

## Text body

```json
{"anchor": "t", "anchorCenter": false, "insets": [91440, 45720, 91440, 45720],
 "wrap": true, "vert": "horz", "autofit": "none", "fontScale": 1,
 "lineReduction": 0, "columns": 1,
 "paragraphs": [Paragraph]}
```

`autofit` is `none`, `normal` (shrink on overflow, with the `fontScale` and
`lineReduction` PowerPoint saved), or `shape` (the box grows with the text).

A paragraph:

```json
{"align": "l", "level": 0, "marL": 0, "indent": 0, "rtl": false,
 "lineSpacing": {"pct": 1.0}, "spaceBefore": {"pt": 0}, "spaceAfter": {"pt": 0},
 "bullet": null, "endSize": 18,
 "runs": [Run]}
```

`bullet` is `null`, `{"char": "•", "font": "Arial", "color": "#000000",
"size": 1.0}`, or `{"text": "3.", ...}` for automatic numbering (the core
computes the number), or `{"media": "..."}` for a picture bullet. `size` is a
fraction of the first run's size.

A run is `{"t": "text", "size": 18, "font": "Calibri", "ea": "...",
"cs": "...", "color": "#000000", "b": true, "i": true, "u": "sng",
"strike": true, "baseline": 30, "caps": "all", "spacing": 0,
"highlight": "#ffff00", "link": "https://..."}`; keys whose value is the
default (`false`, `none`, 0) are left out. A line break is
`{"br": true, "size": 18}`. Fields (slide numbers, dates) arrive as text with
`"field"` set to the field type (`"slidenum"`, `"datetime1"`, ...); slide
numbers are computed for the slide, other fields keep the text the file saved.
A link is kept only for `http`, `https`, and `mailto` targets; the reader asks
before it opens one.

## Table

`cols` holds the column widths. Each row is `{"h": EMU, "cells": [Cell]}`
with one cell per grid column. A cell is
`{"span": 1, "rowSpan": 1, "fill": Fill, "borders": {"l": Line, "r": Line,
"t": Line, "b": Line}, "margins": [l, t, r, b], "anchor": "t", "text": TextBody}`;
cells covered by another cell's span are `{"merged": true}`. The table style
(first row, banded rows, and so on) is already applied.

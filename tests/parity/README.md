# Drawing fidelity against PowerPoint

These scripts compare how the reader draws each slide of the public corpus
with how PowerPoint draws it. They run on a developer machine with PowerPoint
installed, not in CI.

1. `node tests/corpus/fetch-corpus.mjs` fetches the corpus (public decks,
   pinned by URL and SHA-256 in `tests/corpus/manifest.json`, never committed).
2. `powershell -File tests/parity/Export-PowerPoint.ps1` has PowerPoint export
   every slide as a 1280-pixel-wide PNG, with each shape's box and text lines,
   into `tests/parity/cache/powerpoint/` (gitignored).
3. `node tests/parity/compare.mjs` shows each slide in the reader's slide show
   in headless Edge at the size of PowerPoint's PNG, takes a screenshot, and
   writes `tests/parity/scores.json`. `--only a.pptx,b.pptx` limits the decks
   and `--dump folder` also saves both pictures of every slide.

## What is scored

Both pictures are turned grey and shrunk to a quarter of their size
(320 pixels wide), then compared with SSIM (structural similarity, 1 means
identical). An empty slide with the right background already scores well
against a slide with little on it, so each slide is also scored with only its
background drawn. The **gain** is how far the reader's drawing moves the
score from that empty slide towards 1: 0 means no better than the empty
slide, 1 means identical, below 0 means worse than leaving the slide empty.
Slides whose background alone already matches have no gain.

SSIM is strict about position. A slide whose text is drawn correctly but a
few pixels lower than in PowerPoint can score below the empty slide. Text is
therefore also compared line by line: a PowerPoint line counts as matched
when the reader wrote the same characters on one line.

Slides are tagged when the reader shows a labelled box instead of a shape
(`not-drawn`: charts, SmartArt, ActiveX controls, video and the like) or when
a font the deck asks for is not installed (`font-missing`). Tagged slides stay
in every total.

## Results

Measured on 2026-11-25 with PowerPoint 16.0 and Edge 158.0.4370.33 on
Windows 11, over `scores.json` in this folder.

| | Count |
| --- | ---: |
| Decks in the corpus | 164 |
| Decks sent to PowerPoint (the rest are fuzzing and crash files) | 152 |
| Decks PowerPoint could not export | 7 |
| Decks scored | 145 |
| Slides scored | 550 |
| Slides with a gain (the background alone does not already match) | 531 |
| Slides the harness failed on | 0 |

| Measure | All slides | Untagged | `not-drawn` | `font-missing` |
| --- | ---: | ---: | ---: | ---: |
| Slides with a gain | 531 | 469 | 54 | 14 |
| Median gain | 0.41 | 0.45 | 0.09 | 0.48 |
| 10th percentile gain | -0.02 | 0.00 | -0.23 | -0.25 |

A slide can carry both tags, so the last three columns add up to more than
531. Over all 531 slides the gain quartiles are 0.11, 0.41 and 0.75, and the
90th percentile is 0.95. 63 slides score below their empty slide. The median
SSIM is 0.88 against 0.74 for the empty slides.

Of PowerPoint's 3,130 text lines, the reader wrote 2,992 (95.6%) the same way
on one line. 62 slides have at least one line that differs.

PowerPoint could not export these decks, so they are not scored:
`poi/au.asn.aes.www_conferences_2011_presentations_Fri_20Room4Level4_20930_20Maloney.pptx`,
`poi/bug60499.pptx`, `poi/bug62513.pptx`, `poi/bug65551.pptx`,
`poi/ca.ubc.cs.people_~emhill_presentations_HowWeRefactor.pptx`,
`poi/keyframes.pptx`, `libreoffice/predefined-table-style.pptx`.

### Lowest ten slides

| Deck | Slide | Gain | What differs |
| --- | ---: | ---: | --- |
| libreoffice/smartart-chevron.pptx | 1 | -0.61 | SmartArt is shown as a labelled box |
| libreoffice/chart_pt_color_bg1.pptx | 1 | -0.54 | a chart is shown as a labelled box |
| poi/at.ecodesign…elektronik.pptx | 19 | -0.51 | all text is drawn about 20 pixels lower than in PowerPoint |
| libreoffice/activex_checkbox.pptx | 1 | -0.50 | an ActiveX control is shown as a labelled box |
| poi/at.ecodesign…elektronik.pptx | 16 | -0.49 | as slide 19 |
| poi/table_test2.pptx | 1 | -0.48 | vertical text in table cells is drawn horizontally, so rows grow; the header text is black instead of white |
| poi/at.ecodesign…elektronik.pptx | 28 | -0.48 | as slide 19 |
| poi/at.ecodesign…elektronik.pptx | 3 | -0.47 | as slide 19 |
| poi/at.ecodesign…elektronik.pptx | 10 | -0.47 | as slide 19 |
| poi/at.ecodesign…elektronik.pptx | 6 | -0.44 | as slide 19 |

The fonts missing on the measuring PC were Monaco, Plain, Graphik,
Andale Mono, 等线 (DengXian), Aptos, Work Sans Light and Labil Grotesk 50.

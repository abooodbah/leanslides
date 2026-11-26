# LeanSlides: a free, read-only PowerPoint (.pptx) viewer for Windows

Open a .pptx without an office suite. LeanSlides shows the slides, presents
them full screen, never runs macros, and never fetches anything the file
points to. MIT licensed, no telemetry. The 0.1.1 Windows download is a ZIP of
about 0.9 MB.

[Website](https://abooodbah.github.io/leanslides/) · [Releases](https://github.com/abooodbah/leanslides/releases) · [Releases feed (Atom)](https://github.com/abooodbah/leanslides/releases.atom) · [All Lean apps](https://abooodbah.github.io/)

LeanSlides opens `.pptx`, `.ppsx`, and `.potx` files, and the macro-enabled
`.pptm`, `.ppsm`, and `.potm` without running their macros. It is the fourth
of the Lean apps, small read-only viewers with the same look:
[LeanMark](https://github.com/abooodbah/leanmark) for Markdown,
[LeanDoc](https://github.com/abooodbah/leandoc) for Word documents, and
[LeanRows](https://github.com/abooodbah/leanrows) for large CSV files.

## Install

Download `LeanSlides-v0.1.1-windows-x64.zip` from the
[latest release](https://github.com/abooodbah/leanslides/releases/latest).
It runs on Windows 10 and 11, x64. LeanSlides uses the Microsoft Edge WebView2
Runtime that Windows already has; it does not bundle a browser.

- Portable: extract the ZIP and run `LeanSlides.exe`.
- Installed for your user, with no administrator rights, from the extracted
  folder:

  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\install.ps1 -OpenDefaultAppsSettings
  ```

  It copies LeanSlides to `%LOCALAPPDATA%\Programs\LeanSlides`, adds a Start
  menu entry, and offers LeanSlides in Open With and Default Apps for the six
  extensions. It never changes a default you chose; the
  [installer notes](installer/README.md) explain the details.

The programs in the ZIP are not signed, so Windows may show an
unknown-publisher or SmartScreen warning. Compare the ZIP with the `.sha256`
file from the same release, and check where it was built:

```powershell
gh attestation verify LeanSlides-v0.1.1-windows-x64.zip --repo abooodbah/leanslides
```

## What it does

- Slide thumbnails beside the slide, drawn only as they scroll into view.
- Next and previous slide with Right, Down, Page Down, or Space and Left,
  Up, or Page Up; Home and End for the first and last slide.
- Fit the slide to the window, or zoom in and out.
- F5 presents from the first slide, Shift+F5 from the current one, and Esc
  ends the slide show.
- Speaker notes under the slide (Ctrl+Shift+N).
- Find in every slide and its notes (Ctrl+F), with F3 and Shift+F3 for the
  next and previous match.
- Copy the slide's text (Ctrl+Shift+C), or select text and copy it.
- Several presentations in tabs, five themes, and a settings page with every
  keyboard shortcut. The interface is in English, Simplified Chinese, and
  Japanese.
- Open in the editor (Ctrl+Shift+E) hands the file to PowerPoint,
  LibreOffice Impress, or the default app for `.pptx`.

## What it draws

Slides are built from the file's own description: placeholders inherit from
their layout and master; theme colours and fonts; bullets and numbering; autofit; preset and custom shapes; solid, gradient,
picture, and pattern fills; lines with dashes and arrowheads; cropped
pictures; tables with table styles; groups; and slide, layout, and master
backgrounds.

What it does not draw is shown, not hidden. Charts, SmartArt, ActiveX
controls, video, audio, 3D models, ink, and embedded objects show the picture
the file stores for them, or a labelled box when there is none. Linked
pictures and other content outside the file are never fetched and show a
labelled box instead.

## How close it is to PowerPoint

Measured on 2026-11-25 against PowerPoint 16.0's own export of every slide,
over 550 slides from 145 public decks. The method and all numbers are in
[tests/parity/README.md](tests/parity/README.md).

- Of PowerPoint's 3,130 text lines, LeanSlides wrote 2,992 (95.6%) the same
  way on one line.
- The median structural similarity (SSIM) of a slide is 0.88, against 0.74
  for an empty slide with the right background.
- The median gain, how far the drawing moves that score from the empty slide
  towards identical, is 0.41; the quartiles are 0.11 and 0.75. 63 of 531
  slides score below their empty slide.

## Start-up time and memory

Measured on 2026-11-25 on an Intel Core i7-13620H laptop with Windows 11 and
WebView2 158, medians of 10 launches. Memory is the private memory of
LeanSlides.exe and every WebView2 process it started, once it has settled.
The method is in [tests/perf/README.md](tests/perf/README.md).

| Deck | Window visible | First slide drawn | Memory |
| --- | ---: | ---: | ---: |
| none (start page ready) | 114 ms | 424 ms | 89.4 MiB |
| 3 slides, 8 KB | 115 ms | 450 ms | 91.9 MiB |
| 23 slides, 0.9 MB | 115 ms | 455 ms | 99.0 MiB |
| 240 slides with a picture each, 46 MB | 124 ms | 513 ms | 150.8 MiB |
| the same, after paging through every slide | | | 294.4 MiB |

## Known gaps

- Charts, SmartArt, ActiveX controls, video, audio, 3D models, and ink are
  not drawn (see above).
- In some decks all text is drawn about 20 pixels lower than in PowerPoint.
- Vertical text in table cells is drawn horizontally, and some table-style
  header text has the wrong colour.
- Double and triple (compound) lines are drawn as one line.
- A font the deck asks for that is not installed is replaced by a similar
  one, so line breaks can differ.
- Animations and transitions are not played; the slide show shows each slide
  in its final state.
- Memory keeps growing while the same large deck is paged through again and
  again: 523 MiB after five walks through the 240-picture deck.
- Windows only, x64 only. The ZIP is not code-signed.

## Keyboard

| Action | Keys |
| --- | --- |
| Open a presentation | Ctrl+O |
| Next slide | Right, Down, Page Down, Space |
| Previous slide | Left, Up, Page Up |
| First / last slide | Home / End |
| Present from the first / current slide | F5 / Shift+F5 |
| End the slide show | Esc |
| Find in slides and notes | Ctrl+F |
| Next / previous match | F3 / Shift+F3 |
| Show or hide speaker notes | Ctrl+Shift+N |
| Zoom in / out / fit | Ctrl++ / Ctrl+- / Ctrl+0 |
| Copy the slide's text | Ctrl+Shift+C |
| Change theme | Ctrl+Shift+T |
| Open in the editor | Ctrl+Shift+E |
| Read the file again | Ctrl+R |
| Settings and shortcuts | Ctrl+/ or F1 |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab, or Ctrl+Page Down / Ctrl+Page Up |
| Go to tab 1 to 8 / last tab | Ctrl+1 to Ctrl+8 / Ctrl+9 |
| Close tab | Ctrl+W |

## Untrusted presentations

Every file is treated as untrusted. The core reads one file within fixed
limits and refuses any part with a DTD. Macros, OLE objects, and ActiveX
controls never run. The reader page and everything it loads come from
LeanSlides's own app origin, and its Content Security Policy allows nothing
else. The host cancels navigation away from that origin, new windows, and
downloads, and denies permission requests. A link opens in your browser or
mail app only for `http`, `https`, and `mailto`, and only after a click.
[SECURITY.md](SECURITY.md) has the details and how to report a problem.

## Privacy

LeanSlides's own code makes no network requests. It has no telemetry, no
update check, and no account. Outside the presentations you open, it writes
only its settings (theme, language, and up to 10 recent files) in
`HKCU\Software\LeanSlides`, and a WebView2 profile folder in
`%LOCALAPPDATA%\LeanSlides\WebView2`.

This was measured on 2026-11-25 on one Windows 11 PC with
`tests/hosts/Observe-Network.ps1`; CI runs it on every push without the
network log. With no deck, a small deck, a typical deck, and a test deck
whose every outside reference points at a local listener, the listener got no
connection, LeanSlides.exe opened no socket, and Chromium's network log named
only LeanSlides's own reader addresses. In every case the WebView2 runtime
itself also opened HTTPS connections to Microsoft 365 addresses, which the
network log does not show; LeanMark recorded the same on a PC with a work
account added to Windows. [docs/HOST.md](docs/HOST.md#network) has the
numbers.

## Source builds

Requirements on Windows: Visual Studio 2022 or newer with the C++ workload,
CMake, and Ninja.

```powershell
scripts\dev-build.cmd Release
ctest --test-dir build\Release --output-on-failure
```

`scripts\build.ps1` builds, runs the tests, and stages the release payload in
`dist\`; `scripts\package-release.ps1 -Version 0.1.1` makes the ZIP and its
`.sha256` file from it.

The core in `src/core` is portable C++17 and also builds on Linux:

```sh
cmake -S . -B build/linux -G Ninja -DBUILD_TESTING=ON
cmake --build build/linux && ctest --test-dir build/linux
```

`tools/inspect` builds `leanslides-inspect`, which prints what LeanSlides
reads from a presentation as JSON. [docs/MODEL.md](docs/MODEL.md) describes
the slide model and [docs/HOST.md](docs/HOST.md) the Windows host.

## Privacy policy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it.

LeanSlides's own code makes no network requests. It has no telemetry, no
update check, and no account, and it never fetches anything a presentation
points to: linked pictures, videos, and objects show a labelled box instead.
A link you click opens in your browser or mail app, and **Open in the
editor** may open PowerPoint for the web in your browser; those requests are
made by those apps after your click.

The page is drawn by the Microsoft Edge WebView2 Runtime, a Microsoft
component that is installed and updated separately. That runtime may
contact Microsoft on its own, under Microsoft's terms.
[Privacy](#privacy) says what has been observed so far.

## Uninstall

- Installed with `installer\install.ps1`: Settings > Apps > Installed apps >
  LeanSlides, or the installed `uninstall.ps1`, as the
  [installer notes](installer/README.md) describe. It also removes the
  settings key and the WebView2 folder.
- Portable ZIP: delete the extracted folder. The settings key
  `HKCU\Software\LeanSlides` and the folder `%LOCALAPPDATA%\LeanSlides` stay
  until you delete them.

## License

[MIT](LICENSE). Bundled components keep their own licences, listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

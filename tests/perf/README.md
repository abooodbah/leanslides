# Start-up time and memory on Windows

`Measure-Performance.ps1` launches the built `LeanSlides.exe` and measures
how fast the first slide appears and how much memory the whole program uses,
including the Microsoft Edge WebView2 processes it starts. It runs on a
developer machine, not in CI: shared runners give numbers that change from
run to run.

```powershell
node tests/corpus/fetch-corpus.mjs
npm ci --ignore-scripts
powershell -File tests/perf/Measure-Performance.ps1 -ExePath build\Release\LeanSlides.exe -Runs 10
```

It writes `artifacts/perf-windows/perf-windows.json` (every launch) and
`perf-windows.md` (the medians). The first run writes the large deck to
`artifacts/perf-windows/large.pptx` with `make-perf-deck.py`.

## What is measured

Each launch runs `LeanSlides.exe --trace-timing --exit-after-render=MS` and
reads the host's timing lines on a reader thread, so the host never waits on
a full pipe.

- **Window visible** and **first slide drawn** are milliseconds from process
  start on the host's own clock. With no deck, the second figure is when the
  start page is ready.
- **Settled memory** is the private memory of the whole process tree
  (LeanSlides.exe and every process created under it after it started), once
  three samples 250 ms apart agree within 1.5 MiB.
- **Highest** is the most private memory the tree held during the launch.
- **Peak working sets (sum)** adds up each process's own peak working set.
  The processes peak at different moments and share pages, so this sum is an
  upper bound, not a moment that happened.

Before each launch the script waits until no WebView2 process of an earlier
launch is left. It refuses to run while another copy of the same executable
is running.

The decks:

| Case | Deck |
| --- | --- |
| small | `tests/hosts/fixtures/smoke.pptx`, 3 slides, 8 KB |
| typical | `poi/alterman_security.pptx` from the public corpus, 23 slides, 0.9 MB |
| large | made by `make-perf-deck.py`: 240 slides, each a 1280x720 PNG of about 200 KB and a speaker note, 46.1 MB |

"After every slide" drives the running app over the DevTools protocol
(`visit-slides.mjs`) and presses Page Down until the last slide is drawn,
then measures settled memory. "After five walks" does that five times,
going back to the first slide in between.

## Results

Measured on 2026-11-25 on an Intel Core i7-13620H (16 logical processors),
39.6 GiB of memory, Windows 11 Pro build 26300, WebView2 Runtime
158.0.4370.33. Medians of 10 launches (3 for five walks); no launch failed and
every launch settled.

| Case | Window visible | First slide drawn | Settled memory | Highest | Peak working sets (sum) |
| --- | ---: | ---: | ---: | ---: | ---: |
| no deck | 114 ms | 424 ms | 89.4 MiB | 90.3 MiB | 291.3 MiB |
| small | 115 ms | 450 ms | 91.9 MiB | 93.0 MiB | 300.6 MiB |
| typical | 115 ms | 455 ms | 99.0 MiB | 99.1 MiB | 318.7 MiB |
| large | 124 ms | 513 ms | 150.8 MiB | 151.2 MiB | 408.3 MiB |
| large, after every slide | 110 ms | 487 ms | 294.4 MiB | 294.6 MiB | 999.4 MiB |
| large, after five walks | 142 ms | 592 ms | 522.9 MiB | 522.9 MiB | 1,228.5 MiB |

One walk through the 240 slides took 4.8 s (median of 10), about 20 ms a
slide.

## Known gap

Memory keeps growing while the same large deck is paged through again and
again: 151 MiB after opening, 294 MiB after one walk, 523 MiB after five. The
reader's own caches are bounded (24 slide models; thumbnails are drawn near
the visible part of the strip and released 2,400 px away from it). The
growth is in the renderer's native memory, not the page's JavaScript heap,
most likely decoded pictures. Five walks did not show where it stops.

## Mistakes the harness avoids

- Reading the timing pipe only at exit: the host's `WriteFile` blocks once
  the pipe is full, and a walk of the large deck stalled at slide 34.
- Waiting for slides with Playwright's `page.waitForSelector`: the element
  handles it returns keep every drawn slide alive under the DevTools console,
  which added about 100 MiB a walk that the app itself does not use.
  `locator().waitFor()` returns no handle.

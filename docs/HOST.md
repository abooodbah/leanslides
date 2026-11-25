# Windows host

`LeanSlides.exe` is a Win32 window with one WebView2 control. The reader page
and everything it loads come from `https://app.leanslides.invalid/`, which the
host answers itself through `WebResourceRequested`. Nothing is mapped from
disk except the `assets` folder beside the executable, and no request goes to
the network.

## What the host serves

| Address | Answer |
| --- | --- |
| `/reader.html`, `/reader.css`, `/reader.js`, ... | files from `assets/` (letters, digits, `.`, `_`, `-`, `/` only; no `..`; at most 64 MiB) |
| `/deck/<tab>/<generation>/index.json` | the deck index (also sent inline with the `document` message) |
| `/deck/<tab>/<generation>/details.json` | every slide's title, text and notes |
| `/deck/<tab>/<generation>/slide/<n>.json` | slide `n`'s model (from 0), or `{"error": code}` if that slide cannot be read |
| `/deck/<tab>/<generation>/media?id=<id>` | a picture a built slide names, `id` percent-encoded |

A deck address is answered only for the deck the host holds, and only while
its tab is active (`IsCurrentDeckRequest` in `src/windows/DeckUrl.h`). An
address from a closed tab, a background tab, or an older generation (the file
changed on disk) gets 404. Pictures are served only as PNG, JPEG, GIF or BMP
(`IsServableMediaType`), after the core has checked that a built slide names
the part and that its bytes start with that format's signature.

The host keeps only the active tab's deck in memory. Selecting another tab
reads that file again.

## Messages

Reader to host: `ready`, `rendered`, `renderFailed`, `open`, `openRecent`,
`clearRecent`, `openInEditor`, `link`, `setTheme`, `selectTab`, `closeTab`,
`reload`.

Host to reader: `host`, `theme`, `tabs`, `empty`, `status`, `document`
(`deckUrl`, `index`, `coreMs`), `fallback` (`report` with the error code and a
sentence).

A link goes to Windows only after `NormalizeExternalLink` (`src/core/Links.h`)
accepts it: `http` and `https` with a host, or `mailto` with addresses and
subject, body, cc and bcc only.

## Smoke test contract

`LeanSlides.exe --smoke-test FILE` opens one file, waits for `rendered`, then
probes the page. The reader must keep these for the probe:

- `document.documentElement.dataset.renderState` is `ready` once the first
  slide is drawn;
- `document.documentElement.dataset.slides` is the slide count;
- the drawn slide element has the `data-rendered-slide` attribute;
- the reader fetches `slide/0.json` from the deck address (the probe finds
  the deck address from that request).

The probe then fetches `details.json`, slide 2's model and its picture, and
three addresses the host must refuse (an older generation, a slide past the
end, and a part no slide names). It passes when the slide has text, the
details count every slide and hold a note, the picture loads, the three
refusals are 404, no resource came from outside the app origin, and the
Content Security Policy reported nothing. ctest runs it on
`tests/hosts/fixtures/smoke.pptx`, and on `fallback.odp`, where it must fail.

The resource check covers what the page loaded. It is not a network
measurement; that is the next section.

## Network

`tests/hosts/Observe-Network.ps1` launches LeanSlides with no deck,
`smoke.pptx`, `network.pptm`, and a typical corpus deck, watches each for 8
seconds, and closes it. `network.pptm` (written by
`tests/hosts/fixtures/make-network-fixtures.py`) points every outside
reference a deck can hold at a listener on `127.0.0.1:47913`: a linked
picture, a linked picture fill, an external picture, a linked video, a
linked OLE object, a linked background, and hyperlinks on a slide and in the
notes. It also carries a macro project. The script watches three things:

- connections to that listener;
- every TCP connection and UDP endpoint of LeanSlides.exe and its WebView2
  processes, read from the IP helper tables about every 65 ms;
- every URL in Chromium's network log (`--log-net-log`).

A case fails if the listener gets a connection, if LeanSlides.exe has any
socket, if the log names a URL outside `https://app.leanslides.invalid/`, or
if the browser did not get LeanSlides's own arguments together with the log
argument. CI runs it on every push.

On 2026-11-25, on a Windows 11 laptop with WebView2 158.0.4370.33, every case
passed: no listener connection, no socket of LeanSlides.exe, and only reader
URLs in the log (12 to 22 per case). In every case the WebView2 browser
process also opened HTTPS connections to addresses in the range that
`substrate.office.com` (Microsoft 365) resolves to, about 2.6 to 3.2 seconds
after start. The network log does not show them; the runtime makes them on
its own. LeanMark recorded the same connections on a PC with a work account
added to Windows. Other PCs have not been measured.

## Browser arguments

`--disable-background-networking --disable-component-update --disable-sync
--no-first-run --disk-cache-size=1048576 --media-cache-size=1048576
--disable-gpu --disable-software-rasterizer
--enable-features=NetworkServiceInProcess2`. These are LeanDoc's, measured
there on Word documents. LeanSlides has not measured them on slides yet;
`LEANSLIDES_BROWSER_PROFILE=gpu` or `plain` runs without them for that
comparison.

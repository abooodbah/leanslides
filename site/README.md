# LeanSlides site

A dependency-free static site for GitHub Pages: `index.html`, `styles.css`,
and the files in `assets/`. There is no build step and no script except the
JSON-LD block. `.github/workflows/pages.yml` validates and deploys it when
`site/` changes on `main`.

## Preview

```sh
python -m http.server 8080 --directory site
```

Then open `http://localhost:8080/`. Serve it over HTTP: the fonts do not load
from a `file:` URL.

## Validate

```sh
node site/validate.mjs
```

It checks the page structure, same-page and local links, assets and PNG
sizes, alt text, that no outside script or style is loaded, the version
against `package.json`, the release asset names, that every number in the
page text is on its list of measured facts, sentence-case headings, and the
writing rules. It warns when a capture still looks like a solid-colour
placeholder. It does not replace a look in a browser at desktop, tablet, and
phone widths.

When a new measurement goes on the page, add its numbers to `allowedNumbers`
in `validate.mjs` with the source beside them.

## Images

- `assets/leanslides-window.png` (1440x900) is a capture of the Windows app
  showing `docs/images/screenshot-source/community-garden-plan.pptx`, a deck
  made by `make-demo-deck.py` in the same folder.
- `assets/social-preview.png` (1280x640) is the Open Graph image, rendered
  from `docs/images/screenshot-source/social-preview.html`.
- `node docs/images/screenshot-source/capture.mjs path\to\LeanSlides.exe`
  makes both: it starts the real app with the demo deck and a DevTools port,
  sizes the page to 1440x900, captures slide 2, then renders the preview.
  Never replace them with a drawn mock-up.
- `assets/leanslides-icon.png` (256x256) is drawn by `draw()` in
  `scripts/make-icon.py`; `assets/leanslides-icon.svg` draws the same shapes.
- `assets/fonts/` holds IBM Plex WOFF2 files copied from the pinned
  `@fontsource` packages (OFL-1.1).

## On a new release

Change the version and asset links in `index.html` (the release line, the
download buttons, the download table, the commands, and the JSON-LD), and the
measurements if they were taken again. `node site/validate.mjs` fails until
the version matches `package.json`.

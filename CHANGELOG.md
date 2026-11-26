# Changelog

All notable changes to LeanSlides are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-11-25

### Fixed

- A window could stay blank, or show "LeanSlides could not start", when
  another LeanSlides had left the shared WebView2 browser stopped or had
  started it with other settings. A start that fails, or has not shown the
  reader after 20 seconds, is now tried once more with a second WebView2
  folder inside the first one.

## [0.1.0] - 2026-11-25

### Added

- First release. Opens `.pptx`, `.ppsx`, `.potx`, `.pptm`, `.ppsm`, and
  `.potm` presentations for reading and presenting on Windows 10 and 11 x64.
  Macros, OLE objects, and ActiveX controls never run, and nothing a file
  links to is fetched.
- Slide thumbnails, keyboard navigation, fit and zoom, F5 presentation,
  speaker notes, find across slides, and copying slide text.
- Tabs, five themes, a settings page with the keyboard shortcuts, and an
  interface in English, Simplified Chinese, and Japanese.
- A per-user installer and uninstaller in the release ZIP.

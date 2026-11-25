# Security policy

LeanSlides treats every presentation as untrusted input. Reports are welcome
for the core's ZIP and XML handling, the reader, the Windows host and its
WebView2 settings, the installer, the release package, and bundled
dependencies.

## What LeanSlides's code does

- The core reads one file within fixed limits (512 MiB input, 128 MiB per
  part, 1 GiB uncompressed in total) and refuses any part with a DTD or an
  entity declaration. A file over a limit is refused with a named error,
  never shown in part.
- Macros (`vbaProject.bin`), OLE objects, and ActiveX controls are never run
  or opened. A slide shows the stored preview picture of such an object, or
  a labelled placeholder.
- Pictures, videos, backgrounds and objects that are linked from outside the
  file are never fetched. The slide shows a labelled placeholder instead.
- The reader page and everything it loads come from LeanSlides's own app
  origin, which the host answers from its `assets` folder and from memory.
  The Content Security Policy allows nothing else.
- The host cancels navigation away from the app origin, new windows, and
  downloads, denies permission requests, and turns off script dialogs and
  the developer tools. A link opens in the system handler only for `http`,
  `https`, and `mailto`, and only after a click.

These describe the code. They are not a guarantee about the Microsoft Edge
WebView2 Runtime that Windows provides.

## Supported versions

Fixes target the latest release and the `main` branch. Please check the
newest release before reporting.

## Report a vulnerability

Do not open a public issue with exploit details.

1. Open the repository's **Security** tab and choose **Report a
   vulnerability** to send a private report.
2. If private reporting is unavailable, open a minimal issue titled
   `Security contact requested`, with no technical details, files, or proof
   of concept.

Please include, when you can:

- the LeanSlides version or commit;
- the Windows and WebView2 versions;
- steps to reproduce and a minimal, non-private test file;
- the impact and the user interaction it needs;
- a proof of concept or a suggested fix.

A maintainer will confirm the report and coordinate a fix and disclosure.
Please wait for the fix or an agreed date before publishing. Credit is given
on request.

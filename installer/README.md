# LeanSlides per-user installer

These scripts install LeanSlides for the current Windows user. They need no
administrator access and never edit or delete Windows UserChoice values.

## Check the payload first

From the extracted release ZIP, this reads the files and changes nothing:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\install.ps1 -ValidateOnly

## Install

From the extracted `LeanSlides-vX-windows-x64` folder, or from the repository
root after `scripts\build.ps1`:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\install.ps1

The installer looks for `LeanSlides.exe` in the folder above `installer\`, then in
`dist\`. To choose a payload explicitly:

    .\installer\install.ps1 -SourceDirectory 'C:\path\to\payload'

The payload must contain `LeanSlides.exe`, `WebView2Loader.dll`, and the reader
assets. `tools\`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, and `README.md` are
copied when present. The per-user destination is
`%LOCALAPPDATA%\Programs\LeanSlides`.

## Default-app behaviour

LeanSlides registers `.pptx`, `.ppsx`, `.potx`, `.pptm`, `.ppsm`, and `.potm`
through its per-user capabilities, the `LeanSlides.Presentation` ProgID, an
Applications entry, an App Paths entry, and each extension's
`OpenWithProgids` list. Macro-enabled files open, but their macros never run.

For each extension, `install.ps1` writes a direct `HKCU\Software\Classes`
extension default only when no app owns that extension: there is no
UserChoice, and neither `HKCU\Software\Classes\<ext>` nor
`HKLM\Software\Classes\<ext>` has a default value. An office suite
deployed for the whole machine often sets only the HKLM default; LeanSlides then
does not take it over and is registered only in Open With and Default Apps.
`-ValidateOnly` lists, for each extension, which of the two would happen. The
installer then calls SHChangeNotify and asks Windows which executable is
actually used.

When another application stays the default, an interactive install offers to
open LeanSlides's page in Windows Default Apps. These switches also exist:

- `-OpenDefaultAppsSettings`: open the settings page when it is needed.
- `-Quiet`: do not show the interactive settings prompt.
- `-ValidateOnly`: check the payload, list what the install would register
  for each extension, and exit without changing anything.

Windows asks the user before an existing default changes; the scripts do not
work around that.

## Uninstall

Use Settings > Apps > Installed apps > LeanSlides, or run:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File $env:LOCALAPPDATA\Programs\LeanSlides\uninstall.ps1

The uninstaller checks that the recorded location is exactly
`%LOCALAPPDATA%\Programs\LeanSlides` and rejects reparse points. It removes
LeanSlides's own registry keys (including its theme, view, and recent-file
settings), only LeanSlides's values from shared keys, the Start menu shortcut only
when it still points at this installation, and only the files listed in the
install manifest.

If the manifest is missing or invalid, a short list of known LeanSlides files is
used. Unknown files and non-empty folders are kept. A previous direct Classes
default is restored only if the current value is still `LeanSlides.Presentation`. A
later user choice is kept, and UserChoice is never changed or deleted.

## Unsigned builds

The Windows build is not signed. Windows may show an unknown-publisher or
SmartScreen warning. Compare the downloaded ZIP with the `.sha256` file from
the same GitHub Release before you run it.

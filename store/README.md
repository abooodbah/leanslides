# Microsoft Store package

This folder builds the MSIX that is uploaded to Partner Center. It packages
the Windows ZIP from a GitHub release; nothing is compiled here. The Store
signs the package.

- `msix/app.psd1`: the app's names, file types, required files and placeholder
  identity. The scripts read it.
- `msix/AppxManifest.template.xml`: the package manifest. The identity values
  come from the `MSIX_*` repository variables.
- `msix/New-StorePackage.ps1`: stages the release files (without the ZIP's
  installer), adds the logos and manifest, indexes the logos with MakePri,
  packs with MakeAppx and unpacks again to check the result. `-SignTestCopy`
  also writes a copy signed with a throwaway certificate, for an install test.
- `msix/Test-StorePackage.ps1`: installs a package, starts the app from the
  Start menu, through `leanslides.exe` and through a file association with a
  sample presentation, checks the file types Windows registered, then removes
  the package. It changes the machine, so only CI runs it.
- `msix/make-store-images.py`: draws every logo in `msix/Images` from
  `scripts/make-icon.py`. Run `python -I store/msix/make-store-images.py`
  after the icon changes and commit the PNGs.
- `listing.md`, `age-rating.md`, `submission-steps.md`: the Store listing in
  four languages, the age rating answers, and the steps that need the owner's
  Partner Center account.

The workflow `.github/workflows/store-msix.yml` runs on `v*` tags, on pull
requests that change this folder, and by hand. It downloads
`LeanSlides-v<version>-windows-x64.zip` from the release, builds the MSIX,
installs the test-signed copy on the runner, and uploads the unsigned package
as an artifact.

Build locally (needs the Windows 10 SDK):

```powershell
store\msix\New-StorePackage.ps1 -Version 0.1.0 -ReleaseZip LeanSlides-v0.1.0-windows-x64.zip
```

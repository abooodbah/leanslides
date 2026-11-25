# LeanSlides: Microsoft Store submission steps

These are the steps that need the owner's own account. Everything else (the
MSIX package, the listing text and the age rating answers) is in this folder.
The Store screenshots are not made yet.

What is here:

- `listing.md`: every listing field, ready to paste, in English, Japanese,
  Simplified Chinese and Traditional Chinese.
- `age-rating.md`: answers for the IARC age rating questionnaire.
- `msix/`: the package manifest template, logos, and the scripts the
  "Microsoft Store package" workflow runs.

## 1. Developer account

Use the developer account whose publisher display name is **Lean Apps
Studio**, the same account as the other Lean apps. If it does not exist yet,
open https://storedeveloper.microsoft.com, sign up as an individual developer
(free), complete identity verification, and set that publisher display name.

## 2. Reserve the name

1. In Partner Center, open **Apps and games** > **New product** >
   **MSIX or PWA app**.
2. Enter **LeanSlides** and select **Reserve product name**.

## 3. Copy the product identity into GitHub

1. In Partner Center, open LeanSlides > **Product management** >
   **Product identity**.
2. In GitHub, open https://github.com/abooodbah/leanslides/settings/variables/actions and create three
   repository variables (Variables tab, not Secrets):

   | Variable | Value from Product identity |
   | --- | --- |
   | `MSIX_IDENTITY_NAME` | Package/Identity/Name |
   | `MSIX_PUBLISHER` | Package/Identity/Publisher (starts with `CN=`) |
   | `MSIX_PUBLISHER_DISPLAY_NAME` | Package/Properties/PublisherDisplayName (Lean Apps Studio) |

   Copy them exactly. If they do not match, Partner Center rejects the
   upload with an identity error.

## 4. Build the package

The workflow packages the Windows ZIP attached to a GitHub release, so the
release must exist first.

1. Open https://github.com/abooodbah/leanslides/actions/workflows/store-msix.yml and select **Run workflow**.
   Leave the tag empty to package the version in `package.json`, or enter a
   release tag such as `v0.1.0`.
2. When the run finishes, check that its summary has no warning about
   placeholder identity values. If it has one, the variables in step 3 are
   missing or misspelled.
3. Download the artifact `LeanSlides-v0.1.0-store-msix` and unzip it.
   Upload `LeanSlides-v0.1.0-x64.msix`. Do not upload anything from a
   `test-signing` folder; the workflow does not publish those.

Later releases: pushing a `v*` tag runs the same workflow, which waits for the
GitHub release and then builds the package. Each Store update is a new
submission with the new `.msix`.

## 5. Create the submission

Open LeanSlides > **Start your submission** and fill in each section:

1. **Pricing and availability**: Markets: all markets. Visibility: public.
   Pricing: **Free**. No free trial.
2. **Properties**: Category **Productivity**, secondary category **Utilities &
   tools**. Privacy policy URL: https://abooodbah.github.io/leanslides/#privacy-policy. Website: https://abooodbah.github.io/leanslides/.
   Support contact: https://github.com/abooodbah/leanslides/issues. "This product accesses, collects, or
   transmits personal information": No. System requirements: see
   `listing.md`.
3. **Age ratings**: complete the questionnaire with the answers in
   `age-rating.md`.
4. **Packages**: upload the `.msix` from step 4. Leave the device family as
   Windows 10/11 Desktop.
5. **Store listings**: the package declares English only, so English (United
   States) is listed already. Add Japanese (Japan), Chinese (Simplified,
   China) and Chinese (Traditional, Taiwan) with **Manage additional
   languages**. For each language paste the short title, short description,
   description, features, search terms, what's new and copyright line from
   its block in `listing.md`, and upload the screenshots with their captions.
6. **Submission options** > Restricted capabilities: the package declares
   `runFullTrust`. Paste this justification:

   > LeanSlides is a desktop (Win32) application packaged with MSIX.
   > runFullTrust is required for any packaged desktop application. The app
   > only reads files the user opens and does not change system settings.

7. Select **Submit to the Store**. Certification usually takes up to three
   business days. Partner Center emails the result.

## Notes

- The Store signs the package. The repository never holds a signing
  certificate for it, and the workflow's test-signed copy uses a throwaway
  certificate made for that run only.
- The Store version installs next to a ZIP installation without conflict.
  They are separate copies; Windows lets the user pick which one opens each
  file type.
- Settings live under `HKCU\Software\LeanSlides` and the WebView2 data folder
  under `%LOCALAPPDATA%\LeanSlides\WebView2`. In the packaged app Windows keeps
  these in the package's own storage and removes them on uninstall. Nothing is
  written to the install folder.

## WebView2

LeanSlides draws its slides with the Microsoft Edge WebView2 Runtime
(Evergreen). It is part of Windows 11 and Windows Update has installed it on
supported Windows 10 PCs since 2021, so the package does not carry or install
it. If the runtime is missing or broken, LeanSlides does not crash: it shows a
message that it needs the WebView2 Runtime and asks the user to install or
repair it. That message comes from the environment creation callback in
`src/windows/App.cpp`.

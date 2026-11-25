@{
    # Read by New-StorePackage.ps1, Test-StorePackage.ps1 and make-store-images.py.
    AppId = 'LeanSlides'
    # The product name reserved in Partner Center. The Store takes the listing
    # name from the manifest DisplayName, which must equal it exactly. It must
    # not contain another vendor's product name.
    StoreDisplayName = 'LeanSlides'
    Executable = 'LeanSlides.exe'
    # The command alias; the ZIP installer registers the same name under App Paths.
    Alias = 'leanslides.exe'
    # The Python script whose draw() function draws the app icon. Every logo in
    # Images is rendered from it by make-store-images.py.
    IconScript = 'scripts\make-icon.py'
    # The extensions installer\install.ps1 registers.
    Extensions = @('.pptx', '.ppsx', '.potx', '.pptm', '.ppsm', '.potm')
    RequiredFiles = @(
        'WebView2Loader.dll',
        'assets\reader.html',
        'assets\reader.css',
        'assets\reader.js',
        'tools\leanslides-inspect.exe'
    )
    # ZIP-only files. In the MSIX, Windows installs, associates and uninstalls.
    ExcludeFromPackage = @('installer', 'INSTALL.txt')
    ReleaseAssetPattern = 'LeanSlides-v{0}-windows-x64.zip'
    SampleFile = 'tests\hosts\fixtures\smoke.pptx'
    # Used until the repository variables hold the Partner Center values.
    PlaceholderIdentityName = 'Placeholder.LeanSlides'
    PlaceholderPublisher = 'CN=PLACEHOLDER-SET-MSIX_PUBLISHER'
    DefaultPublisherDisplayName = 'Lean Apps Studio'
}

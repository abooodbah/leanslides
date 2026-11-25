[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',

    [switch]$Clean,
    [switch]$SkipTests
)

# Builds LeanSlides for Windows x64 with scripts\dev-build.cmd (MSVC and
# Ninja), runs CTest, and stages the portable payload in dist\:
#   LeanSlides.exe, WebView2Loader.dll, assets\, tools\leanslides-inspect.exe,
#   installer\install.ps1, installer\uninstall.ps1, README.md, LICENSE,
#   THIRD_PARTY_NOTICES.md
# The reader assets are plain files with no build step, so assets\ is copied
# as it is.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildDirectory = Join-Path $repoRoot ('build\' + $Configuration)
$distDirectory = Join-Path $repoRoot 'dist'

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$ArgumentList
    )
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $($LASTEXITCODE): $FilePath $($ArgumentList -join ' ')"
    }
}

function Remove-RepositoryDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $resolved = [System.IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($repoRoot + [System.IO.Path]::DirectorySeparatorChar,
            [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a path outside the repository: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

function Copy-RequiredFile {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
        throw "Required file was not found: $Source"
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

if ($Clean) {
    Remove-RepositoryDirectory -Path $buildDirectory
}

& (Join-Path $PSScriptRoot 'Get-WebView2Sdk.ps1') | Out-Null
$devBuild = Join-Path $PSScriptRoot 'dev-build.cmd'
$testArguments = if ($SkipTests) { @() } else { @('-DLEANSLIDES_ENABLE_GUI_TESTS=ON') }
Invoke-CheckedCommand -FilePath $env:ComSpec -ArgumentList (@('/c', $devBuild, $Configuration) + $testArguments)
if (-not $SkipTests) {
    Invoke-CheckedCommand -FilePath 'ctest' -ArgumentList @('--test-dir', $buildDirectory, '--output-on-failure')
}

# Recreate dist on every successful build so stale files never reach a package.
Remove-RepositoryDirectory -Path $distDirectory
New-Item -ItemType Directory -Path $distDirectory | Out-Null
Copy-RequiredFile -Source (Join-Path $buildDirectory 'LeanSlides.exe') `
    -Destination (Join-Path $distDirectory 'LeanSlides.exe')
Copy-RequiredFile -Source (Join-Path $buildDirectory 'WebView2Loader.dll') `
    -Destination (Join-Path $distDirectory 'WebView2Loader.dll')
Copy-RequiredFile -Source (Join-Path $buildDirectory 'tools\inspect\leanslides-inspect.exe') `
    -Destination (Join-Path $distDirectory 'tools\leanslides-inspect.exe')
$assetSource = Join-Path $repoRoot 'assets'
$assetPrefix = $assetSource + [System.IO.Path]::DirectorySeparatorChar
foreach ($asset in Get-ChildItem -LiteralPath $assetSource -Recurse -File) {
    Copy-RequiredFile -Source $asset.FullName `
        -Destination (Join-Path $distDirectory ('assets\' + $asset.FullName.Substring($assetPrefix.Length)))
}

# Distribution documents are required: a release carries its terms and the
# notices for bundled dependencies.
foreach ($document in @('README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md')) {
    Copy-RequiredFile -Source (Join-Path $repoRoot $document) -Destination (Join-Path $distDirectory $document)
}
# The optional per-user installer sits beside the executable as in the ZIP,
# so dist\ can be installed and tested as it is.
foreach ($installerName in @('install.ps1', 'uninstall.ps1')) {
    Copy-RequiredFile -Source (Join-Path $repoRoot ('installer\' + $installerName)) `
        -Destination (Join-Path $distDirectory ('installer\' + $installerName))
}

$stagedFiles = @(Get-ChildItem -LiteralPath $distDirectory -Recurse -File)
$stagedBytes = ($stagedFiles | Measure-Object -Property Length -Sum).Sum
Write-Host ('LeanSlides {0} x64 staged {1} files ({2:N2} MiB) in {3}' -f
    $Configuration, $stagedFiles.Count, ($stagedBytes / 1MB), $distDirectory)

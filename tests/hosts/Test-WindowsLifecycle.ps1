[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ZipPath
)

# The Windows release ZIP through its whole life on a clean runner account:
# extract, smoke test from the extracted folder, install.ps1, the Open With
# and Default Apps registration, a smoke test and a real launch of the
# installed copy (the launch creates the WebView2 folder), uninstall.ps1, and
# then the registry and files exactly as they were before. It changes HKCU and
# %LOCALAPPDATA%, so run it on a CI runner, not on a desktop you use.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$testsRoot = Split-Path -Parent $PSScriptRoot
$extensions = @('.pptx', '.ppsx', '.potx', '.pptm', '.ppsm', '.potm')
$fixture = Join-Path $testsRoot 'hosts\fixtures\smoke.pptx'
$local = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
$installDir = Join-Path $local 'Programs\LeanSlides'
$dataDir = Join-Path $local 'LeanSlides'
$shortcut = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::StartMenu)) 'Programs\LeanSlides.lnk'

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Write-Pass([string]$Message) { Write-Host ('PASS ' + $Message) }

# Waits until no msedgewebview2 process of this user is left from an earlier
# step, so the WebView2 folder can be removed and a first launch is clean.
function Wait-WebView2Idle([int]$TimeoutSeconds = 30) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not (Get-Process -Name msedgewebview2 -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 250
    }
}

function Invoke-Smoke([string]$ExePath) {
    $process = Start-Process -FilePath $ExePath -ArgumentList @('--smoke-test', ('"{0}"' -f $fixture)) `
        -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit(60000)) {
        $process.Kill()
        throw "The smoke test of $ExePath did not finish in 60 seconds."
    }
    return $process.ExitCode
}

function Get-RegistryValue([string]$SubKey, [string]$Name) {
    $handle = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($SubKey, $false)
    if ($null -eq $handle) { return $null }
    try { return $handle.GetValue($Name) } finally { $handle.Dispose() }
}

function Test-RegistryValueName([string]$SubKey, [string]$Name) {
    $handle = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($SubKey, $false)
    if ($null -eq $handle) { return $false }
    try { return @($handle.GetValueNames()) -contains $Name } finally { $handle.Dispose() }
}

# Everything LeanSlides may touch, as text, so before and after compare exactly.
function Get-State {
    $lines = [System.Collections.Generic.List[string]]::new()
    $keys = @('Software\LeanSlides', 'Software\Classes\LeanSlides.Presentation',
        'Software\Classes\Applications\LeanSlides.exe', 'Software\RegisteredApplications',
        'Software\Microsoft\Windows\CurrentVersion\App Paths\LeanSlides.exe',
        'Software\Microsoft\Windows\CurrentVersion\Uninstall\LeanSlides')
    foreach ($extension in $extensions) {
        $keys += "Software\Classes\$extension"
        $keys += "Software\Classes\$extension\OpenWithProgids"
    }
    foreach ($key in $keys) {
        $handle = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($key, $false)
        if ($null -eq $handle) { $lines.Add("HKCU\$key (absent)"); continue }
        try {
            foreach ($name in ($handle.GetValueNames() | Sort-Object)) {
                # RegisteredApplications is shared: Windows registers other
                # apps there while the test runs. Only LeanSlides's value is
                # LeanSlides's to add and remove.
                if ($key -eq 'Software\RegisteredApplications' -and $name -ne 'LeanSlides') { continue }
                $lines.Add(('HKCU\{0} [{1}] = {2}' -f $key, $name, $handle.GetValue($name)))
            }
            $lines.Add(('HKCU\{0} subkeys: {1}' -f $key, (($handle.GetSubKeyNames() | Sort-Object) -join ',')))
        } finally { $handle.Dispose() }
    }
    foreach ($path in @($installDir, $dataDir, $shortcut)) {
        $lines.Add(('{0}: {1}' -f $path, (Test-Path -LiteralPath $path)))
    }
    $lines
}

# Earlier steps of the same CI job run the build tree, which writes settings
# and a WebView2 folder. This test starts from a clean account, so those
# traces go first; the uninstall must then leave the account exactly so.
Wait-WebView2Idle
foreach ($trace in @('HKCU:\Software\LeanSlides', $dataDir)) {
    if (Test-Path -LiteralPath $trace) {
        Write-Host "Removing a trace of an earlier run: $trace"
        Remove-Item -LiteralPath $trace -Recurse -Force
    }
}
$before = @(Get-State)
Assert-True (-not (Test-Path -LiteralPath $installDir)) "A previous install exists at $installDir."

$extract = Join-Path ([System.IO.Path]::GetTempPath()) ('leanslides-zip-' + [Guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $ZipPath -DestinationPath $extract
$extractedExe = @(Get-ChildItem -LiteralPath $extract -Recurse -Filter LeanSlides.exe)[0].FullName
$payload = Split-Path -Parent $extractedExe
Assert-True ((Invoke-Smoke $extractedExe) -eq 0) 'The smoke test from the extracted ZIP failed.'
Write-Pass 'the extracted ZIP shows the smoke deck'

$installer = Join-Path $payload 'installer\install.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -SourceDirectory $payload -Quiet | Out-Host
Assert-True ($LASTEXITCODE -eq 0) 'install.ps1 failed.'
$installedExe = Join-Path $installDir 'LeanSlides.exe'
Assert-True (Test-Path -LiteralPath $installedExe) 'LeanSlides.exe was not installed.'
Assert-True (Test-Path -LiteralPath (Join-Path $installDir 'assets\reader.html')) 'The reader assets were not installed.'
Assert-True (Test-Path -LiteralPath $shortcut) 'The Start menu shortcut is missing.'
foreach ($extension in $extensions) {
    Assert-True (Test-RegistryValueName "Software\Classes\$extension\OpenWithProgids" 'LeanSlides.Presentation') `
        "Open With is missing for $extension."
    Assert-True ((Get-RegistryValue 'Software\LeanSlides\Capabilities\FileAssociations' $extension) -eq 'LeanSlides.Presentation') `
        "The Default Apps capability is missing for $extension."
}
Assert-True (Test-RegistryValueName 'Software\RegisteredApplications' 'LeanSlides') 'LeanSlides is not in RegisteredApplications.'
Write-Pass 'install.ps1 registered Open With and Default Apps for every extension'

Assert-True ((Invoke-Smoke $installedExe) -eq 0) 'The smoke test from the installed copy failed.'
# A normal launch creates the WebView2 user-data folder that uninstall removes.
$launch = Start-Process -FilePath $installedExe -ArgumentList @('--exit-after-render=1000', ('"{0}"' -f $fixture)) -PassThru
if (-not $launch.WaitForExit(60000)) {
    $launch.Kill()
    throw 'The installed copy did not exit after rendering.'
}
Assert-True ($launch.ExitCode -eq 0) ('The installed copy exited with {0}.' -f $launch.ExitCode)
Assert-True (Test-Path -LiteralPath (Join-Path $dataDir 'WebView2')) 'A launch did not create the WebView2 folder.'
Wait-WebView2Idle
Write-Pass 'the installed copy shows the smoke deck and runs'

$uninstaller = Join-Path $installDir 'uninstall.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $uninstaller -Quiet | Out-Host
Assert-True ($LASTEXITCODE -eq 0) 'uninstall.ps1 failed.'
$after = @(Get-State)
$difference = @(Compare-Object -ReferenceObject $before -DifferenceObject $after)
if ($difference.Count -gt 0) {
    $difference | Format-Table -AutoSize | Out-String | Write-Host
    throw 'The registry or files differ from the state before the install.'
}
Write-Pass 'uninstall.ps1 restored the registry and removed every file, including the WebView2 folder'
Remove-Item -LiteralPath $extract -Recurse -Force

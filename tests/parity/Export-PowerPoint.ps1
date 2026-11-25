# Exports PowerPoint's own rendering of the public corpus: one PNG per slide and
# a powerpoint.json per deck with every shape's box and text-line bounds. The
# reader's output is scored against these files by compare.mjs.
#
#   powershell -File tests/parity/Export-PowerPoint.ps1 [-Only "poi/sample.pptx,poi/shapes.pptx"]
#
# Output goes to tests/parity/cache/powerpoint/<name>/ (gitignored). Decks
# already exported are skipped, so a stopped run can be resumed.
#
# Safety: PowerPoint is a single-instance COM server, so this refuses to start
# while any PowerPoint window is open (automation would attach to it). Each
# batch runs in a worker process; when a deck stalls for -StallSeconds, the
# worker and only the PowerPoint process started for automation (command line
# containing -Embedding, started after this run began) are stopped, the deck is
# recorded as failed, and the run continues with the next deck.
param(
    [string] $Only = '',   # comma-separated corpus names; empty means every deck
    [int] $StallSeconds = 120,
    [int] $Width = 1280
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $here '..\..')
$cache = Join-Path $repo 'tests\corpus\cache'
$out = Join-Path $here 'cache\powerpoint'
New-Item -ItemType Directory -Force -Path $out | Out-Null

if (Get-Process POWERPNT -ErrorAction SilentlyContinue) {
    throw 'PowerPoint is running. Close it first; automation would attach to the open instance.'
}

$manifest = Get-Content -Raw -LiteralPath (Join-Path $repo 'tests\corpus\manifest.json') | ConvertFrom-Json
$onlyNames = @($Only.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$decks = @($manifest.files | Where-Object { $_.powerpoint -and ($onlyNames.Count -eq 0 -or $onlyNames -contains $_.name) })
$runStart = Get-Date

function Stop-AutomationPowerPoint {
    Get-CimInstance Win32_Process -Filter "Name='POWERPNT.EXE'" | Where-Object {
        $_.CommandLine -match '-Embedding' -and $_.CreationDate -ge $runStart
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

$pending = @($decks | Where-Object {
    -not (Test-Path (Join-Path $out (($_.name -replace '[\\/:]', '__')) | Join-Path -ChildPath 'powerpoint.json'))
})
Write-Host "$($decks.Count) decks, $($pending.Count) to export"
while ($pending.Count -gt 0) {
    $list = Join-Path $out 'pending.txt'
    $heartbeat = Join-Path $out 'heartbeat.txt'
    ($pending | ForEach-Object { "$($_.name)`t$(Join-Path $cache $_.name)" }) | Set-Content -LiteralPath $list -Encoding UTF8
    Remove-Item -LiteralPath $heartbeat -ErrorAction SilentlyContinue
    $worker = Start-Process powershell.exe -PassThru -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $here 'powerpoint-worker.ps1'),
        '-ListFile', $list, '-OutDir', $out, '-Heartbeat', $heartbeat, '-Width', $Width)
    $stalled = $null
    while (-not $worker.HasExited) {
        Start-Sleep -Seconds 2
        if (Test-Path $heartbeat) {
            $age = ((Get-Date) - (Get-Item $heartbeat).LastWriteTime).TotalSeconds
            if ($age -gt $StallSeconds) {
                $stalled = (Get-Content -LiteralPath $heartbeat -Raw).Split("`t")[0]
                Stop-Process -Id $worker.Id -Force -ErrorAction SilentlyContinue
                Stop-AutomationPowerPoint
                break
            }
        }
    }
    if ($stalled) {
        Write-Host "stalled: $stalled"
        $dir = Join-Path $out ($stalled -replace '[\\/:]', '__')
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        (@{ name = $stalled; ok = $false; error = "stalled for $StallSeconds s" } | ConvertTo-Json -Compress) |
            Set-Content -LiteralPath (Join-Path $dir 'powerpoint.json') -Encoding UTF8
        Start-Sleep -Seconds 3
    }
    $pending = @($pending | Where-Object {
        -not (Test-Path (Join-Path (Join-Path $out ($_.name -replace '[\\/:]', '__')) 'powerpoint.json'))
    })
    if (-not $stalled -and $pending.Count -gt 0) {
        throw "worker exited with $($pending.Count) decks left; first: $($pending[0].name)"
    }
}
# Quit() can leave the automation process running for a while; wait, then stop it.
for ($i = 0; $i -lt 10 -and (Get-Process POWERPNT -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 1 }
Stop-AutomationPowerPoint
Remove-Item -LiteralPath (Join-Path $out 'pending.txt'), (Join-Path $out 'heartbeat.txt') -ErrorAction SilentlyContinue
$results = Get-ChildItem -LiteralPath $out -Directory | ForEach-Object {
    Get-Content -Raw (Join-Path $_.FullName 'powerpoint.json') | ConvertFrom-Json
}
$ok = @($results | Where-Object ok).Count
Write-Host "exported $ok of $($results.Count) decks; failed: $(@($results | Where-Object { -not $_.ok } | ForEach-Object name) -join ', ')"

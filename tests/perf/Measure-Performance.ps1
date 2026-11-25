[CmdletBinding()]
param(
    [string]$ExePath,
    [ValidateRange(1, 50)][int]$Runs = 10,
    [string]$OutputDirectory = 'artifacts/perf-windows',
    [ValidateRange(1, 60)][int]$SettleSeconds = 12
)

# Start-up time and memory of LeanSlides on Windows, for the README and the
# release notes. Four cases: the window with no deck, a small deck (the
# 3-slide smoke fixture), a typical deck (poi/alterman_security.pptx from the
# public corpus, 23 slides, 0.9 MB) and a large deck (240 slides with a
# 1280 x 720 picture each, 48 MB, written by make-perf-deck.py). A fifth case
# opens the large deck and goes through all 240 slides with Page Down (sent
# to the page over DevTools by visit-slides.mjs) before memory is sampled, to
# show whether memory grows with the slides seen. A sixth goes through them
# five times (three launches at most, as each takes a few minutes), to show
# where it levels off.
#
# Method, after LeanDoc's Measure-LeanDocPerf.ps1: before each launch, wait
# until no WebView2 process still uses LeanSlides' profile folder. Launch with
# --trace-timing and read the "window-visible" and "rendered" lines (both in
# milliseconds since the process was created). Then sample the whole process
# tree (LeanSlides.exe and every WebView2 process it started) every 500 ms
# until three samples agree within 1.5 MiB of private bytes (at least 3 s, at
# most -SettleSeconds). Recorded per launch:
#   - settled private bytes of the tree;
#   - the highest private-bytes total seen while settling (and, in the walk
#     cases, while going through the slides);
#   - the sum of each process's own peak working set (an upper bound on the
#     tree's peak, since the processes need not peak at the same moment).
# Each figure is the median of -Runs launches. Only processes in the tree of
# the launched LeanSlides are closed; nothing is stopped by name.
#
#   powershell -File tests/perf/Measure-Performance.ps1 [-ExePath build\Release\LeanSlides.exe] [-Runs 10]

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if ([string]::IsNullOrWhiteSpace($ExePath)) { $ExePath = Join-Path $repoRoot 'build\Release\LeanSlides.exe' }
$ExePath = [System.IO.Path]::GetFullPath($ExePath)
if (-not (Test-Path -LiteralPath $ExePath)) { throw "LeanSlides.exe not found: $ExePath" }
$out = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
New-Item -ItemType Directory -Path $out -Force | Out-Null

$small = Join-Path $repoRoot 'tests\hosts\fixtures\smoke.pptx'
$typical = Join-Path $repoRoot 'tests\corpus\cache\poi\alterman_security.pptx'
$large = Join-Path $out 'large.pptx'
if (-not (Test-Path -LiteralPath $typical)) { throw "Fetch the corpus first (node tests/corpus/fetch-corpus.mjs): $typical" }
if (-not (Test-Path -LiteralPath $large)) {
    & python -I (Join-Path $PSScriptRoot 'make-perf-deck.py') $out
    if ($LASTEXITCODE -ne 0) { throw 'make-perf-deck.py failed.' }
}

function Get-TreeIds([int]$RootId, [datetime]$RootStart) {
    # Parent links from one snapshot. A child must have started after the
    # root, so a reused process id never joins the tree.
    $all = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate)
    $children = @{}
    foreach ($p in $all) {
        if ($p.CreationDate -lt $RootStart.AddSeconds(-1)) { continue }
        $key = [int]$p.ParentProcessId
        if (-not $children.ContainsKey($key)) { $children[$key] = [System.Collections.Generic.List[int]]::new() }
        $children[$key].Add([int]$p.ProcessId)
    }
    $ids = [System.Collections.Generic.List[int]]::new()
    $queue = [System.Collections.Generic.Queue[int]]::new()
    $queue.Enqueue($RootId)
    while ($queue.Count -gt 0) {
        $id = $queue.Dequeue()
        $ids.Add($id)
        if ($children.ContainsKey($id)) { foreach ($c in $children[$id]) { if (-not $ids.Contains($c)) { $queue.Enqueue($c) } } }
    }
    @($ids)
}

function Get-TreeSample([int]$RootId, [datetime]$RootStart) {
    $private = [int64]0; $peak = [int64]0; $count = 0
    foreach ($id in (Get-TreeIds $RootId $RootStart)) {
        $p = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($null -eq $p) { continue }
        try {
            $p.Refresh()
            $private += [int64]$p.PrivateMemorySize64
            $peak += [int64]$p.PeakWorkingSet64
            $count += 1
        } catch { }
    }
    [pscustomobject]@{ PrivateMiB = $private / 1MB; PeakWorkingSetMiB = $peak / 1MB; Processes = $count }
}

function Wait-ProfileIdle([int]$TimeoutSeconds = 30) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $busy = @(Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" |
            Where-Object { [string]$_.CommandLine -match '(?i)\\LeanSlides\\WebView2' })
        if ($busy.Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    $false
}

function Stop-Tree([System.Diagnostics.Process]$Root, [datetime]$RootStart) {
    $ids = @(Get-TreeIds $Root.Id $RootStart)
    try {
        $Root.Refresh()
        if (-not $Root.HasExited -and $Root.MainWindowHandle -ne [IntPtr]::Zero) {
            [void]$Root.CloseMainWindow()
            [void]$Root.WaitForExit(3000)
        }
    } catch { }
    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    do {
        $left = @($ids | Where-Object { $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue) })
        if ($left.Count -gt 0) { Start-Sleep -Milliseconds 100 }
    } while ($left.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)
    foreach ($id in $left) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
}

# The trace goes to a pipe. LeanSlides writes each line with a blocking
# WriteFile, so the pipe must be read for the whole launch, not only until
# the line this script waits for: once its buffer is full, the next trace
# line would stop the app (going through 240 slides fills it at about the
# 34th). Lines are read on a .NET thread into a queue.
Add-Type -TypeDefinition @'
using System.Collections.Concurrent;
using System.Diagnostics;
public static class LeanSlidesTraceReader {
    public static ConcurrentQueue<string> Attach(Process process) {
        var lines = new ConcurrentQueue<string>();
        process.OutputDataReceived += (sender, e) => { if (e.Data != null) lines.Enqueue(e.Data); };
        process.BeginOutputReadLine();
        return lines;
    }
}
'@

function Measure-Launch([string]$Deck, [switch]$VisitAll, [int]$Walks = 1) {
    [void](Wait-ProfileIdle)
    $info = [System.Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $ExePath
    $info.Arguments = if ($Deck) { '--trace-timing -- "{0}"' -f $Deck } else { '--trace-timing' }
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.WorkingDirectory = Split-Path -Parent $ExePath
    $port = 9351
    if ($VisitAll) { $info.EnvironmentVariables['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = "--remote-debugging-port=$port" }
    $process = [System.Diagnostics.Process]::Start($info)
    $start = $process.StartTime
    $events = @{}
    $trace = [LeanSlidesTraceReader]::Attach($process)
    try {
        $target = if ($Deck) { 'rendered' } else { 'webview-ready' }
        $deadline = [DateTime]::UtcNow.AddSeconds(60)
        while (-not $events.ContainsKey($target)) {
            if ([DateTime]::UtcNow -gt $deadline) { throw "no $target within 60 s" }
            $line = $null
            if (-not $trace.TryDequeue([ref]$line)) {
                if ($process.HasExited) { throw "LeanSlides exited before $target" }
                Start-Sleep -Milliseconds 20
                continue
            }
            if ($line -match '^LEANSLIDES_TIMING (\S+) (\d+)') {
                if (-not $events.ContainsKey($Matches[1])) { $events[$Matches[1]] = [int]$Matches[2] }
            }
        }
        $visit = $null
        $highest = 0.0
        if ($VisitAll) {
            # Every slide once, with Page Down sent to the page over DevTools.
            # Memory is sampled while it runs, so "highest" covers the walk;
            # the settled sample below is taken after the last slide.
            $node = [System.Diagnostics.ProcessStartInfo]::new()
            $node.FileName = (Get-Command node).Source
            $node.Arguments = '"{0}" {1} {2}' -f (Join-Path $PSScriptRoot 'visit-slides.mjs'), $port, $Walks
            $node.UseShellExecute = $false
            $node.RedirectStandardOutput = $true
            $walker = [System.Diagnostics.Process]::Start($node)
            $walkerOutput = $walker.StandardOutput.ReadToEndAsync()
            $walkDeadline = [DateTime]::UtcNow.AddMinutes(10 * $Walks)
            while (-not $walker.WaitForExit(500)) {
                $highest = [Math]::Max($highest, (Get-TreeSample $process.Id $start).PrivateMiB)
                if ([DateTime]::UtcNow -gt $walkDeadline) { $walker.Kill(); throw 'visit-slides.mjs took too long' }
            }
            if ($walker.ExitCode -ne 0) { throw 'visit-slides.mjs failed' }
            $visit = @($walkerOutput.Result.Trim() -split "`n")[-1] | ConvertFrom-Json
        }
        $clock = [System.Diagnostics.Stopwatch]::StartNew()
        $samples = [System.Collections.Generic.List[object]]::new()
        while ($true) {
            $sample = Get-TreeSample $process.Id $start
            $samples.Add($sample)
            $highest = [Math]::Max($highest, $sample.PrivateMiB)
            $recent = @($samples | Select-Object -Last 3)
            if ($clock.Elapsed.TotalSeconds -ge 3 -and $recent.Count -eq 3) {
                $values = @($recent | ForEach-Object { $_.PrivateMiB })
                if ((($values | Measure-Object -Maximum).Maximum - ($values | Measure-Object -Minimum).Minimum) -le 1.5) { break }
            }
            if ($clock.Elapsed.TotalSeconds -ge $SettleSeconds) { break }
            Start-Sleep -Milliseconds 500
        }
        [pscustomobject]@{
            WindowVisibleMs = $events['window-visible']
            ReadyMs = $events[$target]
            SettledPrivateMiB = [Math]::Round($sample.PrivateMiB, 1)
            HighestPrivateMiB = [Math]::Round($highest, 1)
            PeakWorkingSetSumMiB = [Math]::Round($sample.PeakWorkingSetMiB, 1)
            Processes = $sample.Processes
            Settled = $clock.Elapsed.TotalSeconds -lt $SettleSeconds
            VisitMs = if ($visit) { $visit.ms } else { $null }
        }
    } finally {
        Stop-Tree $process $start
    }
}

function Get-Median([double[]]$Values) {
    $sorted = @($Values | Sort-Object)
    if ($sorted.Count -eq 0) { return $null }
    $middle = [int][Math]::Floor($sorted.Count / 2)
    if ($sorted.Count % 2 -eq 1) { return [Math]::Round($sorted[$middle], 1) }
    [Math]::Round(($sorted[$middle - 1] + $sorted[$middle]) / 2, 1)
}

$running = @(Get-CimInstance Win32_Process -Filter "Name = 'LeanSlides.exe'" | Where-Object { $_.ExecutablePath -ieq $ExePath })
if ($running.Count -gt 0) { throw "This LeanSlides.exe is already running (pid $($running[0].ProcessId)); a launch would join it. Close it first." }

$cpu = @(Get-CimInstance Win32_Processor)[0].Name.Trim()
$os = Get-CimInstance Win32_OperatingSystem
$memoryGiB = [Math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$runtime = $null
foreach ($key in @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')) {
    $value = Get-ItemProperty -LiteralPath $key -Name pv -ErrorAction SilentlyContinue
    if ($null -ne $value -and $value.pv) { $runtime = $value.pv; break }
}
$machine = [ordered]@{
    processor = $cpu; logicalProcessors = [Environment]::ProcessorCount; memoryGiB = $memoryGiB
    os = '{0} {1} (build {2})' -f $os.Caption, $os.Version, $os.BuildNumber; webView2 = $runtime
}
Write-Host ('LeanSlides on {0}, {1} GiB, {2}, WebView2 {3}' -f $cpu, $memoryGiB, $machine.os, $runtime)

$cases = @(
    [ordered]@{ name = 'no deck'; deck = $null; slides = 0 },
    [ordered]@{ name = 'small'; deck = $small; slides = 3 },
    [ordered]@{ name = 'typical'; deck = $typical; slides = 23 },
    [ordered]@{ name = 'large'; deck = $large; slides = 240 },
    [ordered]@{ name = 'large, after every slide'; deck = $large; slides = 240; visitAll = $true },
    [ordered]@{ name = 'large, after five walks'; deck = $large; slides = 240; visitAll = $true; walks = 5; runs = 3 })
$results = @()
foreach ($case in $cases) {
    $records = [System.Collections.Generic.List[object]]::new()
    $failed = 0
    $caseRuns = if ($case['runs']) { [Math]::Min($Runs, [int]$case['runs']) } else { $Runs }
    while ($records.Count -lt $caseRuns -and $failed -lt 5) {
        try {
            $record = Measure-Launch $case.deck -VisitAll:([bool]$case['visitAll']) -Walks $(if ($case['walks']) { [int]$case['walks'] } else { 1 })
            $records.Add($record)
            Write-Host ('  {0} #{1}: visible {2} ms, ready {3} ms, settled {4} MiB, highest {5} MiB, peak sum {6} MiB, {7} processes' -f
                $case.name, $records.Count, $record.WindowVisibleMs, $record.ReadyMs, $record.SettledPrivateMiB,
                $record.HighestPrivateMiB, $record.PeakWorkingSetSumMiB, $record.Processes)
        } catch {
            $failed += 1
            Write-Warning ('{0}: {1}' -f $case.name, $_.Exception.Message)
        }
    }
    $bytes = if ($case.deck) { (Get-Item -LiteralPath $case.deck).Length } else { 0 }
    $results += [ordered]@{
        name = $case.name; deck = if ($case.deck) { Split-Path -Leaf $case.deck } else { $null }; slides = $case.slides
        bytes = $bytes; runs = $records.Count; failed = $failed
        windowVisibleMs = Get-Median @($records | ForEach-Object { $_.WindowVisibleMs })
        readyMs = Get-Median @($records | ForEach-Object { $_.ReadyMs })
        readyEvent = if ($case.deck) { 'rendered' } else { 'webview-ready' }
        settledPrivateMiB = Get-Median @($records | ForEach-Object { $_.SettledPrivateMiB })
        highestPrivateMiB = Get-Median @($records | ForEach-Object { $_.HighestPrivateMiB })
        peakWorkingSetSumMiB = Get-Median @($records | ForEach-Object { $_.PeakWorkingSetSumMiB })
        unsettledRuns = @($records | Where-Object { -not $_.Settled }).Count
        visitAllMs = Get-Median @($records | Where-Object { $null -ne $_.VisitMs } | ForEach-Object { $_.VisitMs })
        launches = @($records)
    }
}

$report = [ordered]@{ machine = $machine; exe = $ExePath; runsPerCase = $Runs; cases = $results }
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $out 'perf-windows.json') -Encoding utf8
$lines = @('| Case | Slides | Size | Window visible | First slide drawn (no deck: page ready) | Settled memory | Highest | Peak working sets (sum) |',
           '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
foreach ($r in $results) {
    $size = if ($r.bytes) { '{0:N1} MB' -f ($r.bytes / 1MB) } else { '' }
    $lines += '| {0} | {1} | {2} | {3} ms | {4} ms | {5} MiB | {6} MiB | {7} MiB |' -f $r.name, $r.slides, $size,
        $r.windowVisibleMs, $r.readyMs, $r.settledPrivateMiB, $r.highestPrivateMiB, $r.peakWorkingSetSumMiB
}
$lines | Set-Content -LiteralPath (Join-Path $out 'perf-windows.md') -Encoding utf8
$lines | Write-Host

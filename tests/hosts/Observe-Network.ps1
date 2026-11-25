[CmdletBinding()]
param(
    [string]$ExePath,
    [string]$OutputDirectory = 'artifacts/network-windows',
    [ValidateRange(2000, 60000)][int]$WatchMilliseconds = 8000,
    # More browser arguments for an experiment, added after the net log ones.
    [string]$ExtraBrowserArguments = ''
)

# What LeanSlides and its WebView2 processes do on the network while a deck is
# open. Each case launches LeanSlides with one deck (or none) and watches for
# -WatchMilliseconds, then closes the window. Three observers:
#
#   1. A TCP listener on 127.0.0.1:47913. Every outside reference in
#      tests/hosts/fixtures/network.pptm (linked pictures, a linked picture
#      fill, a linked video, a linked OLE object, a linked background, and
#      hyperlinks) points there, so any fetch of them arrives as a connection.
#   2. The TCP connections and UDP endpoints of the whole process tree, read
#      from the IP helper tables (NetTables.cs) on a separate thread every
#      50 ms plus the time a read takes. A connection shorter than one
#      interval can be missed; the largest gap between samples is recorded.
#   3. Chromium's own network log (--log-net-log, passed through
#      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS), from which every URL the page
#      or the runtime requested is listed.
#
# A case fails if the listener gets a connection, if LeanSlides.exe itself
# has any TCP connection or UDP endpoint, or if the net log names a URL
# outside https://app.leanslides.invalid/. Connections of the WebView2 runtime
# processes are recorded by process kind, remote address, and the time they
# were first seen, and reported, not failed: the runtime can contact Microsoft
# services on its own, and the net log does not show those connections.
#
#   powershell -File tests/hosts/Observe-Network.ps1 [-ExePath build\Release\LeanSlides.exe]

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if ([string]::IsNullOrWhiteSpace($ExePath)) { $ExePath = Join-Path $repoRoot 'build\Release\LeanSlides.exe' }
$ExePath = [System.IO.Path]::GetFullPath($ExePath)
if (-not (Test-Path -LiteralPath $ExePath)) { throw "LeanSlides.exe not found: $ExePath" }
$out = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputDirectory))
New-Item -ItemType Directory -Path $out -Force | Out-Null

$cases = @(
    [ordered]@{ name = 'no deck'; deck = $null },
    [ordered]@{ name = 'smoke'; deck = Join-Path $repoRoot 'tests\hosts\fixtures\smoke.pptx' },
    [ordered]@{ name = 'network'; deck = Join-Path $repoRoot 'tests\hosts\fixtures\network.pptm' })
$typical = Join-Path $repoRoot 'tests\corpus\cache\poi\alterman_security.pptx'
if (Test-Path -LiteralPath $typical) { $cases += [ordered]@{ name = 'typical'; deck = $typical } }

function Get-TreeIds([int]$RootId, [datetime]$RootStart) {
    $all = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate, Name)
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
            [void]$Root.WaitForExit(5000)
        }
    } catch { }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        $left = @($ids | Where-Object { $null -ne (Get-Process -Id $_ -ErrorAction SilentlyContinue) })
        if ($left.Count -gt 0) { Start-Sleep -Milliseconds 100 }
    } while ($left.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)
    foreach ($id in $left) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
}

function Test-Loopback([string]$Address) {
    $Address -in @('127.0.0.1', '::1', '0.0.0.0', '::', '*') -or $Address.StartsWith('127.')
}

$running = @(Get-CimInstance Win32_Process -Filter "Name = 'LeanSlides.exe'" | Where-Object { $_.ExecutablePath -ieq $ExePath })
if ($running.Count -gt 0) { throw "This LeanSlides.exe is already running (pid $($running[0].ProcessId)); a launch would join it. Close it first." }

Add-Type -Path (Join-Path $PSScriptRoot 'NetTables.cs')
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 47913)
$listener.Start()
$results = @()
# One accept stays pending across all cases. A new one per case would leave
# the previous one waiting, and it would take the next connection unseen.
$pendingAccept = $listener.AcceptTcpClientAsync()
try {
    foreach ($case in $cases) {
        [void](Wait-ProfileIdle)
        $netLog = Join-Path $out ('netlog-{0}.json' -f ($case.name -replace '\W', '-'))
        Remove-Item -LiteralPath $netLog -ErrorAction SilentlyContinue
        $info = [System.Diagnostics.ProcessStartInfo]::new()
        $info.FileName = $ExePath
        $info.Arguments = if ($case.deck) { '-- "{0}"' -f $case.deck } else { '' }
        $info.UseShellExecute = $false
        $info.WorkingDirectory = Split-Path -Parent $ExePath
        $info.EnvironmentVariables['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = ('--log-net-log="{0}" --net-log-capture-mode=Default {1}' -f $netLog, $ExtraBrowserArguments).Trim()
        # The connection tables are sampled every 50 ms on their own thread
        # from just before the launch until every process of the tree is gone.
        [LeanSlidesNetTables]::Start(50)
        $process = [System.Diagnostics.Process]::Start($info)
        $start = $process.StartTime
        $seen = @{}
        $names = @{}
        $allIds = [System.Collections.Generic.HashSet[int]]::new()
        $listenerHits = [System.Collections.Generic.List[string]]::new()
        $browserCommandLine = $null
        try {
            $deadline = [DateTime]::UtcNow.AddMilliseconds($WatchMilliseconds)
            while ([DateTime]::UtcNow -lt $deadline) {
                while ($pendingAccept.IsCompleted) {
                    $client = $pendingAccept.Result
                    $listenerHits.Add(('{0} at {1:o}' -f $client.Client.RemoteEndPoint, [DateTime]::UtcNow))
                    $client.Close()
                    $pendingAccept = $listener.AcceptTcpClientAsync()
                }
                # Which processes belong to the tree, and what kind each
                # WebView2 process is: browser (no --type=), renderer,
                # gpu-process, or utility with its sub-type.
                foreach ($id in @(Get-TreeIds $process.Id $start)) { [void]$allIds.Add($id) }
                foreach ($p in @(Get-CimInstance Win32_Process -Property ProcessId, Name, CommandLine |
                        Where-Object { $allIds.Contains([int]$_.ProcessId) -and -not $names.ContainsKey([int]$_.ProcessId) })) {
                    $line = [string]$p.CommandLine
                    $kind = if ($p.Name -ne 'msedgewebview2.exe') { '' }
                        elseif ($line -match '--type=(\S+)') { $Matches[1] + $(if ($line -match '--utility-sub-type=(\S+)') { ' ' + $Matches[1] } else { '' }) }
                        else { 'browser' }
                    $names[[int]$p.ProcessId] = if ($kind) { '{0} ({1})' -f $p.Name, $kind } else { [string]$p.Name }
                    if ($kind -eq 'browser' -and $null -eq $browserCommandLine) { $browserCommandLine = $line }
                }
                Start-Sleep -Milliseconds 100
            }
        } finally {
            # What ran, so a failure on a machine without a browser process
            # (for example a runner where WebView2 did not start) says why.
            $process.Refresh()
            $exitedEarly = if ($process.HasExited) { 'exited with {0}' -f $process.ExitCode } else { 'running' }
            $treeText = (@($allIds) | ForEach-Object { if ($names.ContainsKey($_)) { $names[$_] } else { "pid $_" } }) -join ', '
            Stop-Tree $process $start
            $rows = [LeanSlidesNetTables]::Stop()
        }
        $samples = [int]($rows[$rows.Count - 2].Split('|')[1])
        $largestGap = [int]($rows[$rows.Count - 1].Split('|')[1])
        foreach ($row in @($rows | Select-Object -First ($rows.Count - 2))) {
            $f = $row.Split('|')
            $owner = [int]$f[2]
            if (-not $allIds.Contains($owner)) { continue }
            if ($f[1] -eq 'tcp') {
                $key = 'tcp {0} {1}:{2} -> {3}:{4} {5}' -f $names[$owner], $f[3], $f[4], $f[5], $f[6], $f[7]
                if (-not $seen.ContainsKey($key)) {
                    $seen[$key] = [ordered]@{ protocol = 'tcp'; process = $names[$owner]; root = ($owner -eq $process.Id)
                        remote = '{0}:{1}' -f $f[5], $f[6]; state = $f[7]; loopback = (Test-Loopback $f[5]); firstSeenMs = [int]$f[0] }
                }
            } else {
                $key = 'udp {0} {1}:{2}' -f $names[$owner], $f[3], $f[4]
                if (-not $seen.ContainsKey($key)) {
                    $seen[$key] = [ordered]@{ protocol = 'udp'; process = $names[$owner]; root = ($owner -eq $process.Id)
                        remote = ''; local = '{0}:{1}' -f $f[3], $f[4]; loopback = (Test-Loopback $f[3]); firstSeenMs = [int]$f[0] }
                }
            }
        }
        Start-Sleep -Milliseconds 500
        while ($pendingAccept.IsCompleted) {
            $listenerHits.Add('after close')
            $pendingAccept.Result.Close()
            $pendingAccept = $listener.AcceptTcpClientAsync()
        }
        # Every URL the net log names, by scheme and host; the log may lack its
        # closing brackets if a process was stopped, so it is read as text.
        $urls = @()
        if (Test-Path -LiteralPath $netLog) {
            $text = Get-Content -LiteralPath $netLog -Raw
            $urls = @([regex]::Matches($text, '"(?:url|original_url|new_location)":"([^"]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
        }
        $outside = @($urls | Where-Object { $_ -notmatch '^https://app\.leanslides\.invalid/' })
        $rootEndpoints = @($seen.Values | Where-Object { $_.root })
        $runtimeRemote = @($seen.Values | Where-Object { -not $_.root -and $_.protocol -eq 'tcp' -and -not $_.loopback })
        # The net log argument must reach the browser on top of LeanSlides'
        # own arguments, or this run would watch a differently configured
        # browser from the one people use.
        $argumentsKept = ($null -ne $browserCommandLine) -and
            ($browserCommandLine -match '--disable-background-networking') -and ($browserCommandLine -match '--log-net-log')
        $passed = ($listenerHits.Count -eq 0) -and ($rootEndpoints.Count -eq 0) -and ($outside.Count -eq 0) -and
            (Test-Path -LiteralPath $netLog) -and $argumentsKept
        $results += [ordered]@{
            name = $case.name; deck = if ($case.deck) { Split-Path -Leaf $case.deck } else { $null }
            passed = $passed; listenerConnections = @($listenerHits); leanSlidesEndpoints = @($rootEndpoints)
            runtimeRemoteConnections = @($runtimeRemote); allEndpoints = @($seen.Values)
            netLogFound = (Test-Path -LiteralPath $netLog); netLogUrls = $urls.Count; urlsOutsideReader = @($outside)
            browserArgumentsKept = $argumentsKept; browserCommandLine = $browserCommandLine
            samples = $samples; largestGapMs = $largestGap
        }
        Write-Host ('{0}: {1}; listener {2}, LeanSlides.exe endpoints {3}, runtime remote TCP {4}, net-log URLs {5} ({6} outside the reader), browser arguments kept {7}, {8} samples, largest gap {9} ms' -f
            $case.name, $(if ($passed) { 'PASS' } else { 'FAIL' }), $listenerHits.Count, $rootEndpoints.Count, $runtimeRemote.Count,
            $urls.Count, $outside.Count, $argumentsKept, $samples, $largestGap)
        if (-not $passed) {
            Write-Host ('    LeanSlides.exe {0} at the end of the watch; processes: {1}' -f $exitedEarly, $treeText)
            Write-Host ('    browser command line: {0}' -f $(if ($browserCommandLine) { $browserCommandLine } else { '(not readable)' }))
        }
        foreach ($u in $outside) { Write-Host "    outside: $u" }
        foreach ($r in $runtimeRemote) { Write-Host ('    runtime: {0} -> {1} {2}, first seen at {3} ms' -f $r.process, $r.remote, $r.state, $r.firstSeenMs) }
    }
} finally {
    $listener.Stop()
}
$report = [ordered]@{ exe = $ExePath; watchMilliseconds = $WatchMilliseconds; cases = $results }
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $out 'network-windows.json') -Encoding utf8
if (@($results | Where-Object { -not $_.passed }).Count -gt 0) { exit 1 }

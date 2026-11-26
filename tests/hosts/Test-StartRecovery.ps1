[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ExePath,
    [string]$DeckPath = '',
    [ValidateSet('healthy', 'frozen', 'mismatch')][string[]]$Cases = @('healthy', 'frozen', 'mismatch')
)

# Starts LeanSlides in the two states where a WebView2 browser on the shared
# user-data folder (%LOCALAPPDATA%\LeanSlides\WebView2) cannot serve a new
# window, and requires the new window to render within 25 s anyway:
#
#   frozen    the browser of an open LeanSlides is suspended, then that
#             LeanSlides is ended, so the browser stays alive and silent
#   mismatch  an open LeanSlides started its browser with other arguments
#             (LEANSLIDES_BROWSER_PROFILE=gpu), which WebView2 refuses to share
#
# and once in a healthy state that stays open past the start deadline, to
# show a start that works is never retried. Each launch prints its trace
# (--trace-timing). Only processes this script started, and the browser tree
# it froze, are ended.
#
# Without the retry, the frozen launch showed a blank window for 41 s before
# WebView2 gave up on that browser, and the mismatch launch stopped at an
# error box, so 25 s (the 10 s start deadline and a start on a new folder)
# tells the two builds apart.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $DeckPath) { $DeckPath = Join-Path $PSScriptRoot 'fixtures\smoke.pptx' }
$ExePath = (Resolve-Path -LiteralPath $ExePath).Path
$DeckPath = (Resolve-Path -LiteralPath $DeckPath).Path

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class StartRecoveryNative {
    [DllImport("ntdll.dll")] static extern int NtSuspendProcess(IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int id);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static bool Suspend(int id) {
        IntPtr handle = OpenProcess(0x0800, false, id); // PROCESS_SUSPEND_RESUME
        if (handle == IntPtr.Zero) return false;
        try { return NtSuspendProcess(handle) == 0; } finally { CloseHandle(handle); }
    }
}
'@

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

# The process and every process below it, deepest first.
function Get-Tree([int]$RootId) {
    $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
    $ids = [System.Collections.Generic.List[int]]::new()
    $queue = [System.Collections.Generic.Queue[int]]::new()
    $queue.Enqueue($RootId)
    while ($queue.Count) {
        $id = $queue.Dequeue()
        $ids.Add($id)
        foreach ($child in $all | Where-Object { $_.ParentProcessId -eq $id }) {
            $queue.Enqueue([int]$child.ProcessId)
        }
    }
    $ids.Reverse()
    return $ids
}

function Stop-Tree([int[]]$Ids) {
    foreach ($id in $Ids) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
}

# Ends a launch, then anything it started, including a browser it started
# after the tree was listed: those keep its id as their parent id. Only
# processes created after the launch count, so a reused id is left alone.
function Stop-Launch([System.Diagnostics.Process]$Process) {
    $started = $Process.StartTime
    $known = [System.Collections.Generic.HashSet[int]]::new()
    $null = $known.Add($Process.Id)
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    for ($pass = 0; $pass -lt 3; $pass++) {
        Start-Sleep -Seconds 1
        $children = @(Get-CimInstance Win32_Process | Where-Object {
                $known.Contains([int]$_.ParentProcessId) -and $_.CreationDate -ge $started })
        foreach ($child in $children) {
            $null = $known.Add([int]$child.ProcessId)
            Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
}

function Start-Reader([string[]]$Flags, [hashtable]$Environment = @{}) {
    $info = [System.Diagnostics.ProcessStartInfo]::new($ExePath)
    $info.Arguments = (($Flags + ('"{0}"' -f $DeckPath)) -join ' ')
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.EnvironmentVariables.Remove('LEANSLIDES_BROWSER_PROFILE')
    foreach ($name in $Environment.Keys) { $info.EnvironmentVariables[$name] = $Environment[$name] }
    return [System.Diagnostics.Process]::Start($info)
}

# Reads trace lines until one names the event, or the time is up.
function Wait-Trace([System.Diagnostics.Process]$Process, [string]$EventName, [int]$Seconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    $pending = $Process.StandardOutput.ReadLineAsync()
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($pending.Wait(250)) {
            $line = $pending.Result
            if ($null -eq $line) { return $false }
            if ($line -match ('^LEANSLIDES_TIMING {0} ' -f [regex]::Escape($EventName))) { return $true }
            $pending = $Process.StandardOutput.ReadLineAsync()
        }
    }
    return $false
}

# A launch that closes itself after it renders. Returns its trace, or throws
# with what it printed when it does not finish in time.
function Invoke-Launch([string]$Label, [int]$ExitAfterMs, [int]$TimeoutSeconds) {
    $process = Start-Reader @('--trace-timing', "--exit-after-render=$ExitAfterMs")
    $output = $process.StandardOutput.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        Stop-Launch $process
        $null = $output.Wait(5000)
        $printed = if ($output.IsCompleted) { $output.Result.Trim() } else { '(nothing)' }
        throw "$Label`: the launch did not render and close within $TimeoutSeconds s. It printed:`n$printed"
    }
    $null = $output.Wait(5000)
    $trace = $output.Result
    Assert-True ($process.ExitCode -eq 0) "$Label`: the launch exited with $($process.ExitCode)."
    Assert-True ($trace -match '(?m)^LEANSLIDES_TIMING rendered ') "$Label`: the launch closed without rendering.`n$trace"
    return $trace
}

function Write-Pass([string]$Message) { Write-Host ('PASS ' + $Message) }

# "retry at 10021 ms, rendered at 11873 ms" from a launch's trace.
function Get-Times([string]$Trace) {
    $parts = @()
    foreach ($eventName in 'webview-retry', 'rendered') {
        if ($Trace -match ('(?m)^LEANSLIDES_TIMING {0} (\d+)' -f $eventName)) { $parts += ('{0} at {1} ms' -f $eventName, $Matches[1]) }
    }
    return ($parts -join ', ')
}

# 1. Healthy: rendered, no retry, and still no retry after the 10 s start
#    deadline has passed while the window stays open.
if ($Cases -contains 'healthy') {
    $trace = Invoke-Launch 'healthy' 11000 45
    Assert-True ($trace -notmatch 'webview-retry') "healthy: a start that worked was retried.`n$trace"
    Write-Pass ('a healthy start renders and is not retried ({0})' -f (Get-Times $trace))
}

# 2. Frozen browser on the shared folder.
if ($Cases -contains 'frozen') {
    $holder = Start-Reader @('--trace-timing', '--exit-after-render=600000')
    $frozen = @()
    try {
        Assert-True (Wait-Trace $holder 'rendered' 45) 'frozen: the first window did not render.'
        $frozen = @(Get-Tree $holder.Id | Where-Object { $_ -ne $holder.Id })
        Assert-True ($frozen.Count -gt 0) 'frozen: the first window has no WebView2 processes.'
        foreach ($id in $frozen) { $null = [StartRecoveryNative]::Suspend($id) }
        Stop-Process -Id $holder.Id -Force
        $trace = Invoke-Launch 'frozen' 1500 25
        Assert-True ($trace -match '(?m)^LEANSLIDES_TIMING webview-retry \d+ reason=timeout') "frozen: no timed-out retry in the trace.`n$trace"
        Write-Pass ('a start beside a frozen browser retries and renders ({0})' -f (Get-Times $trace))
    } finally {
        Stop-Tree $frozen
        Stop-Launch $holder
}
}

# 3. A browser started with other arguments on the shared folder.
if ($Cases -contains 'mismatch') {
    $holder = Start-Reader @('--trace-timing', '--exit-after-render=600000') @{ LEANSLIDES_BROWSER_PROFILE = 'gpu' }
    try {
        Assert-True (Wait-Trace $holder 'rendered' 45) 'mismatch: the first window did not render.'
        $trace = Invoke-Launch 'mismatch' 1500 25
        Assert-True ($trace -match '(?m)^LEANSLIDES_TIMING webview-retry \d+ reason=failed') "mismatch: no failed-start retry in the trace.`n$trace"
        Write-Pass ('a start beside a browser with other arguments retries and renders ({0})' -f (Get-Times $trace))
    } finally {
        Stop-Launch $holder
}
}

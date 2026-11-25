# Worker for Export-PowerPoint.ps1. Opens each deck read-only in PowerPoint,
# exports every slide as PNG, and writes PowerPoint's own measurements of every
# shape (box, rotation, text, and the bounds of each text line) as JSON.
# Writes a heartbeat file before each deck so the parent can stop a stalled run.
param(
    [Parameter(Mandatory)] [string] $ListFile,   # one "name<TAB>path" per line
    [Parameter(Mandatory)] [string] $OutDir,
    [Parameter(Mandatory)] [string] $Heartbeat,
    [int] $Width = 1280,
    [int] $MaxLinesPerShape = 60
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

function Write-Json([object] $Value, [string] $Path) {
    $json = $Value | ConvertTo-Json -Depth 12 -Compress
    [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

function Get-ShapeRecord($Shape, [int] $MaxLines) {
    $record = [ordered]@{
        id = [int]$Shape.Id; name = [string]$Shape.Name; type = [int]$Shape.Type
        left = [double]$Shape.Left; top = [double]$Shape.Top
        width = [double]$Shape.Width; height = [double]$Shape.Height
        rotation = [double]$Shape.Rotation; visible = [int]$Shape.Visible
    }
    try { if ($Shape.Type -eq 14) { $record.placeholder = [int]$Shape.PlaceholderFormat.Type } } catch {}
    if ($Shape.Type -eq 6) {
        $children = @()
        foreach ($child in $Shape.GroupItems) { $children += Get-ShapeRecord $child $MaxLines }
        $record.children = $children
        return $record
    }
    if ($Shape.HasTextFrame -and $Shape.TextFrame.HasText) {
        $range = $Shape.TextFrame.TextRange
        $record.text = [string]$range.Text
        $record.fontSize = [double]$range.Characters(1, 1).Font.Size
        $record.fontName = [string]$range.Characters(1, 1).Font.Name
        $lines = @()
        $count = [Math]::Min($range.Lines().Count, $MaxLines)
        for ($i = 1; $i -le $count; $i++) {
            $line = $range.Lines($i, 1)
            $lines += [ordered]@{
                text = [string]$line.Text
                left = [double]$line.BoundLeft; top = [double]$line.BoundTop
                width = [double]$line.BoundWidth; height = [double]$line.BoundHeight
            }
        }
        $record.lines = $lines
    }
    if ($Shape.HasTable) {
        $record.rows = [int]$Shape.Table.Rows.Count
        $record.columns = [int]$Shape.Table.Columns.Count
    }
    return $record
}

$app = New-Object -ComObject PowerPoint.Application
try { $app.DisplayAlerts = 1 } catch {}           # ppAlertsNone
try { $app.AutomationSecurity = 3 } catch {}      # msoAutomationSecurityForceDisable

foreach ($entry in Get-Content -LiteralPath $ListFile -Encoding UTF8) {
    if (-not $entry) { continue }
    $name, $path = $entry -split "`t", 2
    $deckDir = Join-Path $OutDir ($name -replace '[\\/:]', '__')
    if (Test-Path (Join-Path $deckDir 'powerpoint.json')) { continue }
    [System.IO.File]::WriteAllText($Heartbeat, "$name`t$([DateTime]::UtcNow.ToString('o'))")
    New-Item -ItemType Directory -Force -Path $deckDir | Out-Null
    $pres = $null
    $started = Get-Date
    try {
        # ReadOnly, not Untitled, no window.
        $pres = $app.Presentations.Open($path, -1, 0, 0)
        $w = [double]$pres.PageSetup.SlideWidth
        $h = [double]$pres.PageSetup.SlideHeight
        $height = [int][Math]::Round($Width * $h / $w)
        $slides = @()
        foreach ($slide in $pres.Slides) {
            $file = 'slide-{0:D3}.png' -f $slide.SlideIndex
            $slide.Export((Join-Path $deckDir $file), 'PNG', $Width, $height)
            $shapes = @()
            foreach ($shape in $slide.Shapes) { $shapes += Get-ShapeRecord $shape $MaxLinesPerShape }
            $slides += [ordered]@{
                index = [int]$slide.SlideIndex; image = $file
                hidden = [int]$slide.SlideShowTransition.Hidden; shapes = $shapes
            }
        }
        Write-Json ([ordered]@{
            name = $name; ok = $true; slideWidth = $w; slideHeight = $h; imageWidth = $Width
            imageHeight = $height; seconds = [Math]::Round(((Get-Date) - $started).TotalSeconds, 2)
            powerpoint = [string]$app.Version; slides = $slides
        }) (Join-Path $deckDir 'powerpoint.json')
    } catch {
        Write-Json ([ordered]@{ name = $name; ok = $false; error = $_.Exception.Message }) (Join-Path $deckDir 'powerpoint.json')
    } finally {
        if ($pres) { try { $pres.Close() } catch {} }
    }
}
[System.IO.File]::WriteAllText($Heartbeat, "done`t$([DateTime]::UtcNow.ToString('o'))")
if ($app.Presentations.Count -eq 0) { $app.Quit() }
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null

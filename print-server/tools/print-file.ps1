# Prints a PDF or a photo on a Windows printer, silently, with nothing but what
# Windows itself has: Windows.Data.Pdf (the PDF reader Edge uses) draws each
# page, and .NET's System.Drawing.Printing sends it to the printer. It replaces
# SumatraPDF, so the shop PC needs nothing installed to print (25 Nov 2026).
#
# -Settings takes the same list SumatraPDF did (print-server/.env):
#   fit | shrink | noscale         page drawn to fit the paper, or at its own size
#   color | monochrome             monochrome is also greyed here, whatever the driver does
#   portrait | landscape           neither: each page turns to suit its own shape
#   paper=A4                       a paper size by name
#   bin=Rear Paper Feeder          a tray by name
#   print-quality=5                the printer's best resolution (3 = draft)
# -OutFile prints to a file instead (with "Microsoft Print to PDF"), for testing
# without paper.
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][string]$Printer,
  [int]$Copies = 1,
  [string]$Settings = 'fit,portrait,paper=A4',
  [string]$JobName = 'Shiv Print',
  [int]$Dpi = 300,
  [string]$Smoothing = 'HighQualityBicubic',
  [string]$OutFile = ''
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Path)) { throw "File not found: $Path" }
$Path = (Resolve-Path -LiteralPath $Path).ProviderPath

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime

# ── settings ────────────────────────────────────────────────────────────────
$opts = @{ scale = 'fit'; mono = $false; orientation = 'auto'; paper = $null; bin = $null; quality = $null }
foreach ($raw in ($Settings -split ',')) {
  $s = $raw.Trim()
  if (-not $s) { continue }
  $key = $s.ToLowerInvariant()
  if ($key -eq 'fit' -or $key -eq 'shrink' -or $key -eq 'noscale') { $opts.scale = $key }
  elseif ($key -eq 'monochrome') { $opts.mono = $true }
  elseif ($key -eq 'color') { $opts.mono = $false }
  elseif ($key -eq 'portrait' -or $key -eq 'landscape') { $opts.orientation = $key }
  elseif ($key.StartsWith('paper=')) { $opts.paper = $s.Substring(6).Trim() }
  elseif ($key.StartsWith('bin=')) { $opts.bin = $s.Substring(4).Trim() }
  elseif ($key.StartsWith('print-quality=')) { $opts.quality = [int]$s.Substring(14) }
}

# ── WinRT from Windows PowerShell 5.1 ──────────────────────────────────────
$asTaskOf = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
$asTaskAction = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
} | Select-Object -First 1
function Wait-Op($op, [Type]$type) {
  $task = $asTaskOf.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  return $task.Result
}
function Wait-Action($op) {
  $task = $asTaskAction.Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
}
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapEncoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]

# ── the pages: each one a function that draws it as a System.Drawing image ─
$isPdf = [IO.Path]::GetExtension($Path).ToLowerInvariant() -eq '.pdf'
$pdf = $null
$pageCount = 1
if ($isPdf) {
  $null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
  $storage = Wait-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
  $pdf = Wait-Op ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($storage)) ([Windows.Data.Pdf.PdfDocument])
  $pageCount = [int]$pdf.PageCount
  if ($pageCount -lt 1) { throw 'The PDF has no pages.' }
}

# A page's picture and its own size in hundredths of an inch (what the printer draws in).
function Get-Page([int]$index) {
  if ($isPdf) {
    $page = $pdf.GetPage([uint32]$index)
    try {
      $render = New-Object Windows.Data.Pdf.PdfPageRenderOptions
      $render.DestinationWidth = [uint32][Math]::Round($page.Size.Width / 96.0 * $Dpi)
      $render.DestinationHeight = [uint32][Math]::Round($page.Size.Height / 96.0 * $Dpi)
      # Uncompressed: about a third quicker than the default PNG, and it never leaves memory.
      $render.BitmapEncoderId = [Windows.Graphics.Imaging.BitmapEncoder]::BmpEncoderId
      $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
      Wait-Action ($page.RenderToStreamAsync($stream, $render))
      $image = [System.Drawing.Image]::FromStream([System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream))
      # Page.Size is in DIPs (1/96 inch).
      return @{ image = $image; width = $page.Size.Width / 96.0 * 100; height = $page.Size.Height / 96.0 * 100 }
    } finally { $page.Dispose() }
  }

  $image = $null
  try { $image = [System.Drawing.Image]::FromFile($Path) } catch {
    # WebP and anything else GDI+ cannot read: Windows' own decoder, to PNG.
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $storage = Wait-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
    $inStream = Wait-Op ($storage.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Wait-Op ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($inStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Wait-Op ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $out = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $encoder = Wait-Op ([Windows.Graphics.Imaging.BitmapEncoder]::CreateAsync([Windows.Graphics.Imaging.BitmapEncoder]::PngEncoderId, $out)) ([Windows.Graphics.Imaging.BitmapEncoder])
    $encoder.SetSoftwareBitmap($bitmap)
    Wait-Action ($encoder.FlushAsync())
    $image = [System.Drawing.Image]::FromStream([System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($out))
  }
  # A phone photo stands the way its camera says (EXIF orientation).
  if ($image.PropertyIdList -contains 0x0112) {
    $flip = @{ 2 = 'RotateNoneFlipX'; 3 = 'Rotate180FlipNone'; 4 = 'Rotate180FlipX'; 5 = 'Rotate90FlipX'; 6 = 'Rotate90FlipNone'; 7 = 'Rotate270FlipX'; 8 = 'Rotate270FlipNone' }
    $o = [int]$image.GetPropertyItem(0x0112).Value[0]
    if ($flip.ContainsKey($o)) { $image.RotateFlip([System.Drawing.RotateFlipType]$flip[$o]) }
  }
  $dpiX = $image.HorizontalResolution; if ($dpiX -lt 1) { $dpiX = 96 }
  $dpiY = $image.VerticalResolution; if ($dpiY -lt 1) { $dpiY = 96 }
  return @{ image = $image; width = $image.Width / $dpiX * 100; height = $image.Height / $dpiY * 100 }
}

# ── the printer ─────────────────────────────────────────────────────────────
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.DocumentName = $JobName
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$doc.PrinterSettings.PrinterName = $Printer
if (-not $doc.PrinterSettings.IsValid) { throw "Printer not found: $Printer" }
if ($OutFile) {
  $doc.PrinterSettings.PrintToFile = $true
  $doc.PrinterSettings.PrintFileName = $OutFile
}

$page = $doc.DefaultPageSettings
$page.Color = -not $opts.mono
$page.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
if ($opts.orientation -ne 'auto') { $page.Landscape = $opts.orientation -eq 'landscape' }
$warnings = @()
if ($opts.paper) {
  $want = $opts.paper
  $size = $doc.PrinterSettings.PaperSizes | Where-Object { $_.PaperName -eq $want -or $_.Kind.ToString() -eq $want } | Select-Object -First 1
  if ($size) { $page.PaperSize = $size } else { $warnings += "no paper size '$want'" }
}
if ($opts.bin) {
  $want = $opts.bin
  $source = $doc.PrinterSettings.PaperSources | Where-Object { $_.SourceName -eq $want } | Select-Object -First 1
  if ($source) { $page.PaperSource = $source } else { $warnings += "no tray '$want'" }
}
if ($opts.quality) {
  $kind = 'High'; if ($opts.quality -le 3) { $kind = 'Draft' } elseif ($opts.quality -eq 4) { $kind = 'Medium' }
  $res = $doc.PrinterSettings.PrinterResolutions | Where-Object { $_.Kind.ToString() -eq $kind } | Select-Object -First 1
  if ($res) { $page.PrinterResolution = $res }
}

# Copies: the printer makes them when it can; otherwise every page is sent again.
$manualCopies = 1
$Copies = [Math]::Max(1, [Math]::Min(99, $Copies))
if ($Copies -gt 1) {
  if ($doc.PrinterSettings.MaximumCopies -ge $Copies) {
    $doc.PrinterSettings.Copies = [int16]$Copies
    $doc.PrinterSettings.Collate = $true
  } else { $manualCopies = $Copies }
}
$total = $pageCount * $manualCopies

# Grey, for monochrome: drawn through a colour matrix, whatever the driver does.
$grey = $null
if ($opts.mono) {
  $m = New-Object System.Drawing.Imaging.ColorMatrix
  $m.Matrix00 = 0.299; $m.Matrix01 = 0.299; $m.Matrix02 = 0.299
  $m.Matrix10 = 0.587; $m.Matrix11 = 0.587; $m.Matrix12 = 0.587
  $m.Matrix20 = 0.114; $m.Matrix21 = 0.114; $m.Matrix22 = 0.114
  $m.Matrix33 = 1; $m.Matrix44 = 1
  $grey = New-Object System.Drawing.Imaging.ImageAttributes
  $grey.SetColorMatrix($m)
}

$script:next = 0
$script:current = $null
function Get-Next {
  if (-not $script:current) { $script:current = Get-Page ($script:next % $pageCount) }
  return $script:current
}

# Each page turns to suit its shape when no orientation is set.
$doc.add_QueryPageSettings({
  param($sender, $e)
  if ($opts.orientation -eq 'auto') {
    $p = Get-Next
    $e.PageSettings.Landscape = $p.width -gt $p.height
  }
})

$doc.add_PrintPage({
  param($sender, $e)
  $p = Get-Next
  try {
    $g = $e.Graphics
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::$Smoothing
    $pageW = $e.PageBounds.Width
    $pageH = $e.PageBounds.Height
    $hx = $e.PageSettings.HardMarginX
    $hy = $e.PageSettings.HardMarginY
    if ($e.PageSettings.Landscape) { $t = $hx; $hx = $hy; $hy = $t }
    $areaW = $pageW - 2 * $hx
    $areaH = $pageH - 2 * $hy
    $scale = 1.0
    $fits = [Math]::Min($areaW / $p.width, $areaH / $p.height)
    if ($opts.scale -eq 'fit') { $scale = $fits }
    elseif ($opts.scale -eq 'shrink') { $scale = [Math]::Min(1.0, $fits) }
    $w = $p.width * $scale
    $h = $p.height * $scale
    # The page origin is the printable corner; centre on the whole sheet.
    $x = ($pageW - $w) / 2 - $hx
    $y = ($pageH - $h) / 2 - $hy
    $rect = New-Object System.Drawing.Rectangle([int][Math]::Round($x), [int][Math]::Round($y), [int][Math]::Round($w), [int][Math]::Round($h))
    if ($grey) {
      $g.DrawImage($p.image, $rect, 0, 0, $p.image.Width, $p.image.Height, [System.Drawing.GraphicsUnit]::Pixel, $grey)
    } else {
      $g.DrawImage($p.image, $rect)
    }
  } finally {
    $p.image.Dispose()
    $script:current = $null
    $script:next += 1
  }
  $e.HasMorePages = $script:next -lt $total
})

$started = Get-Date
$doc.Print()
$doc.Dispose()
if ($pdf) { $pdf = $null }
[pscustomobject]@{
  ok = $true
  printer = $Printer
  pages = $pageCount
  copies = $Copies
  ms = [int]((Get-Date) - $started).TotalMilliseconds
  warnings = $warnings
} | ConvertTo-Json -Compress

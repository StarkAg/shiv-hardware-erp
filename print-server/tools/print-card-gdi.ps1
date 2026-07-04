param(
  [string]$ImagePath,
  # Optional second card image, drawn at the slot-2 position in the same pass
  [string]$ImagePath2,

  [string]$PrinterName = "EPSON L8050 Series",
  [string]$DevmodeFile = (Join-Path $PSScriptRoot "..\data\epson-card.devmode"),
  [int]$Copies = 1,
  [string]$JobName = "Shiv PVC ID Card",
  [switch]$FullTrayCalibration,
  [double]$SlotLeftMm = 13.0,
  [double]$SlotTopMm = 25.0,
  [double]$Slot2LeftMm = 74.0,
  [double]$Slot2TopMm = 25.0,
  [double]$CardWidthMm = 54.0,
  [double]$CardHeightMm = 86.0,
  [double]$OffsetXmm = 0,
  [double]$OffsetYmm = 0,
  [double]$ScalePercent = 100
)

$ErrorActionPreference = "Stop"

if (-not $FullTrayCalibration -and -not (Test-Path -LiteralPath $ImagePath)) {
  throw "Image not found: $ImagePath"
}
if ($ImagePath2 -and -not (Test-Path -LiteralPath $ImagePath2)) {
  throw "Second image not found: $ImagePath2"
}
if (-not (Test-Path -LiteralPath $DevmodeFile)) {
  throw "Captured Epson card DEVMODE not found: $DevmodeFile. Run capture-epson-card-devmode.ps1 first."
}

function Set-DevModeInt16([byte[]]$bytes, [int]$offset, [int16]$value) {
  $raw = [BitConverter]::GetBytes($value)
  $bytes[$offset] = $raw[0]
  $bytes[$offset + 1] = $raw[1]
}

function Force-CardDevmodeFields([byte[]]$bytes) {
  # Replay the Epson private settings from the captured blob, while forcing
  # the public DEVMODE fields away from A4/plain-paper defaults.
  Set-DevModeInt16 $bytes 76 1    # dmOrientation: portrait
  Set-DevModeInt16 $bytes 78 256  # dmPaperSize: DMPAPER_USER
  Set-DevModeInt16 $bytes 80 860  # dmPaperLength: 86.0 mm in tenths
  Set-DevModeInt16 $bytes 82 540  # dmPaperWidth: 54.0 mm in tenths
  Set-DevModeInt16 $bytes 88 4    # dmDefaultSource: manual / Disc-ID tray on Epson
}

function Convert-MmToPxX([double]$mm, [double]$pxPerMmX) {
  return [int][Math]::Round($mm * $pxPerMmX)
}

function Convert-MmToPxY([double]$mm, [double]$pxPerMmY) {
  return [int][Math]::Round($mm * $pxPerMmY)
}

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct DOCINFO
{
    public int cbSize;
    public string lpszDocName;
    public string lpszOutput;
    public string lpszDatatype;
    public int fwType;
}

public static class NativeGdiPrint
{
    public const int HORZSIZE = 4;
    public const int VERTSIZE = 6;
    public const int HORZRES = 8;
    public const int VERTRES = 10;

    [DllImport("gdi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern IntPtr CreateDC(string driver, string device, string output, IntPtr devmode);

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern int GetDeviceCaps(IntPtr hdc, int index);

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern int StartDoc(IntPtr hdc, ref DOCINFO docInfo);

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern int EndDoc(IntPtr hdc);

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern int AbortDoc(IntPtr hdc);

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern int StartPage(IntPtr hdc);

    [DllImport("gdi32.dll", SetLastError = true)]
    public static extern int EndPage(IntPtr hdc);
}
"@

$devmodeBytes = [IO.File]::ReadAllBytes($DevmodeFile)
Force-CardDevmodeFields $devmodeBytes
$devmode = [Runtime.InteropServices.Marshal]::AllocHGlobal($devmodeBytes.Length)
$hdc = [IntPtr]::Zero
$image = $null
$image2 = $null

try {
  [Runtime.InteropServices.Marshal]::Copy($devmodeBytes, 0, $devmode, $devmodeBytes.Length)
  $hdc = [NativeGdiPrint]::CreateDC("WINSPOOL", $PrinterName, $null, $devmode)
  if ($hdc -eq [IntPtr]::Zero) {
    throw "CreateDC failed for '$PrinterName'. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }

  $doc = New-Object DOCINFO
  $doc.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][DOCINFO])
  $doc.lpszDocName = $JobName

  if ([NativeGdiPrint]::StartDoc($hdc, [ref]$doc) -le 0) {
    throw "StartDoc failed. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }

  if (-not $FullTrayCalibration) {
    $image = [System.Drawing.Image]::FromFile($ImagePath)
    if ($ImagePath2) { $image2 = [System.Drawing.Image]::FromFile($ImagePath2) }
  }
  $width = [NativeGdiPrint]::GetDeviceCaps($hdc, [NativeGdiPrint]::HORZRES)
  $height = [NativeGdiPrint]::GetDeviceCaps($hdc, [NativeGdiPrint]::VERTRES)
  $pageWidthMm = [NativeGdiPrint]::GetDeviceCaps($hdc, [NativeGdiPrint]::HORZSIZE)
  $pageHeightMm = [NativeGdiPrint]::GetDeviceCaps($hdc, [NativeGdiPrint]::VERTSIZE)
  if ($width -le 0 -or $height -le 0) {
    throw "Printer returned invalid card page size: ${width}x${height}"
  }
  if ($pageWidthMm -le 0 -or $pageHeightMm -le 0) {
    throw "Printer returned invalid physical page size: ${pageWidthMm}x${pageHeightMm}mm"
  }

  $pxPerMmX = $width / [double]$pageWidthMm
  $pxPerMmY = $height / [double]$pageHeightMm
  $scale = [Math]::Max(1, $ScalePercent) / 100.0
  $drawWidthMm = $CardWidthMm * $scale
  $drawHeightMm = $CardHeightMm * $scale
  $isSingleCardCanvas = $pageWidthMm -le ($CardWidthMm + 20) -and $pageHeightMm -le ($CardHeightMm + 20)

  if ($isSingleCardCanvas) {
    $drawLeftMm = (($pageWidthMm - $drawWidthMm) / 2.0) + $OffsetXmm
    $drawTopMm = (($pageHeightMm - $drawHeightMm) / 2.0) + $OffsetYmm
  } else {
    $drawLeftMm = $SlotLeftMm + (($CardWidthMm - $drawWidthMm) / 2.0) + $OffsetXmm
    $drawTopMm = $SlotTopMm + (($CardHeightMm - $drawHeightMm) / 2.0) + $OffsetYmm
  }

  $drawLeft = [int][Math]::Round($drawLeftMm * $pxPerMmX)
  $drawTop = [int][Math]::Round($drawTopMm * $pxPerMmY)
  $drawWidth = [int][Math]::Round($drawWidthMm * $pxPerMmX)
  $drawHeight = [int][Math]::Round($drawHeightMm * $pxPerMmY)

  # Second card always sits in slot 2
  $draw2LeftMm = $Slot2LeftMm + (($CardWidthMm - $drawWidthMm) / 2.0) + $OffsetXmm
  $draw2TopMm = $Slot2TopMm + (($CardHeightMm - $drawHeightMm) / 2.0) + $OffsetYmm
  $draw2Left = [int][Math]::Round($draw2LeftMm * $pxPerMmX)
  $draw2Top = [int][Math]::Round($draw2TopMm * $pxPerMmY)

  for ($copy = 1; $copy -le [Math]::Max(1, $Copies); $copy++) {
    if ([NativeGdiPrint]::StartPage($hdc) -le 0) {
      throw "StartPage failed. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }

    $graphics = [System.Drawing.Graphics]::FromHdc($hdc)
    try {
      $graphics.PageUnit = [System.Drawing.GraphicsUnit]::Pixel
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.Clear([System.Drawing.Color]::White)
      if ($FullTrayCalibration) {
        $thinGray = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(210, 210, 210)), 1
        $axisPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(120, 120, 120)), 2
        $slot1Pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(220, 0, 0)), 5
        $slot2Pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(0, 80, 220)), 5
        $font = New-Object System.Drawing.Font "Arial", 34, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
        $smallFont = New-Object System.Drawing.Font "Arial", 22, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
        $redBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 0, 0))
        $blueBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0, 80, 220))
        $blackBrush = [System.Drawing.Brushes]::Black

        try {
          for ($xMm = 0; $xMm -le $pageWidthMm; $xMm += 10) {
            $x = Convert-MmToPxX $xMm $pxPerMmX
            $pen = if ($xMm % 50 -eq 0) { $axisPen } else { $thinGray }
            $graphics.DrawLine($pen, $x, 0, $x, $height)
          }
          for ($yMm = 0; $yMm -le $pageHeightMm; $yMm += 10) {
            $y = Convert-MmToPxY $yMm $pxPerMmY
            $pen = if ($yMm % 50 -eq 0) { $axisPen } else { $thinGray }
            $graphics.DrawLine($pen, 0, $y, $width, $y)
          }

          $cardPxW = Convert-MmToPxX $CardWidthMm $pxPerMmX
          $cardPxH = Convert-MmToPxY $CardHeightMm $pxPerMmY
          $slot1Left = Convert-MmToPxX ($SlotLeftMm + $OffsetXmm) $pxPerMmX
          $slot1Top = Convert-MmToPxY ($SlotTopMm + $OffsetYmm) $pxPerMmY
          $slot2Left = Convert-MmToPxX ($Slot2LeftMm + $OffsetXmm) $pxPerMmX
          $slot2Top = Convert-MmToPxY ($Slot2TopMm + $OffsetYmm) $pxPerMmY

          $graphics.DrawRectangle($slot1Pen, $slot1Left, $slot1Top, $cardPxW, $cardPxH)
          $graphics.DrawRectangle($slot2Pen, $slot2Left, $slot2Top, $cardPxW, $cardPxH)
          $graphics.DrawLine($slot1Pen, $slot1Left, $slot1Top, $slot1Left + $cardPxW, $slot1Top + $cardPxH)
          $graphics.DrawLine($slot1Pen, $slot1Left + $cardPxW, $slot1Top, $slot1Left, $slot1Top + $cardPxH)
          $graphics.DrawLine($slot2Pen, $slot2Left, $slot2Top, $slot2Left + $cardPxW, $slot2Top + $cardPxH)
          $graphics.DrawLine($slot2Pen, $slot2Left + $cardPxW, $slot2Top, $slot2Left, $slot2Top + $cardPxH)

          $graphics.DrawString("FULL TRAY CALIBRATION", $smallFont, $blackBrush, 40, 40)
          $graphics.DrawString("SLOT 1", $font, $redBrush, $slot1Left + 24, $slot1Top + 24)
          $graphics.DrawString("L=$SlotLeftMm T=$SlotTopMm", $smallFont, $redBrush, $slot1Left + 24, $slot1Top + 70)
          $graphics.DrawString("SLOT 2", $font, $blueBrush, $slot2Left + 24, $slot2Top + 24)
          $graphics.DrawString("L=$Slot2LeftMm T=$Slot2TopMm", $smallFont, $blueBrush, $slot2Left + 24, $slot2Top + 70)
        }
        finally {
          $thinGray.Dispose()
          $axisPen.Dispose()
          $slot1Pen.Dispose()
          $slot2Pen.Dispose()
          $font.Dispose()
          $smallFont.Dispose()
          $redBrush.Dispose()
          $blueBrush.Dispose()
        }
      } else {
        $graphics.DrawImage($image, $drawLeft, $drawTop, $drawWidth, $drawHeight)
        if ($image2) {
          $graphics.DrawImage($image2, $draw2Left, $draw2Top, $drawWidth, $drawHeight)
        }
      }
    }
    finally {
      $graphics.Dispose()
    }

    if ([NativeGdiPrint]::EndPage($hdc) -le 0) {
      throw "EndPage failed. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
  }

  if ([NativeGdiPrint]::EndDoc($hdc) -le 0) {
    throw "EndDoc failed. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }

  if ($FullTrayCalibration) {
    Write-Host "sent full-tray calibration to $PrinterName using $DevmodeFile canvas=${width}x${height} ${pageWidthMm}x${pageHeightMm}mm slot1=${SlotLeftMm},${SlotTopMm} slot2=${Slot2LeftMm},${Slot2TopMm}"
  } else {
    $draw2Note = if ($image2) { " draw2=${draw2Left},${draw2Top}px" } else { "" }
    Write-Host "sent to $PrinterName using $DevmodeFile canvas=${width}x${height} ${pageWidthMm}x${pageHeightMm}mm draw=${drawLeft},${drawTop},${drawWidth},${drawHeight}px$draw2Note"
  }
}
catch {
  if ($hdc -ne [IntPtr]::Zero) { [NativeGdiPrint]::AbortDoc($hdc) | Out-Null }
  throw
}
finally {
  if ($image) { $image.Dispose() }
  if ($image2) { $image2.Dispose() }
  if ($hdc -ne [IntPtr]::Zero) { [NativeGdiPrint]::DeleteDC($hdc) | Out-Null }
  if ($devmode -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($devmode) }
}

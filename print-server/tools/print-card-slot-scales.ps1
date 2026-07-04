# Prints a millimetre scale pattern inside BOTH card slots of the Epson
# Disc/ID Card Tray so the physical cards can be read like graph paper:
# 1mm light grid, 5mm medium lines, 10mm bold numbered lines, and a border
# on the expected card edge. The pattern is drawn at the effective slot
# position (slot coords + current offsets from .env), so the white gap the
# user reads on each side of the printed card is exactly the residual
# correction still needed.
param(
  [string]$EnvFile = (Join-Path $PSScriptRoot "..\.env"),
  [int]$Copies = 1
)

$ErrorActionPreference = "Stop"

function Read-Env([string]$Path) {
  $values = @{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
    if ($line -match '^\s*([^=]+)=(.*)$') { $values[$Matches[1].Trim()] = $Matches[2].Trim() }
  }
  return $values
}
function Get-EnvValue($Env, [string]$Name, [string]$Default) {
  if ($Env.ContainsKey($Name) -and $Env[$Name]) { return $Env[$Name] }
  return $Default
}

$envValues = Read-Env $EnvFile
$printer   = Get-EnvValue $envValues "COLOR_PRINTER" "EPSON L8050 Series"
$devmodeFile = Get-EnvValue $envValues "EPSON_CARD_DEVMODE_PATH" (Join-Path $PSScriptRoot "..\data\epson-card.devmode")
$slot1Left = [double](Get-EnvValue $envValues "EPSON_CARD_SLOT_LEFT_MM" "10")
$slot1Top  = [double](Get-EnvValue $envValues "EPSON_CARD_SLOT_TOP_MM" "28")
$slot2Left = [double](Get-EnvValue $envValues "EPSON_CARD_SLOT2_LEFT_MM" "78")
$slot2Top  = [double](Get-EnvValue $envValues "EPSON_CARD_SLOT2_TOP_MM" "$slot1Top")
$offsetX   = [double](Get-EnvValue $envValues "EPSON_CARD_OFFSET_X_MM" "0")
$offsetY   = [double](Get-EnvValue $envValues "EPSON_CARD_OFFSET_Y_MM" "0")
$cardW = 54.0
$cardH = 86.0

if (-not (Test-Path -LiteralPath $devmodeFile)) {
  throw "Captured Epson card DEVMODE not found: $devmodeFile"
}

function Set-DevModeInt16([byte[]]$bytes, [int]$offset, [int16]$value) {
  $raw = [BitConverter]::GetBytes($value)
  $bytes[$offset] = $raw[0]
  $bytes[$offset + 1] = $raw[1]
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

$devmodeBytes = [IO.File]::ReadAllBytes($devmodeFile)
# Same public-field overrides the real card prints use (portrait, custom
# 54x86mm-derived tray canvas, Disc/ID tray source).
Set-DevModeInt16 $devmodeBytes 76 1
Set-DevModeInt16 $devmodeBytes 78 256
Set-DevModeInt16 $devmodeBytes 80 860
Set-DevModeInt16 $devmodeBytes 82 540
Set-DevModeInt16 $devmodeBytes 88 4

$devmode = [Runtime.InteropServices.Marshal]::AllocHGlobal($devmodeBytes.Length)
$hdc = [IntPtr]::Zero

try {
  [Runtime.InteropServices.Marshal]::Copy($devmodeBytes, 0, $devmode, $devmodeBytes.Length)
  $hdc = [NativeGdiPrint]::CreateDC("WINSPOOL", $printer, $null, $devmode)
  if ($hdc -eq [IntPtr]::Zero) {
    throw "CreateDC failed for '$printer'. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }

  $doc = New-Object DOCINFO
  $doc.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][DOCINFO])
  $doc.lpszDocName = "Shiv Card Slot Scales"

  if ([NativeGdiPrint]::StartDoc($hdc, [ref]$doc) -le 0) {
    throw "StartDoc failed. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }

  $width  = [NativeGdiPrint]::GetDeviceCaps($hdc, [NativeGdiPrint]::HORZRES)
  $height = [NativeGdiPrint]::GetDeviceCaps($hdc, [NativeGdiPrint]::VERTRES)
  $pageWidthMm  = [NativeGdiPrint]::GetDeviceCaps($hdc, [NativeGdiPrint]::HORZSIZE)
  $pageHeightMm = [NativeGdiPrint]::GetDeviceCaps($hdc, [NativeGdiPrint]::VERTSIZE)
  if ($width -le 0 -or $height -le 0) { throw "Printer returned invalid canvas: ${width}x${height}" }
  $ppmX = $width / [double]$pageWidthMm
  $ppmY = $height / [double]$pageHeightMm

  for ($copy = 1; $copy -le [Math]::Max(1, $Copies); $copy++) {
    if ([NativeGdiPrint]::StartPage($hdc) -le 0) {
      throw "StartPage failed. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }

    $graphics = [System.Drawing.Graphics]::FromHdc($hdc)
    $penLight  = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(185, 185, 185)), 1
    $penMedium = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(110, 110, 110)), 3
    $penBold   = New-Object System.Drawing.Pen ([System.Drawing.Color]::Black), 5
    $penEdge1  = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(220, 0, 0)), 4
    $penEdge2  = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(0, 80, 220)), 4
    $numFont   = New-Object System.Drawing.Font "Arial", 58, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $bigFont   = New-Object System.Drawing.Font "Arial", 88, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $blackBrush = [System.Drawing.Brushes]::Black
    $redBrush  = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 0, 0))
    $blueBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0, 80, 220))

    try {
      $graphics.PageUnit = [System.Drawing.GraphicsUnit]::Pixel
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
      $graphics.Clear([System.Drawing.Color]::White)

      $slots = @(
        @{ Left = $slot1Left + $offsetX; Top = $slot1Top + $offsetY; Label = "SLOT 1"; Pen = $penEdge1; Brush = $redBrush },
        @{ Left = $slot2Left + $offsetX; Top = $slot2Top + $offsetY; Label = "SLOT 2"; Pen = $penEdge2; Brush = $blueBrush }
      )

      foreach ($slot in $slots) {
        $L = [int][Math]::Round($slot.Left * $ppmX)
        $T = [int][Math]::Round($slot.Top * $ppmY)
        $W = [int][Math]::Round($cardW * $ppmX)
        $H = [int][Math]::Round($cardH * $ppmY)
        $R = $L + $W
        $B = $T + $H

        # 1mm grid, heavier every 5mm, bold every 10mm — clipped to the card area
        for ($x = 0; $x -le $cardW; $x++) {
          $px = $L + [int][Math]::Round($x * $ppmX)
          $pen = if ($x % 10 -eq 0) { $penBold } elseif ($x % 5 -eq 0) { $penMedium } else { $penLight }
          $graphics.DrawLine($pen, $px, $T, $px, $B)
        }
        for ($y = 0; $y -le $cardH; $y++) {
          $py = $T + [int][Math]::Round($y * $ppmY)
          $pen = if ($y % 10 -eq 0) { $penBold } elseif ($y % 5 -eq 0) { $penMedium } else { $penLight }
          $graphics.DrawLine($pen, $L, $py, $R, $py)
        }

        # numbers on the bold lines: mm from left edge (top+bottom rows) and
        # mm from top edge (left+right columns)
        for ($x = 10; $x -lt $cardW; $x += 10) {
          $px = $L + [int][Math]::Round($x * $ppmX)
          $graphics.DrawString("$x", $numFont, $blackBrush, $px + 6, $T + 10)
          $graphics.DrawString("$x", $numFont, $blackBrush, $px + 6, $B - 80)
        }
        for ($y = 10; $y -lt $cardH; $y += 10) {
          $py = $T + [int][Math]::Round($y * $ppmY)
          $graphics.DrawString("$y", $numFont, $blackBrush, $L + 10, $py + 6)
          $graphics.DrawString("$y", $numFont, $blackBrush, $R - 105, $py + 6)
        }

        # expected card edge
        $graphics.DrawRectangle($slot.Pen, $L, $T, $W, $H)

        # slot label in the middle
        $graphics.DrawString($slot.Label, $bigFont, $slot.Brush, $L + [int]($W * 0.16), $T + [int]($H * 0.44))
      }
    }
    finally {
      $penLight.Dispose(); $penMedium.Dispose(); $penBold.Dispose()
      $penEdge1.Dispose(); $penEdge2.Dispose()
      $numFont.Dispose(); $bigFont.Dispose()
      $redBrush.Dispose(); $blueBrush.Dispose()
      $graphics.Dispose()
    }

    if ([NativeGdiPrint]::EndPage($hdc) -le 0) {
      throw "EndPage failed. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
  }

  if ([NativeGdiPrint]::EndDoc($hdc) -le 0) {
    throw "EndDoc failed. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }

  Write-Host "sent slot scales to $printer canvas=${width}x${height} ${pageWidthMm}x${pageHeightMm}mm slot1=$($slots[0].Left),$($slots[0].Top) slot2=$($slots[1].Left),$($slots[1].Top) (offsets $offsetX,$offsetY included)"
}
catch {
  if ($hdc -ne [IntPtr]::Zero) { [NativeGdiPrint]::AbortDoc($hdc) | Out-Null }
  throw
}
finally {
  if ($hdc -ne [IntPtr]::Zero) { [NativeGdiPrint]::DeleteDC($hdc) | Out-Null }
  if ($devmode -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($devmode) }
}

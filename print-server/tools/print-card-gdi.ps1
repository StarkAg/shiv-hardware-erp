param(
  [Parameter(Mandatory = $true)]
  [string]$ImagePath,

  [string]$PrinterName = "EPSON L8050 Series",
  [string]$DevmodeFile = (Join-Path $PSScriptRoot "..\data\epson-card.devmode"),
  [int]$Copies = 1,
  [string]$JobName = "Shiv PVC ID Card"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ImagePath)) {
  throw "Image not found: $ImagePath"
}
if (-not (Test-Path -LiteralPath $DevmodeFile)) {
  throw "Captured Epson card DEVMODE not found: $DevmodeFile. Run capture-epson-card-devmode.ps1 first."
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
$devmode = [Runtime.InteropServices.Marshal]::AllocHGlobal($devmodeBytes.Length)
$hdc = [IntPtr]::Zero
$image = $null

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

  $image = [System.Drawing.Image]::FromFile($ImagePath)
  $width = [NativeGdiPrint]::GetDeviceCaps($hdc, [NativeGdiPrint]::HORZRES)
  $height = [NativeGdiPrint]::GetDeviceCaps($hdc, [NativeGdiPrint]::VERTRES)
  if ($width -le 0 -or $height -le 0) {
    throw "Printer returned invalid card page size: ${width}x${height}"
  }

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
      $graphics.DrawImage($image, 0, 0, $width, $height)
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

  Write-Host "sent to $PrinterName using $DevmodeFile (${width}x${height})"
}
catch {
  if ($hdc -ne [IntPtr]::Zero) { [NativeGdiPrint]::AbortDoc($hdc) | Out-Null }
  throw
}
finally {
  if ($image) { $image.Dispose() }
  if ($hdc -ne [IntPtr]::Zero) { [NativeGdiPrint]::DeleteDC($hdc) | Out-Null }
  if ($devmode -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($devmode) }
}

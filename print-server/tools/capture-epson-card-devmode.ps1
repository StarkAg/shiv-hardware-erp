param(
  [string]$PrinterName = "EPSON L8050 Series",
  [string]$OutFile = (Join-Path $PSScriptRoot "..\data\epson-card.devmode")
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class NativePrinter
{
    public const int DM_OUT_BUFFER = 2;
    public const int DM_PROMPT = 4;
    public const int DM_IN_BUFFER = 8;

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern int DocumentProperties(
        IntPtr hwnd,
        IntPtr hPrinter,
        string pDeviceName,
        IntPtr pDevModeOutput,
        IntPtr pDevModeInput,
        int fMode);
}
"@

function Read-DevModeSummary([byte[]]$bytes) {
  [pscustomobject]@{
    Bytes         = $bytes.Length
    DriverExtra   = [BitConverter]::ToUInt16($bytes, 70)
    Fields        = ("0x{0:X8}" -f [BitConverter]::ToUInt32($bytes, 72))
    Orientation   = [BitConverter]::ToInt16($bytes, 76)
    PaperSize     = [BitConverter]::ToInt16($bytes, 78)
    PaperLength   = [BitConverter]::ToInt16($bytes, 80)
    PaperWidth    = [BitConverter]::ToInt16($bytes, 82)
    DefaultSource = [BitConverter]::ToInt16($bytes, 88)
  }
}

$printerHandle = [IntPtr]::Zero
if (-not [NativePrinter]::OpenPrinter($PrinterName, [ref]$printerHandle, [IntPtr]::Zero)) {
  throw "OpenPrinter failed for '$PrinterName'. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}

$owner = New-Object System.Windows.Forms.Form
$owner.Text = "Shiv Epson PVC Capture"
$owner.Width = 440
$owner.Height = 170
$owner.StartPosition = "CenterScreen"
$owner.TopMost = $true
$owner.ShowInTaskbar = $true

$label = New-Object System.Windows.Forms.Label
$label.AutoSize = $false
$label.Dock = "Fill"
$label.TextAlign = "MiddleCenter"
$label.Text = "Epson settings dialog is opening.`r`nSet PVC ID Card (Borderless), then click OK."
$owner.Controls.Add($label)
$owner.Show()
$owner.Activate()
$owner.BringToFront()
[System.Windows.Forms.Application]::DoEvents()

try {
  $needed = [NativePrinter]::DocumentProperties([IntPtr]::Zero, $printerHandle, $PrinterName, [IntPtr]::Zero, [IntPtr]::Zero, 0)
  if ($needed -le 0) {
    throw "DocumentProperties size query failed. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }

  $input = [Runtime.InteropServices.Marshal]::AllocHGlobal($needed)
  $output = [Runtime.InteropServices.Marshal]::AllocHGlobal($needed)
  try {
    $result = [NativePrinter]::DocumentProperties(
      [IntPtr]::Zero,
      $printerHandle,
      $PrinterName,
      $input,
      [IntPtr]::Zero,
      [NativePrinter]::DM_OUT_BUFFER)
    if ($result -lt 0) {
      throw "Could not load default printer DEVMODE. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }

    Write-Host ""
    $owner.Activate()
    $owner.BringToFront()
    [System.Windows.Forms.Application]::DoEvents()
    Write-Host "In the Epson dialog, set exactly:"
    Write-Host "  Paper Source: Disc/ID Card Tray"
    Write-Host "  Paper Type:   PVC ID Card (Borderless)"
    Write-Host "  Size:         86 x 54 mm / ID Card"
    Write-Host "Then click OK. This will save a replayable private Epson DEVMODE."
    Write-Host ""

    $result = [NativePrinter]::DocumentProperties(
      $owner.Handle,
      $printerHandle,
      $PrinterName,
      $output,
      $input,
      [NativePrinter]::DM_IN_BUFFER -bor [NativePrinter]::DM_OUT_BUFFER -bor [NativePrinter]::DM_PROMPT)
    if ($result -lt 0) {
      throw "Epson dialog was cancelled or failed. Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }

    $bytes = New-Object byte[] $needed
    [Runtime.InteropServices.Marshal]::Copy($output, $bytes, 0, $needed)

    $dir = Split-Path -Parent $OutFile
    if ($dir -and -not (Test-Path $dir)) {
      New-Item -ItemType Directory -Path $dir | Out-Null
    }

    [IO.File]::WriteAllBytes($OutFile, $bytes)
    Write-Host "Saved: $OutFile"
    Read-DevModeSummary $bytes | Format-List
  }
  finally {
    if ($input -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($input) }
    if ($output -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($output) }
  }
}
finally {
  if ($owner) { $owner.Close(); $owner.Dispose() }
  if ($printerHandle -ne [IntPtr]::Zero) { [NativePrinter]::ClosePrinter($printerHandle) | Out-Null }
}

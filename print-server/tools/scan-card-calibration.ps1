param(
  [string]$EnvFile    = (Join-Path $PSScriptRoot "..\.env"),
  [ValidateSet('1','2','both')]
  [string]$Slot       = '1',
  [int]$DPI           = 300,
  [string]$ScanOutputDir = $env:TEMP,
  [string]$ScannerName   = '*HP*',
  [switch]$UseDialog,
  [switch]$UpdateEnv,
  [switch]$NoPrompt
)

$ErrorActionPreference = 'Stop'

# ── helpers ──────────────────────────────────────────────────────────────────
function Read-EnvFile([string]$Path) {
  $v = @{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
    if ($line -match '^\s*([^=]+)=(.*)$') { $v[$Matches[1].Trim()] = $Matches[2].Trim() }
  }
  $v
}

function Get-EnvNum($env, [string]$name, [double]$default) {
  if ($env.ContainsKey($name) -and $env[$name]) {
    $n = 0.0
    if ([double]::TryParse($env[$name], [Globalization.NumberStyles]::Float,
        [Globalization.CultureInfo]::InvariantCulture, [ref]$n)) { return $n }
  }
  $default
}

function Set-EnvValue([string[]]$Lines, [string]$Name, [string]$Value) {
  $updated = $false
  $next = foreach ($line in $Lines) {
    if ($line -match "^\s*$([regex]::Escape($Name))=") { $updated = $true; "$Name=$Value" }
    else { $line }
  }
  if (-not $updated) { $next += "$Name=$Value" }
  [string[]]$next
}

function Format-Mm([double]$v) {
  $v.ToString('0.##', [Globalization.CultureInfo]::InvariantCulture)
}

# ── C# pixel analyser ────────────────────────────────────────────────────────
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies 'System.Drawing' -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class CardAnalyzer {

    static byte[] Lock(Bitmap bmp, out BitmapData bd, out int stride) {
        bd = bmp.LockBits(new Rectangle(0,0,bmp.Width,bmp.Height),
            ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        stride = Math.Abs(bd.Stride);
        var px = new byte[stride * bmp.Height];
        Marshal.Copy(bd.Scan0, px, 0, px.Length);
        bmp.UnlockBits(bd);
        return px;
    }

    // bounding box of pixels with average(R,G,B) >= threshold
    public static Rectangle FindBrightBounds(Bitmap bmp, int threshold) {
        BitmapData bd; int stride;
        var px = Lock(bmp, out bd, out stride);
        int w = bmp.Width, h = bmp.Height;
        int minX = w, minY = h, maxX = -1, maxY = -1;
        for (int y = 0; y < h; y++) {
            int row = y * stride;
            for (int x = 0; x < w; x++) {
                int i = row + x*4;
                int avg = (px[i] + px[i+1] + px[i+2]) / 3; // B G R order
                if (avg >= threshold) {
                    if (x < minX) minX = x; if (y < minY) minY = y;
                    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) return Rectangle.Empty;
        return new Rectangle(minX, minY, maxX-minX+1, maxY-minY+1);
    }

    // bounding box of pixels matching the per-channel ranges
    public static Rectangle FindColorBounds(Bitmap bmp,
        int rMin, int rMax, int gMin, int gMax, int bMin, int bMax) {
        BitmapData bd; int stride;
        var px = Lock(bmp, out bd, out stride);
        int w = bmp.Width, h = bmp.Height;
        int minX = w, minY = h, maxX = -1, maxY = -1;
        for (int y = 0; y < h; y++) {
            int row = y * stride;
            for (int x = 0; x < w; x++) {
                int i = row + x*4;
                int B = px[i], G = px[i+1], R = px[i+2];
                if (R>=rMin && R<=rMax && G>=gMin && G<=gMax && B>=bMin && B<=bMax) {
                    if (x < minX) minX = x; if (y < minY) minY = y;
                    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) return Rectangle.Empty;
        return new Rectangle(minX, minY, maxX-minX+1, maxY-minY+1);
    }
}
'@

# ── read .env ─────────────────────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $EnvFile)) { throw "Missing env file: $EnvFile" }
$envValues = Read-EnvFile $EnvFile
$slot1Left = Get-EnvNum $envValues 'EPSON_CARD_SLOT_LEFT_MM'  10
$slot1Top  = Get-EnvNum $envValues 'EPSON_CARD_SLOT_TOP_MM'   28
$slot2Left = Get-EnvNum $envValues 'EPSON_CARD_SLOT2_LEFT_MM' 74
$slot2Top  = Get-EnvNum $envValues 'EPSON_CARD_SLOT2_TOP_MM'  28

# ── WIA scan helper ───────────────────────────────────────────────────────────
function Invoke-Scan([string]$outPath, [string]$label) {
  Write-Host "Scanning $label..."
  # BMP is the most universally supported WIA transfer format
  $BMP_GUID = '{B96B3CAB-0728-11D3-9D7B-0000F81EF32E}'

  if ($UseDialog) {
    $dlg = New-Object -ComObject WIA.CommonDialog
    $img = $dlg.ShowAcquireImage(1, 1, 3, $BMP_GUID, $false, $true, $false)
    $bmpPath = [IO.Path]::ChangeExtension($outPath, '.bmp')
    $img.SaveFile($bmpPath)
    # convert BMP → PNG
    $bmp = [System.Drawing.Bitmap]::new($bmpPath)
    try { $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png) }
    finally { $bmp.Dispose() }
    Remove-Item $bmpPath -Force -ErrorAction SilentlyContinue
    return
  }

  $mgr = New-Object -ComObject WIA.DeviceManager
  # No type filter — accept WSD (type=1) and eSCL (type=65535); prefer eSCL
  $allScanners = @($mgr.DeviceInfos)
  $matching = $allScanners | Where-Object {
    try { $_.Properties.Item('Name').Value -like $ScannerName } catch { $false }
  }
  # Prefer eSCL (more reliable for programmatic use); fall back to WSD
  $devInfo = ($matching | Where-Object { $_.Type -ne 1 } | Select-Object -First 1)
  if (-not $devInfo) { $devInfo = ($matching | Select-Object -First 1) }

  if (-not $devInfo) {
    Write-Host "Available scanners:"
    $allScanners | ForEach-Object {
      try { Write-Host "  - $($_.Properties.Item('Name').Value) (type $($_.Type))" } catch {}
    }
    throw "No scanner matching '$ScannerName'. Try -UseDialog or change -ScannerName."
  }
  Write-Host "  Scanner: $($devInfo.Properties.Item('Name').Value) (type $($devInfo.Type))"

  $dev  = $devInfo.Connect()
  $item = $dev.Items[1]

  # WIA 2.0 property IDs for scanner items:
  #   6147 = Horizontal Resolution (DPI)
  #   6148 = Vertical Resolution (DPI)
  #   6149 = Horizontal Start Position (px)
  #   6150 = Vertical Start Position (px)
  #   6151 = Horizontal Extent (width in px at current resolution)
  #   6152 = Vertical Extent (height in px at current resolution)

  # Read current resolution and extent before changing DPI
  $curXRes = try { [double]$item.Properties[6147].Value } catch { 200.0 }
  $curYRes = try { [double]$item.Properties[6148].Value } catch { 200.0 }
  $curXExt = try { [int]$item.Properties[6151].Value }    catch { 0 }
  $curYExt = try { [int]$item.Properties[6152].Value }    catch { 0 }

  # Set resolution
  try { $item.Properties[6147].Value = $DPI } catch {}
  try { $item.Properties[6148].Value = $DPI } catch {}

  # Rescale extent to new DPI (preserve physical scan area)
  if ($curXExt -gt 0 -and $curXRes -gt 0) {
    $newXExt = [int]([Math]::Floor($curXExt * $DPI / $curXRes))
    $newYExt = [int]([Math]::Floor($curYExt * $DPI / $curYRes))
    try { $item.Properties[6151].Value = $newXExt } catch {}
    try { $item.Properties[6152].Value = $newYExt } catch {}
  }

  $wiaImg = $item.Transfer($BMP_GUID)

  $bmpPath = [IO.Path]::ChangeExtension($outPath, '.bmp')
  $wiaImg.SaveFile($bmpPath)

  # Convert BMP → PNG (lossless, better for colour analysis)
  $bmp = [System.Drawing.Bitmap]::new($bmpPath)
  try { $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png) }
  finally { $bmp.Dispose() }
  Remove-Item $bmpPath -Force -ErrorAction SilentlyContinue

  Write-Host "  Saved: $outPath"
}

# ── analyse one scan ──────────────────────────────────────────────────────────
function Measure-Slot([string]$scanPath, [int]$slotNum,
                      [double]$currentLeft, [double]$currentTop,
                      [string]$leftKey, [string]$topKey) {

  $colorName = if ($slotNum -eq 1) { 'RED' } else { 'BLUE' }
  $bmpTemp   = [System.Drawing.Bitmap]::new($scanPath)
  $actualDPI = [Math]::Max(72, [Math]::Round($bmpTemp.HorizontalResolution))
  $bmpTemp.Dispose()
  if ($actualDPI -lt 100) { $actualDPI = $DPI }  # fallback if metadata missing
  $pxPerMm = $actualDPI / 25.4
  Write-Host "  Scan DPI: $actualDPI"

  $bmp = [System.Drawing.Bitmap]::new($scanPath)
  try {
    # ── 1. find white card ────────────────────────────────────────────────────
    # threshold 170: white PVC card is bright; scanner lid-open background is dark
    $cardBounds = [CardAnalyzer]::FindBrightBounds($bmp, 170)
    if ($cardBounds.IsEmpty) {
      throw "Could not detect a bright card area in the scan.`nTip: open the scanner lid so the card shows against a dark background."
    }

    $cardW_mm = [Math]::Round($cardBounds.Width  / $pxPerMm, 1)
    $cardH_mm = [Math]::Round($cardBounds.Height / $pxPerMm, 1)
    Write-Host "  Card detected: $($cardBounds.X)x$($cardBounds.Y) px  →  ${cardW_mm} x ${cardH_mm} mm"

    # sanity-check: PVC card is 54×86mm ± 8mm
    if ([Math]::Abs($cardW_mm - 54) -gt 8 -or [Math]::Abs($cardH_mm - 86) -gt 8) {
      Write-Warning "Detected card size (${cardW_mm}x${cardH_mm} mm) is far from expected 54x86 mm. Results may be inaccurate."
    }

    # ── 2. find colour rectangle ──────────────────────────────────────────────
    $rectBounds = if ($slotNum -eq 1) {
      # Red: R 130-255, G 0-80, B 0-80
      [CardAnalyzer]::FindColorBounds($bmp, 130,255, 0,80, 0,80)
    } else {
      # Blue: R 0-80, G 0-100, B 130-255
      [CardAnalyzer]::FindColorBounds($bmp, 0,80, 0,100, 130,255)
    }

    if ($rectBounds.IsEmpty) {
      throw "Could not detect the $colorName calibration rectangle in the scan.`nEnsure the card was printed with the full-tray calibration pattern."
    }

    $rectW_mm = [Math]::Round($rectBounds.Width  / $pxPerMm, 1)
    $rectH_mm = [Math]::Round($rectBounds.Height / $pxPerMm, 1)
    Write-Host "  ${colorName} rect:  $($rectBounds.X)x$($rectBounds.Y) px  →  ${rectW_mm} x ${rectH_mm} mm"

    # ── 3. compute offset and correction ─────────────────────────────────────
    # offset: how far the rectangle's edge is FROM the card edge
    # positive = rectangle is INSIDE the card (slot value was too large)
    $offsetLeft_mm = [Math]::Round(($rectBounds.Left - $cardBounds.Left) / $pxPerMm, 2)
    $offsetTop_mm  = [Math]::Round(($rectBounds.Top  - $cardBounds.Top)  / $pxPerMm, 2)

    $newLeft = [Math]::Round($currentLeft - $offsetLeft_mm, 2)
    $newTop  = [Math]::Round($currentTop  - $offsetTop_mm,  2)

    Write-Host ""
    Write-Host "  Offset from card edge:"
    $lDir = if ($offsetLeft_mm -gt 0.4) {'inside (too far right)'} elseif ($offsetLeft_mm -lt -0.4) {'outside (too far left)'} else {'aligned'}
    $tDir = if ($offsetTop_mm  -gt 0.4) {'inside (too low)'}       elseif ($offsetTop_mm  -lt -0.4) {'outside (too high)'}      else {'aligned'}
    Write-Host ("    left : {0:+0.00;-0.00} mm  ({1})" -f $offsetLeft_mm, $lDir)
    Write-Host ("    top  : {0:+0.00;-0.00} mm  ({2})" -f $offsetTop_mm,  $tDir)
    Write-Host ""
    Write-Host "  Correction:"
    Write-Host "    $leftKey = $(Format-Mm $newLeft)   (was $(Format-Mm $currentLeft))"
    Write-Host "    $topKey  = $(Format-Mm $newTop)   (was $(Format-Mm $currentTop))"

    return @{ LeftKey = $leftKey; TopKey = $topKey; NewLeft = $newLeft; NewTop = $newTop }
  }
  finally { $bmp.Dispose() }
}

# ── main loop: slot 1, slot 2, or both ───────────────────────────────────────
$slots = if ($Slot -eq 'both') { @(1,2) } else { @([int]$Slot) }
$corrections = @()

foreach ($s in $slots) {
  Write-Host ""
  Write-Host "=== Slot $s calibration ($(if ($s -eq 1) {'RED'} else {'BLUE'}) rectangle) ==="
  Write-Host "  Current: LEFT=$(Format-Mm $(if ($s -eq 1) {$slot1Left} else {$slot2Left}))  TOP=$(Format-Mm $(if ($s -eq 1) {$slot1Top} else {$slot2Top}))"
  Write-Host ""

  if (-not $NoPrompt) {
    Write-Host "  Place the SLOT $s calibration card FACE-DOWN on the HP scanner glass."
    Write-Host "  Leave the scanner lid OPEN (dark background helps detect card edges)."
    Write-Host "  Press Enter when ready..."
    $null = Read-Host
  }

  $stamp    = [datetime]::Now.ToString('yyyyMMdd-HHmmss')
  $scanPath = Join-Path $ScanOutputDir "calib-slot${s}-${stamp}.png"

  Invoke-Scan $scanPath "slot $s"

  $cL = if ($s -eq 1) { $slot1Left  } else { $slot2Left  }
  $cT = if ($s -eq 1) { $slot1Top   } else { $slot2Top   }
  $kL = if ($s -eq 1) { 'EPSON_CARD_SLOT_LEFT_MM'  } else { 'EPSON_CARD_SLOT2_LEFT_MM' }
  $kT = if ($s -eq 1) { 'EPSON_CARD_SLOT_TOP_MM'   } else { 'EPSON_CARD_SLOT2_TOP_MM'  }

  $result = Measure-Slot $scanPath $s $cL $cT $kL $kT
  $corrections += $result
}

# ── apply corrections ─────────────────────────────────────────────────────────
Write-Host ""
if ($UpdateEnv) {
  $lines = [IO.File]::ReadAllLines($EnvFile)
  foreach ($c in $corrections) {
    $lines = Set-EnvValue $lines $c.LeftKey (Format-Mm $c.NewLeft)
    $lines = Set-EnvValue $lines $c.TopKey  (Format-Mm $c.NewTop)
  }
  [IO.File]::WriteAllLines($EnvFile, $lines)
  Write-Host "Updated $EnvFile"
  Write-Host "Restart the print server and re-print calibration to verify:"
  Write-Host "  .\print-card-tray-calibration.ps1"
} else {
  Write-Host "Run again with -UpdateEnv to apply corrections."
  Write-Host "Or apply manually to: $EnvFile"
}

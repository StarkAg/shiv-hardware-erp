param(
  [double]$PrintedTooFarRightMm = 0,
  [double]$PrintedTooFarLeftMm = 0,
  [double]$PrintedTooHighMm = 0,
  [double]$PrintedTooLowMm = 0,
  [Nullable[double]]$SetLeftMm = $null,
  [Nullable[double]]$SetTopMm = $null,
  [switch]$Restart,
  [switch]$PrintTest,
  [string]$PrintServerUrl = "http://localhost:3333"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $root ".env"

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Missing .env: $envPath"
}

function Get-EnvNumber([string[]]$Lines, [string]$Name, [double]$Default) {
  foreach ($line in $Lines) {
    if ($line -match "^\s*$([regex]::Escape($Name))=(.*)$") {
      $raw = $Matches[1].Trim()
      $value = 0.0
      if ([double]::TryParse($raw, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$value)) {
        return $value
      }
      return $Default
    }
  }
  return $Default
}

function Set-EnvValue([string[]]$Lines, [string]$Name, [string]$Value) {
  $updated = $false
  $next = foreach ($line in $Lines) {
    if ($line -match "^\s*$([regex]::Escape($Name))=") {
      $updated = $true
      "$Name=$Value"
    } else {
      $line
    }
  }

  if (-not $updated) {
    $next += "$Name=$Value"
  }

  return [string[]]$next
}

function Format-Mm([double]$Value) {
  return $Value.ToString("0.###", [Globalization.CultureInfo]::InvariantCulture)
}

function Restart-PrintServer {
  $listener = Get-NetTCPConnection -LocalPort 3333 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force
    Start-Sleep -Seconds 2
  }

  Start-Process -FilePath "node.exe" -ArgumentList "server.mjs" -WorkingDirectory $root -WindowStyle Hidden
  Start-Sleep -Seconds 5
}

function Send-TestCard([double]$Left, [double]$Top) {
  $id = "CAL-{0:yyyyMMdd-HHmmss}" -f (Get-Date)
  $body = @{
    kind = "guarantee"
    layout = "card"
    copies = 1
    document = @{
      id = $id
      number = $id
      date = (Get-Date).ToString("o")
      customer = @{
        id = "calibration"
        name = "PVC CALIBRATION"
        mobile = "9138261300"
        uid = "L$(Format-Mm $Left)-T$(Format-Mm $Top)"
        address = "Ramgarh Cantt"
      }
      category = "readymade-door"
      height = @{ inches = 79; soot = 4 }
      width = @{ inches = 31; soot = 2 }
      qty = 1
      items = @(
        @{
          brandId = "calibration"
          brandName = "Measure border offset in mm"
          category = "readymade-door"
          rate = 0
          cost = 0
          guaranteeYears = 10
          coverage = "guarantee"
        }
      )
    }
  } | ConvertTo-Json -Depth 20

  Invoke-RestMethod -Uri "$PrintServerUrl/print" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 180
}

$lines = [IO.File]::ReadAllLines($envPath)
$oldLeft = Get-EnvNumber $lines "EPSON_CARD_SLOT_LEFT_MM" 10
$oldTop = Get-EnvNumber $lines "EPSON_CARD_SLOT_TOP_MM" 28

$newLeft = if ($null -ne $SetLeftMm) {
  [double]$SetLeftMm
} else {
  $oldLeft - $PrintedTooFarRightMm + $PrintedTooFarLeftMm
}

$newTop = if ($null -ne $SetTopMm) {
  [double]$SetTopMm
} else {
  $oldTop + $PrintedTooHighMm - $PrintedTooLowMm
}

$lines = Set-EnvValue $lines "EPSON_CARD_SLOT_LEFT_MM" (Format-Mm $newLeft)
$lines = Set-EnvValue $lines "EPSON_CARD_SLOT_TOP_MM" (Format-Mm $newTop)
[IO.File]::WriteAllLines($envPath, $lines)

Write-Host "Card slot calibration updated:"
Write-Host "  Left: $(Format-Mm $oldLeft) -> $(Format-Mm $newLeft) mm"
Write-Host "  Top:  $(Format-Mm $oldTop) -> $(Format-Mm $newTop) mm"
Write-Host ""
Write-Host "Rules:"
Write-Host "  printed too far right  => -PrintedTooFarRightMm"
Write-Host "  printed too far left   => -PrintedTooFarLeftMm"
Write-Host "  printed too high       => -PrintedTooHighMm"
Write-Host "  printed too low        => -PrintedTooLowMm"

if ($Restart) {
  Restart-PrintServer
  Write-Host "Print server restarted."
}

if ($PrintTest) {
  $result = Send-TestCard $newLeft $newTop
  Write-Host "Calibration test sent:"
  $result | ConvertTo-Json -Depth 10
}

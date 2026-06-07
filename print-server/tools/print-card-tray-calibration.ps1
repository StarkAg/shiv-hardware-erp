param(
  [string]$EnvFile = (Join-Path $PSScriptRoot "..\.env"),
  [int]$Copies = 1
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Missing env file: $EnvFile"
}

function Read-Env([string]$Path) {
  $values = @{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
    if ($line -match '^\s*([^=]+)=(.*)$') {
      $values[$Matches[1].Trim()] = $Matches[2].Trim()
    }
  }
  return $values
}

function Get-EnvValue($Env, [string]$Name, [string]$Default) {
  if ($Env.ContainsKey($Name) -and $Env[$Name]) { return $Env[$Name] }
  return $Default
}

$envValues = Read-Env $EnvFile
$printer = Get-EnvValue $envValues "COLOR_PRINTER" "EPSON L8050 Series"
$devmode = Get-EnvValue $envValues "EPSON_CARD_DEVMODE_PATH" (Join-Path $PSScriptRoot "..\data\epson-card.devmode")
$slot1Left = Get-EnvValue $envValues "EPSON_CARD_SLOT_LEFT_MM" "10"
$slot1Top = Get-EnvValue $envValues "EPSON_CARD_SLOT_TOP_MM" "28"
$slot2Left = Get-EnvValue $envValues "EPSON_CARD_SLOT2_LEFT_MM" "74"
$slot2Top = Get-EnvValue $envValues "EPSON_CARD_SLOT2_TOP_MM" $slot1Top
$offsetX = Get-EnvValue $envValues "EPSON_CARD_OFFSET_X_MM" "0"
$offsetY = Get-EnvValue $envValues "EPSON_CARD_OFFSET_Y_MM" "0"
$scale = Get-EnvValue $envValues "EPSON_CARD_SCALE_PERCENT" "100"

& (Join-Path $PSScriptRoot "print-card-gdi.ps1") `
  -PrinterName $printer `
  -DevmodeFile $devmode `
  -Copies $Copies `
  -JobName "Shiv PVC Full Tray Calibration" `
  -FullTrayCalibration `
  -SlotLeftMm $slot1Left `
  -SlotTopMm $slot1Top `
  -Slot2LeftMm $slot2Left `
  -Slot2TopMm $slot2Top `
  -OffsetXmm $offsetX `
  -OffsetYmm $offsetY `
  -ScalePercent $scale

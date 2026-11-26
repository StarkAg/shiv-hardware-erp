param(
  [string]$TaskName = 'Shiv Print Server'
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startScript = Join-Path $scriptDir 'start-hidden.vbs'

if (-not (Test-Path -LiteralPath $startScript)) {
  throw "Missing startup script: $startScript"
}

$action = New-ScheduledTaskAction `
  -Execute 'wscript.exe' `
  -Argument "`"$startScript`"" `
  -WorkingDirectory $scriptDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description 'Starts the Shiv Hardware print server when this Windows user logs in.' `
  -Force | Out-Null

# Every 2 minutes, health-check.ps1 asks the server /status and restarts it if
# it is hung or the whole chain is gone (what the restart loops cannot see).
$healthName = "$TaskName Health"
$healthScript = Join-Path $scriptDir 'health-check-hidden.vbs'
$healthAction = New-ScheduledTaskAction `
  -Execute 'wscript.exe' `
  -Argument "`"$healthScript`"" `
  -WorkingDirectory $scriptDir
$healthTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 2)
$healthSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $healthName `
  -Action $healthAction `
  -Trigger $healthTrigger `
  -Settings $healthSettings `
  -Principal $principal `
  -Description 'Every 2 minutes: restarts the Shiv Hardware print server if it is hung or not running.' `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName, $healthName | Select-Object TaskName, State, TaskPath

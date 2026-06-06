param(
  [string]$TaskName = 'Shiv Hardware Auto Start'
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startScript = Join-Path $scriptDir 'start-all-hidden.vbs'

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
  -Description 'Starts the Shiv Hardware panel and print server when this Windows user logs in.' `
  -Force | Out-Null

if (Get-ScheduledTask -TaskName 'Shiv Print Server' -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName 'Shiv Print Server' -Confirm:$false
}

Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State, TaskPath

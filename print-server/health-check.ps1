# Health check for Shiv Print Server. The "Shiv Print Server Health" task
# (install-autostart.ps1) runs it every 2 minutes, through health-check-hidden.vbs.
#
# start-watchdog.ps1 and run.mjs already restart a server that crashes. This
# catches what they cannot: a server that is running but no longer answers
# (hung), and the whole chain gone (killed, or never started after logon).
# It acts only after two checks in a row fail, about 2 minutes apart, so a
# server that is busy for a moment or still starting is left alone.

$dir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$port  = 3333
$log   = Join-Path $dir 'shiv-print-server.health.log'
$state = Join-Path $env:LOCALAPPDATA 'ShivPrintServer'
$fails = Join-Path $state 'health-fails.txt'
$last  = Join-Path $state 'health-restarted.txt'
New-Item -ItemType Directory -Force -Path $state | Out-Null

function Write-Log($text) { Add-Content $log "[$(Get-Date -f 'dd-MM-yyyy HH:mm:ss')] $text" }

function Test-Server {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$port/status" -TimeoutSec 15 -UseBasicParsing
    return [bool]$r.ok
  } catch { return $false }
}

if (Test-Server) {
  if (Test-Path $fails) { Remove-Item $fails -Force; Write-Log 'Answering again' }
  exit 0
}

# Give a restart we made 4 minutes to come up before judging it.
if (Test-Path $last) {
  $since = (Get-Date) - (Get-Item $last).LastWriteTime
  if ($since.TotalMinutes -lt 4) { exit 0 }
}

$count = 1
if (Test-Path $fails) { $count = [int](Get-Content $fails -Raw) + 1 }
Set-Content $fails $count
if ($count -lt 2) {
  Write-Log 'No answer on /status, checking again next round'
  exit 0
}

Remove-Item $fails -Force
Set-Content $last (Get-Date -f o)

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq 'node') {
    # Hung: kill only server.mjs (and the Chrome it opened). run.mjs starts a
    # fresh one within seconds.
    Write-Log "Hung (port $port open, no answer twice), killing server PID $($proc.Id)"
    & taskkill.exe /PID $proc.Id /T /F | Out-Null
    exit 0
  }
  Write-Log "Port $port is held by '$($proc.ProcessName)' (PID $($listener.OwningProcess)), not the print server; left alone"
  exit 0
}

# Nothing listening for two checks: the restart chain is gone or stuck.
# Stop whatever is left of it and start it again from scratch.
Write-Log "Down (nothing on port $port twice), restarting the whole chain"
Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='cmd.exe'" |
  Where-Object { $_.CommandLine -match 'start-watchdog\.ps1|print-server\\start-windows\.cmd' } |
  ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F | Out-Null }
Start-Sleep -Seconds 2
Start-Process 'wscript.exe' -ArgumentList "`"$(Join-Path $dir 'start-hidden.vbs')`"" -WorkingDirectory $dir
Write-Log 'Started start-hidden.vbs'

# Auto-start and restart watchdog for Shiv Print Server
$dir  = Split-Path $MyInvocation.MyCommand.Path
$node = 'C:\Program Files\nodejs\node.exe'
$log  = Join-Path $dir 'shiv-print-server.log'
$err  = Join-Path $dir 'shiv-print-server.err.log'
$auto = Join-Path $dir 'shiv-print-server.autostart.log'

$existing = Get-NetTCPConnection -LocalPort 3333 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    Add-Content $auto "[$(Get-Date -f 'dd-MM-yyyy HH:mm:ss')] Shiv Print Server already listening on port 3333 with PID $($existing.OwningProcess)"
    exit 0
}

while ($true) {
    Add-Content $log "[$(Get-Date -f 'dd-MM-yyyy HH:mm:ss')] Shiv Print Server starting"
    # --watch: Node auto-restarts itself whenever server.mjs/template.mjs (or
    # anything else it imports) changes on disk, so edits take effect live
    # without this script (or a person) having to kill/relaunch it. If the
    # process dies outright (crash, not a file-change restart), this loop's
    # own 5s-retry still kicks in as the crash-safety net.
    $cmdArgs = "/c `"$node`" --watch server.mjs 1>>`"$log`" 2>>`"$err`""
    $p = Start-Process 'cmd.exe' -ArgumentList $cmdArgs -WorkingDirectory $dir -WindowStyle Hidden -PassThru -Wait
    Add-Content $log "[$(Get-Date -f 'dd-MM-yyyy HH:mm:ss')] Shiv Print Server exited (code $($p.ExitCode)), restarting in 5s"
    Start-Sleep 5
}
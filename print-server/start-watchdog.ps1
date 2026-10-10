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
    # run.mjs starts server.mjs, restarts it whenever server.mjs/template.mjs
    # (any .mjs here) is really changed on disk, so edits take effect live, and
    # restarts it if it crashes. Not `node --watch`: on Windows that restarted
    # the server every time a file was merely read (see run.mjs). This loop is
    # only the safety net for run.mjs itself dying.
    # The outer pair of quotes is for cmd: /c strips the first and last quote of
    # its line, which without them left `C:\Program Files\...` unquoted, so this
    # script exited with code 1 at once and never ran the server (2026-10-10).
    $cmdArgs = "/c `"`"$node`" run.mjs 1>>`"$log`" 2>>`"$err`"`""
    $p = Start-Process 'cmd.exe' -ArgumentList $cmdArgs -WorkingDirectory $dir -WindowStyle Hidden -PassThru -Wait
    Add-Content $log "[$(Get-Date -f 'dd-MM-yyyy HH:mm:ss')] Shiv Print Server exited (code $($p.ExitCode)), restarting in 5s"
    Start-Sleep 5
}
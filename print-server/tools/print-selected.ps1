# Ctrl+Alt+P: print the files selected in File Explorer or on the Desktop.
# Copies them into the Print Drop folder (originals stay put); the print server
# fits them to A4, auto-rotates, photos -> Epson colour, PDFs -> HP B/W, and
# falls back to the other printer when one is offline. A tray icon shows while
# printing, then a message says what actually happened.
param(
  [string]$Mode = '',   # '' = auto, 'Color', 'Black & White'
  [switch]$DryRun       # only report what is selected; print nothing
)

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);

  public static string ClassOf(IntPtr h) {
    var sb = new StringBuilder(256);
    GetClassName(h, sb, 256);
    return sb.ToString();
  }

  // Visible, non-minimized File Explorer windows, topmost first.
  public static List<long> ExplorerWindowsTopFirst() {
    var list = new List<long>();
    for (IntPtr h = GetTopWindow(IntPtr.Zero); h != IntPtr.Zero; h = GetWindow(h, 2 /* GW_HWNDNEXT */)) {
      if (IsWindowVisible(h) && !IsIconic(h) && ClassOf(h) == "CabinetWClass") list.Add(h.ToInt64());
    }
    return list;
  }
}
'@
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$server = 'http://127.0.0.1:3333'
$dropRoot = Join-Path $env:USERPROFILE 'Print Drop'
$autoStart = Join-Path (Split-Path (Split-Path $PSScriptRoot)) 'start-all-hidden.vbs'

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon("$env:WINDIR\System32\printui.exe")
$tray.Text = 'Shiv Print'
$tray.Visible = $true

function Show-Message([string]$title, [string]$text, [string]$kind = 'Info') {
  if ($text.Length -gt 250) { $text = $text.Substring(0, 247) + '...' }   # Windows limit
  $tray.ShowBalloonTip(5000, $title, $text, $kind)
}

function Finish([int]$waitSeconds = 6) {
  Start-Sleep -Seconds $waitSeconds
  $tray.Dispose()
  exit 0
}

$logFile = Join-Path $env:TEMP 'shiv-print-selected.log'
function Log([string]$line) {
  try { Add-Content -LiteralPath $logFile -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $line) } catch {}
}

function Get-FilesFromViews($views) {
  @($views | Select-Object -First 1 | ForEach-Object { $_.Document.SelectedItems() } |
    Where-Object { -not $_.IsFolder } | ForEach-Object { $_.Path })
}

function Get-ExplorerFiles($shellWindows, [long]$hwnd) {
  $title = New-Object System.Text.StringBuilder 512
  [void][Fg]::GetWindowText([IntPtr]$hwnd, $title, 512)
  # One Explorer window can hold several tabs (same HWND); its title names the active tab.
  $views = @($shellWindows | Where-Object { $_.HWND -eq $hwnd })
  if ($views.Count -gt 1) {
    $active = @($views | Where-Object { $title.ToString() -like "$($_.LocationName)*" })
    if ($active.Count -ge 1) { $views = $active }
  }
  Get-FilesFromViews $views
}

function Get-DesktopFiles($shellWindows) {
  # SWC_DESKTOP = 8, SWFO_NEEDDISPATCH = 1
  $desktopHwnd = 0
  Get-FilesFromViews @($shellWindows.FindWindowSW(0, $null, 8, [ref]$desktopHwnd, 1))
}

function Get-SelectedFiles {
  $shellWindows = (New-Object -ComObject Shell.Application).Windows()
  $fg = [Fg]::GetForegroundWindow()
  $fgClass = [Fg]::ClassOf($fg)
  Log "foreground hwnd=$fg class=$fgClass"

  # 1. The window that has focus, when it is the Desktop or a File Explorer window.
  if ($fgClass -in @('Progman', 'WorkerW')) {
    $files = Get-DesktopFiles $shellWindows
    Log "desktop (foreground): $($files.Count) selected"
    if ($files.Count) { return $files }
  } elseif ($fgClass -eq 'CabinetWClass') {
    $files = Get-ExplorerFiles $shellWindows $fg.ToInt64()
    Log "explorer (foreground): $($files.Count) selected"
    if ($files.Count) { return $files }
  }

  # 2. Focus moved elsewhere while the shortcut started: use the topmost
  #    Explorer window that has a selection, then the Desktop.
  foreach ($hwnd in [Fg]::ExplorerWindowsTopFirst()) {
    $files = Get-ExplorerFiles $shellWindows $hwnd
    Log "explorer hwnd=${hwnd}: $($files.Count) selected"
    if ($files.Count) { return $files }
  }
  $files = Get-DesktopFiles $shellWindows
  Log "desktop (fallback): $($files.Count) selected"
  return $files
}

function Get-DropStatus {
  try { Invoke-RestMethod "$server/drop-print/status" -TimeoutSec 3 } catch { $null }
}

function To-LocalTime($value) {
  if ($value -is [datetime]) { return $value.ToLocalTime() }
  [DateTimeOffset]::Parse([string]$value).LocalDateTime
}

function Describe-Printer([string]$printer) {
  if ($printer -match 'EPSON') { 'Epson (colour)' } elseif ($printer -match 'HP') { 'HP (black & white)' } else { $printer }
}

# ── 1. What's selected ─────────────────────────────────────────────────────────
$files = Get-SelectedFiles
if ($DryRun) { $files; $tray.Dispose(); exit 0 }
if ($files.Count -eq 0) {
  Show-Message 'Nothing selected' 'Select PDFs or photos in File Explorer or on the Desktop, then press Ctrl+Alt+P.' 'Warning'
  Finish
}
$printable = '\.(pdf|jpe?g|png|webp|gif)$'
$skipped = @($files | Where-Object { $_ -notmatch $printable } | ForEach-Object { Split-Path $_ -Leaf })
$files = @($files | Where-Object { $_ -match $printable })
if ($files.Count -eq 0) {
  Show-Message 'Only PDFs and photos' "Can't print this way: $($skipped -join ', '). Select PDF, JPG, PNG, WEBP or GIF files." 'Warning'
  Finish
}
$names = @($files | ForEach-Object { Split-Path $_ -Leaf })
$count = $files.Count
$plural = if ($count -eq 1) { '' } else { 's' }

# ── 2. Hand the files to the print server ──────────────────────────────────────
$dropDir = if ($Mode) { Join-Path $dropRoot $Mode } else { $dropRoot }
if (-not (Test-Path $dropDir)) { New-Item -ItemType Directory -Force $dropDir | Out-Null }
$serverUp = $null -ne (Get-DropStatus)
$started = (Get-Date).AddSeconds(-2)
foreach ($f in $files) { Copy-Item -LiteralPath $f -Destination $dropDir -Force }

if (-not $serverUp) {
  # Files are safe in the folder; they print as soon as the server is running.
  if (Test-Path $autoStart) { Start-Process wscript.exe -ArgumentList "`"$autoStart`"" -WindowStyle Hidden }
  Show-Message 'Print server was off' "Starting it now. Your $count file$plural will print in about a minute." 'Warning'
  Finish 8
}

$tray.Text = "Shiv Print: printing $count file$plural..."
Show-Message "Printing $count file$plural..." ($names -join ', ')

# ── 3. Follow the job until every file has a result ────────────────────────────
$results = @{}
$waitingNames = @()
$deadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  $status = Get-DropStatus
  if (-not $status) { continue }   # server restarting; keep trying until the deadline
  foreach ($name in $names) {
    if ($results.ContainsKey($name)) { continue }
    $hit = $status.recent | Where-Object { $_.name -eq $name -and (To-LocalTime $_.at) -ge $started } | Select-Object -First 1
    if ($hit) { $results[$name] = $hit }
  }
  $waitingNames = @($status.waiting | Where-Object { $names -contains $_.name } | ForEach-Object { $_.name })
  if ($results.Count + $waitingNames.Count -ge $count) { break }
}

# ── 4. Tell the user what happened ─────────────────────────────────────────────
$printed = @($results.Values | Where-Object { $_.result -eq 'printed' })
$failed = @($results.Values | Where-Object { $_.result -eq 'failed' })
$unsupported = @($results.Values | Where-Object { $_.result -eq 'unsupported' })
$notes = @()

if ($printed.Count -gt 0) {
  $on = ($printed | ForEach-Object { Describe-Printer $_.printer } | Select-Object -Unique) -join ' + '
  $notes += "Printed $($printed.Count) on $on."
  $fellBack = @($printed | Where-Object { $_.fallback })
  if ($fellBack.Count -gt 0) {
    $from = Describe-Printer ($fellBack[0].fallback.from)
    $notes += "$from was not available, so the other printer was used."
  }
}
if ($waitingNames.Count -gt 0) { $notes += "$($waitingNames.Count) waiting: no printer is on. They will print by themselves when a printer is back." }
if ($failed.Count -gt 0) { $notes += "Failed: $(($failed | ForEach-Object { $_.name }) -join ', '). Kept in Print Drop\_Failed." }
if ($unsupported.Count -gt 0) { $notes += "Not a PDF/photo: $(($unsupported | ForEach-Object { $_.name }) -join ', ')." }
if ($skipped.Count -gt 0) { $notes += "Skipped (not a PDF/photo): $($skipped -join ', ')." }
$pending = $count - $results.Count - $waitingNames.Count
if ($pending -gt 0) { $notes += "$pending still in progress. Check the printer." }

if ($failed.Count -gt 0) { $title = 'Some files did not print'; $kind = 'Error' }
elseif ($waitingNames.Count -gt 0) { $title = 'Printer offline'; $kind = 'Warning' }
elseif ($printed.Count -eq $count) { $title = "Printed $count file$plural"; $kind = 'Info' }
else { $title = 'Shiv Print'; $kind = 'Warning' }

$tray.Text = 'Shiv Print'
Show-Message $title ($notes -join ' ') $kind
Finish 8

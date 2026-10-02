# Draws the Shiv Quotation app icon and packs it into a multi-size .ico.
#
#   powershell -ExecutionPolicy Bypass -File scripts/make-quotation-icon.ps1
#
# Gold rounded tile (the counter's accent colour), a white quotation sheet with
# a folded corner and a rupee sign, and a dark "S" badge tying it to the panel's
# "S" icon. Writes build/icon-quotation.ico (exe, installer, shortcut) and
# public/quotation-icon.ico (window/taskbar icon at runtime).
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$sizes = 16, 24, 32, 48, 64, 128, 256

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Draw-Icon([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::Transparent)
  $s = $size / 256.0
  $g.ScaleTransform($s, $s)

  # Gold tile.
  $tile = New-RoundedPath 12 12 232 232 52
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.PointF 12, 12), (New-Object System.Drawing.PointF 244, 244), ([System.Drawing.Color]::FromArgb(255, 212, 168, 92)), ([System.Drawing.Color]::FromArgb(255, 150, 108, 46))
  $g.FillPath($grad, $tile)

  # Quotation sheet with a folded top-right corner.
  $fold = 38
  $sx = 58; $sy = 36; $sw = 116; $sh = 160
  $sheet = New-Object System.Drawing.Drawing2D.GraphicsPath
  $sheet.AddLines([System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF $sx, $sy),
    (New-Object System.Drawing.PointF ($sx + $sw - $fold), $sy),
    (New-Object System.Drawing.PointF ($sx + $sw), ($sy + $fold)),
    (New-Object System.Drawing.PointF ($sx + $sw), ($sy + $sh)),
    (New-Object System.Drawing.PointF $sx, ($sy + $sh))
  ))
  $sheet.CloseFigure()
  $shadow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(60, 70, 45, 10))
  $g.TranslateTransform(5, 6); $g.FillPath($shadow, $sheet); $g.TranslateTransform(-5, -6)
  $g.FillPath([System.Drawing.Brushes]::White, $sheet)
  $foldPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $foldPath.AddLines([System.Drawing.PointF[]]@(
    (New-Object System.Drawing.PointF ($sx + $sw - $fold), $sy),
    (New-Object System.Drawing.PointF ($sx + $sw - $fold), ($sy + $fold)),
    (New-Object System.Drawing.PointF ($sx + $sw), ($sy + $fold))
  ))
  $foldPath.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 236, 222, 194))), $foldPath)

  # Rupee sign + item lines (lines dropped at tiny sizes where they'd smear).
  $gold = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 160, 116, 48))
  $font = New-Object System.Drawing.Font 'Segoe UI', 64, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
  $g.DrawString([string][char]0x20B9, $font, $gold, (New-Object System.Drawing.RectangleF $sx, ($sy + 14), ($sw - 14), 80), $fmt)
  if ($size -ge 48) {
    $line = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 222, 204, 168))
    foreach ($ly in 112, 134, 156) {
      $lw = if ($ly -eq 156) { 48 } else { 80 }
      $g.FillPath($line, (New-RoundedPath ($sx + 18) $ly $lw 10 5))
    }
  }

  # Dark "S" badge.
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 29, 35, 48))), 142, 142, 92, 92)
  $g.DrawEllipse((New-Object System.Drawing.Pen ([System.Drawing.Color]::White), 6), 142, 142, 92, 92)
  $sFont = New-Object System.Drawing.Font 'Segoe UI', 62, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawString('S', $sFont, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 142, 145, 92, 92), $fmt)

  $g.Dispose()
  return $bmp
}

# ICO with PNG-compressed entries (Vista+ format, what the panel's icon uses).
$pngs = foreach ($sz in $sizes) {
  $ms = New-Object System.IO.MemoryStream
  (Draw-Icon $sz).Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  , $ms.ToArray()
}
$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $out
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
  $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
  $bw.Write([uint16]1); $bw.Write([uint16]32)
  $bw.Write([uint32]$pngs[$i].Length); $bw.Write([uint32]$offset)
  $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Flush()

foreach ($target in (Join-Path $root 'build\icon-quotation.ico'), (Join-Path $root 'public\quotation-icon.ico')) {
  [System.IO.File]::WriteAllBytes($target, $out.ToArray())
  Write-Output "wrote $target ($($out.Length) bytes)"
}
(Draw-Icon 256).Save((Join-Path $root 'build\icon-quotation.png'), [System.Drawing.Imaging.ImageFormat]::Png)

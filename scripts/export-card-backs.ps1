# Copy the card-back designs (..\card-backs\out\*.png, the same designs as
# Desktop\Epson\Improved) into the app: a print JPEG (full 2x size, card + 3 mm
# bleed) and a small preview per design in public\card-backs, and the list the
# Card backs screen shows in src\features\guarantee\cardBacks.json.
#   powershell -File scripts\export-card-backs.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot
$src = Join-Path (Split-Path $root) 'card-backs\out'
$dst = Join-Path $root 'public\card-backs'
New-Item -ItemType Directory -Force $dst | Out-Null
Get-ChildItem $dst -Filter *.jpg | Remove-Item -Force

$jpeg = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
function Save-Jpeg($image, [int]$w, [int]$h, [string]$file, [long]$quality) {
  $bmp = New-Object Drawing.Bitmap $w, $h
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([Drawing.Color]::White)
  $g.DrawImage($image, 0, 0, $w, $h)
  $g.Dispose()
  $params = New-Object Drawing.Imaging.EncoderParameters 1
  $params.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), $quality
  $bmp.Save($file, $jpeg, $params)
  $bmp.Dispose()
}

$list = @()
foreach ($png in Get-ChildItem $src -Filter *.png | Sort-Object Name) {
  $slug = ($png.BaseName.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
  $img = [Drawing.Image]::FromFile($png.FullName)
  try {
    Save-Jpeg $img $img.Width $img.Height (Join-Path $dst "$slug.jpg") 92
    $tw = 260; $th = [int][Math]::Round($img.Height * $tw / $img.Width)
    Save-Jpeg $img $tw $th (Join-Path $dst "$slug-thumb.jpg") 85
  } finally { $img.Dispose() }
  $years = if ($png.BaseName -match '(\d+)\s*Yrs') { [int]$Matches[1] } else { $null }
  $list += [ordered]@{ name = $png.BaseName; file = "$slug.jpg"; thumb = "$slug-thumb.jpg"; years = $years }
}
$json = ConvertTo-Json @($list) -Depth 3
[IO.File]::WriteAllText((Join-Path $root 'src\features\guarantee\cardBacks.json'), $json + "`n", (New-Object Text.UTF8Encoding $false))
"exported $($list.Count) card backs to $dst"

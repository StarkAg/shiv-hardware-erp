param(
  [Parameter(Mandatory = $true)]
  [string]$ImagePath,

  [string]$PrinterName = "EPSON L8050 Series",
  [int]$Copies = 1,
  [string]$JobName = "Shiv PVC ID Card",
  [double]$OffsetXmm = 0,
  [double]$OffsetYmm = 0,
  [double]$ScalePercent = 100
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ImagePath)) {
  throw "Image not found: $ImagePath"
}

$excel = $null
$workbook = $null
$ownsExcel = $false

try {
  try {
    $excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
  } catch {
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $ownsExcel = $true
  }

  $excel.DisplayAlerts = $false

  function Convert-MmToPoints([double]$mm) {
    return $mm * 72.0 / 25.4
  }

  function Set-ColumnWidthInPoints($sheet, [int]$columnIndex, [double]$targetPoints) {
    $column = $sheet.Columns.Item($columnIndex)
    $range = $sheet.Cells.Item(1, $columnIndex)
    $low = 0.1
    $high = 255.0

    for ($i = 0; $i -lt 18; $i++) {
      $mid = ($low + $high) / 2
      $column.ColumnWidth = $mid
      if ([double]$range.Width -lt $targetPoints) {
        $low = $mid
      } else {
        $high = $mid
      }
    }

    $column.ColumnWidth = $high
  }

  # Excel uses the per-user NeXX: alias, not necessarily the physical USB/WSD port.
  $deviceValue = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Devices' -ErrorAction SilentlyContinue).$PrinterName
  $targetActivePrinter = if ($deviceValue -match '([^,]+:)$') { "$PrinterName on $($Matches[1])" } else { $PrinterName }
  if ($excel.ActivePrinter -notlike "$PrinterName*") {
    try {
      $excel.ActivePrinter = $targetActivePrinter
    } catch {
      if ($excel.ActivePrinter -notlike "$PrinterName*") {
        throw
      }
    }
  }

  $workbook = $excel.Workbooks.Add()
  $sheet = $workbook.Worksheets.Item(1)
  $sheet.Name = "PVC ID Card"
  $sheet.Cells.Clear()

  $cardWidth = Convert-MmToPoints 86.0
  $cardHeight = Convert-MmToPoints 54.0
  $offsetX = Convert-MmToPoints $OffsetXmm
  $offsetY = Convert-MmToPoints $OffsetYmm
  $scale = [Math]::Max(1, $ScalePercent) / 100.0
  $imageWidth = $cardWidth * $scale
  $imageHeight = $cardHeight * $scale
  $imageLeft = ($cardWidth - $imageWidth) / 2 + $offsetX
  $imageTop = ($cardHeight - $imageHeight) / 2 + $offsetY

  $sheet.DisplayPageBreaks = $false
  $sheet.Cells.Font.Color = 16777215
  $sheet.Range("A1").Value2 = " "
  $sheet.Range("A1").Interior.Color = 16777215
  Set-ColumnWidthInPoints $sheet 1 $cardWidth
  $sheet.Rows.Item(1).RowHeight = $cardHeight
  $sheet.PageSetup.PrintArea = $sheet.Range("A1").Address($true, $true)
  $sheet.PageSetup.LeftMargin = 0
  $sheet.PageSetup.RightMargin = 0
  $sheet.PageSetup.TopMargin = 0
  $sheet.PageSetup.BottomMargin = 0
  $sheet.PageSetup.HeaderMargin = 0
  $sheet.PageSetup.FooterMargin = 0
  $sheet.PageSetup.CenterHorizontally = $true
  $sheet.PageSetup.CenterVertically = $true
  $sheet.PageSetup.Zoom = $false
  $sheet.PageSetup.FitToPagesWide = 1
  $sheet.PageSetup.FitToPagesTall = 1
  $sheet.PageSetup.Orientation = 2 # xlLandscape
  $sheet.PageSetup.PrintGridlines = $false
  $sheet.PageSetup.PrintHeadings = $false
  $sheet.PageSetup.BlackAndWhite = $false
  $sheet.PageSetup.Draft = $false

  $shape = $sheet.Shapes.AddPicture($ImagePath, $false, $true, $imageLeft, $imageTop, $imageWidth, $imageHeight)
  $shape.LockAspectRatio = 0
  $shape.Left = $imageLeft
  $shape.Top = $imageTop
  $shape.Width = $imageWidth
  $shape.Height = $imageHeight
  $shape.Placement = 1 # xlMoveAndSize

  for ($i = 0; $i -lt [Math]::Max(1, $Copies); $i++) {
    $sheet.PrintOut()
  }

  Write-Host "sent to $PrinterName through Excel: $JobName"
}
finally {
  if ($workbook) { $workbook.Close($false) | Out-Null }
  if ($excel) {
    if ($ownsExcel) { $excel.Quit() }
    [Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

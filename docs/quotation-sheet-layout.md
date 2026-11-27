# Quotation sheets: matching the Excel workbook

The plywood and door quotations (readymade door, flush door, 6 mm, 12 mm and
19 mm) print exactly like the shop's workbook
`Desktop\Epson\Plywood and Door color.xlsm`, one tab per kind:

| Category         | Workbook tab |
|------------------|--------------|
| `readymade-door` | ReadyMade    |
| `flush-door`     | Plain        |
| `plywood-6`      | 6 MM         |
| `block-board-12` | 12 MM        |
| `block-board-19` | 19 MM        |

## What was wrong (27 Nov 2026)

The font was already right: every tab is Arial, and the print was Arial at the
same size (each word's width matched Excel to 0.1 mm). It looked different
because of placement:

- One layout was used for every tab, shifted 13 mm left for the two-column
  tabs. The tabs actually have different column widths, so Height, Width, X,
  Quantity and the Guarantee column were 4 to 7 mm off.
- The rate was right-aligned under a right-aligned "Rate"; Excel puts "Rate"
  at the left and right-aligns the figures under it.
- The 19 MM tab is 13 pt, not 15 (its section titles are 15), with uneven row
  heights in the first section.
- 12 MM and 19 MM have no green title and a larger header box. Section titles
  have a full blank row above and below them.
- The 6 MM tab has the black rule under the size but no yellow band.
- The header picture was a grey-gradient copy without a border. The workbook's
  own picture (white) is now `public/assets/aluminium/header-sheet.png`, with
  Excel's thin black border.

## Where the layout lives

`SHEET_LAYOUTS` in `src/features/print/QuotationPrint.tsx` (the panel) and
`SHEETS` in `print-server/template.mjs` (phone and remote prints) hold the
same table. Change both together. All figures are mm from the top-left of the
A4 page. Text is placed by its baseline, as Excel does: a line of Arial at
line-height 1 has its box top `0.8465 x pt x 0.3528` mm above the baseline.

## Measuring again after the workbook changes

1. Export the tab from Excel to PDF (File > Export, or `ExportAsFixedFormat`
   from PowerShell through `Excel.Application`).
2. Read the PDF with `pdfjs-dist` (already in the project):
   `page.getTextContent()` gives each text's x and baseline
   (`transform[4]`, `transform[5]`, in points from the bottom-left; multiply
   by `210 / viewport.width` for mm). `page.getOperatorList()` gives the
   picture's place and the filled rectangles (yellow band, tints, rule).
3. Render the quotation in the browser and compare each word's left edge,
   right edge and baseline with the PDF's. Everything was within 0.4 mm when
   this was done.

Known differences that are the workbook's, not the layout's: on the 19 MM tab
Assam Gold's cost sits in the next column, and on 12 MM Grace Pro's "7 Years"
is 14 pt and off-centre. On 12 MM and 19 MM Excel colours 7 years red; the
owner's rule (7 years in black, `yearsColor`) is kept.

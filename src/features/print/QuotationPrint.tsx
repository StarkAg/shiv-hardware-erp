import type { CSSProperties, ReactNode } from 'react'
import type { BrandQuoteRow, ProductCategory, Quotation } from '../../lib/types'
import { CATEGORY_LABELS } from '../../lib/types'
import { isAluminium } from '../../lib/aluminium'
import { isUpvc } from '../../lib/upvc'
import { isFixedCard } from '../../lib/data/fixedCards'
import { UpvcPrint } from './UpvcPrint'
import { FixedCardPrint } from './FixedCardPrint'
import { A4Page } from './A4Page'
import { AluminiumPrint } from './AluminiumPrint'
import { BedPlyPrint } from './BedPlyPrint'
import { SizeRatesPrint } from './SizeRatesPrint'
import { assetPath } from '../../lib/assets'
import { enrichQuotation } from '../../lib/pricing'

// Mirrors the old Excel Plywood and Door sheets for non-aluminium quotations.

export const legacyCategoryLabel = (category: Quotation['category']) => ({
  'readymade-door': 'Readymade Door Water Proof',
  'flush-door': 'Flush Door (Plain Door) Water Proof',
  'plywood-6': 'Water Proof Plywood',
  'block-board-12': 'Water Proof Block Board',
  'block-board-19': 'Water Proof Block Board',
  'film-face-ply': 'Film Face Ply',
  'bed-inner-ply': CATEGORY_LABELS['bed-inner-ply'],
  'aluminium-door': CATEGORY_LABELS['aluminium-door'],
  'window-2-track': CATEGORY_LABELS['window-2-track'],
  'window-3-track': CATEGORY_LABELS['window-3-track'],
  'upvc-2-track': CATEGORY_LABELS['upvc-2-track'],
  'upvc-2.5-track': CATEGORY_LABELS['upvc-2.5-track'],
  'upvc-3-track': CATEGORY_LABELS['upvc-3-track'],
  'upvc-door': CATEGORY_LABELS['upvc-door'],
  'wpc-door-frame': CATEGORY_LABELS['wpc-door-frame'],
  'size-rates': CATEGORY_LABELS['size-rates'],
  'hinge': '', 'screw': '', 'aldrop': '', 'handle': '', 'tb': '', 'fevicol': '', 'mica': '', 'tape': '',
}[category])

export const legacyThickness = (category: Quotation['category']) => ({
  'readymade-door': '30 mm',
  'flush-door': '30 mm',
  'plywood-6': '6mm',
  'block-board-12': '12mm',
  'block-board-19': '19mm',
  'film-face-ply': '12mm',
  'bed-inner-ply': '',
  'aluminium-door': '',
  'window-2-track': '',
  'window-3-track': '',
  'upvc-2-track': '', 'upvc-2.5-track': '', 'upvc-3-track': '', 'upvc-door': '', 'wpc-door-frame': '', 'size-rates': '',
  'hinge': '', 'screw': '', 'aldrop': '', 'handle': '', 'tb': '', 'fevicol': '', 'mica': '', 'tape': '',
}[category])

export const legacyDimension = (dim: Quotation['height']) => (
  dim.soot ? `${dim.inches} ${dim.soot}/8"` : dim.inches ? String(dim.inches) : ''
)

/** Section headers inserted between brand groups for block-board categories. */
const SECTION_CONFIG: Partial<Record<ProductCategory, {
  first: string
  breaks: Record<string, string>
}>> = {
  'block-board-12': {
    first: '1. Water Proof Ply',
    breaks: { Amron: '2. Semi Water Proof Ply', 'Assam Gold': '3. Commercial Ply' },
  },
  'block-board-19': {
    first: '1. Water Proof Block Board',
    breaks: { Amron: '2. Semi Water Proof Block Board', 'Assam Gold': '3. Commercial Ply Block Board' },
  },
}

/** Whether this kind of quotation is split into sections (water proof, semi, commercial). */
export const hasSections = (category: ProductCategory) => Boolean(SECTION_CONFIG[category])

/**
 * The first section only — the water proof brands — for a customer who has no
 * use for the cheaper grades: every row before the first section break.
 */
export function firstSectionRows<T extends { brandName: string }>(category: ProductCategory, rows: T[]): T[] {
  const cfg = SECTION_CONFIG[category]
  if (!cfg) return rows
  const cut = rows.findIndex((r) => cfg.breaks[r.brandName])
  return cut === -1 ? rows : rows.slice(0, cut)
}

/**
 * The colour a guarantee prints in, as on the shop's own sheet: 7 years in
 * black, the rest in red. The print server's layout (print-server/template.mjs)
 * follows the same rule.
 */
export const yearsColor = (years: number) => (years === 7 ? '#000000' : '#dc2626')

/**
 * Each sheet as the shop's workbook prints it (Desktop\Epson\Plywood and Door
 * color.xlsm, one tab per kind). Every figure was measured off Excel's own PDF
 * of that tab: mm from the page's top-left, text placed by its baseline (y) as
 * Excel does. docs/quotation-sheet-layout.md says how to measure them again.
 * print-server/template.mjs SHEETS holds the same table; keep the two equal.
 */
export type SheetLayout = {
  /** Font size in pt. The 19 MM tab is 13 pt, its section titles 15. */
  fs: number
  /** Header box (image with its border). */
  img: [left: number, top: number, width: number, height: number]
  /** Baseline of the green product title; null when the tab has none. */
  title: number | null
  /** Left edge of Thickness, Rate, the size row and section titles. */
  left: number
  /** Left and right ends of the yellow size band, the rule and brand tints. */
  band: [number, number]
  /** Whether the size row is on a yellow band (the 6 MM tab has the rule only). */
  yellow: boolean
  /** Baselines of the Thickness/Height/Width/Quantity line and the size row under it. */
  head: number
  size: number
  heightX: number
  /** Right edge of the height figure; "X" and the width follow. */
  heightR: number
  crossX: number
  widthX: number
  qtyX: number
  /** Baseline of the first section title (sheets with sections). */
  section1?: number
  /** Baseline of the "Rate  Brand  Cost ..." line, then of the first brand. */
  rateHead: number
  first: number
  /** Brand row pitch. */
  pitch: number
  /** The tab's own uneven row heights from the first brand on; `pitch` after them. */
  pitches?: number[]
  /** Section titles 2 and 3: baseline distance from the row above, and to the row below. */
  secBefore?: [number, number]
  secAfter?: [number, number]
  /** Right edge of the rate; left of brand and cost; centres of the guarantee and warranty columns. */
  rateR: number
  brandX: number
  costX: number
  gtyC: number
  /** Present on sheets with a separate Warranty column. */
  warC?: number
}

const READYMADE: SheetLayout = {
  fs: 15, img: [28.2, 23.6, 87.5, 52.8], title: 86.1, left: 29.1, band: [28.2, 181.8], yellow: true,
  head: 99.1, size: 105.7, heightX: 99.9, heightR: 115.1, crossX: 119.4, widthX: 126.8, qtyX: 154.5,
  rateHead: 118.5, first: 131.3, pitch: 6.39, rateR: 39.7, brandX: 56.2, costX: 126.8, gtyC: 167.85,
}
/** Plain (flush door): the columns the 12 MM tab shares. */
const PLAIN: SheetLayout = {
  fs: 15, img: [17.6, 21.7, 88.4, 52.8], title: 83.9, left: 17.3, band: [16.4, 193.7], yellow: true,
  head: 96.8, size: 103.2, heightX: 83.5, heightR: 98.7, crossX: 103, widthX: 110.5, qtyX: 138.1,
  rateHead: 116.2, first: 129, pitch: 6.39, rateR: 27.9, brandX: 44.4, costX: 110.5, gtyC: 151.5, warC: 179.75,
}
export const SHEET_LAYOUTS: Partial<Record<ProductCategory, SheetLayout>> = {
  'readymade-door': READYMADE,
  'flush-door': PLAIN,
  'block-board-12': {
    ...PLAIN, img: [18.8, 20.6, 118.7, 64.8], title: null,
    section1: 116, rateHead: 128.8, first: 141.5, secBefore: [12.6, 12.6], secAfter: [12.9, 11.7],
  },
  'block-board-19': {
    fs: 13, img: [17.6, 10.9, 120.3, 64.8], title: null, left: 17.2, band: [16.4, 193.7], yellow: true,
    head: 86.6, size: 92.9, heightX: 85.6, heightR: 98.9, crossX: 103.2, widthX: 110.3, qtyX: 138,
    section1: 106, rateHead: 118.5, first: 131.3, pitch: 5.6, secBefore: [12.8, 11.8], secAfter: [11.5, 11.5],
    pitches: [6.4, 6, 5.8, 6.2, 5.8, 5.6, 5.7, 5.6, 5.6, 5.6, 5.6, 5.6, 5.6, 5.6, 5.6, 5.7, 6],
    rateR: 28, brandX: 44.3, costX: 110.3, gtyC: 151.5, warC: 179.75,
  },
  'plywood-6': {
    fs: 15, img: [19.3, 20.5, 89.2, 52.8], title: 84, left: 18.8, band: [17.9, 170.4], yellow: false,
    head: 95.7, size: 102, heightX: 89.8, heightR: 105.1, crossX: 109.8, widthX: 117.6, qtyX: 141.4,
    rateHead: 113.5, first: 125, pitch: 6.39, rateR: 28.6, brandX: 45.1, costX: 117.6, gtyC: 155.6,
  },
}
/** The header picture as the workbook holds it (its xl/media/image1.png). */
export const SHEET_HEADER = 'assets/aluminium/header-sheet.png'
export const sheetLayout = (category: ProductCategory) => SHEET_LAYOUTS[category] ?? READYMADE

/** Section titles print at 15 pt on every tab. */
const SECTION_FS = 15
/** mm from a line's baseline up to the top of its box, for Arial at line-height 1. */
export const baselineDrop = (pt: number) => 0.8465 * pt * 0.3528

type PrintItem =
  | { kind: 'section'; label: string; y: number }
  | { kind: 'brand'; row: BrandQuoteRow; y: number; h: number }

/** Every brand row (baseline y, row height h) and section title (baseline y). */
function buildPrintItems(category: ProductCategory, rows: BrandQuoteRow[], L: SheetLayout): PrintItem[] {
  const cfg = SECTION_CONFIG[category]
  const items: PrintItem[] = []
  if (cfg) items.push({ kind: 'section', label: cfg.first, y: L.section1 ?? L.rateHead })
  let y = L.first
  let prev: number | null = null
  let sec = 0
  rows.forEach((row, i) => {
    const secLabel = cfg?.breaks[row.brandName]
    if (secLabel && prev !== null) {
      const title = prev + (L.secBefore?.[sec] ?? 2 * L.pitch)
      items.push({ kind: 'section', label: secLabel, y: title })
      y = title + (L.secAfter?.[sec] ?? 2 * L.pitch)
      sec++
    }
    const h = L.pitches?.[i] ?? L.pitch
    items.push({ kind: 'brand', row, y, h })
    prev = y
    y += h
  })
  return items
}

/**
 * Readymade door only, when "Experiment 1" is on (owner's trial, 1 Nov 2026): a box under the rates for the
 * door fitted, filled in by hand. The door's rate and the total are left blank
 * to write in; fitting items and labour are the shop's usual approximate
 * figures. print-server/template.mjs draws the same box.
 */
export const DOOR_FITTING_ITEMS = 1000
export const DOOR_FITTING_LABOUR = 200
export const DOOR_FITTING_NOTE = 'Labour 200 covers both visits: the mechanic first comes home to take measurements, then comes again to fit the door once it arrives.'
const FIT_GAP = 6 // mm below the last rate row

/**
 * Doors printed side by side. Only the first: the space to its right is left
 * clear, and a second or third door is written in there by pen when needed.
 */
export const DOOR_FITTING_COLS = 1

/**
 * Laid out in the sheet's own manner: a green title like the product's, column
 * headings like Rate/Brand/Cost, the row to write in on a yellow band like the
 * size, and the black rule of the size row above the total. Positions are mm
 * from the block's top; print-server/template.mjs doorFittingHtml uses the same.
 */
const FIT = {
  labelLeft: 29, colLeft: 86, colW: 30,
  head: 7, rate: 14, rateH: 8, fitting: 22.6, labour: 29, rowH: 6.39, rule: 36.4, total: 37.2, totalH: 8, note: 47,
}

function DoorFittingBox({ top }: { top: number }) {
  const cols = Array.from({ length: DOOR_FITTING_COLS }, (_, i) => i)
  const at = (y: number) => `${top + y}mm`
  const fitEnd = FIT.colLeft + DOOR_FITTING_COLS * FIT.colW
  const row = (y: number, h: number, label: string, cell: (c: number) => string, style?: CSSProperties) => (
    <div className="absolute left-0 right-0 flex items-center" style={{ top: at(y), height: `${h}mm`, ...style }}>
      <span className="absolute" style={{ left: `${FIT.labelLeft}mm` }}>{label}</span>
      {cols.map((c) => (
        <span key={c} className="absolute text-center" style={{ left: `${FIT.colLeft + c * FIT.colW}mm`, width: `${FIT.colW}mm` }}>{cell(c)}</span>
      ))}
    </div>
  )
  return (
    <div className="absolute inset-0 text-[15pt] leading-[1.1]">
      <div className="absolute text-[#00b050]" style={{ left: `${FIT.labelLeft}mm`, top: at(0) }}>Door with Fitting</div>
      {row(FIT.head, FIT.rowH, '', (c) => `Door ${c + 1}`)}
      <div className="absolute" style={{ left: `${FIT.labelLeft}mm`, width: `${fitEnd - FIT.labelLeft}mm`, top: at(FIT.rate), height: `${FIT.rateH}mm`, backgroundColor: '#FFFF00' }} />
      {row(FIT.rate, FIT.rateH, 'Door Rate', () => '')}
      {row(FIT.fitting, FIT.rowH, 'Fitting Items (Approx.)', () => String(DOOR_FITTING_ITEMS))}
      {row(FIT.labour, FIT.rowH, 'Labour', () => String(DOOR_FITTING_LABOUR))}
      <div className="absolute border-t-[1.5px] border-black" style={{ left: `${FIT.labelLeft}mm`, width: `${fitEnd - FIT.labelLeft}mm`, top: at(FIT.rule) }} />
      {row(FIT.total, FIT.totalH, 'Total', () => '', { fontWeight: 700 })}
      <div className="absolute text-[12pt] leading-[1.25]" style={{ left: `${FIT.labelLeft}mm`, right: '34mm', top: at(FIT.note) }}>{DOOR_FITTING_NOTE}</div>
    </div>
  )
}

export function QuotationPrint({ quote }: { quote: Quotation }) {
  if (quote.bed) return <BedPlyPrint quote={quote} />
  if (quote.sizeRates) return <SizeRatesPrint quote={quote} />
  if (isAluminium(quote.category)) return <AluminiumPrint quote={quote} />
  if (isUpvc(quote.category)) return <UpvcPrint quote={quote} />
  if (isFixedCard(quote.category)) return <FixedCardPrint quote={quote} />
  const enrichedQuote = enrichQuotation(quote)
  const L = sheetLayout(quote.category)
  const printItems = buildPrintItems(quote.category, enrichedQuote.rows ?? [], L)
  const lastY = printItems.length ? printItems[printItems.length - 1].y : L.first - L.pitch
  const [bandL, bandR] = L.band
  // Text sits on baseline y, as in Excel: left-aligned from x, or right-aligned
  // to x ('right'), or centred on x ('center').
  const T = ({ x, y, align = 'left', color, pt = L.fs, children }: {
    x: number; y: number; align?: 'left' | 'right' | 'center'; color?: string; pt?: number; children: ReactNode
  }) => (
    <div
      className="absolute whitespace-nowrap leading-none"
      style={{
        top: `${y - baselineDrop(pt)}mm`, fontSize: `${pt}pt`, color,
        ...(align === 'left' ? { left: `${x}mm` } : align === 'right' ? { right: `${210 - x}mm` } : { left: `${x - 30}mm`, width: '60mm', textAlign: 'center' }),
      }}
    >{children}</div>
  )
  const years = (row: BrandQuoteRow, show: boolean) => (row.guaranteeYears && show ? `${row.guaranteeYears} Years` : '')

  return (
    <A4Page>
      <div className="relative h-[297mm] w-[210mm] font-[Arial] text-black">
        {/* The workbook's own picture, inside its thin black border. */}
        <div
          className="absolute box-border border-[0.26mm] border-solid border-black"
          style={{ left: `${L.img[0]}mm`, top: `${L.img[1]}mm`, width: `${L.img[2]}mm`, height: `${L.img[3]}mm` }}
        >
          <img src={assetPath(SHEET_HEADER)} alt="" className="block h-full w-full" />
        </div>
        {L.title !== null && <T x={L.left} y={L.title} color="#00b050">{legacyCategoryLabel(quote.category)}</T>}
        <T x={L.left} y={L.head}>Thickness</T>
        <T x={L.heightX} y={L.head}>Height</T>
        <T x={L.widthX} y={L.head}>Width</T>
        <T x={L.qtyX} y={L.head}>Quantity</T>
        {L.yellow && (
          <div className="absolute" style={{ left: `${bandL}mm`, width: `${bandR - bandL}mm`, top: `${L.size - 5}mm`, height: '6.4mm', backgroundColor: '#FFFF00' }} />
        )}
        <div className="absolute bg-black" style={{ left: `${bandL}mm`, width: `${bandR - bandL}mm`, top: `${L.size + 1.2}mm`, height: '0.35mm' }} />
        <T x={L.left} y={L.size}>{legacyThickness(quote.category)}</T>
        <T x={L.heightR} y={L.size} align="right">{legacyDimension(quote.height)}</T>
        <T x={L.crossX} y={L.size}>X</T>
        <T x={L.widthX} y={L.size}>{legacyDimension(quote.width)}</T>
        <T x={L.qtyX} y={L.size}>{quote.qty ?? 1}</T>
        <T x={L.left} y={L.rateHead}>Rate</T>
        <T x={L.brandX} y={L.rateHead}>Brand</T>
        <T x={L.costX} y={L.rateHead}>Cost</T>
        <T x={L.gtyC} y={L.rateHead} align="center">Guarantee</T>
        {L.warC !== undefined && <T x={L.warC} y={L.rateHead} align="center">Warranty</T>}

        {printItems.map((item, i) => {
          if (item.kind === 'section') {
            return <T key={`s-${i}`} x={L.left} y={item.y} pt={SECTION_FS} color="#00B0F0">{item.label}</T>
          }
          const { row, y, h } = item
          const tone = yearsColor(row.guaranteeYears)
          return (
            <div key={`${row.brandName}-${i}`}>
              {row.accentColor && (
                <div
                  className="absolute"
                  style={{ left: `${bandL}mm`, width: `${bandR - bandL}mm`, top: `${y - 0.8 * h}mm`, height: `${h}mm`, backgroundColor: row.accentColor }}
                />
              )}
              <T x={L.rateR} y={y} align="right">{row.rate}</T>
              <T x={L.brandX} y={y}>{row.brandName}</T>
              <T x={L.costX} y={y}>{Math.round(row.cost || 0)}</T>
              {L.warC !== undefined ? (
                <>
                  <T x={L.gtyC} y={y} align="center" color={tone}>{years(row, row.coverage !== 'warranty')}</T>
                  <T x={L.warC} y={y} align="center" color={tone}>{years(row, row.coverage === 'warranty')}</T>
                </>
              ) : (
                <T x={L.gtyC} y={y} align="center" color={tone}>{years(row, true)}</T>
              )}
            </div>
          )
        })}
        {/* The fitting box keeps its old place: 6 mm under the last row's box. */}
        {quote.category === 'readymade-door' && quote.fitting && <DoorFittingBox top={lastY - 4.45 + L.pitch + FIT_GAP} />}
      </div>
    </A4Page>
  )
}

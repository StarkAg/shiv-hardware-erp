import type { CSSProperties } from 'react'
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
import { assetPath } from '../../lib/assets'
import { enrichQuotation } from '../../lib/pricing'

// Mirrors the old Excel Plywood and Door sheets for non-aluminium quotations.

const legacyCategoryLabel = (category: Quotation['category']) => ({
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
  'hinge': '', 'screw': '', 'aldrop': '', 'handle': '', 'tb': '', 'fevicol': '', 'mica': '', 'tape': '',
}[category])

/** Categories where Excel shows separate Guarantee and Warranty columns. */
const hasTwoGtyCols = (cat: ProductCategory) =>
  cat === 'flush-door' || cat === 'block-board-12' || cat === 'block-board-19'

const legacyThickness = (category: Quotation['category']) => ({
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
  'upvc-2-track': '', 'upvc-2.5-track': '', 'upvc-3-track': '', 'upvc-door': '', 'wpc-door-frame': '',
  'hinge': '', 'screw': '', 'aldrop': '', 'handle': '', 'tb': '', 'fevicol': '', 'mica': '', 'tape': '',
}[category])

const legacyDimension = (dim: Quotation['height']) => (
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

const ROW_H = 6.39
const BRAND_START = 126.75
const SECTION_GAP = 3 // mm gap before 2nd/3rd section headers

type PrintItem =
  | { kind: 'section'; label: string; top: number }
  | { kind: 'brand'; row: BrandQuoteRow; top: number }

function buildPrintItems(category: ProductCategory, rows: BrandQuoteRow[]): PrintItem[] {
  const cfg = SECTION_CONFIG[category]
  if (!cfg) {
    return rows.map((row, i) => ({ kind: 'brand', row, top: BRAND_START + i * ROW_H }))
  }

  const items: PrintItem[] = []
  let top = BRAND_START - ROW_H // first section header sits one row above brand start

  items.push({ kind: 'section', label: cfg.first, top })
  top += ROW_H

  for (const row of rows) {
    const secLabel = cfg.breaks[row.brandName]
    if (secLabel) {
      top += SECTION_GAP
      items.push({ kind: 'section', label: secLabel, top })
      top += ROW_H
    }
    items.push({ kind: 'brand', row, top })
    top += ROW_H
  }

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
  if (isAluminium(quote.category)) return <AluminiumPrint quote={quote} />
  if (isUpvc(quote.category)) return <UpvcPrint quote={quote} />
  if (isFixedCard(quote.category)) return <FixedCardPrint quote={quote} />
  const enrichedQuote = enrichQuotation(quote)
  const twoCol = hasTwoGtyCols(quote.category)
  const tintRight = twoCol ? '2mm' : '32mm'
  const printItems = buildPrintItems(quote.category, enrichedQuote.rows ?? [])
  const lastTop = printItems.length ? printItems[printItems.length - 1].top : BRAND_START - ROW_H

  return (
    <A4Page>
      <div className="relative h-[297mm] w-[210mm] font-[Arial] text-black">
        <div className="absolute inset-0" style={twoCol ? { transform: 'translateX(-13mm)' } : undefined}>
        <img
          src={assetPath('assets/aluminium/header-door.jpeg')}
          alt=""
          className="absolute left-[27.94mm] top-[22.47mm] block h-[53.53mm] w-[88.06mm]"
        />
        <div className="absolute left-[29mm] top-[81.3mm] text-[15pt] text-[#00b050]">{legacyCategoryLabel(quote.category)}</div>
        <div className="absolute left-[29mm] top-[94.6mm] text-[15pt] leading-[1.1]">Thickness</div>
        <div className="absolute left-[96mm] top-[94.6mm] text-[15pt] leading-[1.1]">Height</div>
        <div className="absolute left-[120mm] top-[94.6mm] text-[15pt] leading-[1.1]">Width</div>
        <div className="absolute left-[148mm] w-[30mm] text-center top-[94.6mm] text-[15pt] leading-[1.1]">Quantity</div>
        {/* Yellow background row for dimensions — matches brand tint right boundary */}
        <div className="absolute left-[29mm]" style={{ top: '100mm', height: '7mm', backgroundColor: '#FFFF00', right: twoCol ? '2mm' : '34mm' }} />
        <div className="absolute left-[29mm] top-[101.3mm] text-[15pt] leading-[1.1]">{legacyThickness(quote.category)}</div>
        <div className="absolute left-[88mm] top-[101.3mm] w-[21mm] text-right text-[15pt] leading-[1.1]">{legacyDimension(quote.height)}</div>
        <div className="absolute left-[114mm] top-[101.3mm] w-[5mm] text-center text-[15pt] leading-[1.1]">X</div>
        <div className="absolute left-[122mm] top-[101.3mm] text-[15pt] leading-[1.1]">{legacyDimension(quote.width)}</div>
        <div className="absolute left-[148mm] top-[101.3mm] w-[30mm] text-center text-[15pt] leading-[1.1]">{quote.qty ?? 1}</div>
        <div className="absolute left-[29mm] top-[107mm] border-t-[1.5px] border-black" style={{ right: twoCol ? '2mm' : '34mm' }} />
        <div className="absolute left-[29mm] top-[113.5mm] w-[22mm] text-right text-[15pt] leading-[1.1]">Rate</div>
        <div className="absolute left-[56.4mm] top-[113.5mm] text-[15pt] leading-[1.1]">Brand</div>
        <div className="absolute left-[127mm] top-[113.5mm] text-[15pt] leading-[1.1]">Cost</div>
        <div className="absolute left-[148mm] w-[30mm] text-center top-[113.5mm] text-[15pt] leading-[1.1]">Guarantee</div>
        {twoCol && (
          <div className="absolute left-[178mm] w-[30mm] text-center top-[113.5mm] text-[15pt] leading-[1.1]">Warranty</div>
        )}

        <div className="absolute inset-0 text-[15pt] leading-[1.05]">
          {printItems.map((item, i) => {
            if (item.kind === 'section') {
              return (
                <div
                  key={`s-${i}`}
                  className="absolute left-[29mm] text-[15pt] leading-[1.1]"
                  style={{ top: `${item.top}mm`, color: '#00B0F0' }}
                >
                  {item.label}
                </div>
              )
            }

            const { row, top } = item
            return (
              <div
                key={`${row.brandName}-${i}`}
                className="absolute left-0 right-0 h-[6.45mm] whitespace-nowrap"
                style={{ top: `${top}mm` }}
              >
                {row.accentColor && (
                  <div
                    className="absolute inset-y-0 left-[29mm]"
                    style={{ backgroundColor: row.accentColor, right: tintRight }}
                  />
                )}
                <span className="absolute left-[29mm] w-[22mm] text-right">{row.rate}</span>
                <span className="absolute left-[56.4mm]">{row.brandName}</span>
                <span className="absolute left-[127mm]">{Math.round(row.cost || 0)}</span>
                {twoCol ? (
                  <>
                    <span className="absolute left-[148mm] w-[30mm] text-center" style={{ color: yearsColor(row.guaranteeYears) }}>
                      {row.guaranteeYears && row.coverage !== 'warranty' ? `${row.guaranteeYears} Years` : ''}
                    </span>
                    <span className="absolute left-[178mm] w-[30mm] text-center" style={{ color: yearsColor(row.guaranteeYears) }}>
                      {row.guaranteeYears && row.coverage === 'warranty' ? `${row.guaranteeYears} Years` : ''}
                    </span>
                  </>
                ) : (
                  <span className="absolute left-[148mm] w-[30mm] text-center" style={{ color: yearsColor(row.guaranteeYears) }}>
                    {row.guaranteeYears ? `${row.guaranteeYears} Years` : ''}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        {quote.category === 'readymade-door' && quote.fitting && <DoorFittingBox top={lastTop + ROW_H + FIT_GAP} />}
        </div>
      </div>
    </A4Page>
  )
}

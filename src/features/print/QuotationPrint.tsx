import type { BrandQuoteRow, ProductCategory, Quotation } from '../../lib/types'
import { CATEGORY_LABELS } from '../../lib/types'
import { isAluminium } from '../../lib/aluminium'
import { A4Page } from './A4Page'
import { AluminiumPrint } from './AluminiumPrint'
import { assetPath } from '../../lib/assets'
import { enrichQuotation } from '../../lib/pricing'

// Mirrors the old Excel Plywood and Door sheets for non-aluminium quotations.

const legacyCategoryLabel = (category: Quotation['category']) => ({
  'readymade-door': 'Readymade Door Water Proof',
  'flush-door': 'Flush Door (Plain Door) Water Proof',
  'plywood-6': 'Water Proof Plywood',
  'block-board-12': 'Water Proof Block Board',
  'block-board-19': 'Water Proof Block Board',
  'aluminium-door': CATEGORY_LABELS['aluminium-door'],
  'window-2-track': CATEGORY_LABELS['window-2-track'],
  'window-3-track': CATEGORY_LABELS['window-3-track'],
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
  'aluminium-door': '',
  'window-2-track': '',
  'window-3-track': '',
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

export function QuotationPrint({ quote }: { quote: Quotation }) {
  if (isAluminium(quote.category)) return <AluminiumPrint quote={quote} />
  const enrichedQuote = enrichQuotation(quote)
  const twoCol = hasTwoGtyCols(quote.category)
  const tintRight = twoCol ? '2mm' : '32mm'
  const printItems = buildPrintItems(quote.category, enrichedQuote.rows ?? [])

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
        <div className="absolute left-[108mm] top-[94.6mm] text-[15pt] leading-[1.1]">Height</div>
        <div className="absolute left-[142mm] top-[94.6mm] text-[15pt] leading-[1.1]">Width</div>
        {/* Yellow background row for dimensions — matches brand tint right boundary */}
        <div className="absolute left-[29mm]" style={{ top: '100mm', height: '7mm', backgroundColor: '#FFFF00', right: twoCol ? '2mm' : '34mm' }} />
        <div className="absolute left-[29mm] top-[101.3mm] text-[15pt] leading-[1.1]">{legacyThickness(quote.category)}</div>
        <div className="absolute left-[102mm] top-[101.3mm] w-[21mm] text-right text-[15pt] leading-[1.1]">{legacyDimension(quote.height)}</div>
        <div className="absolute left-[130mm] top-[101.3mm] w-[5mm] text-center text-[15pt] leading-[1.1]">X</div>
        <div className="absolute left-[142mm] top-[101.3mm] text-[15pt] leading-[1.1]">{legacyDimension(quote.width)}</div>
        <div className="absolute left-[29mm] top-[107mm] border-t-[1.5px] border-black" style={{ right: twoCol ? '2mm' : '34mm' }} />
        <div className="absolute left-[29mm] top-[113.5mm] text-[15pt] leading-[1.1]">Rate</div>
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
                <span className="absolute left-[31mm]">{row.rate}</span>
                <span className="absolute left-[56.4mm]">{row.brandName}</span>
                <span className="absolute left-[127mm]">{Math.round(row.cost || 0)}</span>
                {twoCol ? (
                  <>
                    <span className="absolute left-[148mm] w-[30mm] text-center text-red-600">
                      {row.guaranteeYears && row.coverage !== 'warranty' ? `${row.guaranteeYears} Years` : ''}
                    </span>
                    <span className="absolute left-[178mm] w-[30mm] text-center text-red-600">
                      {row.guaranteeYears && row.coverage === 'warranty' ? `${row.guaranteeYears} Years` : ''}
                    </span>
                  </>
                ) : (
                  <span className="absolute left-[148mm] w-[30mm] text-center text-red-600">
                    {row.guaranteeYears ? `${row.guaranteeYears} Years` : ''}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        </div>
      </div>
    </A4Page>
  )
}

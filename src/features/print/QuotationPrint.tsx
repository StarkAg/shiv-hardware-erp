import type { Quotation } from '../../lib/types'
import { CATEGORY_LABELS } from '../../lib/types'
import { isAluminium } from '../../lib/aluminium'
import { A4Page } from './A4Page'
import { AluminiumPrint } from './AluminiumPrint'
import { assetPath } from '../../lib/assets'

// Mirrors the old Excel Plywood and Door sheets for non-aluminium quotations.

const legacyCategoryLabel = (category: Quotation['category']) => ({
  'readymade-door': 'Readymade Door',
  'flush-door': 'Flush Door ( Plain Door )',
  'plywood-6': 'Water Proof Plywood',
  'block-board-12': 'Water Proof Block Board',
  'block-board-19': 'Water Proof Block Board',
  'aluminium-door': CATEGORY_LABELS['aluminium-door'],
  'window-2-track': CATEGORY_LABELS['window-2-track'],
  'window-3-track': CATEGORY_LABELS['window-3-track'],
}[category])

const legacyThickness = (category: Quotation['category']) => ({
  'readymade-door': '30 mm',
  'flush-door': '30 mm',
  'plywood-6': '6mm',
  'block-board-12': '12mm',
  'block-board-19': '19mm',
  'aluminium-door': '',
  'window-2-track': '',
  'window-3-track': '',
}[category])

const legacyDimension = (dim: Quotation['height']) => (
  dim.soot ? `${dim.inches} ${dim.soot}/8"` : dim.inches ? String(dim.inches) : ''
)

export function QuotationPrint({ quote }: { quote: Quotation }) {
  if (isAluminium(quote.category)) return <AluminiumPrint quote={quote} />

  return (
    <A4Page>
      <div className="relative h-[297mm] w-[210mm] font-[Arial] text-black">
        <img
          src={assetPath('assets/letterhead/legacy-quotation-header.png')}
          alt=""
          className="absolute left-[27.94mm] top-[22.47mm] block h-[53.53mm] w-[88.06mm]"
        />

        <div className="absolute left-[29mm] top-[81.3mm] text-[15pt] text-[#00b050]">{legacyCategoryLabel(quote.category)}</div>
        <div className="absolute left-[29mm] top-[94.6mm] text-[15pt] leading-[1.1]">Thickness</div>
        <div className="absolute left-[108mm] top-[94.6mm] text-[15pt] leading-[1.1]">Height</div>
        <div className="absolute left-[142mm] top-[94.6mm] text-[15pt] leading-[1.1]">Width</div>
        <div className="absolute left-[29mm] top-[101.3mm] text-[15pt] leading-[1.1]">{legacyThickness(quote.category)}</div>
        <div className="absolute left-[102mm] top-[101.3mm] w-[21mm] text-right text-[15pt] leading-[1.1]">{legacyDimension(quote.height)}</div>
        <div className="absolute left-[130mm] top-[101.3mm] w-[5mm] text-center text-[15pt] leading-[1.1]">X</div>
        <div className="absolute left-[142mm] top-[101.3mm] text-[15pt] leading-[1.1]">{legacyDimension(quote.width)}</div>
        <div className="absolute left-[29mm] top-[107mm] w-[153mm] border-t-[1.5px] border-black" />
        <div className="absolute left-[29mm] top-[113.5mm] text-[15pt] leading-[1.1]">Rate</div>
        <div className="absolute left-[56.4mm] top-[113.5mm] text-[15pt] leading-[1.1]">Brand</div>
        <div className="absolute left-[127mm] top-[113.5mm] text-[15pt] leading-[1.1]">Cost</div>
        <div className="absolute left-[156mm] top-[113.5mm] text-[15pt] leading-[1.1]">Guarantee</div>

        <div className="absolute inset-0 text-[15pt] leading-[1.05]">
          {(quote.rows ?? []).map((row, index) => (
            <div key={`${row.brandName}-${index}`} className="absolute left-0 right-0 h-[6.45mm] whitespace-nowrap" style={{ top: `${126.75 + index * 6.39}mm` }}>
              <span className="absolute left-[31mm]">{row.rate}</span>
              <span className="absolute left-[56.4mm]">{row.brandName}</span>
              <span className="absolute left-[127mm]">{Math.round(row.cost || 0)}</span>
              <span className="absolute left-[157.65mm] text-red-600">{row.guaranteeYears ? `${row.guaranteeYears} Years` : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </A4Page>
  )
}

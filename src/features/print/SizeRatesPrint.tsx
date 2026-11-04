import type { Quotation } from '../../lib/types'
import { assetPath } from '../../lib/assets'
import { A4Page } from './A4Page'
import { legacyCategoryLabel, legacyDimension, legacyThickness, yearsColor } from './QuotationPrint'

/**
 * Size Rates, on the shop's own quotation sheet: the same header, green title,
 * yellow band and rule, at the same places. What is the same for every row is on
 * the band (thickness, brand, rate, guarantee); what changes is in the rows
 * (height, width, cost). print-server/template.mjs buildSizeRatesHtml draws the
 * same page; positions are mm and must stay the same there.
 */
export const SIZES = { first: 120.36, rowH: 6.39 }

export function SizeRatesPrint({ quote }: { quote: Quotation }) {
  const rates = quote.sizeRates
  if (!rates) return null
  const years = rates.guaranteeYears ?? 0
  return (
    <A4Page>
      <div className="relative h-[297mm] w-[210mm] font-[Arial] text-[15pt] leading-[1.1] text-black">
        <img
          src={assetPath('assets/aluminium/header-door.jpeg')}
          alt=""
          className="absolute left-[27.94mm] top-[22.47mm] block h-[53.53mm] w-[88.06mm]"
        />
        <div className="absolute left-[29mm] top-[81.3mm] text-[#00b050]">{rates.category ? legacyCategoryLabel(rates.category) : rates.name}</div>

        <div className="absolute left-[29mm] top-[94.6mm]">Thickness</div>
        <div className="absolute left-[60mm] top-[94.6mm]">Brand</div>
        <div className="absolute left-[127mm] top-[94.6mm]">Rate</div>
        <div className="absolute left-[148mm] top-[94.6mm] w-[30mm] text-center">{rates.coverage === 'warranty' ? 'Warranty' : 'Guarantee'}</div>

        <div className="absolute left-[29mm] right-[34mm] top-[100mm] h-[7mm]" style={{ backgroundColor: '#FFFF00' }} />
        <div className="absolute left-[29mm] top-[101.3mm]">{rates.category ? legacyThickness(rates.category) : ''}</div>
        <div className="absolute left-[60mm] top-[101.3mm] whitespace-nowrap">{rates.name}</div>
        <div className="absolute left-[127mm] top-[101.3mm]">{rates.rate || ''}</div>
        <div className="absolute left-[148mm] top-[101.3mm] w-[30mm] text-center" style={{ color: yearsColor(years) }}>{years ? `${years} Years` : ''}</div>
        <div className="absolute left-[29mm] right-[34mm] top-[107mm] border-t-[1.5px] border-black" />

        <div className="absolute left-[29mm] top-[113.5mm] w-[22mm] text-right">Height</div>
        <div className="absolute left-[60mm] top-[113.5mm]">Width</div>
        <div className="absolute left-[127mm] top-[113.5mm]">Cost</div>

        <div className="absolute inset-0 leading-[1.05]">
          {rates.rows.map((row, i) => (
            <div key={i} className="absolute left-0 right-0 h-[6.45mm] whitespace-nowrap" style={{ top: `${SIZES.first + i * SIZES.rowH}mm` }}>
              <span className="absolute left-[29mm] w-[22mm] text-right">{row.height ? legacyDimension(row.height) : row.size}</span>
              {row.width && <span className="absolute left-[53mm] w-[5mm] text-center">X</span>}
              {row.width && <span className="absolute left-[60mm]">{legacyDimension(row.width)}</span>}
              <span className="absolute left-[127mm]">{Math.round(row.cost)}</span>
            </div>
          ))}
        </div>
      </div>
    </A4Page>
  )
}

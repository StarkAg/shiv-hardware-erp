import type { Quotation } from '../../lib/types'
import { assetPath } from '../../lib/assets'
import { A4Page } from './A4Page'

/**
 * Size Rates: the brand, then each size and its cost. Same header and type as
 * the other quotations. print-server/template.mjs buildSizeRatesHtml draws the
 * same page; positions are mm and must stay the same there.
 */
export const SIZES = { top: 100, rowH: 7 }

export function SizeRatesPrint({ quote }: { quote: Quotation }) {
  const rates = quote.sizeRates
  if (!rates) return null
  return (
    <A4Page>
      <div className="relative h-[297mm] w-[210mm] font-[Arial] text-[15pt] leading-[1.1] text-black">
        <img
          src={assetPath('assets/aluminium/header-door.jpeg')}
          alt=""
          className="absolute left-[27.94mm] top-[22.47mm] block h-[53.53mm] w-[88.06mm]"
        />
        <div className="absolute left-[29mm] top-[81.3mm] text-[#00b050]">{rates.brand}</div>

        <div className="absolute left-[29mm] top-[94.6mm] font-bold">Size</div>
        <div className="absolute left-[146mm] top-[94.6mm] w-[30mm] text-right font-bold">Cost</div>
        <div className="absolute left-[29mm] right-[34mm] border-t-[1.5px] border-black" style={{ top: `${SIZES.top}mm` }} />

        {rates.rows.map((row, i) => {
          const top = SIZES.top + i * SIZES.rowH
          return (
            <div key={i} className="whitespace-nowrap">
              <span className="absolute left-[29mm]" style={{ top: `${top + 1.3}mm` }}>{row.size}</span>
              <span className="absolute left-[146mm] w-[30mm] text-right" style={{ top: `${top + 1.3}mm` }}>{row.cost}</span>
              <div className="absolute left-[29mm] right-[34mm] border-t border-[#bbbbbb]" style={{ top: `${top + SIZES.rowH}mm` }} />
            </div>
          )
        })}
      </div>
    </A4Page>
  )
}

import type { Quotation } from '../../lib/types'
import { assetPath } from '../../lib/assets'
import { A4Page } from './A4Page'
import { yearsColor } from './QuotationPrint'

/**
 * Bed Inner Ply, laid out like the counter's handwritten sheet: the boards with
 * their sq ft, a rule and the total, then each grade on that total. Same header,
 * columns and type as the other quotations. print-server/template.mjs
 * bedPlyHtml draws the same page; positions are mm and must stay the same there.
 */
export const BED = { band: 100, rowH: 7, gapToHead: 11, headToRows: 8, gradeH: 9 }

export function BedPlyPrint({ quote }: { quote: Quotation }) {
  const bed = quote.bed
  if (!bed) return null
  const rule = BED.band + bed.pieces.length * BED.rowH
  const head = rule + BED.gapToHead
  return (
    <A4Page>
      <div className="relative h-[297mm] w-[210mm] font-[Arial] text-[15pt] leading-[1.1] text-black">
        <img
          src={assetPath('assets/aluminium/header-door.jpeg')}
          alt=""
          className="absolute left-[27.94mm] top-[22.47mm] block h-[53.53mm] w-[88.06mm]"
        />
        <div className="absolute left-[29mm] top-[81.3mm] text-[#00b050]">Bed Inner Ply</div>

        <div className="absolute left-[29mm] top-[94.6mm]">Thickness</div>
        <div className="absolute left-[72mm] top-[94.6mm]">Size (ft)</div>
        <div className="absolute left-[112mm] top-[94.6mm] w-[15mm] text-center">Pcs</div>
        <div className="absolute left-[148mm] top-[94.6mm] w-[30mm] text-center">Sq Ft</div>

        <div className="absolute left-[29mm] right-[34mm]" style={{ top: `${BED.band}mm`, height: `${bed.pieces.length * BED.rowH}mm`, backgroundColor: '#FFFF00' }} />
        {bed.pieces.map((p, i) => {
          const top = `${BED.band + 1.3 + i * BED.rowH}mm`
          return (
            <div key={i}>
              <span className="absolute left-[29mm]" style={{ top }}>{p.thicknessMm}mm</span>
              <span className="absolute left-[72mm]" style={{ top }}>{p.length} X {p.width}</span>
              <span className="absolute left-[112mm] w-[15mm] text-center" style={{ top }}>{p.qty}</span>
              <span className="absolute left-[148mm] w-[30mm] text-center" style={{ top }}>{p.sqft}</span>
            </div>
          )
        })}
        <div className="absolute left-[29mm] right-[34mm] border-t-[1.5px] border-black" style={{ top: `${rule}mm` }} />
        <div className="absolute left-[29mm] font-bold" style={{ top: `${rule + 1.3}mm` }}>Total</div>
        <div className="absolute left-[148mm] w-[30mm] text-center font-bold" style={{ top: `${rule + 1.3}mm` }}>{bed.totalSqft}</div>

        <div className="absolute left-[24mm] w-[27mm] whitespace-nowrap text-right" style={{ top: `${head}mm` }}>Rate/Sqft</div>
        <div className="absolute left-[56.4mm]" style={{ top: `${head}mm` }}>Grade</div>
        <div className="absolute left-[102mm] w-[20mm] text-center" style={{ top: `${head}mm` }}>Husk</div>
        <div className="absolute left-[127mm]" style={{ top: `${head}mm` }}>Cost</div>
        <div className="absolute left-[148mm] w-[30mm] text-center" style={{ top: `${head}mm` }}>Guarantee</div>
        {bed.grades.map((g, i) => {
          const top = `${head + BED.headToRows + i * BED.gradeH}mm`
          return (
            <div key={g.name} className="whitespace-nowrap">
              <span className="absolute left-[29mm] w-[22mm] text-right" style={{ top }}>{g.rate}</span>
              <span className="absolute left-[56.4mm]" style={{ top }}>{g.name}</span>
              <span className="absolute left-[102mm] w-[20mm] text-center" style={{ top }}>{g.huskPercent}%</span>
              <span className="absolute left-[127mm]" style={{ top }}>{g.amount}</span>
              <span className="absolute left-[148mm] w-[30mm] text-center" style={{ top, color: yearsColor(g.guaranteeYears) }}>
                {g.guaranteeYears ? `${g.guaranteeYears} Years` : ''}
              </span>
            </div>
          )
        })}
      </div>
    </A4Page>
  )
}

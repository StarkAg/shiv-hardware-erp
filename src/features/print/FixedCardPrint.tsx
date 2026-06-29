// Fixed rate-card print (Film Face Ply, WPC Door Frame) — mirrors the Excel
// print preview: shop header, a title box on the right, then a simple table.
import type { Quotation } from '../../lib/types'
import { assetPath } from '../../lib/assets'
import { formatINR } from '../../lib/pricing'
import { FIXED_CARD_META } from '../../lib/data/fixedCards'
import { A4Page } from './A4Page'

export function FixedCardPrint({ quote }: { quote: Quotation }) {
  const meta = FIXED_CARD_META[quote.category]
  const rows = quote.fixedRows ?? []
  if (!meta) return null

  return (
    <A4Page>
      <div className="relative h-[297mm] w-[210mm] font-[Arial] text-black">
        {/* Shop letterhead header (same artwork as the quotation sheets) */}
        <img
          src={assetPath('assets/aluminium/header-door.jpeg')}
          alt=""
          className="absolute left-[27.94mm] top-[22.47mm] block h-[53.53mm] w-[88.06mm]"
        />
        {/* Title box, top-right (e.g. "Film Face Ply Rates" / "Door Chaukhat") */}
        <div className="absolute right-[12mm] top-[32mm] flex h-[18mm] w-[78mm] items-center justify-center border-2 border-black px-3 text-center text-[18pt] leading-tight">
          {meta.title}
        </div>

        {/* Table */}
        <div className="absolute left-[12mm] right-[12mm] top-[92mm] text-[15pt]">
          {/* Header row */}
          <div className="flex border-b-2 border-black pb-1 font-semibold">
            <div className="w-[26mm]">{meta.leftHeader}</div>
            <div className="flex-1">Brand</div>
            {meta.showRate && <div className="w-[24mm] text-right">Rate</div>}
            <div className="w-[26mm] text-right">Cost</div>
            {meta.showGuarantee && <div className="w-[40mm] pl-3">Guarantee</div>}
          </div>
          {/* Data rows */}
          {rows.map((r, i) => (
            <div
              key={i}
              className="flex items-center py-[1.5mm]"
              style={r.accentColor ? { backgroundColor: r.accentColor } : undefined}
            >
              <div className="w-[26mm]">{r.label}</div>
              <div className="flex-1">{r.brand}</div>
              {meta.showRate && <div className="w-[24mm] text-right">{r.rate?.toFixed(2)}</div>}
              <div className="w-[26mm] text-right">{formatINR(r.cost)}</div>
              {meta.showGuarantee && (
                <div className="w-[40mm] pl-3">{r.guaranteeYears ? `${r.guaranteeYears} Years Guarantee` : ''}</div>
              )}
            </div>
          ))}

          {meta.note && <div className="mt-[8mm] text-[14pt]">{meta.note}</div>}
        </div>
      </div>
    </A4Page>
  )
}

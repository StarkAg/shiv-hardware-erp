// Fixed rate-card print (Film Face Ply, WPC Door Frame) — mirrors the Excel
// print preview: shop header, a title box on the right, then a simple table.
import type { Quotation } from '../../lib/types'
import { assetPath } from '../../lib/assets'
import { FIXED_CARD_META } from '../../lib/data/fixedCards'
import { A4Page } from './A4Page'

export function FixedCardPrint({ quote }: { quote: Quotation }) {
  const meta = FIXED_CARD_META[quote.category]
  const rows = quote.fixedRows ?? []
  if (!meta) return null
  // Door Chaukhat: the Excel sheet's own layout — bigger photo, no header row,
  // shading that runs on through the guarantee wording. Every position below is
  // measured off the shop's printed PDF (Fraem.pdf).
  const sheet = !!meta.showGuarantee

  if (sheet) {
    return (
      <A4Page>
        <div className="relative h-[297mm] w-[210mm] font-[Arial] text-black">
          <img
            src={assetPath('assets/aluminium/header-door.jpeg')}
            alt=""
            className="absolute left-[19.8mm] top-[11.6mm] block h-[47.7mm] w-[86.5mm]"
          />
          <div className="absolute right-[8mm] top-[24.8mm] flex h-[12.5mm] w-[82.7mm] items-center justify-center border border-black bg-[#d9d9d9] px-2 text-center text-[15pt] leading-tight">
            {meta.title}
          </div>
          {/* The PDF's photo is stretched wide with the fixing hooks laid on top;
              the sheet image is cut straight from it, so it is shown whole. */}
          {meta.image && (
            <img src={assetPath(meta.image)} alt="" className="absolute left-[19.8mm] top-[61.3mm] h-[109.3mm] w-[147.4mm]" />
          )}
          <div className="absolute left-[18.7mm] top-[175.1mm] text-[15pt] leading-none">
            {rows.map((r, i) => (
              <div
                key={i}
                className="flex h-[6.15mm] items-center whitespace-nowrap pl-[0.8mm]"
                style={{
                  width: r.guaranteeYears ? '179.8mm' : '122.4mm',
                  ...(r.accentColor ? { backgroundColor: r.accentColor } : {}),
                }}
              >
                <div className="w-[25mm] shrink-0">{r.label}</div>
                <div className="w-[80.7mm] shrink-0">{r.brand}</div>
                <div className="w-[16.8mm] shrink-0">{r.cost}</div>
                <div className="shrink-0">{r.guaranteeYears ? `${r.guaranteeYears} Years Guarantee` : ''}</div>
              </div>
            ))}
            {meta.note && <div className="mt-[6.5mm]">{meta.note}</div>}
          </div>
        </div>
      </A4Page>
    )
  }

  return (
    <A4Page>
      <div className="relative h-[297mm] w-[210mm] font-[Arial] text-black">
        {/* Shop letterhead header (same artwork as the quotation sheets) */}
        <img
          src={assetPath('assets/aluminium/header-door.jpeg')}
          alt=""
          className="absolute left-[16mm] top-[22.47mm] block h-[53.53mm] w-[88.06mm]"
        />
        {/* Title box, top-right (e.g. "Film Face Ply Rates" / "Door Chaukhat") */}
        <div className="absolute right-[14mm] top-[30mm] flex h-[14mm] w-[64mm] items-center justify-center bg-[#d9d9d9] px-2 text-center text-[15pt] leading-tight">
          {meta.title}
        </div>

        {/* Optional promo image (WPC) */}
        {meta.image && (
          <img src={assetPath(meta.image)} alt="" className="absolute left-[12mm] top-[80mm] h-[95mm] w-[95mm] object-contain" />
        )}

        {/* Table — columns grouped left (matches the Excel sheet), full-width header rule */}
        <div className={`absolute left-[16mm] right-[12mm] ${meta.image ? 'top-[178mm]' : 'top-[80mm]'} text-[14pt]`}>
          {/* Header row */}
          <div className="flex border-b border-black pb-[1mm]">
            <div className="w-[26mm]">{meta.leftHeader}</div>
            <div className="w-[74mm]">Brand</div>
            {meta.showRate && <div className="w-[24mm] text-right">Rate</div>}
            <div className="w-[24mm] text-right">Cost</div>
            {meta.showGuarantee && <div className="w-[52mm] pl-[4mm]">Guarantee</div>}
          </div>
          {/* spacer row (Excel leaves a blank line under the header) */}
          <div className="h-[3mm]" />
          {/* Data rows */}
          {rows.map((r, i) => (
            <div
              key={i}
              className="flex items-center py-[0.6mm]"
              style={r.accentColor ? { backgroundColor: r.accentColor } : undefined}
            >
              <div className="w-[26mm]">{r.label}</div>
              <div className="w-[74mm]">{r.brand}</div>
              {meta.showRate && <div className="w-[24mm] text-right">{r.rate?.toFixed(2)}</div>}
              <div className="w-[24mm] text-right">{r.cost}</div>
              {meta.showGuarantee && (
                <div className="w-[52mm] pl-[4mm]">{r.guaranteeYears ? `${r.guaranteeYears} Years Guarantee` : ''}</div>
              )}
            </div>
          ))}

          {meta.note && <div className="mt-[8mm] text-[14pt]">{meta.note}</div>}
        </div>
      </div>
    </A4Page>
  )
}

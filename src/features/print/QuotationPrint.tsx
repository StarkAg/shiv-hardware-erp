import type { Quotation } from '../../lib/types'
import { CATEGORY_LABELS, SHOP } from '../../lib/types'
import { formatINR, formatSize, sealForYears } from '../../lib/pricing'
import { isAluminium } from '../../lib/aluminium'
import { Letterhead } from './Letterhead'
import { A4Page } from './A4Page'
import { AluminiumPrint } from './AluminiumPrint'

// Quotation = ONE size of ONE product, listing the cost of EVERY brand (doors/
// plywood/boards) — mirrors the Excel ReadyMade / Plain / Block-Board sheets.
// Aluminium shows the configured item with its cost breakdown.

export function QuotationPrint({ quote }: { quote: Quotation }) {
  if (isAluminium(quote.category)) return <AluminiumPrint quote={quote} />
  const dateStr = new Date(quote.date).toLocaleDateString('en-GB')
  const isAlu = !!quote.alu
  const guaranteeYears = Array.from(
    new Set((quote.rows ?? []).map((r) => r.guaranteeYears).filter((y) => y > 0)),
  ).sort((a, b) => a - b)

  return (
    <A4Page>
      <Letterhead />

      <div className="px-[12mm] pt-[4mm] font-print text-[13px] text-black">
        {/* Title + meta */}
        <div className="flex items-end justify-between border-b-2 border-black pb-1">
          <h1 className="text-[20px] font-bold" style={{ color: 'var(--shiv-green)' }}>
            {CATEGORY_LABELS[quote.category]}
          </h1>
          <div className="text-right text-[12px] leading-tight">
            <div><span className="font-bold">No: </span>{quote.number}</div>
            <div><span className="font-bold">Date: </span>{dateStr}</div>
          </div>
        </div>

        {/* Customer (optional) */}
        {(quote.customer.name || quote.customer.mobile) && (
          <div className="mt-2 flex justify-between text-[12px] leading-snug">
            <div>
              <span className="font-bold">M/s </span>{quote.customer.name || '—'}
              {quote.customer.address && <div>{quote.customer.address}</div>}
            </div>
            {quote.customer.mobile && (
              <div><span className="font-bold">Mobile: </span>{quote.customer.mobile}</div>
            )}
          </div>
        )}

        {/* Size banner */}
        <div className="my-3 flex items-center gap-6 rounded border border-slate-400 bg-slate-50 px-4 py-2">
          <span className="text-[15px] font-bold">
            Size: <span style={{ color: 'var(--shiv-green)' }}>{formatSize(quote.height, quote.width) || '—'}</span>
          </span>
          <span className="text-[13px]">Area: <b>{quote.sqft.toFixed(2)}</b> sqft</span>
          <span className="text-[13px]">Quantity: <b>{quote.qty}</b></span>
        </div>

        {!isAlu ? (
          /* All-brands rate card */
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr style={{ background: 'var(--shiv-green)', color: '#fff' }}>
                <th className="border border-slate-500 px-2 py-1.5 text-left w-[44%]">Brand</th>
                <th className="border border-slate-500 px-2 py-1.5 text-right w-[18%]">Rate ₹/sqft</th>
                <th className="border border-slate-500 px-2 py-1.5 text-right w-[20%]">Cost</th>
                <th className="border border-slate-500 px-2 py-1.5 text-center w-[18%]">Guarantee</th>
              </tr>
            </thead>
            <tbody>
              {(quote.rows ?? []).map((r, i) => (
                <tr key={i} className="border-b border-slate-400">
                  <td className="border border-slate-400 px-2 py-1.5 font-semibold">{r.brandName}</td>
                  <td className="border border-slate-400 px-2 py-1.5 text-right">{r.rate}</td>
                  <td className="border border-slate-400 px-2 py-1.5 text-right font-bold">{formatINR(r.cost)}</td>
                  <td
                    className="border border-slate-400 px-2 py-1.5 text-center font-semibold"
                    style={{ color: r.guaranteeYears ? 'var(--shiv-red)' : '#94a3b8' }}
                  >
                    {r.guaranteeYears ? `${r.guaranteeYears} Years` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {quote.notes && (
          <div className="mt-3 text-[11px] whitespace-pre-wrap">
            <span className="font-bold">Note: </span>{quote.notes}
          </div>
        )}

        {/* Seals + signature */}
        <div className="mt-[10mm] flex items-end justify-between">
          <div className="flex items-end gap-2">
            {guaranteeYears.map((y) => {
              const s = sealForYears(y)
              return s ? <img key={y} src={s} alt={`${y} year`} className="h-[22mm]" /> : null
            })}
          </div>
          <div className="text-center text-[12px]">
            <div className="mb-[14mm] font-bold">For {SHOP.name}</div>
            <div className="border-t border-black px-6 pt-1">Proprietor</div>
          </div>
        </div>

        <div className="mt-4 text-center text-[9px] text-slate-500">
          This is a computer-generated quotation. Rates valid for 7 days. E. &amp; O. E.
        </div>
      </div>
    </A4Page>
  )
}

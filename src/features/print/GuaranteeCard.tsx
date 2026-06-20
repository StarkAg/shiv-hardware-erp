import type { GuaranteeDocument } from '../../lib/types'
import { CATEGORY_LABELS, SHOP } from '../../lib/types'
import { formatSize, sealForYears } from '../../lib/pricing'
import { Letterhead } from './Letterhead'
import { A4Page } from './A4Page'
import { assetPath } from '../../lib/assets'

// Standalone guarantee document. It is not tied to a quotation.

const DEFAULT_TERMS = [
  'Guarantee is against borer/termite only, subject to proper installation & maintenance.',
  'Guarantee is not valid against water-logging, fire, physical/mechanical damage or misuse.',
  'This card must be produced at the time of any claim.',
  'Polish, fittings, glass & handles are not covered under guarantee.',
]

type GuaranteeLayout = 'a4' | 'card'

export function GuaranteeCard({
  document,
  terms = DEFAULT_TERMS,
  layout = 'a4',
}: {
  document: GuaranteeDocument
  terms?: string[]
  layout?: GuaranteeLayout
}) {
  if (layout === 'card') return <CompactGuaranteeCard document={document} />

  const dateStr = new Date(document.date).toLocaleDateString('en-GB')
  const guaranteedRows = document.items.filter((r) => r.guaranteeYears > 0)
  const maxYears = Math.max(0, ...guaranteedRows.map((r) => r.guaranteeYears))
  const seal = sealForYears(maxYears)

  return (
    <A4Page>
      <Letterhead />

      <div className="px-[12mm] pt-[3mm] font-print text-[13px] text-black">
        <div className="my-1 text-center">
          <span className="inline-block px-6 py-0.5 text-[16px] font-bold tracking-wide" style={{ color: 'var(--shiv-green)' }}>
            GUARANTEE CARD
          </span>
        </div>

        <div className="flex justify-between border-b border-black pb-1 text-[12px]">
          <span><span className="font-bold">Ref No: </span>{document.number}</span>
          <span><span className="font-bold">Date: </span>{dateStr}</span>
        </div>

        <div className="mt-2 leading-snug">
          <div><span className="font-bold">M/s </span>{document.customer.name || '—'}</div>
          <div className="flex gap-8 text-[12px]">
            <span><span className="font-bold">UID - </span>{document.customer.uid || 'N/A'}</span>
            <span><span className="font-bold">Mobile - </span>{document.customer.mobile || 'N/A'}</span>
          </div>
        </div>

        <div className="my-3 flex items-center gap-6 rounded border border-slate-400 bg-slate-50 px-4 py-2">
          <span className="text-[14px] font-bold">{CATEGORY_LABELS[document.category]}</span>
          <span className="text-[13px]">Size: <b>{formatSize(document.height, document.width, document.category) || '—'}</b></span>
          <span className="text-[13px]">Qty: <b>{document.qty}</b></span>
        </div>

        {/* Guaranteed brands */}
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr style={{ background: 'var(--shiv-green)', color: '#fff' }}>
              <th className="border border-slate-500 px-2 py-1 text-left">Brand</th>
              <th className="border border-slate-500 px-2 py-1 text-center w-[28%]">Guarantee</th>
            </tr>
          </thead>
          <tbody>
            {guaranteedRows.map((r, i) => (
              <tr key={i} className="border-b border-slate-400">
                <td className="border border-slate-400 px-2 py-1 font-semibold">{r.brandName}</td>
                <td className="border border-slate-400 px-2 py-1 text-center font-semibold" style={{ color: 'var(--shiv-red)' }}>
                  {r.guaranteeYears} Years
                </td>
              </tr>
            ))}
            {!guaranteedRows.length && (
              <tr><td colSpan={2} className="border border-slate-400 py-3 text-center text-slate-400">No guaranteed brands for this product</td></tr>
            )}
          </tbody>
        </table>

        {/* Terms + seal */}
        <div className="mt-3 flex gap-4">
          <div className="flex-1">
            <div className="mb-1 text-[12px] font-bold">Terms &amp; Conditions:</div>
            <ol className="list-decimal space-y-0.5 pl-4 text-[10.5px] leading-snug">
              {terms.map((t, i) => (<li key={i}>{t}</li>))}
            </ol>
          </div>
          {seal && (
            <div className="flex w-[38mm] shrink-0 items-start justify-center">
              <img src={seal} alt={`${maxYears} year guarantee`} className="w-[34mm]" />
            </div>
          )}
        </div>

        <div className="mt-[14mm] flex justify-end">
          <div className="text-center text-[12px]">
            <div className="mb-[14mm] font-bold">For {SHOP.name}</div>
            <div className="border-t border-black px-6 pt-1">Proprietor</div>
          </div>
        </div>
      </div>
    </A4Page>
  )
}

function CompactGuaranteeCard({ document }: { document: GuaranteeDocument }) {
  const dateStr = new Date(document.date).toLocaleDateString('en-GB')
  const guaranteedRows = document.items.filter((r) => r.guaranteeYears > 0)
  const maxYears = Math.max(0, ...guaranteedRows.map((r) => r.guaranteeYears))
  const seal = sealForYears(maxYears)
  const primaryRow = guaranteedRows[0]

  return (
    <A4Page>
      <div className="flex h-[297mm] items-start justify-center bg-white pt-[18mm] font-print text-black">
        <div className="relative h-[86mm] w-[54mm] overflow-hidden rounded-[3mm] border-[1.5px] border-black bg-white p-[4mm]">
          <div className="flex items-center justify-between border-b border-black pb-[2mm]">
            <div className="flex min-w-0 items-center gap-[1.5mm]">
              <img src={assetPath('assets/letterhead/shiv-logo.png')} alt="" className="h-[8mm] w-[8mm] shrink-0 object-contain" />
              <div>
                <div className="text-[10px] font-bold leading-none">{SHOP.name}</div>
                <div className="text-[5.8px] font-semibold leading-tight">{SHOP.address}</div>
              </div>
            </div>
            {seal && <img src={seal} alt={`${maxYears} year guarantee`} className="h-[10mm] w-[10mm] shrink-0 object-contain" />}
          </div>

          <div className="mt-[3mm] text-center text-[11px] font-bold tracking-wide" style={{ color: 'var(--shiv-green)' }}>
            GUARANTEE CARD
          </div>

          <div className="mt-[3mm] grid grid-cols-2 gap-x-[2mm] gap-y-[1.5mm] text-[7.5px] leading-tight">
            <div><span className="font-bold">Ref:</span> {document.number}</div>
            <div><span className="font-bold">Date:</span> {dateStr}</div>
            <div className="col-span-2"><span className="font-bold">M/s:</span> {document.customer.name || '-'}</div>
            <div><span className="font-bold">UID:</span> {document.customer.uid || 'N/A'}</div>
            <div><span className="font-bold">Mobile:</span> {document.customer.mobile || 'N/A'}</div>
            <div className="col-span-2"><span className="font-bold">Product:</span> {CATEGORY_LABELS[document.category]}</div>
            <div className="col-span-2"><span className="font-bold">Size:</span> {formatSize(document.height, document.width, document.category) || '-'} | <span className="font-bold">Qty:</span> {document.qty}</div>
            <div className="col-span-2"><span className="font-bold">Brand:</span> {primaryRow?.brandName ?? '-'}</div>
          </div>

          <div className="absolute bottom-[4mm] left-[4mm] right-[4mm] flex items-end justify-between">
            <div className="text-[10px] font-bold" style={{ color: 'var(--shiv-red)' }}>
              {maxYears ? `${maxYears} Years` : 'No Guarantee'}
            </div>
            <div className="w-[21mm] border-t border-black pt-[1mm] text-center text-[7px]">Proprietor</div>
          </div>
        </div>
      </div>
    </A4Page>
  )
}

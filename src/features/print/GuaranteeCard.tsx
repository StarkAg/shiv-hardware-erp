import type { GuaranteeDocument } from '../../lib/types'
import { CATEGORY_LABELS, SHOP } from '../../lib/types'
import { formatSize, sealForYears } from '../../lib/pricing'
import { Letterhead } from './Letterhead'
import { A4Page } from './A4Page'

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

// Compact labels used on the PVC card overlay (legacy Excel style: "30MM")
const CARD_THICKNESS: Partial<Record<GuaranteeDocument['category'], string>> = {
  'readymade-door': '30MM',
  'flush-door': '30MM',
  'plywood-6': '6MM',
  'block-board-12': '12MM',
  'block-board-19': '19MM',
  'film-face-ply': '12MM',
}

// Size without inch marks, as on the old card: 79 4/8 X 44
const cardDimension = (dim: GuaranteeDocument['height'] | null | undefined) =>
  dim?.soot ? `${dim.inches} ${dim.soot}/8` : dim?.inches ? String(dim.inches) : ''

/**
 * Overlay layout for PRE-PRINTED PVC guarantee cards: the physical card already
 * carries the shop design; only the variable details are printed, matching the
 * legacy Excel "Gaurantee Card Name Print" positions. Must stay in sync with
 * the print server's template.mjs card layout.
 */
function CompactGuaranteeCard({ document }: { document: GuaranteeDocument }) {
  return (
    <A4Page>
      <div className="flex h-[297mm] items-start justify-center bg-white pt-[18mm] font-print text-black">
        <div className="relative h-[86mm] w-[54mm] overflow-hidden bg-white">
          {/* card boundary shown on screen only, never printed */}
          <div className="pointer-events-none absolute inset-0 border border-dashed border-slate-300 print:hidden" />
          <GuaranteeCardFace document={document} />
        </div>
      </div>
    </A4Page>
  )
}

/**
 * The 54mm x 86mm card content only — no page wrapper. Reused by the print
 * preview (inside CompactGuaranteeCard/A4Page) and by inline UI thumbnails
 * (e.g. the slot 1/2 previews in GuaranteeBuilder).
 */
export function GuaranteeCardFace({ document }: { document: GuaranteeDocument }) {
  const dateStr = new Date(document.date).toLocaleDateString('en-GB').replace(/\//g, '-')
  const guaranteedRows = document.items.filter((r) => r.guaranteeYears > 0)
  const rows = (guaranteedRows.length ? guaranteedRows : document.items).slice(0, 5)
  const docThickness = CARD_THICKNESS[document.category] ?? ''
  const docSizeStr = [cardDimension(document.height), cardDimension(document.width)].filter(Boolean).join(' X ')
  const totalAmount = rows.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
  const customer = document.customer

  return (
    <>
      <div className="absolute left-[3mm] right-[3mm] top-[4mm] text-[7pt] font-semibold leading-[1.18]">
        <div className="overflow-hidden whitespace-nowrap">
          M/s {customer.name || ''}{customer.address ? `,${customer.address}` : ''}
        </div>
        <div>Mob - {customer.mobile || ''}</div>
        <div>UID - {customer.uid || 'N/A'}</div>
      </div>

      <div className="absolute right-[3mm] top-[13.9mm] text-[7pt] font-medium">{dateStr}</div>

      {rows.map((item, i) => {
        const rowThickness = item.thickness || docThickness
        const rowSizeStr = (item.height || item.width)
          ? [cardDimension(item.height), cardDimension(item.width)].filter(Boolean).join(' X ')
          : docSizeStr
        const rowQty = item.qty ?? document.qty
        return (
        <div
          key={i}
          className="absolute left-[3mm] right-[3mm] items-baseline text-[4pt] leading-none"
          style={{ top: `${20.5 + i * 3.2}mm`, display: 'grid', gridTemplateColumns: '5.5mm 1fr 11mm 5mm 4.5mm', columnGap: '1.3mm' }}
        >
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{rowThickness}</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{item.brandName}</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{rowSizeStr}</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{rowQty} Pcs</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-right">{Number(item.amount) ? Math.round(Number(item.amount)) : ''}</span>
        </div>
        )
      })}

      {totalAmount > 0 && (
        <div className="absolute right-[3mm] top-[76.8mm] inline-block border-y border-black py-[0.8mm] text-[7pt] font-semibold leading-none">
          {Math.round(totalAmount)}
        </div>
      )}
    </>
  )
}

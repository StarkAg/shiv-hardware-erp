import type { GuaranteeDocument } from '../../lib/types'
import { CATEGORY_LABELS, SHOP } from '../../lib/types'
import { formatSize, sealForYears } from '../../lib/pricing'
import { Letterhead } from './Letterhead'
import { A4Page } from './A4Page'
import { GuaranteeQr } from './GuaranteeQr'
import { guaranteeOnlineUrl } from '../../lib/printServer'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { fitLine } from '../../lib/fitLine'

/** A one-line card field that shrinks/squeezes to fit its width — never "…". */
function FitText({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    fitLine(box)
    // The print font can arrive after first paint; measure again once it has.
    let live = true
    document.fonts?.ready.then(() => { if (live) fitLine(box) })
    return () => { live = false }
  })
  return (
    <span ref={ref} className={`block overflow-hidden whitespace-nowrap ${className}`}>
      <span className="inline-block whitespace-nowrap">{children}</span>
    </span>
  )
}

// Standalone guarantee document. It is not tied to a quotation.


type GuaranteeLayout = 'a4' | 'card'

export function GuaranteeCard({
  document,
  layout = 'a4',
}: {
  document: GuaranteeDocument
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

        {/* The seal. The terms are not printed here any more: the card is a
            small piece of plastic and they filled it, while the page behind
            its QR has room to set them out properly and is the copy that can
            be corrected after printing. */}
        <div className="mt-3 flex gap-4">
          <div className="flex-1" />
          {seal && (
            <div className="flex w-[38mm] shrink-0 items-start justify-center">
              <img src={seal} alt={`${maxYears} year guarantee`} className="w-[34mm]" />
            </div>
          )}
        </div>

        <div className="relative mt-[10mm] min-h-[48mm]">
          <div className="absolute bottom-[10mm] left-[10mm]">
            <GuaranteeQr value={guaranteeOnlineUrl(document.number, document.token)} size="32mm" />
          </div>
          <div className="absolute bottom-0 right-0 text-center text-[12px]">
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
      <div className="absolute left-[3mm] right-[3mm] top-[4mm] text-[6pt] font-semibold leading-[1.18]">
        <FitText>M/s {customer.name || ''}{customer.address ? `,${customer.address}` : ''}</FitText>
        <FitText>Mob - {customer.mobile || ''}</FitText>
        <FitText>UID - {customer.uid || 'N/A'}</FitText>
      </div>

      <div className="absolute right-[3mm] top-[13.9mm] text-[6pt] font-medium">{dateStr}</div>

      {rows.map((item, i) => {
        const rowThickness = item.thickness || docThickness
        // The size as the bill wrote it (e.g. "7 X 4" feet) wins over inches.
        const rowSizeStr = item.sizeLabel?.trim()
          ? item.sizeLabel.trim()
          : (item.height || item.width)
            ? [cardDimension(item.height), cardDimension(item.width)].filter(Boolean).join(' X ')
            : docSizeStr
        const rowQty = item.qty ?? document.qty
        return (
        <div
          key={i}
          className="absolute left-[3mm] right-[3mm] items-baseline text-[5pt] leading-none"
          style={{ top: `${20.5 + i * 3.2}mm`, display: 'grid', gridTemplateColumns: '5.5mm 1fr 11mm 5mm 4.5mm', columnGap: '1.3mm' }}
        >
          <FitText>{rowThickness}</FitText>
          <FitText>{item.brandName}</FitText>
          <FitText>{rowSizeStr}</FitText>
          <FitText>{rowQty} Pcs</FitText>
          <FitText className="text-right">{Number(item.amount) ? Math.round(Number(item.amount)) : ''}</FitText>
        </div>
        )
      })}

      {totalAmount > 0 && (
        <div className="absolute right-[3mm] top-[76.8mm] inline-block border-y border-black py-[0.8mm] text-[5pt] font-semibold leading-none">
          {Math.round(totalAmount)}
        </div>
      )}

      {/* Same place as print-server/template.mjs: QR, then SCAN TO VERIFY ending at 83mm. */}
      <div className="absolute left-[3mm] top-[69.05mm]">
        <GuaranteeQr value={guaranteeOnlineUrl(document.number, document.token)} size="12mm" />
      </div>
      <div className="absolute left-[3mm] top-[81.55mm] w-[12mm] text-center text-[4pt] font-bold leading-none tracking-[0.2pt]">
        <FitText>SCAN TO VERIFY</FitText>
      </div>
    </>
  )
}

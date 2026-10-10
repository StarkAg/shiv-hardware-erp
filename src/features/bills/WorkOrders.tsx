import { useLive } from '../ledger/lib/cache'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ClipboardList, FileText, Printer, ReceiptIndianRupee, RotateCcw, Ruler } from 'lucide-react'
import { api } from '../../../convex/_generated/api'
import { foldName } from '../../../convex/lib/text'
import { useStore } from '../../lib/store'
import { SHOP, billLines, type Bill } from '../../lib/types'

/**
 * Work orders: a job made to measure.
 *
 * On paper it is an advance taken with a slip of what to make, a mechanic sent
 * to the site for the sizes, and only then the real bill. Here: the advance is
 * a Receipt; what to make is a Quotation (or a sale) with "Order" switched on;
 * this list walks it through To measure → Measured → Billed. "Make sale bill"
 * opens the quotation converted to a sale with its lines, and saving that bill
 * is what marks the order billed.
 */
type Stage = 'measure' | 'measured' | 'billed'

const STAGES: { key: Stage; title: string; hint: string }[] = [
  { key: 'measure', title: 'To measure', hint: 'Send the mechanic with the visit slip' },
  { key: 'measured', title: 'Measured', hint: 'Sizes are in — make the sale bill' },
  { key: 'billed', title: 'Billed', hint: '' },
]

const stageOf = (b: Bill): Stage => (b.workDoneAt ? 'billed' : b.measuredAt ? 'measured' : 'measure')
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

/** The slip the mechanic takes to the site: who, where, what — and empty boxes for the sizes. */
export function visitSlipHtml(b: Bill, advance: string): string {
  // Made to measure, every piece can be its own size: a line of 9 pieces
  // gives the mechanic 9 rows ("1 of 9" … "9 of 9"), each with its own boxes.
  const pieces = billLines(b.items).filter((i) => i.description.trim()).flatMap((i) => {
    const qty = Math.round(Number(i.qty) || 1)
    return qty > 1 && qty <= 30
      ? Array.from({ length: qty }, (_, n) => ({ what: `${esc(i.description)} <span class="muted">— ${n + 1} of ${qty}</span>`, qty: '1' }))
      : [{ what: esc(i.description), qty: String(Number(i.qty) || '') }]
  })
  const rows = [
    ...pieces.map((p, n) => `<tr><td>${n + 1}</td><td>${p.what}</td><td class="c">${p.qty}</td><td></td><td></td><td></td></tr>`),
    ...Array.from({ length: Math.max(2, 8 - pieces.length) }, (_, n) => `<tr><td>${pieces.length + n + 1}</td><td></td><td></td><td></td><td></td><td></td></tr>`),
  ].join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Visit slip ${esc(b.number)}</title><style>
    @page { size: A5 portrait; margin: 9mm; }
    * { box-sizing: border-box; } body { font-family: Arial, sans-serif; color: #111; font-size: 10.5pt; margin: 0; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5pt solid #111; padding-bottom: 2mm; }
    .shop { font-weight: 700; font-size: 13pt; } .muted { color: #555; font-size: 8.5pt; }
    h1 { font-size: 12pt; margin: 3mm 0 2mm; letter-spacing: .5pt; text-transform: uppercase; }
    .grid { display: grid; grid-template-columns: 26mm 1fr; gap: 1.2mm 3mm; margin-bottom: 3mm; }
    .grid b { font-weight: 600; color: #444; }
    table { width: 100%; border-collapse: collapse; } th, td { border: .6pt solid #333; padding: 2.2mm 1.5mm; vertical-align: top; }
    th { background: #eee; font-size: 9pt; text-align: left; } td.c { text-align: center; }
    .sign { display: flex; justify-content: space-between; margin-top: 9mm; font-size: 9.5pt; }
    .sign div { border-top: .6pt solid #333; padding-top: 1mm; width: 30%; text-align: center; }
    .notes { border: .6pt solid #333; height: 18mm; margin-top: 3mm; padding: 1.5mm; color: #555; font-size: 9pt; }
  </style></head><body>
    <div class="top"><div><div class="shop">${esc(SHOP.name)}</div><div class="muted">${esc(SHOP.address)}</div></div>
      <div class="muted" style="text-align:right">${SHOP.phones.map((p) => `${esc(p.label)} ${esc(p.number)}`).join('<br>')}</div></div>
    <h1>Site measurement · ${esc(b.number)}</h1>
    <div class="grid">
      <b>Customer</b><span>M/s ${esc(b.customerName)}</span>
      <b>Phone</b><span>${esc(b.customerPhone) || '—'}</span>
      <b>Site / ref</b><span>${esc(b.ref) || '&nbsp;'}</span>
      <b>Order date</b><span>${fmtDate(b.date)}</span>
      <b>Advance</b><span>${esc(advance.replace(/^Advance\s*/, '')) || '—'}</span>
      <b>Mechanic</b><span>${esc(b.visitBy) || '&nbsp;'}</span>
    </div>
    <table><thead><tr><th style="width:7mm">#</th><th>What to make</th><th style="width:12mm">Qty</th><th style="width:20mm">Width</th><th style="width:20mm">Height</th><th style="width:24mm">Remarks</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="notes">Notes:${b.notes ? ` ${esc(b.notes)}` : ''}</div>
    <div class="sign"><div>Measured by</div><div>Date</div><div>Customer</div></div>
  </body></html>`
}

function printHtml(html: string) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)
  frame.onload = () => {
    frame.contentWindow?.focus()
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 1000)
  }
  frame.srcdoc = html
}

export function WorkOrders() {
  const navigate = useNavigate()
  const { bills, saveBill } = useStore()
  const staff = (useLive(api.attendance.getStaff, {}, 'staff') as string[] | undefined) ?? []
  const book = useLive(api.reports.receivables, {}, 'receivables') as { rows: any[] } | undefined
  const [showBilled, setShowBilled] = useState(false)

  const orders = useMemo(() => bills
    .filter((b) => b.workOrder && ((b.kind ?? 'sale') === 'sale' || b.kind === 'quotation'))
    .sort((a, b) => a.date.localeCompare(b.date)), [bills])

  /** "Advance ₹5,000" when the customer is in credit, "Owes ₹…" when not. */
  const standing = (b: Bill): string => {
    const name = foldName(b.customerName ?? '')
    const row = (book?.rows ?? []).find((r) =>
      (b.ledgerId && String(r.ledger?._id) === String(b.ledgerId)) || foldName(String(r.ledger?.name ?? '')) === name)
    const amount = Number(row?.closing) || 0
    if (!row || !amount) return ''
    return row.closingSide === 'Cr' ? `Advance ${money(amount)}` : `Owes ${money(amount)}`
  }

  const set = (b: Bill, patch: Partial<Bill>) => saveBill({ ...b, ...patch })

  const card = (b: Bill) => {
    const stage = stageOf(b)
    const quote = b.kind === 'quotation'
    const advance = standing(b)
    const what = billLines(b.items).filter((i) => i.description.trim())
      .map((i) => `${i.description}${Number(i.qty) > 1 ? ` × ${i.qty}` : ''}`).join(', ')
    const btn = 'flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 dark:border-white/10 dark:text-stone-200 dark:hover:bg-white/5'
    const primary = 'flex items-center gap-1.5 rounded-lg bg-shiv-green px-3 py-1.5 text-xs font-bold text-stone-950 hover:brightness-95'
    return (
      <div key={b.id} className={`border-b border-stone-100 px-4 py-3 last:border-b-0 dark:border-white/5 ${stage === 'billed' ? 'opacity-60' : ''}`}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-mono text-xs text-muted">{quote ? b.number : `#${b.number}`}</span>
          <span className="font-semibold text-stone-900 dark:text-stone-100">{b.customerName || '—'}</span>
          {b.customerPhone && <span className="text-xs text-muted">{b.customerPhone}</span>}
          <span className="text-xs text-muted">· {fmtDate(b.date)}</span>
          {advance && (
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold ${advance.startsWith('Advance') ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'}`}>
              {advance}
            </span>
          )}
        </div>
        <div className="mt-1 text-sm text-stone-700 dark:text-stone-300">{what || <span className="text-muted">No items written yet</span>}</div>
        {stage !== 'billed' && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted">
              Mechanic
              <select
                value={b.visitBy ?? ''}
                onChange={(e) => set(b, { visitBy: e.target.value || undefined })}
                className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs text-stone-800 dark:border-white/10 dark:bg-stone-900 dark:text-stone-100"
              >
                <option value="">—</option>
                {[...new Set([...staff, ...(b.visitBy ? [b.visitBy] : [])])].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="button" className={btn} onClick={() => printHtml(visitSlipHtml(b, advance))}>
              <Printer size={14} /> Visit slip
            </button>
            <button type="button" className={btn} onClick={() => navigate(`/bills/${b.id}`)} title="Open it and type in the sizes the mechanic brought">
              <Ruler size={14} /> Enter sizes
            </button>
            {stage === 'measure' ? (
              <button type="button" className={btn} onClick={() => set(b, { measuredAt: Date.now() })}>
                <Check size={14} /> Measured
              </button>
            ) : (
              <button type="button" className={btn} onClick={() => set(b, { measuredAt: undefined })} title="Back to To measure">
                <RotateCcw size={14} /> Not measured
              </button>
            )}
            {quote ? (
              <button type="button" className={primary} onClick={() => navigate(`/bills/${b.id}?convert=sale`)}>
                <ReceiptIndianRupee size={14} /> Make sale bill
              </button>
            ) : (
              <button type="button" className={primary} onClick={() => set(b, { workDoneAt: Date.now() })} title="This order is already a sale bill">
                <Check size={14} /> Billed
              </button>
            )}
          </div>
        )}
        {stage === 'billed' && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className={btn} onClick={() => navigate(`/bills/${b.id}`)}><FileText size={14} /> Bill</button>
            <button type="button" className={btn} onClick={() => set(b, { workDoneAt: undefined })}><RotateCcw size={14} /> Not billed</button>
          </div>
        )}
      </div>
    )
  }

  const byStage = (s: Stage) => orders.filter((b) => stageOf(b) === s)
  const billed = byStage('billed').sort((a, b) => (b.workDoneAt ?? 0) - (a.workDoneAt ?? 0))

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-3 md:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardList size={20} className="text-shiv-green" />
        <h1 className="text-lg font-bold text-stone-900 dark:text-stone-100">Work list</h1>
        <button
          type="button"
          onClick={() => navigate('/bills?new=quotation&order=1')}
          className="ml-auto rounded-lg bg-shiv-green px-3 py-1.5 text-xs font-bold text-stone-950 hover:brightness-95"
        >
          New order
        </button>
      </div>
      <p className="-mt-2 text-xs text-muted">
        Take the advance as a Receipt. Write what to make as a Quotation with <b>Order</b> on (New order). Print the visit
        slip for the mechanic, type in the sizes he brings, then Make sale bill.
      </p>

      {STAGES.filter((s) => s.key !== 'billed').map((s) => {
        const list = byStage(s.key)
        return (
          <section key={s.key}>
            <div className="mb-1.5 flex items-baseline gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted">{s.title}</h2>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-700 dark:bg-white/10 dark:text-stone-200">{list.length}</span>
              <span className="text-xs text-muted">{s.hint}</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-white/10 dark:bg-stone-900">
              {list.length ? list.map(card) : <p className="px-4 py-6 text-center text-sm text-muted">Nothing here.</p>}
            </div>
          </section>
        )
      })}

      {billed.length > 0 && (
        <section>
          <button type="button" onClick={() => setShowBilled((v) => !v)} className="mb-1.5 text-xs font-semibold text-muted hover:text-stone-700 dark:hover:text-stone-200">
            {showBilled ? 'Hide' : 'Show'} billed ({billed.length})
          </button>
          {showBilled && (
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-white/10 dark:bg-stone-900">
              {billed.map(card)}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

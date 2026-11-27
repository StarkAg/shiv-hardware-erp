import { useState, type ComponentType } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Plus, Printer, Share2, Trash2 } from 'lucide-react'
import { workingDate } from '../../lib/businessDate'
import { useStore } from '../../lib/store'
import { CATEGORY_LABELS, type GuaranteeYears, type Quotation } from '../../lib/types'
import { BED_GRADES, BED_THICKNESS_MM, buildBedPly } from '../../lib/bedPly'
import { formatINR } from '../../lib/pricing'
import { Button, Toggle } from '../../components/ui'
import { toast } from '../../components/Toast'
import { printViaShop } from '../../lib/printViaShop'
import { elementToJpeg, shareJpeg } from '../../lib/shareImage'
import { sendWhatsAppDocument } from '../../lib/printServer'
import { canLocalPrint, useLocalPrint } from '../../lib/useLocalPrint'
import { quotationPrinter } from '../../lib/quotePrinter'
import { QuotationPrint } from '../print/QuotationPrint'
import { ComboBox, CustomerAccounts, type CustomerAccount } from '../guarantee/GuaranteeBuilder'
import { CopiesBox } from './CopiesBox'

/**
 * The Bed Inner Ply quotation: boards in feet, their total sq ft, and what that
 * comes to in each grade. The other quotations are one size against a price
 * set, so this has its own screen; saving, WhatsApp and print are the same.
 */
const uid = () => Math.random().toString(36).slice(2, 10)
const blankPiece = () => ({ id: uid(), thickness: String(BED_THICKNESS_MM), length: '', width: '', qty: '1' })
const box = 'h-10 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 text-center text-base tabular-nums outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100'
const card = 'rounded-xl border border-stone-200/90 bg-stone-50 p-3 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100 md:p-4'
const number = (text: string) => Number(text) || 0

export function BedPlyBuilder({ Preview }: { Preview: ComponentType<{ quote: Quotation }> }) {
  const { id } = useParams()
  const { quotations, nextQuoteNumber, saveQuotation, upsertCustomer } = useStore()
  const existing = quotations.find((q) => q.id === id)
  const [quoteNumber] = useState(() => existing?.number ?? nextQuoteNumber())
  const [quoteId] = useState(() => existing?.id ?? uid())
  const [accounts, setAccounts] = useState<CustomerAccount[]>([])
  const [customer, setCustomer] = useState(existing?.customer ?? { id: uid(), name: '', mobile: '', altMobile: '', uid: '', address: '' })
  const [withCustomer, setWithCustomer] = useState(!!existing?.customer?.name)
  const [pieces, setPieces] = useState(() => existing?.bed?.pieces.length
    ? existing.bed.pieces.map((p) => ({ id: uid(), thickness: String(p.thicknessMm), length: String(p.length), width: String(p.width), qty: String(p.qty) }))
    : [blankPiece()])
  const [grades, setGrades] = useState(() => (existing?.bed?.grades ?? BED_GRADES).map((g) => ({
    name: g.name, huskPercent: g.huskPercent, guaranteeYears: g.guaranteeYears as GuaranteeYears, rate: String(g.rate),
  })))
  const [printing, setPrinting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [copies, setCopies] = useState(1)
  const { printNode, mount: localPrintMount } = useLocalPrint()

  const bed = buildBedPly(
    pieces.map((p) => ({ thicknessMm: number(p.thickness), length: number(p.length), width: number(p.width), qty: number(p.qty) })),
    grades.map((g) => ({ ...g, rate: number(g.rate) })),
  )
  const ready = bed.totalSqft > 0
  const setPiece = (pieceId: string, patch: Partial<ReturnType<typeof blankPiece>>) =>
    setPieces((all) => all.map((p) => (p.id === pieceId ? { ...p, ...patch } : p)))

  function buildQuote(): Quotation {
    return {
      id: quoteId,
      number: quoteNumber,
      date: workingDate() ? `${workingDate()}T06:30:00.000Z` : new Date().toISOString(),
      customer: withCustomer ? customer : { id: customer.id, name: '', mobile: '' },
      category: 'bed-inner-ply',
      height: { inches: 0, soot: 0 },
      width: { inches: 0, soot: 0 },
      qty: 1,
      sqft: bed.totalSqft,
      notes: '',
      bed,
    }
  }

  function save() {
    if (withCustomer && customer.name) upsertCustomer(customer)
    const quote = buildQuote()
    saveQuotation(quote)
    return quote
  }

  async function share() {
    if (!ready) return
    setSharing(true)
    try {
      const quote = save()
      const blob = await elementToJpeg(<QuotationPrint quote={quote} />)
      try {
        await sendWhatsAppDocument('group', blob, `${quote.number}.jpg`)
        toast(`${quote.number} sent to the Shiv Hardware group`)
        return
      } catch (err) {
        if (!(err instanceof TypeError)) throw err
      }
      const how = await shareJpeg(blob, `${quote.number}.jpg`)
      if (how === 'saved') toast(`${quote.number}.jpg saved — send it from your photos`)
    } catch (err) {
      toast(`Share failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setSharing(false)
    }
  }

  async function print() {
    if (!ready) return
    setPrinting(true)
    const quote = save()
    try {
      if (canLocalPrint()) {
        try {
          await printNode(<QuotationPrint quote={quote} />, copies, await quotationPrinter())
          setCopies(1)
          return
        } catch {
          // On to the shop PC below.
        }
      }
      const sent = await printViaShop({ kind: 'quotation', quote }, {
        copies,
        onDone: (r) => toast(r.ok ? `${quote.number} printed at the shop` : `Not printed: ${r.error}`, r.ok ? 'ok' : 'error'),
      })
      if (sent.via === 'queue') toast(`${quote.number} sent to the shop PC`, 'info')
      setCopies(1)
    } catch (err) {
      toast(`Not printed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="flex flex-col">
      {localPrintMount}
      <div className="no-print border-b border-stone-200/80 bg-stone-50/95 px-2 py-2 shadow-sm backdrop-blur dark:border-white/10 dark:bg-stone-950/90 md:px-4">
        <div className="flex items-center justify-center pb-2">
          <span className="rounded-full border border-stone-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-stone-300">
            {CATEGORY_LABELS['bed-inner-ply']}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={share} disabled={!ready || sharing} className="flex flex-1 items-center justify-center gap-1.5 md:flex-none">
            <Share2 size={16} /> {sharing ? 'Sharing' : 'WhatsApp'}
          </Button>
          <CopiesBox copies={copies} onChange={setCopies} />
          <Button onClick={print} disabled={!ready || printing} data-enter-submit className="flex flex-1 items-center justify-center gap-1.5 md:flex-none">
            {printing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
            {printing ? 'Printing…' : copies > 1 ? `Print ${copies}` : 'Print'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-2 md:gap-3 md:p-4">
        <div><Toggle checked={withCustomer} onChange={setWithCustomer} label="Customer details" /></div>
        {withCustomer && (
          <div className={card}>
            <CustomerAccounts onAccounts={setAccounts} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted">M/s (Name)</span>
                <ComboBox
                  value={customer.name}
                  placeholder="Pick or type a customer"
                  options={accounts.map((a) => a.name)}
                  note={(n) => accounts.find((a) => a.name === n)?.phone ?? ''}
                  onChange={(name) => {
                    const account = accounts.find((a) => a.name.trim().toLowerCase() === name.trim().toLowerCase())
                    setCustomer({ ...customer, name, ...(account?.phone ? { mobile: account.phone } : {}) })
                  }}
                  className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm outline-none transition focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted">Mobile</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={customer.mobile}
                  onChange={(e) => setCustomer({ ...customer, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                  className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm outline-none transition focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
                />
              </label>
            </div>
          </div>
        )}

        <div className={card}>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Boards</h2>
          <div className="grid grid-cols-[3.5rem_1fr_auto_1fr_3rem_3.5rem_2.25rem] items-center gap-1.5 text-center text-xs font-semibold text-muted md:gap-2">
            <span>mm</span><span>Length ft</span><span /><span>Width ft</span><span>Pcs</span><span>Sq ft</span><span />
          </div>
          {pieces.map((p) => {
            const sqft = number(p.length) * number(p.width) * number(p.qty)
            return (
              <div key={p.id} className="mt-1.5 grid grid-cols-[3.5rem_1fr_auto_1fr_3rem_3.5rem_2.25rem] items-center gap-1.5 md:gap-2">
                <input aria-label="Thickness in mm" inputMode="decimal" className={box} value={p.thickness} onChange={(e) => setPiece(p.id, { thickness: e.target.value })} />
                <input aria-label="Length in feet" inputMode="decimal" className={box} value={p.length} onChange={(e) => setPiece(p.id, { length: e.target.value })} />
                <span className="text-muted">×</span>
                <input aria-label="Width in feet" inputMode="decimal" className={box} value={p.width} onChange={(e) => setPiece(p.id, { width: e.target.value })} />
                <input aria-label="Pieces" inputMode="numeric" className={box} value={p.qty} onChange={(e) => setPiece(p.id, { qty: e.target.value })} />
                <span className="text-center font-semibold tabular-nums">{sqft ? Math.round(sqft * 100) / 100 : '—'}</span>
                <button
                  type="button"
                  aria-label="Remove this board"
                  disabled={pieces.length === 1}
                  onClick={() => setPieces((all) => all.filter((x) => x.id !== p.id))}
                  className="flex h-10 items-center justify-center rounded-lg text-muted hover:text-danger disabled:opacity-30"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )
          })}
          <div className="mt-3 flex items-center justify-between gap-3">
            <Button variant="outline" onClick={() => setPieces((all) => [...all, blankPiece()])} className="flex items-center gap-1.5">
              <Plus size={16} /> Add board
            </Button>
            <span className="text-base">Total <b className="tabular-nums">{bed.totalSqft}</b> sq ft</span>
          </div>
        </div>

        <div className={card}>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Grades</h2>
          <ul className="divide-y divide-stone-200 dark:divide-white/10">
            {grades.map((g, i) => (
              <li key={g.name} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{g.name}</div>
                  <div className="text-xs text-muted">{g.huskPercent}% husk{g.guaranteeYears ? ` · ${g.guaranteeYears} years guarantee` : ''}</div>
                </div>
                <label className="flex items-center gap-1 text-sm text-muted">
                  ₹
                  <input
                    aria-label={`${g.name} rate per sq ft`}
                    inputMode="decimal"
                    className={`${box} w-16`}
                    value={g.rate}
                    onChange={(e) => setGrades((all) => all.map((x, n) => (n === i ? { ...x, rate: e.target.value } : x)))}
                  />
                </label>
                <b className="w-20 shrink-0 text-right text-base tabular-nums">{ready ? formatINR(bed.grades[i].amount) : '—'}</b>
              </li>
            ))}
          </ul>
        </div>

        {ready && <Preview quote={buildQuote()} />}
      </div>
    </div>
  )
}

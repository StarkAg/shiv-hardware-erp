import { useMemo, useState, type ComponentType } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Plus, Printer, Share2, Trash2 } from 'lucide-react'
import { workingDate } from '../../lib/businessDate'
import { useStore } from '../../lib/store'
import { CATEGORY_LABELS, type Quotation } from '../../lib/types'
import { buildSizeRates, lastRatesFor, MAX_SIZES } from '../../lib/sizeRates'
import { Button, Toggle } from '../../components/ui'
import { toast } from '../../components/Toast'
import { printViaShop } from '../../lib/printViaShop'
import { elementToJpeg, shareJpeg } from '../../lib/shareImage'
import { sendWhatsAppDocument } from '../../lib/printServer'
import { canLocalPrint, useLocalPrint } from '../../lib/useLocalPrint'
import { QuotationPrint } from '../print/QuotationPrint'
import { ComboBox, CustomerAccounts, type CustomerAccount } from '../guarantee/GuaranteeBuilder'

/**
 * The Size Rates quotation: a brand picked or typed at the top, then as many
 * sizes as it needs, each with its cost. The other quotations work prices out
 * from one size, so this has its own screen; saving, WhatsApp and print are the
 * same as Bed Inner Ply's.
 */
const uid = () => Math.random().toString(36).slice(2, 10)
const blankRow = () => ({ id: uid(), size: '', cost: '' })
const box = 'h-10 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 text-base outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100'
const card = 'rounded-xl border border-stone-200/90 bg-stone-50 p-3 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100 md:p-4'
const field = 'w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm outline-none transition focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100'

export function SizeRatesBuilder({ Preview }: { Preview: ComponentType<{ quote: Quotation }> }) {
  const { id } = useParams()
  const { quotations, sets, nextQuoteNumber, saveQuotation, upsertCustomer } = useStore()
  const existing = quotations.find((q) => q.id === id)
  const [quoteNumber] = useState(() => existing?.number ?? nextQuoteNumber())
  const [quoteId] = useState(() => existing?.id ?? uid())
  const [accounts, setAccounts] = useState<CustomerAccount[]>([])
  const [customer, setCustomer] = useState(existing?.customer ?? { id: uid(), name: '', mobile: '', altMobile: '', uid: '', address: '' })
  const [withCustomer, setWithCustomer] = useState(!!existing?.customer?.name)
  const [brand, setBrand] = useState(existing?.sizeRates?.brand ?? '')
  const [rows, setRows] = useState(() => existing?.sizeRates?.rows.length
    ? existing.sizeRates.rows.map((r) => ({ id: uid(), size: r.size, cost: String(r.cost) }))
    : [blankRow()])
  const [justAdded, setJustAdded] = useState('')
  const [printing, setPrinting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const { printNode, mount: localPrintMount } = useLocalPrint()

  // Brands quoted this way before come first, then the price sets' own.
  const brands = useMemo(() => {
    const quoted = quotations.flatMap((q) => (q.sizeRates?.brand ? [q.sizeRates.brand] : []))
    const seen = new Set<string>()
    return [...quoted, ...sets.flatMap((s) => s.brands.map((b) => b.name))].filter((name) => {
      const key = name.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [quotations, sets])

  const sizeRates = buildSizeRates(brand, rows)
  const ready = sizeRates.rows.length > 0
  const full = rows.length >= MAX_SIZES
  const setRow = (rowId: string, patch: Partial<ReturnType<typeof blankRow>>) =>
    setRows((all) => all.map((r) => (r.id === rowId ? { ...r, ...patch } : r)))

  function addRow() {
    if (full) return
    const row = blankRow()
    setJustAdded(row.id)
    setRows((all) => [...all, row])
  }

  /** A brand quoted before opens on its last sizes and costs, if nothing is typed yet. */
  function chooseBrand(name: string) {
    setBrand(name)
    if (rows.some((r) => r.size.trim() || r.cost.trim())) return
    const last = lastRatesFor(quotations, name, quoteId)
    if (last) setRows(last.map((r) => ({ id: uid(), size: r.size, cost: String(r.cost) })))
  }

  function buildQuote(): Quotation {
    return {
      id: quoteId,
      number: quoteNumber,
      date: workingDate() ? `${workingDate()}T06:30:00.000Z` : new Date().toISOString(),
      customer: withCustomer ? customer : { id: customer.id, name: '', mobile: '' },
      category: 'size-rates',
      height: { inches: 0, soot: 0 },
      width: { inches: 0, soot: 0 },
      qty: 1,
      sqft: 0,
      notes: '',
      sizeRates,
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
          await printNode(<QuotationPrint quote={quote} />)
          return
        } catch {
          // On to the shop PC below.
        }
      }
      const sent = await printViaShop({ kind: 'quotation', quote }, {
        onDone: (r) => toast(r.ok ? `${quote.number} printed at the shop` : `Not printed: ${r.error}`, r.ok ? 'ok' : 'error'),
      })
      if (sent.via === 'queue') toast(`${quote.number} sent to the shop PC`, 'info')
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
            {CATEGORY_LABELS['size-rates']}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={share} disabled={!ready || sharing} className="flex flex-1 items-center justify-center gap-1.5 md:flex-none">
            <Share2 size={16} /> {sharing ? 'Sharing' : 'WhatsApp'}
          </Button>
          <Button onClick={print} disabled={!ready || printing} data-enter-submit className="flex flex-1 items-center justify-center gap-1.5 md:flex-none">
            {printing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
            {printing ? 'Printing…' : 'Print'}
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
                  className={field}
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
                  className={field}
                />
              </label>
            </div>
          </div>
        )}

        <div className={card}>
          <label className="block">
            <span className="mb-1 block text-sm font-bold uppercase tracking-wide text-muted">Brand</span>
            <ComboBox value={brand} placeholder="Pick or type anything" options={brands} onChange={chooseBrand} className={field} />
          </label>
        </div>

        <div className={card}>
          <div className="grid grid-cols-[1fr_7rem_2.25rem] items-center gap-1.5 text-xs font-semibold text-muted md:gap-2">
            <span>Size</span><span className="text-right">Cost ₹</span><span />
          </div>
          {rows.map((row, index) => (
            <div key={row.id} className="mt-1.5 grid grid-cols-[1fr_7rem_2.25rem] items-center gap-1.5 md:gap-2">
              {/* Written as typed: a size is not a name to tidy. */}
              <input
                aria-label="Size"
                data-case="raw"
                maxLength={40}
                autoFocus={row.id === justAdded}
                className={box}
                value={row.size}
                onChange={(e) => setRow(row.id, { size: e.target.value })}
              />
              <input
                aria-label="Cost"
                inputMode="decimal"
                className={`${box} text-right tabular-nums`}
                value={row.cost}
                onChange={(e) => setRow(row.id, { cost: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || index !== rows.length - 1 || full) return
                  // The new row takes the focus; the Counter's Enter walk stays out of it.
                  e.preventDefault()
                  addRow()
                }}
              />
              <button
                type="button"
                aria-label={`Remove ${row.size || 'this size'}`}
                disabled={rows.length === 1}
                onClick={() => setRows((all) => all.filter((x) => x.id !== row.id))}
                className="flex h-10 items-center justify-center rounded-lg text-muted hover:text-danger disabled:opacity-30"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <div className="mt-3 flex items-center justify-between gap-3">
            <Button variant="outline" onClick={addRow} disabled={full} className="flex items-center gap-1.5">
              <Plus size={16} /> Add size
            </Button>
            {full && <span className="text-sm text-muted">One sheet holds {MAX_SIZES} sizes</span>}
          </div>
        </div>

        {ready && <Preview quote={buildQuote()} />}
      </div>
    </div>
  )
}

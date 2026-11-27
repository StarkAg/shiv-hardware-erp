import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Plus, Printer, Share2, Trash2 } from 'lucide-react'
import { workingDate } from '../../lib/businessDate'
import { useStore } from '../../lib/store'
import { CATEGORY_LABELS, type Dimension, type Quotation, type SizeRates } from '../../lib/types'
import { autoCost, buildSizeRates, findInPriceList, lastRatesFor, MAX_SIZES, priceList, type SizePricing, type SizeUnit } from '../../lib/sizeRates'
import { Button, Toggle } from '../../components/ui'
import { toast } from '../../components/Toast'
import { printViaShop } from '../../lib/printViaShop'
import { elementToJpeg, shareJpeg } from '../../lib/shareImage'
import { sendWhatsAppDocument } from '../../lib/printServer'
import { canLocalPrint, useLocalPrint } from '../../lib/useLocalPrint'
import { QuotationPrint } from '../print/QuotationPrint'
import { ComboBox, CustomerAccounts, type CustomerAccount } from '../guarantee/GuaranteeBuilder'
import { CopiesBox } from './CopiesBox'
import { DimInput } from './DimInput'

/**
 * The Size Rates quotation: a brand picked or typed at the top, then as many
 * sizes as it needs. A brand from the price list brings its rate and its size
 * boxes, feet for a board and inches and soot for a door, and each cost works
 * itself out; a cost left to work itself out is blank in `rows` and shows as the
 * box's placeholder, so typing over one takes no clearing. The other quotations
 * price one size, so this has its own screen; saving, WhatsApp and print are the
 * same as Bed Inner Ply's.
 */
const uid = () => Math.random().toString(36).slice(2, 10)
const blankDim = (): Dimension => ({ inches: 0, soot: 0 })
const blankRow = () => ({ id: uid(), height: blankDim(), width: blankDim(), cost: '' })
const isBlank = (r: ReturnType<typeof blankRow>) => !r.height.inches && !r.height.soot && !r.width.inches && !r.width.soot && !r.cost.trim()
const box = 'h-10 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 text-base outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100'
const card = 'rounded-xl border border-stone-200/90 bg-stone-50 p-3 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100 md:p-4'
const field = 'w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm outline-none transition focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100'

/** Saved rows back on screen: a cost that matches the sum goes on working itself out. */
function rowsFrom(saved: SizeRates) {
  const pricing: SizePricing = { rate: saved.rate ?? 0, unit: saved.unit ?? 'ft', category: saved.category }
  return saved.rows.map((r) => {
    const height = r.height ?? blankDim()
    const width = r.width ?? blankDim()
    return { id: uid(), height, width, cost: autoCost(height, width, pricing) === r.cost ? '' : String(r.cost) }
  })
}

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
  const [rate, setRate] = useState(existing?.sizeRates?.rate ? String(existing.sizeRates.rate) : '')
  const [unit, setUnit] = useState<SizeUnit>(existing?.sizeRates?.unit ?? 'ft')
  const [rows, setRows] = useState(() => (existing?.sizeRates?.rows.length ? rowsFrom(existing.sizeRates) : [blankRow()]))
  const [justAdded, setJustAdded] = useState('')
  const sizeList = useRef<HTMLDivElement>(null)
  const [printing, setPrinting] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [copies, setCopies] = useState(1)
  const { printNode, mount: localPrintMount } = useLocalPrint()

  const list = useMemo(() => priceList(sets), [sets])
  // The price list first, then any other brand typed here before.
  const brands = useMemo(() => {
    const quoted = quotations.flatMap((q) => (q.sizeRates?.brand ? [q.sizeRates.brand] : []))
    const seen = new Set<string>()
    return [...list.map((item) => item.label), ...quoted].filter((name) => {
      const key = name.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [list, quotations])

  const listed = findInPriceList(list, brand)
  const pricing: SizePricing = {
    rate: Number(rate) || 0,
    unit,
    category: listed?.category,
    name: listed?.name,
    guaranteeYears: listed?.guaranteeYears,
    coverage: listed?.coverage,
  }
  const sizeRates = buildSizeRates(brand, rows, pricing)
  const ready = sizeRates.rows.length > 0
  const full = rows.length >= MAX_SIZES
  const setRow = (rowId: string, patch: Partial<ReturnType<typeof blankRow>>) =>
    setRows((all) => all.map((r) => (r.id === rowId ? { ...r, ...patch } : r)))

  // A new row is ready to type in. Its first box belongs to DimInput, so it is found here.
  useEffect(() => {
    if (justAdded) sizeList.current?.querySelector<HTMLInputElement>(`[data-row='${justAdded}'] input`)?.focus()
  }, [justAdded])

  function addRow() {
    if (full) return
    const row = blankRow()
    setJustAdded(row.id)
    setRows((all) => [...all, row])
  }

  /**
   * A brand on the price list brings its rate and size boxes. A brand quoted
   * before opens on its last sizes if nothing is typed yet, at today's rate when
   * the price list has one. Sizes typed in feet mean nothing in inches, so a
   * brand measured the other way starts them again.
   */
  function chooseBrand(name: string) {
    setBrand(name)
    const found = findInPriceList(list, name)
    if (found) {
      setRate(String(found.rate))
      setUnit(found.unit)
    }
    const last = rows.every(isBlank) ? lastRatesFor(quotations, name, quoteId) : null
    if (last && found) {
      setRows(rowsFrom(last).map((r) => ({ ...r, cost: '' })))
    } else if (last) {
      if (last.rate) setRate(String(last.rate))
      if (last.unit) setUnit(last.unit)
      setRows(rowsFrom(last))
    } else if (found && found.unit !== unit) {
      setRows([blankRow()])
    }
  }

  function chooseUnit(next: SizeUnit) {
    if (next !== unit) setRows([blankRow()])
    setUnit(next)
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
      const sent = await printViaShop({ kind: 'quotation', quote }, {
        copies,
        local: canLocalPrint() ? () => printNode(<QuotationPrint quote={quote} />, copies) : undefined,
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
            {CATEGORY_LABELS['size-rates']}
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
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-muted">Rate ₹ per sq ft</span>
              <input aria-label="Rate per sq ft" inputMode="decimal" className={`${box} tabular-nums`} value={rate} onChange={(e) => setRate(e.target.value)} />
            </label>
            {/* A brand on the price list decides this itself. */}
            {!listed && (
              <div>
                <span className="mb-1 block text-xs font-semibold text-muted">Sizes in</span>
                <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Sizes in">
                  {([['ft', 'Feet'], ['in', 'Inches']] as const).map(([value, label]) => (
                    <Button key={value} role="radio" aria-checked={unit === value} variant={unit === value ? 'primary' : 'outline'} onClick={() => chooseUnit(value)} className="h-10 justify-center">
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={card}>
          <div ref={sizeList}>
            {rows.map((row, index) => {
              const auto = autoCost(row.height, row.width, pricing)
              return (
                <div key={row.id} data-row={row.id} className="mt-2 grid grid-cols-2 items-end gap-1.5 first:mt-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem_2.25rem] md:gap-2">
                  <DimInput label="Height" hideLabel={index > 0} dim={row.height} feet={unit === 'ft'} onChange={(height) => setRow(row.id, { height })} />
                  <DimInput label="Width" hideLabel={index > 0} dim={row.width} feet={unit === 'ft'} onChange={(width) => setRow(row.id, { width })} />
                  <div className="col-span-2 grid grid-cols-[1fr_2.25rem] items-end gap-1.5 md:contents">
                    <label className="block">
                      {index === 0 && <span className="mb-1.5 block text-right text-xs font-bold uppercase tracking-wide text-muted">Cost ₹</span>}
                      <input
                        aria-label="Cost"
                        inputMode="decimal"
                        className={`${box} text-right tabular-nums ${auto ? 'placeholder:font-semibold placeholder:text-stone-900 dark:placeholder:text-stone-100' : ''}`}
                        placeholder={auto ? String(auto) : 'Cost'}
                        value={row.cost}
                        onChange={(e) => setRow(row.id, { cost: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' || index !== rows.length - 1 || full) return
                          // The new row takes the focus; the Counter's Enter walk stays out of it.
                          e.preventDefault()
                          addRow()
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      aria-label="Remove this size"
                      disabled={rows.length === 1}
                      onClick={() => setRows((all) => all.filter((x) => x.id !== row.id))}
                      className="flex h-10 items-center justify-center rounded-lg text-muted hover:text-danger disabled:opacity-30"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
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

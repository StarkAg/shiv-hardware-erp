import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { workingDate } from '../../lib/businessDate'
import { Link, useParams } from 'react-router-dom'
import { Calculator, Minus, Plus, Printer, Share2, Trash2 } from 'lucide-react'
import { useStore } from '../../lib/store'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type Brand,
  type BrandQuoteRow,
  type CoverageType,
  type Dimension,
  type GuaranteeYears,
  type ProductCategory,
  type Quotation,
} from '../../lib/types'
import { areaSqft, buildBrandRows, enrichQuotation, formatINR, formatSize, isFootSized } from '../../lib/pricing'
import {
  type AluAddons,
  defaultAddons,
  isAluminium,
} from '../../lib/aluminium'
import { calcAluminiumQuote, productOf } from '../../lib/aluCosting'
import { useAluCosting } from '../../lib/aluCostingStore'
import { calcAllUpvcBrands, isUpvc } from '../../lib/upvc'
import { FIXED_CARDS, FIXED_CARD_META, isFixedCard } from '../../lib/data/fixedCards'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button, Toggle } from '../../components/ui'
import { QuotationPrint, firstSectionRows, hasSections, yearsColor } from '../print/QuotationPrint'
import { printViaShop } from '../../lib/printViaShop'
import { elementToJpeg, shareJpeg } from '../../lib/shareImage'
import { sendWhatsAppDocument } from '../../lib/printServer'
import { defaultRatesUnlocked, lockDefaultRates, unlockDefaultRates } from '../../lib/defaultRates'
import { canLocalPrint, useLocalPrint } from '../../lib/useLocalPrint'
import { quotationPrinter } from '../../lib/quotePrinter'
import { toast } from '../../components/Toast'
import Confirm from '../ledger/components/Confirm'
import { ComboBox, CustomerAccounts, type CustomerAccount } from '../guarantee/GuaranteeBuilder'
import { BedPlyBuilder } from './BedPlyBuilder'
import { SizeRatesBuilder } from './SizeRatesBuilder'
import { CopiesBox } from './CopiesBox'
import { PriceBySwitch } from './PriceBySwitch'
import { DimInput } from './DimInput'

const blankDim = (): Dimension => ({ inches: 0, soot: 0 })
const uid = () => Math.random().toString(36).slice(2, 10)
const A4_W = 794
const A4_H = 1123
const GUARANTEE_OPTIONS: GuaranteeYears[] = [0, 1, 3, 5, 7, 8, 10, 15, 20, 21, 25, 30]
const isCategory = (c?: string): c is ProductCategory =>
  !!c && CATEGORY_ORDER.includes(c as ProductCategory)

function coverageLabel(coverage: CoverageType | undefined) {
  return coverage === 'warranty' ? 'Wty' : 'Gty'
}

function tintedRowStyle(item: Pick<Brand, 'accentColor'> | Pick<BrandQuoteRow, 'accentColor'>) {
  return item.accentColor ? { backgroundColor: item.accentColor } : undefined
}

/**
 * The brands of a price set while editing it ("Edit set"), laid out like the
 * printed quotation: Rate, Brand, Cost, Guarantee, Warranty, in its big Arial,
 * on its green rows, years in red (7 years black). Each cell is still a box to
 * type in or pick from; the box shows only on hover and while typing, so the
 * rows read like the sheet (owner's ask, 27 Nov 2026).
 */
export function PrintLikeBrandEditor({ brands, costOf, onChange, onRemove, onAdd }: {
  brands: Brand[]
  costOf: (name: string) => number | undefined
  onChange: (id: string, patch: Partial<Brand>) => void
  onRemove: (id: string) => void
  onAdd: () => void
}) {
  const box = 'block h-[30px] w-full min-w-0 border border-transparent bg-transparent px-1 py-0 leading-[30px] outline-none hover:border-stone-400 focus:border-blue-600 focus:bg-white'
  const yearsCell = (b: Brand, coverage: CoverageType) => {
    const here = (b.coverage ?? 'guarantee') === coverage && b.guaranteeYears > 0
    return (
      <select
        aria-label={coverage === 'guarantee' ? 'Guarantee' : 'Warranty'}
        // Blank like the sheet when empty; the "-" shows on hover, to show it can be picked.
        className={`${box} cursor-pointer appearance-none text-center ${here ? '' : 'text-transparent hover:text-stone-400 focus:text-stone-400'}`}
        style={here ? { color: yearsColor(b.guaranteeYears) } : undefined}
        value={here ? b.guaranteeYears : 0}
        onChange={(e) => {
          const years = Number(e.target.value) as GuaranteeYears
          // Picking years in one column moves the cover there; "-" clears it.
          if (years) onChange(b.id, { guaranteeYears: years, coverage })
          else if (here) onChange(b.id, { guaranteeYears: 0 })
        }}
      >
        {GUARANTEE_OPTIONS.map((g) => (
          <option key={g} value={g} style={{ color: '#000' }}>{g === 0 ? '-' : `${g} Years`}</option>
        ))}
      </select>
    )
  }
  return (
    <div className="overflow-x-auto bg-white text-black" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <table className="w-full min-w-[640px] table-fixed border-collapse text-[22px] leading-[30px] [&_td]:border-0 [&_th]:border-0">
        <colgroup>
          <col className="w-[11%]" />
          <col className="w-[38%]" />
          <col className="w-[13%]" />
          <col className="w-[16%]" />
          <col className="w-[16%]" />
          <col className="w-[6%]" />
        </colgroup>
        <thead>
          <tr className="font-normal">
            <th className="px-2 pb-3 pt-2 text-right font-normal">Rate</th>
            <th className="px-2 pb-3 pt-2 text-left font-normal">Brand</th>
            <th className="px-2 pb-3 pt-2 text-left font-normal">Cost</th>
            <th className="px-2 pb-3 pt-2 text-center font-normal">Guarantee</th>
            <th className="px-2 pb-3 pt-2 text-center font-normal">Warranty</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {brands.map((b) => {
            const cost = costOf(b.name)
            return (
              <tr key={b.id} style={tintedRowStyle(b)}>
                <td className="p-0">
                  <input
                    type="number"
                    aria-label="Rate"
                    className={`${box} text-right tabular-nums`}
                    value={b.rate}
                    onChange={(e) => onChange(b.id, { rate: Number(e.target.value) })}
                  />
                </td>
                <td className="p-0">
                  <input
                    aria-label="Brand"
                    className={box}
                    value={b.name}
                    onChange={(e) => onChange(b.id, { name: e.target.value })}
                  />
                </td>
                <td className="px-2 py-0 tabular-nums">{cost === undefined ? '' : Math.round(cost)}</td>
                <td className="p-0">{yearsCell(b, 'guarantee')}</td>
                <td className="p-0">{yearsCell(b, 'warranty')}</td>
                <td className="p-0 text-center">
                  <button
                    className="rounded px-1 align-middle text-red-600 hover:bg-red-50"
                    onClick={() => onRemove(b.id)}
                    title="Remove brand"
                  >
                    <Minus size={18} />
                  </button>
                </td>
              </tr>
            )
          })}
          {!brands.length && (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-[15px] text-muted">No brands — add one below.</td></tr>
          )}
        </tbody>
      </table>
      <div className="px-2 py-3">
        <Button variant="outline" className="flex items-center gap-1.5" onClick={onAdd}>
          <Plus size={16} /> Add brand
        </Button>
      </div>
    </div>
  )
}

/**
 * The brands of a price set when not editing: the same sheet as
 * PrintLikeBrandEditor (same columns, widths, Arial, green rows, red years),
 * with plain text where the editor has boxes and nothing to remove or add, so
 * turning "Edit set" on or off keeps every column in place (owner's ask, 28 Nov 2026).
 */
function PrintLikeBrandTable({ rows, hasSize }: { rows: BrandQuoteRow[]; hasSize: boolean }) {
  const years = (r: BrandQuoteRow, coverage: CoverageType) =>
    (r.coverage ?? 'guarantee') === coverage && r.guaranteeYears > 0 ? (
      <span style={{ color: yearsColor(r.guaranteeYears) }}>{r.guaranteeYears} Years</span>
    ) : null
  return (
    <div className="hidden overflow-x-auto bg-white text-black md:block" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <table className="w-full min-w-[640px] table-fixed border-collapse text-[22px] leading-[30px] [&_td]:border-0 [&_th]:border-0">
        <colgroup>
          <col className="w-[11%]" />
          <col className="w-[38%]" />
          <col className="w-[13%]" />
          <col className="w-[16%]" />
          <col className="w-[16%]" />
          <col className="w-[6%]" />
        </colgroup>
        <thead>
          <tr>
            <th className="px-2 pb-3 pt-2 text-right font-normal">Rate</th>
            <th className="px-2 pb-3 pt-2 text-left font-normal">Brand</th>
            <th className="px-2 pb-3 pt-2 text-left font-normal">Cost</th>
            <th className="px-2 pb-3 pt-2 text-center font-normal">Guarantee</th>
            <th className="px-2 pb-3 pt-2 text-center font-normal">Warranty</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={tintedRowStyle(r)}>
              {/* px-[5px]: the editor box padding (px-1) plus its 1px border */}
              <td className="whitespace-nowrap px-[5px] py-0 text-right tabular-nums">{r.rate}</td>
              <td className="truncate px-[5px] py-0">{r.brandName}</td>
              <td className="px-2 py-0 tabular-nums">{hasSize ? Math.round(r.cost) : ''}</td>
              <td className="px-[5px] py-0 text-center">{years(r, 'guarantee')}</td>
              <td className="px-[5px] py-0 text-center">{years(r, 'warranty')}</td>
              <td />
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-[15px] text-muted">No brands — turn on Edit set to add brands.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Bed Inner Ply has boards and grades rather than one size and a price set, and
 * Size Rates has a brand and its sizes: each has its own screen.
 */
export function QuotationBuilder() {
  const { id, category } = useParams()
  const { quotations } = useStore()
  const kind = category ?? quotations.find((q) => q.id === id)?.category
  if (kind === 'bed-inner-ply') return <BedPlyBuilder Preview={InlineQuotationPreview} />
  if (kind === 'size-rates') return <SizeRatesBuilder Preview={InlineQuotationPreview} />
  return <RateCardBuilder />
}

function RateCardBuilder() {
  const { id, category } = useParams()
  const { sets, quotations, nextQuoteNumber, saveQuotation, upsertCustomer, addSet, removeSet, updateBrand, removeBrand, addBrand } = useStore()
  const existing = quotations.find((q) => q.id === id)

  const [number] = useState(() => existing?.number ?? nextQuoteNumber())
  const [quoteId] = useState(() => existing?.id ?? uid())
  const [deletingSet, setDeletingSet] = useState(false)
  // The customer accounts the name box offers (guarantee/GuaranteeBuilder CustomerAccounts).
  const [accounts, setAccounts] = useState<CustomerAccount[]>([])
  const [customer, setCustomer] = useState(
    existing?.customer ?? { id: uid(), name: '', mobile: '', altMobile: '', uid: '', address: '' },
  )
  const [withCustomer, setWithCustomer] = useState(!!existing?.customer?.name)
  const [printState, setPrintState] = useState<null | 'printing' | 'done' | { error: string }>(null)
  const [sharing, setSharing] = useState(false)
  const [copies, setCopies] = useState(1)
  const { printNode, mount: localPrintMount } = useLocalPrint()

  const [cat, setCat] = useState<ProductCategory>(
    isCategory(category) ? category : existing?.category ?? 'readymade-door',
  )
  const [h, setH] = useState<Dimension>(existing?.height ?? blankDim())
  const [w, setW] = useState<Dimension>(existing?.width ?? blankDim())
  // Always one piece: the counter quotes per piece, so there is no quantity to ask for.
  const qty = existing?.qty ?? 1
  const [addons, setAddons] = useState<AluAddons>(defaultAddons())
  // selected price set
  const [setId, setSetId] = useState(sets[0]?.id)
  const activeSet = sets.find((s) => s.id === setId) ?? sets[0]
  const [editMode, setEditModeRaw] = useState(false)
  const [asking, setAsking] = useState<null | 'unlock' | 'delete'>(null)
  const [, bump] = useState(0)
  const setEditMode = (on: boolean) => {
    if (!on) { lockDefaultRates(); bump((n) => n + 1) }
    setEditModeRaw(on)
  }
  // The default set (C1) is protected: an edit copies it into a new set and
  // changes that copy; C1 itself needs the shop code (lib/defaultRates).
  const onLockedDefault = !!activeSet && activeSet.id === sets[0]?.id && !defaultRatesUnlocked()
  function editRates(apply: (targetSetId: string) => void) {
    if (!onLockedDefault) return apply(setId)
    const copyId = addSet(setId, true)
    setSetId(copyId)
    apply(copyId)
    toast('C1 is the default — saved your change as a new set')
  }
  const sizeCardRef = useRef<HTMLDivElement>(null)

  // Sync category when a different product submenu item is clicked.
  useEffect(() => {
    if (isCategory(category)) {
      setCat(category)
      setAddons(defaultAddons())
    }
  }, [category])

  const alu = isAluminium(cat)
  const upvc = isUpvc(cat)
  const aluLike = alu || upvc
  const fixed = isFixedCard(cat)
  const foot = isFootSized(cat)
  const hasSize = h.inches > 0 || w.inches > 0
  const brands = (activeSet?.brands ?? []).filter((b) => b.category === cat)
  const sqft = areaSqft(h, w, cat)
  // Aluminium is priced from its sections, materials and margin, or straight off
  // the selling sheet: the Aluminium rates screen sets which, per product.
  const aluCosting = useAluCosting()
  const aluThicknesses = alu
    ? calcAluminiumQuote(cat, h, w, addons, aluCosting)
    : upvc
      ? calcAllUpvcBrands(cat, h, w, addons)
      : []

  // Block board can leave out the semi water proof and commercial grades.
  const [waterProofOnly, setWaterProofOnly] = useState(() => {
    try { return localStorage.getItem('shiv-quote:water-proof-only') === '1' } catch { return false }
  })
  const toggleWaterProofOnly = () => setWaterProofOnly((on) => {
    try { localStorage.setItem('shiv-quote:water-proof-only', on ? '0' : '1') } catch { /* private window */ }
    return !on
  })
  // Readymade door's "Experiment 1": the Door with Fitting section under the
  // rates. Remembered on this device, like the water proof switch.
  const [fitting, setFitting] = useState(() => {
    if (existing) return !!existing.fitting
    try { return localStorage.getItem('shiv-quote:door-fitting') === '1' } catch { return false }
  })
  const toggleFitting = () => setFitting((on) => {
    try { localStorage.setItem('shiv-quote:door-fitting', on ? '0' : '1') } catch { /* private window */ }
    return !on
  })
  const allRows = !aluLike && !fixed ? buildBrandRows(brands, h, w, Math.max(1, qty)) : []
  const rows = waterProofOnly && hasSections(cat) ? firstSectionRows(cat, allRows) : allRows

  function buildQuote(): Quotation {
    const base = {
      id: quoteId,
      number,
      // The working date picked in the sidebar, when one is (lib/businessDate).
      date: workingDate() ? `${workingDate()}T06:30:00.000Z` : new Date().toISOString(),
      customer: withCustomer ? customer : { id: customer.id, name: '', mobile: '' },
      category: cat,
      height: h,
      width: w,
      qty: Math.max(1, qty),
      sqft: areaSqft(h, w, cat),
      notes: '',
    }
    if (aluLike) {
      return {
        ...base,
        alu: {
          addons: activeAddonLabels(cat, addons),
          glassType: addons.glassType,
          thicknesses: aluThicknesses,
        },
      }
    }
    if (fixed) {
      return { ...base, fixedRows: FIXED_CARDS[cat] ?? [] }
    }
    return { ...base, rows, ...(cat === 'readymade-door' && fitting ? { fitting: true } : {}) }
  }

  function save({ silent = false }: { silent?: boolean } = {}) {
    if (withCustomer && customer.name) upsertCustomer(customer)
    saveQuotation(buildQuote())
    if (!silent) toast(`Saved ${number}`)
  }

  /** The quotation as a JPG, made on this phone from the layout that prints — works anywhere. */
  async function shareWhatsApp() {
    if (!hasSize && !fixed) return
    setSharing(true)
    try {
      save({ silent: true })
      const shareDoc = enrichQuotation(buildQuote())
      const blob = await elementToJpeg(<QuotationPrint quote={shareDoc} />)
      // Straight into the Shiv Hardware group from the shop's number; where the
      // shop PC cannot be reached (not on shop Wi-Fi), the phone's share sheet.
      try {
        await sendWhatsAppDocument('group', blob, `${shareDoc.number}.jpg`)
        toast(`${shareDoc.number} sent to the Shiv Hardware group`)
        return
      } catch (err) {
        if (!(err instanceof TypeError)) throw err
      }
      const how = await shareJpeg(blob, `${shareDoc.number}.jpg`)
      if (how === 'saved') toast(`${shareDoc.number}.jpg saved — send it from your photos`)
    } catch (err) {
      toast(`Share failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setSharing(false)
    }
  }

  async function handleDirectPrint() {
    if (!hasSize && !fixed) return
    setPrintState('printing')
    save({ silent: true })
    const printDoc = enrichQuotation(buildQuote())

    // In the desktop app: drawn here as the preview shows it, straight to the
    // printer set on the Printers screen (lib/quotePrinter.ts).
    if (canLocalPrint()) {
      try {
        await printNode(<QuotationPrint quote={printDoc} />, copies, await quotationPrinter())
        setCopies(1)
        setPrintState('done')
        setTimeout(() => setPrintState(null), 2500)
        return
      } catch {
        // fall through to the shop PC below
      }
    }

    // The shop PC: directly on its Wi-Fi, or through the online queue from anywhere.
    try {
      const sent = await printViaShop({ kind: 'quotation', quote: printDoc }, {
        copies,
        onDone: (r) => toast(r.ok ? `${printDoc.number} printed at the shop` : `Not printed: ${r.error}`, r.ok ? 'ok' : 'error'),
      })
      if (sent.via === 'queue') toast(`${printDoc.number} sent to the shop PC`, 'info')
      setCopies(1)
      setPrintState('done')
      setTimeout(() => setPrintState(null), 2500)
    } catch (err) {
      setPrintState({ error: err instanceof Error ? err.message : String(err) })
    }
  }

  const doc = enrichQuotation(buildQuote())
  const toggle = (k: keyof AluAddons) => setAddons((a) => ({ ...a, [k]: !a[k] }))
  const focusNextSizeEntry = (e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key !== 'Enter') return

    const entries = Array.from(
      sizeCardRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-size-entry]') ?? [],
    )
    const next = entries[entries.indexOf(e.currentTarget) + 1]
    // Last size box: leave Enter to the app's flow (on to the next box / Print).
    if (!next) return
    e.preventDefault()
    next.focus()
    if (next instanceof HTMLInputElement) next.select()
  }

  return (
    <div className="flex flex-col xl:h-full">
      {localPrintMount}
      <div className="no-print border-b border-stone-200/80 bg-stone-50/95 px-2 py-2 shadow-sm backdrop-blur dark:border-white/10 dark:bg-stone-950/90 md:px-4">
        <div className="flex items-center justify-center pb-2">
          <span className="rounded-full border border-stone-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-stone-300">
            {CATEGORY_LABELS[cat]}
          </span>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex shrink-0 flex-wrap gap-2">
            {alu && <PriceBySwitch category={cat} />}
            <Button
              variant="outline"
              onClick={shareWhatsApp}
              className="flex flex-1 items-center justify-center gap-1.5 md:flex-none"
              disabled={(!hasSize && !fixed) || sharing}
            >
              <Share2 size={16} /> {sharing ? 'Sharing' : 'WhatsApp'}
            </Button>
            <CopiesBox copies={copies} onChange={setCopies} />
            <Button onClick={handleDirectPrint} disabled={(!hasSize && !fixed) || printState === 'printing'} data-enter-submit className="flex flex-1 items-center justify-center gap-1.5 md:flex-none">
              {printState === 'printing' ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
              {printState === 'printing' ? 'Printing…' : copies > 1 ? `Print ${copies}` : 'Print'}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-2 md:gap-3 md:p-4 xl:min-h-0 xl:flex-1 xl:flex-row">
        {/* On a wide screen the screen fits the window: the page as it prints
            stands whole on the right, and the size and prices scroll on their own
            on the left (owner, 28 Nov 2026). Narrower, this box is no box
            (contents) and the order classes place the preview: last on a phone,
            above the prices on a tablet. */}
        <div className="contents xl:flex xl:min-w-0 xl:flex-1 xl:flex-col xl:gap-3 xl:overflow-y-auto">
        {/* Optional customer details — hidden for fixed rate cards (no inputs) */}
        {!fixed && (
        <div className="shrink-0">
          <Toggle checked={withCustomer} onChange={setWithCustomer} label="Customer details" />
        </div>
        )}

        {!fixed && withCustomer && (
          <div className="shrink-0 rounded-xl border border-stone-200/90 bg-stone-50 p-3 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Customer</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* Picked from the customer accounts, as on the guarantee card: the
                  mobile comes with it. A name not in the books can still be typed. */}
              {(
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
              )}
              <CustomerAccounts onAccounts={setAccounts} />
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted">Mobile</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={customer.mobile}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 10)
                    setCustomer({ ...customer, mobile: value })
                  }}
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 transition ${
                    customer.mobile.length === 10
                      ? 'border-green-500 bg-green-50 focus:border-green-600 focus:ring-green-600/20 dark:border-green-600 dark:bg-green-950/30'
                      : 'border-stone-300 bg-stone-50 focus:border-shiv-green focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950'
                  } dark:text-stone-100`}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted">2nd Mobile (optional)</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={customer.altMobile ?? ''}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 10)
                    setCustomer({ ...customer, altMobile: value })
                  }}
                  className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm outline-none transition focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
                />
              </label>
            </div>
          </div>
        )}

        {/* Size — hidden for fixed rate cards (FF Ply / WPC have no size calc) */}
        {!fixed && (
        <div ref={sizeCardRef} className="shrink-0">
          <div className="rounded-xl border border-stone-200/90 bg-stone-50 p-3 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100 md:p-4">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted md:mb-3">Size</h2>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-10 md:items-end md:gap-3">
              <DimInput label="Height" dim={h} onChange={setH} onKeyDown={focusNextSizeEntry} feet={foot} className="min-w-0 md:col-span-5" />
              <DimInput label="Width" dim={w} onChange={setW} onKeyDown={focusNextSizeEntry} feet={foot} className="min-w-0 md:col-span-5" />
            </div>

            {/* Aluminium / UPVC options */}
            {aluLike && (
              <div className="mt-3 md:mt-4">
                <div className="grid grid-cols-2 gap-1.5 md:flex md:flex-wrap md:gap-2.5">
                  {ADDONS
                    .filter((o) => o.offered(cat))
                    .map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => toggle(o.key)}
                        className={`flex h-9 min-w-0 items-center justify-between gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition md:h-auto md:min-w-[132px] md:px-4 md:py-2 md:text-sm ${
                          addons[o.key]
                            ? 'border-shiv-green bg-shiv-green/10 text-stone-900 dark:text-stone-100'
                            : 'border-stone-300 bg-stone-100 text-muted hover:border-stone-400 dark:border-white/15 dark:bg-transparent '
                        }`}
                      >
                        <span className="min-w-0 truncate">{o.label}</span>
                        <span
                          aria-hidden="true"
                          className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition ${
                            addons[o.key] ? 'bg-shiv-green' : 'bg-stone-300 dark:bg-stone-700'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition ${
                              addons[o.key] ? 'left-3.5' : 'left-0.5'
                            }`}
                          />
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {alu && (
              <Link
                to={`/aluminium-rates/${productOf(cat)}`}
                className="mt-2 flex min-h-10 items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800 hover:border-shiv-green dark:border-white/15 dark:bg-transparent dark:text-stone-100 md:mt-3"
              >
                <Calculator size={16} />
                {aluCosting.priceBy[productOf(cat)] === 'sheet'
                  ? 'Priced by the sheet: rates by area'
                  : <>Section kg, aluminium rate, materials &amp; margin</>}
              </Link>
            )}

            <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-stone-300 md:mt-3">
              Size: <b>{formatSize(h, w, cat) || '—'}</b> · <b>{sqft.toFixed(2)}</b> sqft
            </div>
          </div>
        </div>
        )}

        {/* On a phone the prices come first, straight under the size; the
            page as it prints follows below them. */}

        {/* Live preview: all-brands rate card OR aluminium breakdown */}
        <div className="flex flex-col md:order-1 rounded-xl border border-stone-200/90 bg-stone-50 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100">
          {aluLike && (
            <div className="shrink-0 border-b border-stone-100 bg-stone-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-muted dark:border-white/10 dark:bg-white/5 md:px-4 md:py-2 md:text-xs">
              {upvc ? 'UPVC' : 'Aluminium'} Cost
            </div>
          )}
          <div className="overflow-visible">
            {fixed ? (
              <table className="w-full text-[11px] leading-tight md:text-sm">
                <thead className="bg-stone-50 text-left text-[11px] uppercase text-muted dark:bg-white/5 dark:text-muted md:text-xs">
                  <tr>
                    <th className="px-2 py-1.5 md:px-4 md:py-2">{FIXED_CARD_META[cat]?.leftHeader}</th>
                    <th className="px-2 py-1.5 md:px-4 md:py-2">Brand</th>
                    {FIXED_CARD_META[cat]?.showRate && <th className="px-2 py-1.5 text-right md:px-4 md:py-2">Rate</th>}
                    <th className="px-2 py-1.5 text-right md:px-4 md:py-2">Cost</th>
                    {FIXED_CARD_META[cat]?.showGuarantee && <th className="px-2 py-1.5 text-center md:px-4 md:py-2">Guarantee</th>}
                  </tr>
                </thead>
                <tbody>
                  {(FIXED_CARDS[cat] ?? []).map((r, i) => (
                    <tr key={i} className="border-t border-stone-100 dark:border-white/10" style={r.accentColor ? { backgroundColor: r.accentColor } : undefined}>
                      <td className="px-2 py-1.5 font-medium md:px-4 md:py-2">{r.label}</td>
                      <td className="px-2 py-1.5 md:px-4 md:py-2">{r.brand}</td>
                      {FIXED_CARD_META[cat]?.showRate && <td className="px-2 py-1.5 text-right text-muted md:px-4 md:py-2">{r.rate}</td>}
                      <td className="px-2 py-1.5 text-right font-semibold md:px-4 md:py-2">{formatINR(r.cost)}</td>
                      {FIXED_CARD_META[cat]?.showGuarantee && <td className="px-2 py-1.5 text-center text-shiv-red md:px-4 md:py-2">{r.guaranteeYears ? `${r.guaranteeYears} Years` : ''}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : !aluLike ? (
            <>
            {/* On a phone, the prices as a list: the brand and its guarantee on
                the left, what it costs large on the right, the rate under it. */}
            {!editMode && (
              <ul className="divide-y divide-stone-100 dark:divide-white/10 md:hidden">
                {rows.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-3 py-2.5" style={tintedRowStyle(r)}>
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-semibold text-stone-900 dark:text-stone-50">{r.brandName}</div>
                      {r.guaranteeYears ? (
                        <div className="text-xs font-semibold text-shiv-red">{coverageLabel(r.coverage)} {r.guaranteeYears} years</div>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-base font-bold tabular-nums text-stone-900 dark:text-stone-50">{hasSize ? formatINR(r.cost) : '—'}</div>
                      <div className="text-[11px] tabular-nums text-muted">₹{r.rate}/sqft</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {editMode ? (
              <PrintLikeBrandEditor
                brands={brands}
                costOf={(name) => (hasSize ? rows.find((r) => r.brandName === name)?.cost : undefined)}
                onChange={(id, patch) => editRates((t) => updateBrand(t, id, patch))}
                onRemove={(id) => editRates((t) => removeBrand(t, id))}
                onAdd={() => editRates((t) => addBrand(t, cat))}
              />
            ) : (
              <PrintLikeBrandTable rows={rows} hasSize={hasSize} />
            )}
            </>
            ) : (
            // Aluminium — all 3 thicknesses side by side
            <table className="w-full table-fixed text-[11px] leading-tight md:text-sm">
              <colgroup>
                <col className="w-[28%]" />
                <col className="w-[24%]" />
                <col className="w-[24%]" />
                <col className="w-[24%]" />
              </colgroup>
              <thead className="bg-stone-50 text-left text-[11px] uppercase text-muted dark:bg-white/5 dark:text-muted md:text-xs">
                <tr>
                  <th className="px-2 py-1.5 md:px-4 md:py-2">Item</th>
                  {aluThicknesses.map((t) => (
                    <th key={t.name} className="break-words px-1.5 py-1.5 text-right md:px-4 md:py-2">{t.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cat === 'aluminium-door' ? (
                  <>
                    {[
                      { label: 'Door', key: 'doorCost' as const },
                      addons.chaukhat ? { label: 'Chaukhat', key: 'chaukhatCost' as const } : null,
                      addons.accessories ? { label: 'Accessories', key: 'accessories' as const } : null,
                    ].filter((row): row is { label: string; key: 'doorCost' | 'chaukhatCost' | 'accessories' } => !!row)
                      .map(({ label, key }) => (
                        <tr key={key} className="border-t border-stone-100 dark:border-white/10">
                          <td className="break-words px-2 py-1.5 text-muted md:px-4 md:py-2">{label}</td>
                          {aluThicknesses.map((t) => (
                            <td key={t.name} className="px-1.5 py-1.5 text-right md:px-4 md:py-2">{hasSize ? formatINR(t[key]) : '—'}</td>
                          ))}
                        </tr>
                      ))}
                    <tr className="border-t-2 border-stone-200 bg-stone-50 dark:border-white/20 dark:bg-white/5">
                      <td className="break-words px-2 py-1.5 font-bold md:px-4 md:py-2.5">Total</td>
                      {aluThicknesses.map((t) => (
                        <td key={t.name} className="px-1.5 py-1.5 text-right font-bold text-shiv-green md:px-4 md:py-2.5">
                          {hasSize ? formatINR(t.total) : '—'}
                        </td>
                      ))}
                    </tr>
                    {[
                      addons.decorFilm ? { label: 'Decor Film', key: 'decorFilm' as const } : null,
                      addons.brownCoated ? { label: 'Brown Coated', key: 'brownCoated' as const } : null,
                    ].filter((row): row is { label: string; key: 'decorFilm' | 'brownCoated' } => !!row)
                      .map(({ label, key }) => (
                        <tr key={key} className="border-t border-stone-100 dark:border-white/10">
                          <td className="break-words px-2 py-1.5 text-[11px] uppercase text-muted md:px-4 md:py-2 md:text-xs">{label}</td>
                          {aluThicknesses.map((t) => (
                            <td key={t.name} className="px-1.5 py-1.5 text-right text-[10px] text-muted md:px-4 md:py-2 md:text-xs">
                              {hasSize ? formatINR(t[key] ?? 0) : '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </>
                ) : (
                  <>
                    {[
                      { label: 'Clear & Texture Glass', key: 'doorCost' },
                      { label: 'Reflective Glass', key: 'reflectiveCost' },
                    ].map(({ label, key }) => (
                      <tr key={key} className="border-t border-stone-100 dark:border-white/10">
                        <td className="break-words px-2 py-1.5 text-muted md:px-4 md:py-2">{label}</td>
                        {aluThicknesses.map((t) => (
                          <td key={t.name} className="px-1.5 py-1.5 text-right md:px-4 md:py-2">
                            {hasSize ? formatINR(Number((t as Record<string, unknown>)[key] ?? 0)) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {(cat === 'window-2-track' && addons.ssNet) || addons.brownCoated ? (
                      <tr className="border-t border-stone-100 bg-stone-50 dark:border-white/10 dark:bg-white/5">
                        <td colSpan={4} className="px-2 py-1.5 text-[11px] font-bold uppercase text-muted md:px-4 md:text-xs">Add-ons</td>
                      </tr>
                    ) : null}
                    {cat === 'window-2-track' && addons.ssNet && (
                      <tr className="border-t border-stone-100 dark:border-white/10">
                        <td className="break-words px-2 py-1.5 text-[11px] uppercase text-muted md:px-4 md:py-2 md:text-xs">SS Net</td>
                        {aluThicknesses.map((t) => (
                          <td key={t.name} className="px-1.5 py-1.5 text-right text-[10px] text-muted md:px-4 md:py-2 md:text-xs">
                            {hasSize ? formatINR(t.accessories) : '—'}
                          </td>
                        ))}
                      </tr>
                    )}
                    {addons.brownCoated && (
                      <tr className="border-t border-stone-100 dark:border-white/10">
                        <td className="break-words px-2 py-1.5 text-[11px] uppercase text-muted md:px-4 md:py-2 md:text-xs">Brown Coated</td>
                        {aluThicknesses.map((t) => (
                          <td key={t.name} className="px-1.5 py-1.5 text-right text-[10px] text-muted md:px-4 md:py-2 md:text-xs">
                            {hasSize ? formatINR(t.brownCoated) : '—'}
                          </td>
                        ))}
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
            )}
          </div>
        </div>

        {/* Edit-set toolbar (rename / delete the active set) */}
        {!alu && editMode && (
          <div className="flex shrink-0 md:order-1 items-center justify-between rounded-xl border border-stone-200/90 bg-stone-50 p-3 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100">
            <div className="text-sm font-semibold text-stone-700 dark:text-stone-200">
              Active set: <span className="text-shiv-green">{activeSet?.name ?? 'C1'}</span>
            </div>
            {onLockedDefault && (
              <Button variant="ghost" onClick={() => setAsking('unlock')}>
                Unlock {activeSet?.name} (code)
              </Button>
            )}
            <Button
              variant="ghost"
              className="flex items-center gap-1.5 text-danger"
              disabled={sets.length <= 1}
              onClick={() => (onLockedDefault ? setAsking('delete') : setDeletingSet(true))}
            >
              <Trash2 size={15} /> Delete set
            </Button>
            {asking && (
              <Confirm
                title={asking === 'unlock' ? `Unlock ${activeSet?.name} for editing` : `Delete ${activeSet?.name}?`}
                body={asking === 'unlock' ? 'C1 is the default rate set. Without the code, edits are saved as a new set instead.' : 'C1 is the default rate set.'}
                confirmLabel={asking === 'unlock' ? 'Unlock' : 'Delete'}
                danger={asking === 'delete'}
                ask={{ label: 'Code', secret: true }}
                onConfirm={(typed) => {
                  unlockDefaultRates(typed)
                  if (asking === 'delete') {
                    removeSet(setId)
                    setSetId(sets.find((s) => s.id !== setId)?.id ?? sets[0]?.id)
                    lockDefaultRates()
                  }
                  bump((n) => n + 1)
                }}
                onClose={() => setAsking(null)}
              />
            )}
            {deletingSet && (
              <Confirm
                title={`Delete ${activeSet?.name}?`}
                confirmLabel="Delete"
                danger
                onConfirm={() => {
                  removeSet(setId)
                  setSetId(sets.find((s) => s.id !== setId)?.id ?? sets[0]?.id)
                }}
                onClose={() => setDeletingSet(false)}
              />
            )}
          </div>
        )}
        </div>
        <div className="order-last md:order-none xl:flex xl:w-[min(50%,calc((100dvh-280px)*0.707+30px))] xl:shrink-0 xl:flex-col">
          {/* What goes on the page is decided right above the page itself. */}
          {hasSections(cat) && (
              <button
                type="button"
                onClick={toggleWaterProofOnly}
                aria-pressed={waterProofOnly}
                className="mb-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-stone-200/90 bg-stone-50 px-3 py-2 text-left text-sm font-semibold shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 md:mb-3"
              >
                <span>Water proof only</span>
                <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${waterProofOnly ? 'bg-shiv-green' : 'bg-stone-300 dark:bg-stone-700'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${waterProofOnly ? 'left-[18px]' : 'left-0.5'}`} />
                </span>
              </button>
            )}
          <InlineQuotationPreview quote={doc} side />
        </div>
      </div>

      {!alu && (
        <div className="no-print mt-auto border-t border-stone-200/80 bg-stone-50/95 px-2 py-2 shadow-[0_-6px_16px_rgba(0,0,0,0.04)] backdrop-blur dark:border-white/10 dark:bg-stone-950/90 md:px-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Price Set</span>
              {sets.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSetId(s.id)}
                  className={`min-h-11 rounded-lg border px-3 py-1 text-xs font-medium transition md:min-h-0 ${
                    s.id === setId
                      ? 'border-shiv-green bg-shiv-green text-stone-950 shadow-sm'
                      : 'border-stone-300 bg-stone-100 text-stone-600 hover:border-shiv-green hover:bg-stone-50 dark:border-white/15 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10'
                  }`}
                >
                  {s.name}
                </button>
              ))}
              {cat === 'readymade-door' && (
                <button
                  onClick={toggleFitting}
                  aria-pressed={fitting}
                  title="Print the Door with Fitting section under the rates"
                  className={`min-h-11 rounded-lg border px-3 py-1 text-xs font-medium transition md:min-h-0 ${
                    fitting
                      ? 'border-stone-900 bg-stone-900 text-white shadow-sm dark:border-white dark:bg-white dark:text-stone-950'
                      : 'border-stone-300 bg-stone-100 text-stone-600 hover:border-stone-900 hover:bg-stone-50 dark:border-white/15 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10'
                  }`}
                >
                  Experiment 1
                </button>
              )}
              <button
                onClick={() => setSetId(addSet(setId))}
                className="flex min-h-11 items-center gap-1 rounded-lg border border-dashed border-stone-400 px-3 py-1 text-xs font-medium text-muted hover:border-shiv-green hover:bg-white dark:border-white/20 dark:hover:bg-white/10 md:min-h-0"
              >
                <Plus size={15} /> Add Set
              </button>
              <span className="ml-auto">
                <Toggle checked={editMode} onChange={setEditMode} label="Edit set" />
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Print status: a small chip in the corner. Nothing behind it is
          covered or frozen, so the next quote can be typed while it prints
          (owner, 27 Nov 2026). */}
      {printState && (
        <div
          role="status"
          className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 border-2 border-black px-3 py-2 text-sm font-semibold shadow-lg ${
            printState === 'printing'
              ? 'bg-yellow-300 text-black'
              : printState === 'done'
                ? 'bg-green-600 text-white'
                : 'bg-red-600 text-white'
          }`}
        >
          {printState === 'printing' && (<><Loader2 size={16} className="animate-spin" /> Printing</>)}
          {printState === 'done' && (<><CheckCircle2 size={16} /> Sent to printer</>)}
          {typeof printState === 'object' && 'error' in printState && (
            <>
              <AlertCircle size={16} />
              <span className="max-w-xs truncate" title={printState.error}>Not printed: {printState.error}</span>
              <button onClick={() => setPrintState(null)} className="ml-1 underline">Close</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The page as it prints, scaled to the width it has. Beside the controls
 * (`side`, a wide screen) it is also kept to the height of the window, so the
 * whole page shows at once.
 */
function InlineQuotationPreview({ quote, side = false }: { quote: Quotation; side?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const wide = side ? window.matchMedia('(min-width: 1280px)') : null
    const update = () => {
      const byWidth = Math.max(0, el.clientWidth - 2) / A4_W
      const byHeight = wide?.matches ? Math.max(0, el.clientHeight - 2) / A4_H : Infinity
      setScale(Math.min(1, byWidth, byHeight))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    wide?.addEventListener('change', update)
    return () => { ro.disconnect(); wide?.removeEventListener('change', update) }
  }, [side])

  return (
    <div className={`no-print rounded-xl border border-stone-200/90 bg-stone-50 p-2 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100 md:p-3 ${side ? 'xl:flex xl:min-h-0 xl:flex-1 xl:flex-col' : ''}`}>
      <div className="mb-2 shrink-0 text-xs font-bold uppercase tracking-wide text-muted">Print Preview</div>
      <div ref={wrapRef} className={`overflow-hidden rounded-lg border border-stone-200 bg-stone-200 dark:border-white/10 dark:bg-stone-950 ${side ? 'xl:relative xl:min-h-0 xl:flex-1' : ''}`}>
        <div
          // Beside the controls the page is laid over its box, so the box's height
          // comes from the window and never from the page it is scaled to.
          className={`mx-auto overflow-hidden bg-white ${side ? 'xl:absolute xl:inset-x-0 xl:top-0' : ''}`}
          style={{
            width: Math.round(A4_W * scale),
            height: Math.round(A4_H * scale),
          }}
        >
          <div
            style={{
              width: A4_W,
              height: A4_H,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            <QuotationPrint quote={quote} />
          </div>
        </div>
      </div>
    </div>
  )
}

const UPVC_WINDOWS: ProductCategory[] = ['upvc-2-track', 'upvc-2.5-track', 'upvc-3-track']

/**
 * The extras each product offers. One table for the tick boxes and for what
 * the saved quotation lists, so anything ticked — and so priced — is written
 * on the quote too. It used to be two lists, and a UPVC window priced with
 * its chaukhat and net printed without saying so.
 */
const ADDONS: { key: 'chaukhat' | 'accessories' | 'ssNet' | 'decorFilm' | 'brownCoated'; label: string; offered: (cat: ProductCategory) => boolean }[] = [
  { key: 'chaukhat', label: 'Chaukhat', offered: (cat) => cat === 'aluminium-door' || UPVC_WINDOWS.includes(cat) },
  { key: 'accessories', label: 'Accessories', offered: (cat) => cat === 'aluminium-door' || cat === 'upvc-door' },
  { key: 'ssNet', label: 'SS Net', offered: (cat) => cat === 'window-2-track' || UPVC_WINDOWS.includes(cat) },
  { key: 'decorFilm', label: 'Decor Film', offered: (cat) => cat === 'aluminium-door' },
  { key: 'brownCoated', label: 'Brown Coated', offered: (cat) => isAluminium(cat) || UPVC_WINDOWS.includes(cat) },
]

function activeAddonLabels(cat: ProductCategory, a: AluAddons): string[] {
  return ADDONS.filter((o) => o.offered(cat) && a[o.key]).map((o) => o.label)
}


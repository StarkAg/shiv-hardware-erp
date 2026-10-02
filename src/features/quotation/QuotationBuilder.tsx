import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useParams } from 'react-router-dom'
import { Minus, Plus, Printer, Share2, Trash2 } from 'lucide-react'
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
  calcAllThicknesses,
  defaultAddons,
  isAluminium,
} from '../../lib/aluminium'
import { calcAllUpvcBrands, isUpvc } from '../../lib/upvc'
import { FIXED_CARDS, FIXED_CARD_META, isFixedCard } from '../../lib/data/fixedCards'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button, Input, Toggle } from '../../components/ui'
import { QuotationPrint } from '../print/QuotationPrint'
import { printOnServer, renderPngOnServer } from '../../lib/printServer'
import { createCloudPrintJob } from '../../lib/cloudApi'
import { canLocalPrint, useLocalPrint } from '../../lib/useLocalPrint'
import { toast } from '../../components/Toast'
import Confirm from '../ledger/components/Confirm'

const blankDim = (): Dimension => ({ inches: 0, soot: 0 })
const uid = () => Math.random().toString(36).slice(2, 10)
const A4_W = 794
const A4_H = 1123
const GUARANTEE_OPTIONS: GuaranteeYears[] = [0, 1, 3, 5, 7, 8, 10, 15, 20, 21, 25, 30]
const COVERAGE_OPTIONS: CoverageType[] = ['guarantee', 'warranty']
const isCategory = (c?: string): c is ProductCategory =>
  !!c && CATEGORY_ORDER.includes(c as ProductCategory)

function coverageLabel(coverage: CoverageType | undefined) {
  return coverage === 'warranty' ? 'Wty' : 'Gty'
}

function tintedRowStyle(item: Pick<Brand, 'accentColor'> | Pick<BrandQuoteRow, 'accentColor'>) {
  return item.accentColor ? { backgroundColor: item.accentColor } : undefined
}

export function QuotationBuilder() {
  const { id, category } = useParams()
  const { sets, quotations, nextQuoteNumber, saveQuotation, upsertCustomer, addSet, removeSet, updateBrand, removeBrand, addBrand } = useStore()
  const existing = quotations.find((q) => q.id === id)

  const [number] = useState(() => existing?.number ?? nextQuoteNumber())
  const [quoteId] = useState(() => existing?.id ?? uid())
  const [deletingSet, setDeletingSet] = useState(false)
  const [customer, setCustomer] = useState(
    existing?.customer ?? { id: uid(), name: '', mobile: '', uid: '', address: '' },
  )
  const [withCustomer, setWithCustomer] = useState(!!existing?.customer?.name)
  const [printState, setPrintState] = useState<null | 'printing' | 'done' | { error: string }>(null)
  const [sharing, setSharing] = useState(false)
  const { printNode, mount: localPrintMount } = useLocalPrint()

  const [cat, setCat] = useState<ProductCategory>(
    isCategory(category) ? category : existing?.category ?? 'readymade-door',
  )
  const [h, setH] = useState<Dimension>(existing?.height ?? blankDim())
  const [w, setW] = useState<Dimension>(existing?.width ?? blankDim())
  const [qty, setQty] = useState<number>(existing?.qty ?? 1)
  const [addons, setAddons] = useState<AluAddons>(defaultAddons())
  // selected price set
  const [setId, setSetId] = useState(sets[0]?.id)
  const activeSet = sets.find((s) => s.id === setId) ?? sets[0]
  const [editMode, setEditMode] = useState(false)
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
  const aluThicknesses = alu
    ? calcAllThicknesses(cat, h, w, addons)
    : upvc
      ? calcAllUpvcBrands(cat, h, w, addons)
      : []

  const rows = !aluLike && !fixed ? buildBrandRows(brands, h, w, Math.max(1, qty)) : []

  function buildQuote(): Quotation {
    const base = {
      id: quoteId,
      number,
      date: new Date().toISOString(),
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
    return { ...base, rows }
  }

  function save({ silent = false }: { silent?: boolean } = {}) {
    if (withCustomer && customer.name) upsertCustomer(customer)
    saveQuotation(buildQuote())
    if (!silent) toast(`Saved ${number}`)
  }

  async function shareWhatsApp() {
    if (!hasSize && !fixed) return
    setSharing(true)
    try {
      save({ silent: true })
      const shareDoc = buildQuote()
      const png = await renderPngOnServer({ kind: 'quotation', quote: shareDoc })
      const dataUrl = `data:${png.mime};base64,${png.image}`
      const blob = await (await fetch(dataUrl)).blob()
      const fileName = `${shareDoc.number}.png`
      const shareText = `${shareDoc.number} - ${CATEGORY_LABELS[shareDoc.category] ?? 'Quotation'}`

      // Create download link
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = fileName

      // Method 1: Try native share API first (mobile only)
      const file = new File([blob], fileName, { type: png.mime })
      if (navigator.share && navigator.canShare?.({ files: [file] }) !== false) {
        try {
          await navigator.share({ files: [file], title: 'Quotation', text: shareText })
          URL.revokeObjectURL(url)
          return
        } catch (shareErr) {
          console.log('Share cancelled or failed:', shareErr)
        }
      }

      // Method 2: Download file and trigger system share (works on most mobile)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      // Open WhatsApp
      const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`
      setTimeout(() => {
        window.location.href = waUrl
      }, 500)

      toast(`${fileName} downloaded`)
      URL.revokeObjectURL(url)
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

    // Offline-first: in the desktop app, print straight to the local printer —
    // instant, and works with no internet (no print-server / no cloud queue).
    if (canLocalPrint()) {
      try {
        await printNode(<QuotationPrint quote={printDoc} />)
        setPrintState('done')
        setTimeout(() => setPrintState(null), 2500)
        return
      } catch {
        // fall through to server / cloud below
      }
    }

    try {
      await printOnServer({ kind: 'quotation', quote: printDoc })
      setPrintState('done')
      setTimeout(() => setPrintState(null), 2500)
    } catch (serverErr) {
      // fallback: cloud print job (needs internet)
      try {
        await createCloudPrintJob({ kind: 'quotation', quote: printDoc })
        setPrintState('done')
        setTimeout(() => setPrintState(null), 2500)
      } catch (cloudErr) {
        setPrintState({ error: cloudErr instanceof Error ? cloudErr.message : String(cloudErr) })
      }
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
    <div className="flex flex-col">
      {localPrintMount}
      <div className="no-print border-b border-stone-200/80 bg-stone-50/95 px-2 py-2 shadow-sm backdrop-blur dark:border-white/10 dark:bg-stone-950/90 md:px-4">
        <div className="flex items-center justify-center pb-2">
          <span className="rounded-full border border-stone-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-stone-300">
            {CATEGORY_LABELS[cat]}
          </span>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              onClick={shareWhatsApp}
              className="flex flex-1 items-center justify-center gap-1.5 md:flex-none"
              disabled={(!hasSize && !fixed) || sharing}
            >
              <Share2 size={16} /> {sharing ? 'Sharing' : 'WhatsApp'}
            </Button>
            <Button onClick={handleDirectPrint} disabled={(!hasSize && !fixed) || printState === 'printing'} data-enter-submit className="flex flex-1 items-center justify-center gap-1.5 md:flex-none">
              {printState === 'printing' ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
              {printState === 'printing' ? 'Printing…' : 'Print'}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-2 md:gap-3 md:p-4">
        {/* Optional customer details — hidden for fixed rate cards (no inputs) */}
        {!fixed && (
        <div className="shrink-0">
          <Toggle checked={withCustomer} onChange={setWithCustomer} label="Add customer details (optional)" />
        </div>
        )}

        {!fixed && withCustomer && (
          <div className="shrink-0 rounded-xl border border-stone-200/90 bg-stone-50 p-3 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">Customer</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input label="M/s (Name)" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
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
            <div className="mt-2 md:mt-3">
              <label className="mb-1 block text-xs font-medium text-muted">Qty</label>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={qty || ''}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                className="w-24 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm outline-none focus:border-shiv-green focus:ring-1 focus:ring-shiv-green dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
              />
            </div>

            {/* Aluminium / UPVC options */}
            {aluLike && (
              <div className="mt-3 md:mt-4">
                <div className="grid grid-cols-2 gap-1.5 md:flex md:flex-wrap md:gap-2.5">
                  {[
                    { key: 'chaukhat' as const, label: 'Chaukhat', show: cat === 'aluminium-door' || cat === 'upvc-2-track' || cat === 'upvc-2.5-track' || cat === 'upvc-3-track' },
                    { key: 'accessories' as const, label: 'Accessories', show: cat === 'aluminium-door' || cat === 'upvc-door' },
                    { key: 'ssNet' as const, label: 'SS Net', show: cat === 'window-2-track' || cat === 'upvc-2-track' || cat === 'upvc-2.5-track' || cat === 'upvc-3-track' },
                    { key: 'decorFilm' as const, label: 'Decor Film', show: cat === 'aluminium-door' },
                    { key: 'brownCoated' as const, label: 'Brown Coated', show: alu || cat === 'upvc-2-track' || cat === 'upvc-2.5-track' || cat === 'upvc-3-track' },
                  ]
                    .filter((o) => o.show)
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

            <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-stone-300 md:mt-3">
              Size: <b>{formatSize(h, w, cat) || '—'}</b> · <b>{sqft.toFixed(2)}</b> sqft
            </div>
          </div>
        </div>
        )}

        <InlineQuotationPreview quote={doc} />

        {/* Live preview: all-brands rate card OR aluminium breakdown */}
        <div className="flex flex-col rounded-xl border border-stone-200/90 bg-stone-50 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100">
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
            <table className="w-full table-fixed text-[11px] leading-tight md:text-sm">
              <thead className="bg-stone-50 text-left text-[11px] uppercase text-muted dark:bg-white/5 dark:text-muted md:text-xs">
                <tr>
                  <th className={`${editMode ? 'w-[52%]' : 'w-[44%]'} px-2 py-1.5 md:px-4 md:py-2`}>Brand</th>
                  <th className={`${editMode ? 'w-[20%]' : 'w-[17%]'} px-1.5 py-1.5 text-right md:px-4 md:py-2`}>Rate</th>
                  {!editMode && <th className="w-[21%] px-1.5 py-1.5 text-right md:px-4 md:py-2">Cost</th>}
                  <th className={`${editMode ? 'w-[18%]' : 'w-[18%]'} px-1.5 py-1.5 text-center md:px-4 md:py-2`}>Gty/Wty</th>
                  {editMode && <th className="w-10 px-2 py-1.5 md:px-4 md:py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {!editMode &&
                  rows.map((r, i) => (
                    <tr key={i} className="border-t border-stone-100 dark:border-white/10" style={tintedRowStyle(r)}>
                      <td className="break-words px-2 py-1.5 font-medium md:px-4 md:py-2">{r.brandName}</td>
                      <td className="px-1.5 py-1.5 text-right text-muted md:px-4 md:py-2">{r.rate}</td>
                      <td className="px-1.5 py-1.5 text-right font-semibold md:px-4 md:py-2">{hasSize ? formatINR(r.cost) : '—'}</td>
                      <td className="px-1.5 py-1.5 text-center md:px-4 md:py-2">
                        {r.guaranteeYears
                          ? <span className="text-shiv-red font-medium">{coverageLabel(r.coverage)} {r.guaranteeYears}y</span>
                          : <span className="text-stone-300 dark:text-stone-600">—</span>}
                      </td>
                    </tr>
                  ))}
                {editMode &&
                  brands.map((b) => (
                    <tr key={b.id} className="border-t border-stone-100 dark:border-white/10" style={tintedRowStyle(b)}>
                      <td className="px-1.5 py-1.5 md:px-3">
                        <input
                          className="h-8 w-full min-w-0 rounded border border-line px-1.5 text-[11px] dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 md:h-auto md:px-2 md:py-1 md:text-sm"
                          value={b.name}
                          onChange={(e) => updateBrand(setId, b.id, { name: e.target.value })}
                        />
                      </td>
                      <td className="px-1 py-1.5 md:px-3">
                        <input
                          type="number"
                          className="h-8 w-full min-w-0 rounded border border-line px-1 text-right text-[11px] dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 md:h-auto md:w-24 md:px-2 md:py-1 md:text-sm"
                          value={b.rate}
                          onChange={(e) => updateBrand(setId, b.id, { rate: Number(e.target.value) })}
                        />
                      </td>
                      <td className="px-1 py-1.5 text-center md:px-3">
                        <div className="grid grid-cols-2 gap-1">
                          <div className="relative">
                            <div className="flex h-8 w-full min-w-0 items-center justify-center rounded-lg border border-stone-300 bg-stone-50 px-1 text-[10px] font-medium text-stone-800 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 md:h-auto md:px-2 md:py-2 md:text-xs">
                              {coverageLabel(b.coverage)}
                            </div>
                            <select
                              aria-label="Coverage"
                              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                              value={b.coverage ?? 'guarantee'}
                              onChange={(e) => updateBrand(setId, b.id, { coverage: e.target.value as CoverageType })}
                            >
                              {COVERAGE_OPTIONS.map((coverage) => (
                                <option key={coverage} value={coverage}>
                                  {coverageLabel(coverage)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="relative">
                            <div className="flex h-8 w-full min-w-0 items-center justify-center rounded-lg border border-stone-300 bg-stone-50 px-1 text-[10px] font-medium text-stone-800 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 md:h-auto md:px-2 md:py-2 md:text-xs">
                              {b.guaranteeYears === 0 ? '-' : `${b.guaranteeYears}y`}
                            </div>
                            <select
                              aria-label="Guarantee"
                              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                              value={b.guaranteeYears}
                              onChange={(e) =>
                                updateBrand(setId, b.id, { guaranteeYears: Number(e.target.value) as GuaranteeYears })
                              }
                            >
                              {GUARANTEE_OPTIONS.map((g) => (
                                <option key={g} value={g}>{g === 0 ? '-' : `${g}y`}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </td>
                      <td className="px-1 py-1.5 text-right md:px-3">
                        <button
                          className="rounded p-1 text-danger hover:bg-red-50 dark:hover:bg-red-950/30"
                          onClick={() => removeBrand(setId, b.id)}
                          title="Remove brand"
                        >
                          <Minus size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                {!brands.length && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted">No brands — {editMode ? 'add one below.' : 'turn on Edit set to add brands.'}</td></tr>
                )}
              </tbody>
              {editMode && (
                <tfoot>
                  <tr className="border-t border-stone-100 dark:border-white/10">
                    <td colSpan={4} className="px-4 py-2">
                      <Button variant="outline" className="flex items-center gap-1.5" onClick={() => addBrand(setId, cat)}>
                        <Plus size={16} /> Add brand
                      </Button>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
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
          <div className="flex shrink-0 items-center justify-between rounded-xl border border-stone-200/90 bg-stone-50 p-3 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100">
            <div className="text-sm font-semibold text-stone-700 dark:text-stone-200">
              Active set: <span className="text-shiv-green">{activeSet?.name ?? 'C1'}</span>
            </div>
            <Button
              variant="ghost"
              className="flex items-center gap-1.5 text-danger"
              disabled={sets.length <= 1}
              onClick={() => setDeletingSet(true)}
            >
              <Trash2 size={15} /> Delete set
            </Button>
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

      {!alu && (
        <div className="no-print mt-auto border-t border-stone-200/80 bg-stone-50/95 px-2 py-2 shadow-[0_-6px_16px_rgba(0,0,0,0.04)] backdrop-blur dark:border-white/10 dark:bg-stone-950/90 md:px-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Price Set</span>
              {sets.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSetId(s.id)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                    s.id === setId
                      ? 'border-shiv-green bg-shiv-green text-stone-950 shadow-sm'
                      : 'border-stone-300 bg-stone-100 text-stone-600 hover:border-shiv-green hover:bg-stone-50 dark:border-white/15 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10'
                  }`}
                >
                  {s.name}
                </button>
              ))}
              <button
                onClick={() => setSetId(addSet(setId))}
                className="flex items-center gap-1 rounded-lg border border-dashed border-stone-400 px-2.5 py-1 text-xs font-medium text-muted hover:border-shiv-green hover:bg-white dark:border-white/20 dark:hover:bg-white/10"
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

      {/* Print status overlay */}
      {printState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-xs rounded-2xl border border-white/10 bg-stone-900 p-6 text-center shadow-2xl">
            {printState === 'printing' && (
              <>
                <Loader2 size={36} className="mx-auto mb-3 animate-spin text-shiv-green" />
                <p className="font-semibold text-stone-100">Sending to printer…</p>
              </>
            )}
            {printState === 'done' && (
              <>
                <CheckCircle2 size={36} className="mx-auto mb-3 text-shiv-green" />
                <p className="font-semibold text-stone-100">Sent!</p>
              </>
            )}
            {typeof printState === 'object' && 'error' in printState && (
              <>
                <AlertCircle size={36} className="mx-auto mb-3 text-red-400" />
                <p className="mb-1 font-semibold text-stone-100">Print failed</p>
                <p className="mb-4 text-sm text-muted">{printState.error}</p>
                <button
                  onClick={() => setPrintState(null)}
                  className="rounded-lg bg-stone-700 px-4 py-2 text-sm font-medium text-stone-100 hover:bg-stone-600"
                >
                  Dismiss
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function InlineQuotationPreview({ quote }: { quote: Quotation }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => {
      const available = Math.max(0, el.clientWidth - 2)
      setScale(Math.min(1, available / A4_W))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="no-print rounded-xl border border-stone-200/90 bg-stone-50 p-2 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100 md:p-3">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Print Preview</div>
      <div ref={wrapRef} className="overflow-hidden rounded-lg border border-stone-200 bg-stone-200 dark:border-white/10 dark:bg-stone-950">
        <div
          className="mx-auto overflow-hidden bg-white"
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

function activeAddonLabels(cat: ProductCategory, a: AluAddons): string[] {
  const out: string[] = []
  if (cat === 'aluminium-door' && a.chaukhat) out.push('Chaukhat')
  if (cat === 'aluminium-door' && a.accessories) out.push('Accessories')
  if (cat === 'window-2-track' && a.ssNet) out.push('SS Net')
  if (cat === 'aluminium-door' && a.decorFilm) out.push('Decor Film')
  if (a.brownCoated) out.push('Brown Coated')
  return out
}


function DimInput({
  label,
  dim,
  onChange,
  onKeyDown,
  feet = false,
  className = '',
}: {
  label: string
  dim: Dimension
  onChange: (d: Dimension) => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  feet?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">{label}</label>
      {/* Boards are sized in whole feet (no soot); doors/aluminium use inches + n/8. */}
      <div className={feet ? 'grid grid-cols-1' : 'grid grid-cols-[minmax(0,1fr)_4rem] gap-1.5 md:grid-cols-[minmax(0,1fr)_5rem] md:gap-2'}>
        <label className="relative block">
          <input
            type="number"
            min={0}
            inputMode="numeric"
            data-size-entry
            className="h-10 w-full rounded-lg border-2 border-stone-300 bg-stone-50 px-2 pr-8 text-lg font-semibold text-stone-950 outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 md:h-11 md:px-3 md:pr-9"
            placeholder="0"
            value={dim.inches || ''}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={onKeyDown}
            onChange={(e) => onChange({ inches: Number(e.target.value), soot: feet ? 0 : dim.soot })}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm font-bold text-muted md:right-3">{feet ? 'ft' : 'in'}</span>
        </label>
        {!feet && (
          <label className="relative block">
            <input
              type="number"
              min={0}
              max={7}
              inputMode="numeric"
              data-size-entry
              className="h-10 w-full rounded-lg border-2 border-stone-300 bg-stone-50 px-2 pr-6 text-lg font-semibold text-stone-950 outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 md:h-11 md:px-3 md:pr-7"
              placeholder="0"
              value={dim.soot || ''}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={onKeyDown}
              onChange={(e) => onChange({ ...dim, soot: Math.min(7, Math.max(0, Number(e.target.value))) })}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm font-bold text-muted">/8</span>
          </label>
        )}
      </div>
    </div>
  )
}

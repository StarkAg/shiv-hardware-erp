import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
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
import { areaSqft, buildBrandRows, enrichQuotation, formatINR, formatSize } from '../../lib/pricing'
import {
  type AluAddons,
  calcAllThicknesses,
  defaultAddons,
  isAluminium,
} from '../../lib/aluminium'
import { Button, Input, Toggle } from '../../components/ui'
import { PrintPreview } from '../print/PrintPreview'
import { QuotationPrint } from '../print/QuotationPrint'
import { renderPngOnServer } from '../../lib/printServer'

const blankDim = (): Dimension => ({ inches: 0, soot: 0 })
const uid = () => Math.random().toString(36).slice(2, 10)
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
  const [customer, setCustomer] = useState(
    existing?.customer ?? { id: uid(), name: '', mobile: '', uid: '', address: '' },
  )
  const [withCustomer, setWithCustomer] = useState(!!existing?.customer?.name)
  const [printMode, setPrintMode] = useState<null | 'quote'>(null)
  const [sharing, setSharing] = useState(false)

  const [cat, setCat] = useState<ProductCategory>(
    isCategory(category) ? category : existing?.category ?? 'readymade-door',
  )
  const [h, setH] = useState<Dimension>(existing?.height ?? blankDim())
  const [w, setW] = useState<Dimension>(existing?.width ?? blankDim())
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
  const hasSize = h.inches > 0 || w.inches > 0
  const brands = (activeSet?.brands ?? []).filter((b) => b.category === cat)
  const sqft = areaSqft(h, w)
  const aluThicknesses = alu ? calcAllThicknesses(cat, h, w, addons) : []

  const rows = !alu ? buildBrandRows(brands, h, w, 1) : []

  function buildQuote(): Quotation {
    const base = {
      id: quoteId,
      number,
      date: new Date().toISOString(),
      customer: withCustomer ? customer : { id: customer.id, name: '', mobile: '' },
      category: cat,
      height: h,
      width: w,
      sqft: areaSqft(h, w),
      notes: '',
    }
    if (alu) {
      return {
        ...base,
        alu: {
          addons: activeAddonLabels(cat, addons),
          glassType: addons.glassType,
          thicknesses: aluThicknesses,
        },
      }
    }
    return { ...base, rows }
  }

  function save({ silent = false }: { silent?: boolean } = {}) {
    if (withCustomer && customer.name) upsertCustomer(customer)
    saveQuotation(buildQuote())
    if (!silent) alert(`Saved ${number}`)
  }

  async function shareWhatsApp() {
    if (!hasSize) return
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

      alert(`${fileName} downloaded. It's ready in your Downloads. Now share it on WhatsApp.`)
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(`Share failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSharing(false)
    }
  }

  const doc = enrichQuotation(buildQuote())
  const toggle = (k: keyof AluAddons) => setAddons((a) => ({ ...a, [k]: !a[k] }))
  const focusNextSizeEntry = (e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key !== 'Enter') return

    e.preventDefault()
    const entries = Array.from(
      sizeCardRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-size-entry]') ?? [],
    )
    const next = entries[entries.indexOf(e.currentTarget) + 1]
    next?.focus()
    if (next instanceof HTMLInputElement) next.select()
  }

  return (
    <div className="flex flex-col">
      <div className="no-print border-b border-stone-200/80 bg-stone-50/95 px-2 py-2 shadow-sm backdrop-blur dark:border-white/10 dark:bg-stone-950/90 md:px-4">
        <div className="flex items-center justify-center pb-2">
          <span className="rounded-full border border-stone-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-stone-300">
            {CATEGORY_LABELS[cat]}
          </span>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              onClick={shareWhatsApp}
              className="flex flex-1 items-center justify-center gap-1.5 md:flex-none"
              disabled={!hasSize || sharing}
            >
              <Share2 size={16} /> {sharing ? 'Sharing' : 'WhatsApp'}
            </Button>
            <Button onClick={() => setPrintMode('quote')} disabled={!hasSize} className="flex flex-1 items-center justify-center gap-1.5 md:flex-none">
              <Printer size={16} /> Print
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-2 md:gap-3 md:p-4">
        {/* Optional customer details */}
        <div className="shrink-0">
          <Toggle checked={withCustomer} onChange={setWithCustomer} label="Add customer details (optional)" />
        </div>

        {withCustomer && (
          <div className="shrink-0 rounded-xl border border-stone-200/90 bg-stone-50 p-3 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">Customer</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input label="M/s (Name)" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-stone-500 dark:text-stone-400">Mobile</span>
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

        {/* Size */}
        <div ref={sizeCardRef} className="shrink-0">
          <div className="rounded-xl border border-stone-200/90 bg-stone-50 p-3 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100 md:p-4">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400 md:mb-3">Size</h2>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-10 md:items-end md:gap-3">
              <DimInput label="Height" dim={h} onChange={setH} onKeyDown={focusNextSizeEntry} className="min-w-0 md:col-span-5" />
              <DimInput label="Width" dim={w} onChange={setW} onKeyDown={focusNextSizeEntry} className="min-w-0 md:col-span-5" />
            </div>

            {/* Aluminium options */}
            {alu && (
              <div className="mt-3 md:mt-4">
                <div className="grid grid-cols-2 gap-1.5 md:flex md:flex-wrap md:gap-2.5">
                  {[
                    { key: 'chaukhat' as const, label: 'Chaukhat', show: true },
                    { key: 'accessories' as const, label: 'Accessories', show: cat === 'aluminium-door' },
                    { key: 'ssNet' as const, label: 'SS Net', show: cat !== 'aluminium-door' },
                    { key: 'decorFilm' as const, label: 'Decor Film', show: true },
                    { key: 'brownCoated' as const, label: 'Brown Coated', show: true },
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
                            : 'border-stone-300 bg-stone-100 text-stone-500 hover:border-stone-400 dark:border-white/15 dark:bg-transparent dark:text-stone-400'
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
              Size: <b>{formatSize(h, w) || '—'}</b> · <b>{sqft.toFixed(2)}</b> sqft
            </div>
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
              className="flex items-center gap-1.5 text-red-500"
              disabled={sets.length <= 1}
              onClick={() => {
                if (confirm(`Delete ${activeSet?.name}?`)) {
                  removeSet(setId)
                  setSetId(sets.find((s) => s.id !== setId)?.id ?? sets[0]?.id)
                }
              }}
            >
              <Trash2 size={15} /> Delete set
            </Button>
          </div>
        )}

        {/* Live preview: all-brands rate card OR aluminium breakdown */}
        <div className="flex flex-col rounded-xl border border-stone-200/90 bg-stone-50 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100">
          {alu && (
            <div className="shrink-0 border-b border-stone-100 bg-stone-50 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-stone-500 dark:border-white/10 dark:bg-white/5 dark:text-stone-400 md:px-4 md:py-2 md:text-xs">
              Aluminium Cost
            </div>
          )}
          <div className="overflow-visible">
            {!alu ? (
            <table className="w-full table-fixed text-[11px] leading-tight md:text-sm">
              <thead className="bg-stone-50 text-left text-[10px] uppercase text-stone-400 dark:bg-white/5 dark:text-stone-500 md:text-xs">
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
                      <td className="px-1.5 py-1.5 text-right text-stone-500 dark:text-stone-400 md:px-4 md:py-2">{r.rate}</td>
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
                          className="h-8 w-full min-w-0 rounded border border-slate-200 px-1.5 text-[11px] dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 md:h-auto md:px-2 md:py-1 md:text-sm"
                          value={b.name}
                          onChange={(e) => updateBrand(setId, b.id, { name: e.target.value })}
                        />
                      </td>
                      <td className="px-1 py-1.5 md:px-3">
                        <input
                          type="number"
                          className="h-8 w-full min-w-0 rounded border border-slate-200 px-1 text-right text-[11px] dark:border-white/15 dark:bg-stone-950 dark:text-stone-100 md:h-auto md:w-24 md:px-2 md:py-1 md:text-sm"
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
                          className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                          onClick={() => removeBrand(setId, b.id)}
                          title="Remove brand"
                        >
                          <Minus size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                {!brands.length && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-stone-400 dark:text-stone-500">No brands — {editMode ? 'add one below.' : 'turn on Edit set to add brands.'}</td></tr>
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
              <thead className="bg-stone-50 text-left text-[10px] uppercase text-stone-400 dark:bg-white/5 dark:text-stone-500 md:text-xs">
                <tr>
                  <th className="px-2 py-1.5 md:px-4 md:py-2">Item</th>
                  {aluThicknesses.map((t) => (
                    <th key={t.name} className="break-words px-1.5 py-1.5 text-right md:px-4 md:py-2">{t.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: cat === 'aluminium-door' ? 'Door' : 'Glass', key: 'doorCost' as const },
                  addons.chaukhat ? { label: 'Chaukhat', key: 'chaukhatCost' as const } : null,
                  cat === 'aluminium-door' && addons.accessories
                    ? { label: 'Accessories', key: 'accessories' as const }
                    : null,
                  cat !== 'aluminium-door' && addons.ssNet
                    ? { label: 'SS Net', key: 'accessories' as const }
                    : null,
                ].filter((row): row is { label: string; key: 'doorCost' | 'chaukhatCost' | 'accessories' } => !!row)
                  .map(({ label, key }) => (
                    <tr key={key} className="border-t border-stone-100 dark:border-white/10">
                      <td className="break-words px-2 py-1.5 text-stone-500 dark:text-stone-400 md:px-4 md:py-2">{label}</td>
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
                      <td className="break-words px-2 py-1.5 text-[10px] uppercase text-stone-400 md:px-4 md:py-2 md:text-xs">{label}</td>
                      {aluThicknesses.map((t) => (
                        <td key={t.name} className="px-1.5 py-1.5 text-right text-[10px] text-stone-400 md:px-4 md:py-2 md:text-xs">
                          {hasSize ? formatINR(t[key] ?? 0) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
            )}
          </div>
        </div>
      </div>

      {!alu && (
        <div className="no-print mt-auto border-t border-stone-200/80 bg-stone-50/95 px-2 py-2 shadow-[0_-6px_16px_rgba(0,0,0,0.04)] backdrop-blur dark:border-white/10 dark:bg-stone-950/90 md:px-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Price Set</span>
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
                className="flex items-center gap-1 rounded-lg border border-dashed border-stone-400 px-2.5 py-1 text-xs font-medium text-stone-500 hover:border-shiv-green hover:bg-white dark:border-white/20 dark:text-stone-400 dark:hover:bg-white/10"
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

      {printMode && (
        <PrintPreview
          title="Quotation"
          onClose={() => setPrintMode(null)}
          serverPrint={{ kind: 'quotation', quote: doc }}
        >
          <QuotationPrint quote={doc} />
        </PrintPreview>
      )}
    </div>
  )
}

function activeAddonLabels(cat: ProductCategory, a: AluAddons): string[] {
  const out: string[] = []
  if (a.chaukhat) out.push('Chaukhat')
  if (cat === 'aluminium-door' && a.accessories) out.push('Accessories')
  if (cat !== 'aluminium-door' && a.ssNet) out.push('SS Net')
  if (a.decorFilm) out.push('Decor Film')
  if (a.brownCoated) out.push('Brown Coated')
  return out
}


function DimInput({
  label,
  dim,
  onChange,
  onKeyDown,
  className = '',
}: {
  label: string
  dim: Dimension
  onChange: (d: Dimension) => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  className?: string
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">{label}</label>
      <div className="grid grid-cols-[minmax(0,1fr)_4rem] gap-1.5 md:grid-cols-[minmax(0,1fr)_5rem] md:gap-2">
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
            onChange={(e) => onChange({ ...dim, inches: Number(e.target.value) })}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-400 dark:text-stone-500 md:right-3">in</span>
        </label>
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
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-400 dark:text-stone-500">/8</span>
        </label>
      </div>
    </div>
  )
}

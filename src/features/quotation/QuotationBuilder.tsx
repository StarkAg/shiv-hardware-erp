import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useParams } from 'react-router-dom'
import { Minus, Plus, Printer, Save, Trash2 } from 'lucide-react'
import { useStore } from '../../lib/store'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type Dimension,
  type GuaranteeYears,
  type ProductCategory,
  type Quotation,
} from '../../lib/types'
import { areaSqft, buildBrandRows, formatINR, formatSize, lineAmount } from '../../lib/pricing'
import {
  type AluAddons,
  calcAllThicknesses,
  defaultAddons,
  isAluminium,
} from '../../lib/aluminium'
import { Button, Input, PageHeader, Select, Toggle } from '../../components/ui'
import { PrintPreview } from '../print/PrintPreview'
import { QuotationPrint } from '../print/QuotationPrint'
import { GuaranteeCard } from '../print/GuaranteeCard'

const blankDim = (): Dimension => ({ inches: 0, soot: 0 })
const uid = () => Math.random().toString(36).slice(2, 10)
const GUARANTEE_OPTIONS: GuaranteeYears[] = [0, 1, 3, 5, 7, 10, 15, 20, 25]
const isCategory = (c?: string): c is ProductCategory =>
  !!c && CATEGORY_ORDER.includes(c as ProductCategory)

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
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [printMode, setPrintMode] = useState<null | 'quote' | 'guarantee'>(null)

  const [cat, setCat] = useState<ProductCategory>(
    isCategory(category) ? category : existing?.category ?? 'readymade-door',
  )
  const [h, setH] = useState<Dimension>(existing?.height ?? blankDim())
  const [w, setW] = useState<Dimension>(existing?.width ?? blankDim())
  const [qty, setQty] = useState(existing?.qty ?? 1)
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
  const sqft = alu ? (calcAllThicknesses(cat, h, w, addons)[0]?.doorCost ? areaSqft(h, w) : areaSqft(h, w)) : areaSqft(h, w)
  const aluThicknesses = alu ? calcAllThicknesses(cat, h, w, addons) : []

  const rows = !alu ? buildBrandRows(brands, h, w, qty) : []

  function buildQuote(): Quotation {
    const base = {
      id: quoteId,
      number,
      date: new Date().toISOString(),
      customer: withCustomer ? customer : { id: customer.id, name: '', mobile: '' },
      category: cat,
      height: h,
      width: w,
      qty: qty || 1,
      sqft: areaSqft(h, w),
      notes,
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

  function save() {
    if (withCustomer && customer.name) upsertCustomer(customer)
    saveQuotation(buildQuote())
    alert(`Saved ${number}`)
  }

  const doc = buildQuote()
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
    <div className="flex h-screen flex-col overflow-hidden">
      <PageHeader
        title={`New Quotation — ${CATEGORY_LABELS[cat]}`}
        subtitle={number}
        actions={
          <>
            <Button variant="outline" onClick={save} className="flex items-center gap-1.5" disabled={!hasSize}>
              <Save size={16} /> Save
            </Button>
            <Button onClick={() => setPrintMode('quote')} disabled={!hasSize} className="flex items-center gap-1.5">
              <Printer size={16} /> Print Quotation
            </Button>
          </>
        }
      >
        {!alu && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Price Set</span>
            {sets.map((s) => (
              <button
                key={s.id}
                onClick={() => setSetId(s.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
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
              className="flex items-center gap-1 rounded-lg border border-dashed border-stone-400 px-3 py-1.5 text-sm font-medium text-stone-500 hover:border-shiv-green hover:bg-white dark:border-white/20 dark:text-stone-400 dark:hover:bg-white/10"
            >
              <Plus size={15} /> Add Set
            </button>
            <span className="ml-auto">
              <Toggle checked={editMode} onChange={setEditMode} label="Edit set" />
            </span>
          </div>
        )}
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {/* Optional customer details */}
        <Toggle checked={withCustomer} onChange={setWithCustomer} label="Add customer details (optional)" />

        {withCustomer && (
          <div className="shrink-0 rounded-xl border border-stone-200/90 bg-stone-50 p-3 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">Customer</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <Input label="M/s (Name)" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
              <Input label="Mobile" value={customer.mobile} onChange={(e) => setCustomer({ ...customer, mobile: e.target.value })} />
              <Input label="UID" value={customer.uid} onChange={(e) => setCustomer({ ...customer, uid: e.target.value })} />
              <Input label="Address" value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} />
            </div>
          </div>
        )}

        {/* Size */}
        <div ref={sizeCardRef} className="shrink-0">
          <div className="rounded-xl border border-stone-200/90 bg-stone-50 p-4 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">Size</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
              <DimInput label="Height" dim={h} onChange={setH} onKeyDown={focusNextSizeEntry} className="md:col-span-5" />
              <DimInput label="Width" dim={w} onChange={setW} onKeyDown={focusNextSizeEntry} className="md:col-span-5" />
              <div className="md:col-span-2">
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">Qty</label>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  data-size-entry
                  value={qty}
                  className="h-11 w-full rounded-lg border-2 border-stone-300 bg-stone-50 px-3 text-lg font-semibold text-stone-950 outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={focusNextSizeEntry}
                  onChange={(e) => setQty(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Aluminium options */}
            {alu && (
              <div className="mt-4">
                <div className="flex flex-wrap gap-2.5">
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
                        className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                          addons[o.key]
                            ? 'border-shiv-green bg-shiv-green/10 text-stone-800 dark:text-stone-100'
                            : 'border-stone-300 bg-stone-100 text-stone-500 hover:border-stone-400 dark:border-white/15 dark:bg-transparent dark:text-stone-400'
                        }`}
                      >
                        {addons[o.key] ? '✓ ' : ''}{o.label}
                      </button>
                    ))}
                </div>
              </div>
            )}

            <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-stone-300">
              Size: <b>{formatSize(h, w) || '—'}</b> · <b>{sqft.toFixed(2)}</b> sqft · Qty <b>{qty}</b>
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
        <div className="shrink-0 overflow-hidden rounded-xl border border-stone-200/90 bg-stone-50 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100">
          <div className="border-b border-stone-100 bg-stone-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-stone-500 dark:border-white/10 dark:bg-white/5 dark:text-stone-400">
            {alu ? 'Aluminium Cost' : `All Brands — cost for this size${editMode ? ' (editing ' + (activeSet?.name ?? '') + ')' : ''}`}
          </div>
          <div>
            {!alu ? (
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase text-stone-400 dark:bg-white/5 dark:text-stone-500">
                <tr>
                  <th className="px-4 py-2.5">Brand</th>
                  <th className="px-4 py-2.5 text-right">Rate (₹/sqft)</th>
                  <th className="px-4 py-2.5 text-right">Cost</th>
                  <th className="px-4 py-2.5 text-center">Guarantee</th>
                  {editMode && <th className="px-4 py-2.5 w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {!editMode &&
                  rows.map((r, i) => (
                    <tr key={i} className="border-t border-stone-100 dark:border-white/10">
                      <td className="px-4 py-2.5 font-medium">{r.brandName}</td>
                      <td className="px-4 py-2.5 text-right text-stone-500 dark:text-stone-400">{r.rate}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{hasSize ? formatINR(r.cost) : '—'}</td>
                      <td className="px-4 py-2.5 text-center">
                        {r.guaranteeYears
                          ? <span className="text-shiv-red font-medium">{r.guaranteeYears} Years</span>
                          : <span className="text-stone-300 dark:text-stone-600">—</span>}
                      </td>
                    </tr>
                  ))}
                {editMode &&
                  brands.map((b) => (
                    <tr key={b.id} className="border-t border-stone-100 dark:border-white/10">
                      <td className="px-3 py-1.5">
                        <input
                          className="w-full rounded border border-slate-200 px-2 py-1 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
                          value={b.name}
                          onChange={(e) => updateBrand(setId, b.id, { name: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          className="w-24 rounded border border-slate-200 px-2 py-1 text-right dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
                          value={b.rate}
                          onChange={(e) => updateBrand(setId, b.id, { rate: Number(e.target.value) })}
                        />
                      </td>
                      <td className="px-4 py-1.5 text-right font-semibold">
                        {hasSize ? formatINR(lineAmount(b.rate, h, w, qty)) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <Select
                          value={b.guaranteeYears}
                          onChange={(e) =>
                            updateBrand(setId, b.id, { guaranteeYears: Number(e.target.value) as GuaranteeYears })
                          }
                        >
                          {GUARANTEE_OPTIONS.map((g) => (
                            <option key={g} value={g}>{g === 0 ? 'None' : `${g}y`}</option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3 py-1.5 text-right">
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
                  <tr><td colSpan={editMode ? 5 : 4} className="px-4 py-6 text-center text-stone-400 dark:text-stone-500">No brands — {editMode ? 'add one below.' : 'turn on Edit set to add brands.'}</td></tr>
                )}
              </tbody>
              {editMode && (
                <tfoot>
                  <tr className="border-t border-stone-100 dark:border-white/10">
                    <td colSpan={5} className="px-4 py-2">
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
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase text-stone-400 dark:bg-white/5 dark:text-stone-500">
                <tr>
                  <th className="px-3 py-2.5 text-left">Item</th>
                  {aluThicknesses.map((t) => (
                    <th key={t.name} className="px-3 py-2.5 text-right">{t.name}</th>
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
                      <td className="px-3 py-2 text-stone-500 dark:text-stone-400">{label}</td>
                      {aluThicknesses.map((t) => (
                        <td key={t.name} className="px-3 py-2 text-right">{hasSize ? formatINR(t[key]) : '—'}</td>
                      ))}
                    </tr>
                  ))}
                <tr className="border-t-2 border-stone-200 bg-stone-50 dark:border-white/20 dark:bg-white/5">
                  <td className="px-3 py-2.5 font-bold">Total</td>
                  {aluThicknesses.map((t) => (
                    <td key={t.name} className="px-3 py-2.5 text-right font-bold text-shiv-green">
                      {hasSize ? formatINR(t.total) : '—'}
                    </td>
                  ))}
                </tr>
                {(addons.decorFilm || addons.brownCoated) && (
                  <tr className="border-t border-stone-100 dark:border-white/10">
                    <td className="px-3 py-2 text-stone-400 text-xs uppercase">Add-ons</td>
                    {aluThicknesses.map((t) => (
                      <td key={t.name} className="px-3 py-2 text-right text-xs text-stone-400">
                        {hasSize ? formatINR((t.decorFilm ?? 0) + (t.brownCoated ?? 0)) : '—'}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
            )}
          </div>
        </div>

        <div className="shrink-0 rounded-xl border border-stone-200/90 bg-stone-50 p-3 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100">
          <label className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">Notes (printed on quotation)</label>
          <textarea
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
            rows={1}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {printMode && (
        <PrintPreview title={printMode === 'quote' ? 'Quotation' : 'Guarantee Card'} onClose={() => setPrintMode(null)}>
          {printMode === 'quote' ? <QuotationPrint quote={doc} /> : <GuaranteeCard quote={doc} />}
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
      <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
        <label className="relative block">
          <input
            type="number"
            min={0}
            inputMode="numeric"
            data-size-entry
            className="h-11 w-full rounded-lg border-2 border-stone-300 bg-stone-50 px-3 pr-9 text-lg font-semibold text-stone-950 outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
            placeholder="0"
            value={dim.inches || ''}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={onKeyDown}
            onChange={(e) => onChange({ ...dim, inches: Number(e.target.value) })}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold text-stone-400 dark:text-stone-500">in</span>
        </label>
        <label className="relative block">
          <input
            type="number"
            min={0}
            max={7}
            inputMode="numeric"
            data-size-entry
            className="h-11 w-full rounded-lg border-2 border-stone-300 bg-stone-50 px-3 pr-7 text-lg font-semibold text-stone-950 outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
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

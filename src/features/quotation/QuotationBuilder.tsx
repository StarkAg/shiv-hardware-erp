import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useParams } from 'react-router-dom'
import { Moon, Minus, Plus, Printer, Save, Sun, Trash2 } from 'lucide-react'
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
  ALU_THICKNESSES,
  type AluAddons,
  type AluThickness,
  calcAluminium,
  defaultAddons,
  isAluminium,
} from '../../lib/aluminium'
import { Button, Card, Input, PageHeader, Toggle } from '../../components/ui'
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
  // aluminium-only
  const [thickness, setThickness] = useState<AluThickness>('1.2 MM')
  const [addons, setAddons] = useState<AluAddons>(defaultAddons())
  // selected price set
  const [setId, setSetId] = useState(sets[0]?.id)
  const activeSet = sets.find((s) => s.id === setId) ?? sets[0]
  const [editMode, setEditMode] = useState(false)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('shiv-panel:theme') === 'dark')
  const sizeCardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    localStorage.setItem('shiv-panel:theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

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
  const sqft = alu ? calcAluminium(cat, thickness, h, w, addons).area : areaSqft(h, w)

  const rows = !alu ? buildBrandRows(brands, h, w, qty) : []
  const aluResult = alu ? calcAluminium(cat, thickness, h, w, addons) : null

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
      sqft,
      notes,
    }
    if (alu && aluResult) {
      return {
        ...base,
        alu: {
          thickness,
          addons: activeAddonLabels(cat, addons),
          breakdown: aluResult.breakdown,
          total: aluResult.total * (qty || 1),
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
            <button
              type="button"
              onClick={() => setDarkMode((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white/70 px-3 py-2 text-sm font-medium text-stone-700 transition hover:border-shiv-green hover:bg-stone-50 dark:border-white/15 dark:bg-white/5 dark:text-stone-100 dark:hover:bg-white/10"
              title={darkMode ? 'Use light mode' : 'Use dark mode'}
            >
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
              {darkMode ? 'Light' : 'Dark'}
            </button>
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
                    : 'border-stone-300 bg-white/80 text-stone-600 hover:border-shiv-green hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-stone-300 dark:hover:bg-white/10'
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
          <Card className="shrink-0 p-3">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">Customer</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <Input label="M/s (Name)" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
              <Input label="Mobile" value={customer.mobile} onChange={(e) => setCustomer({ ...customer, mobile: e.target.value })} />
              <Input label="UID" value={customer.uid} onChange={(e) => setCustomer({ ...customer, uid: e.target.value })} />
              <Input label="Address" value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} />
            </div>
          </Card>
        )}

        {/* Size */}
        <div ref={sizeCardRef} className="shrink-0">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">Size</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
              {alu && (
                <div className="md:col-span-3">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">Thickness</label>
                  <select
                    className="h-11 w-full rounded-lg border-2 border-stone-300 bg-white px-3 text-base font-semibold text-stone-950 outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
                    value={thickness}
                    data-size-entry
                    onKeyDown={focusNextSizeEntry}
                    onChange={(e) => setThickness(e.target.value as AluThickness)}
                  >
                    {ALU_THICKNESSES.map((t) => (<option key={t} value={t}>{t}</option>))}
                  </select>
                </div>
              )}
              <DimInput label="Height" dim={h} onChange={setH} onKeyDown={focusNextSizeEntry} className={alu ? 'md:col-span-3' : 'md:col-span-5'} />
              <DimInput label="Width" dim={w} onChange={setW} onKeyDown={focusNextSizeEntry} className={alu ? 'md:col-span-3' : 'md:col-span-5'} />
              <div className={alu ? 'md:col-span-3' : 'md:col-span-2'}>
                <Input
                  label="Qty"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  data-size-entry
                  value={qty}
                  className="h-11 border-2 text-lg font-semibold text-stone-950 focus:ring-2 focus:ring-shiv-green/20"
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={focusNextSizeEntry}
                  onChange={(e) => setQty(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Aluminium options */}
            {alu && (
              <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm dark:border-white/10 dark:bg-white/5">
                {cat !== 'aluminium-door' && (
                  <label className="flex items-center gap-1">
                    Glass:
                    <select
                      className="rounded border border-stone-300 px-2 py-1 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
                      value={addons.glassType}
                      onChange={(e) => setAddons((a) => ({ ...a, glassType: e.target.value as 'clear' | 'reflective' }))}
                    >
                      <option value="clear">Clear</option>
                      <option value="reflective">Reflective</option>
                    </select>
                  </label>
                )}
                <Chk label="Chaukhat" on={addons.chaukhat} onClick={() => toggle('chaukhat')} />
                {cat === 'aluminium-door' && <Chk label="Accessories" on={addons.accessories} onClick={() => toggle('accessories')} />}
                {cat !== 'aluminium-door' && <Chk label="SS Net" on={addons.ssNet} onClick={() => toggle('ssNet')} />}
                <Chk label="Decor Film" on={addons.decorFilm} onClick={() => toggle('decorFilm')} />
                <Chk label="Brown Coated" on={addons.brownCoated} onClick={() => toggle('brownCoated')} />
              </div>
            )}

            <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-sm text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-stone-300">
              Size: <b>{formatSize(h, w) || '—'}</b> · <b>{sqft.toFixed(2)}</b> sqft · Qty <b>{qty}</b>
            </div>
          </Card>
        </div>

        {/* Edit-set toolbar (rename / delete the active set) */}
        {!alu && editMode && (
          <Card className="flex shrink-0 items-center justify-between p-3">
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
          </Card>
        )}

        {/* Live preview: all-brands rate card OR aluminium breakdown */}
        <div className="shrink-0 overflow-hidden rounded-xl border border-stone-200/90 bg-white text-stone-800 shadow-sm shadow-stone-900/5">
          <div className="border-b border-stone-100 bg-stone-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-stone-500">
            {alu ? 'Aluminium Cost' : `All Brands — cost for this size${editMode ? ' (editing ' + (activeSet?.name ?? '') + ')' : ''}`}
          </div>
          <div>
            {!alu ? (
            <table className="w-full text-sm">
              <thead className="bg-white text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="px-4 py-2">Brand</th>
                  <th className="px-4 py-2 text-right">Rate (₹/sqft)</th>
                  <th className="px-4 py-2 text-right">Cost</th>
                  <th className="px-4 py-2 text-center">Guarantee</th>
                  {editMode && <th className="px-4 py-2 w-10"></th>}
                </tr>
              </thead>
              <tbody>
                {!editMode &&
                  rows.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-medium">{r.brandName}</td>
                      <td className="px-4 py-2 text-right">{r.rate}</td>
                      <td className="px-4 py-2 text-right font-semibold">{hasSize ? formatINR(r.cost) : '—'}</td>
                      <td className="px-4 py-2 text-center text-shiv-red">
                        {r.guaranteeYears ? `${r.guaranteeYears} Years` : '—'}
                      </td>
                    </tr>
                  ))}
                {editMode &&
                  brands.map((b) => (
                    <tr key={b.id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">
                        <input
                          className="w-full rounded border border-slate-200 px-2 py-1"
                          value={b.name}
                          onChange={(e) => updateBrand(setId, b.id, { name: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          className="w-24 rounded border border-slate-200 px-2 py-1 text-right"
                          value={b.rate}
                          onChange={(e) => updateBrand(setId, b.id, { rate: Number(e.target.value) })}
                        />
                      </td>
                      <td className="px-4 py-1.5 text-right font-semibold">
                        {hasSize ? formatINR(lineAmount(b.rate, h, w, qty)) : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <select
                          className="rounded border border-slate-200 px-2 py-1"
                          value={b.guaranteeYears}
                          onChange={(e) =>
                            updateBrand(setId, b.id, { guaranteeYears: Number(e.target.value) as GuaranteeYears })
                          }
                        >
                          {GUARANTEE_OPTIONS.map((g) => (
                            <option key={g} value={g}>{g === 0 ? 'None' : `${g}y`}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          className="rounded p-1 text-red-500 hover:bg-red-50"
                          onClick={() => removeBrand(setId, b.id)}
                          title="Remove brand"
                        >
                          <Minus size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                {!brands.length && (
                  <tr><td colSpan={editMode ? 5 : 4} className="px-4 py-6 text-center text-slate-400">No brands — {editMode ? 'add one below.' : 'turn on Edit set to add brands.'}</td></tr>
                )}
              </tbody>
              {editMode && (
                <tfoot>
                  <tr className="border-t border-slate-100">
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
            <table className="w-full text-sm">
              <tbody>
                {(aluResult?.breakdown ?? []).map((b, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-4 py-2">{b.label}</td>
                    <td className="px-4 py-2 text-right font-semibold">{formatINR(b.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td className="px-4 py-2 text-right font-bold">Total{qty > 1 ? ` × ${qty}` : ''}</td>
                  <td className="px-4 py-2 text-right text-lg font-bold text-shiv-green">
                    {formatINR((aluResult?.total ?? 0) * (qty || 1))}
                  </td>
                </tr>
              </tbody>
            </table>
            )}
          </div>
        </div>

        <Card className="shrink-0 p-3">
          <label className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">Notes (printed on quotation)</label>
          <textarea
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
            rows={1}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Card>
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
  if (cat !== 'aluminium-door') out.push(a.glassType === 'clear' ? 'Clear glass' : 'Reflective glass')
  if (a.chaukhat) out.push('Chaukhat')
  if (cat === 'aluminium-door' && a.accessories) out.push('Accessories')
  if (cat !== 'aluminium-door' && a.ssNet) out.push('SS Net')
  if (a.decorFilm) out.push('Decor Film')
  if (a.brownCoated) out.push('Brown Coated')
  return out
}

function Chk({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 select-none">
      <input type="checkbox" checked={on} onChange={onClick} className="accent-shiv-green" />
      {label}
    </label>
  )
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
            className="h-11 w-full rounded-lg border-2 border-stone-300 px-3 pr-9 text-lg font-semibold text-stone-950 outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
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
            className="h-11 w-full rounded-lg border-2 border-stone-300 px-3 pr-7 text-lg font-semibold text-stone-950 outline-none focus:border-shiv-green focus:ring-2 focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950 dark:text-stone-100"
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

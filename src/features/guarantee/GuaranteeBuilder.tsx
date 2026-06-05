import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Printer, ScanLine, Trash2 } from 'lucide-react'
import { Button, Card, Input, Select } from '../../components/ui'
import { useStore } from '../../lib/store'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type Dimension,
  type GuaranteeDocument,
  type GuaranteeYears,
  type ProductCategory,
} from '../../lib/types'
import { formatSize } from '../../lib/pricing'
import { PrintPreview } from '../print/PrintPreview'
import { GuaranteeCard } from '../print/GuaranteeCard'

type GuaranteeLayout = 'card' | 'a4'
type BilledItem = {
  id: string
  category: ProductCategory
  brandName: string
  guaranteeYears: GuaranteeYears
  height: Dimension
  width: Dimension
  qty: number
}

const blankDim = (): Dimension => ({ inches: 0, soot: 0 })
const uid = () => Math.random().toString(36).slice(2, 10)
const GUARANTEE_YEAR_OPTIONS: GuaranteeYears[] = [1, 3, 5, 7, 8, 10, 15, 20, 21, 25, 30]
const GUARANTEE_CATEGORIES = CATEGORY_ORDER.filter((c) => !['aluminium-door', 'window-2-track', 'window-3-track'].includes(c))

export function GuaranteeBuilder({ layout }: { layout: GuaranteeLayout }) {
  const { sets } = useStore()
  const [number] = useState(() => `GC-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`)
  const [category, setCategory] = useState<ProductCategory>('readymade-door')
  const [brandName, setBrandName] = useState('')
  const [years, setYears] = useState<GuaranteeYears>(10)
  const [customer, setCustomer] = useState({ id: uid(), name: '', mobile: '', uid: '', address: '' })
  const [h, setH] = useState<Dimension>(blankDim)
  const [w, setW] = useState<Dimension>(blankDim)
  const [qty, setQty] = useState(1)
  const [billedItems, setBilledItems] = useState<BilledItem[]>([])
  const [preview, setPreview] = useState(false)
  const sizeCardRef = useRef<HTMLDivElement>(null)

  const brandOptions = (sets[0]?.brands ?? []).filter((b) => b.category === category)
  const hasSize = h.inches > 0 || h.soot > 0 || w.inches > 0 || w.soot > 0
  const selectedBrand = brandOptions.find((b) => b.name === brandName)
  const displayBrand = brandName.trim() || selectedBrand?.name || CATEGORY_LABELS[category]
  const previewTitle = layout === 'card' ? 'Guarantee Card' : 'Guarantee A4 Sheet'

  useEffect(() => {
    setBrandName('')
  }, [category])

  function focusNextSizeEntry(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const entries = Array.from(sizeCardRef.current?.querySelectorAll<HTMLInputElement>('[data-size-entry]') ?? [])
    const next = entries[entries.indexOf(e.currentTarget) + 1]
    next?.focus()
    next?.select()
  }

  function chooseBrand(name: string) {
    setBrandName(name)
    const brand = brandOptions.find((b) => b.name === name)
    if (brand?.guaranteeYears) setYears(brand.guaranteeYears)
  }

  function addBilledItem() {
    if (!hasSize) return
    setBilledItems((items) => [
      ...items,
      {
        id: uid(),
        category,
        brandName: displayBrand,
        guaranteeYears: years,
        height: { ...h },
        width: { ...w },
        qty: qty || 1,
      },
    ])
  }

  function removeBilledItem(id: string) {
    setBilledItems((items) => items.filter((item) => item.id !== id))
  }

  function buildGuaranteeDoc(): GuaranteeDocument {
    const primaryItem = billedItems[0]
    const printItems = billedItems.length
      ? billedItems.map((item) => ({
          brandName: item.brandName,
          guaranteeYears: item.guaranteeYears,
          sizeLabel: `${CATEGORY_LABELS[item.category]} - ${formatSize(item.height, item.width) || '-'} - Qty ${item.qty}`,
        }))
      : [
          {
            brandName: displayBrand,
            guaranteeYears: years,
          },
        ]

    return {
      id: number,
      number,
      date: new Date().toISOString(),
      customer,
      category: primaryItem?.category ?? category,
      height: primaryItem?.height ?? h,
      width: primaryItem?.width ?? w,
      qty: primaryItem?.qty ?? (qty || 1),
      items: printItems,
    }
  }

  const doc = buildGuaranteeDoc()

  return (
    <div className="mobile-panel-screen flex flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 md:p-4">
        <div className="no-print flex justify-center gap-3">
          <Button onClick={() => setPreview(true)} disabled={!hasSize && !billedItems.length} className="flex min-w-32 items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold">
            <Printer size={20} /> Print
          </Button>
          <Link
            to="/scan"
            className="flex min-w-32 items-center justify-center gap-2 rounded-xl border border-stone-300 bg-stone-50 px-5 py-3 text-base font-semibold text-stone-700 shadow-sm transition hover:border-shiv-green hover:bg-stone-100 dark:border-white/15 dark:bg-white/5 dark:text-stone-100 dark:hover:bg-white/10"
          >
            <ScanLine size={20} /> Scan Bill
          </Link>
        </div>

        <Card className="shrink-0 p-4 text-stone-800 dark:text-stone-100">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">Customer</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-stone-500 dark:text-stone-400">UID</span>
              <input
                type="text"
                inputMode="text"
                maxLength={12}
                value={customer.uid}
                onChange={(e) => {
                  const value = e.target.value.toUpperCase().slice(0, 12)
                  setCustomer({ ...customer, uid: value })
                }}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 transition ${
                  customer.uid.length === 12
                    ? 'border-green-500 bg-green-50 focus:border-green-600 focus:ring-green-600/20 dark:border-green-600 dark:bg-green-950/30'
                    : 'border-stone-300 bg-stone-50 focus:border-shiv-green focus:ring-shiv-green/20 dark:border-white/15 dark:bg-stone-950'
                } dark:text-stone-100`}
              />
            </label>
          </div>
        </Card>

        <Card className="shrink-0 p-4 text-stone-800 dark:text-stone-100">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">Guarantee</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Select label="Product" value={category} onChange={(e) => setCategory(e.target.value as ProductCategory)}>
              {GUARANTEE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </Select>
            <Select label="Brand / Item" value={brandName} onChange={(e) => chooseBrand(e.target.value)}>
              <option value="">{CATEGORY_LABELS[category]}</option>
              {brandOptions.map((b) => (
                <option key={b.id} value={b.name}>{b.name}</option>
              ))}
            </Select>
            <Select label="Years" value={years} onChange={(e) => setYears(Number(e.target.value) as GuaranteeYears)}>
              {GUARANTEE_YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>{y} Years</option>
              ))}
            </Select>
          </div>
        </Card>

        <div
          ref={sizeCardRef}
          className="shrink-0 rounded-xl border border-stone-200/90 bg-stone-50 p-4 text-stone-800 shadow-sm shadow-stone-900/5 dark:border-white/10 dark:bg-stone-900/90 dark:text-stone-100"
        >
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
          <div className="mt-3 flex justify-end">
            <Button onClick={addBilledItem} disabled={!hasSize} className="flex items-center justify-center gap-1.5">
              <Plus size={16} /> Add Item
            </Button>
          </div>
        </div>

        <Card className="min-h-0 shrink-0 overflow-hidden text-stone-800 dark:text-stone-100">
          <div className="border-b border-stone-100 px-4 py-2 text-sm font-bold uppercase tracking-wide text-stone-500 dark:border-white/10 dark:text-stone-400">
            Billed Items
          </div>
          {billedItems.length ? (
            <div className="max-h-56 overflow-auto">
              {billedItems.map((item) => (
                <div key={item.id} className="flex items-center gap-3 border-b border-stone-100 px-4 py-3 last:border-b-0 dark:border-white/10">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-stone-900 dark:text-stone-100">
                      {CATEGORY_LABELS[item.category]} - {item.brandName}
                    </div>
                    <div className="mt-0.5 text-xs font-medium text-stone-500 dark:text-stone-400">
                      {formatSize(item.height, item.width) || '-'} - Qty {item.qty} - {item.guaranteeYears} Years
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeBilledItem(item.id)}
                    className="rounded-lg p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                    aria-label="Remove billed item"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-5 text-center text-sm font-medium text-stone-400 dark:text-stone-500">
              No billed items added.
            </div>
          )}
        </Card>
      </div>

      {preview && (
        <PrintPreview
          title={previewTitle}
          onClose={() => setPreview(false)}
          serverPrint={{ kind: 'guarantee', document: doc, layout }}
        >
          <GuaranteeCard document={doc} layout={layout} />
        </PrintPreview>
      )}
    </div>
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

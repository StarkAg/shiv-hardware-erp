import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Printer } from 'lucide-react'
import { Button, Card, Input, PageHeader, Select } from '../../components/ui'
import { useStore } from '../../lib/store'
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type Dimension,
  type GuaranteeYears,
  type ProductCategory,
  type Quotation,
} from '../../lib/types'
import { areaSqft, formatSize } from '../../lib/pricing'
import { PrintPreview } from '../print/PrintPreview'
import { GuaranteeCard } from '../print/GuaranteeCard'

type GuaranteeLayout = 'card' | 'a4'

const blankDim = (): Dimension => ({ inches: 0, soot: 0 })
const uid = () => Math.random().toString(36).slice(2, 10)
const GUARANTEE_YEAR_OPTIONS: GuaranteeYears[] = [1, 3, 5, 7, 10, 15, 20, 25]

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
  const [preview, setPreview] = useState(false)
  const sizeCardRef = useRef<HTMLDivElement>(null)

  const brandOptions = (sets[0]?.brands ?? []).filter((b) => b.category === category)
  const hasSize = h.inches > 0 || h.soot > 0 || w.inches > 0 || w.soot > 0
  const selectedBrand = brandOptions.find((b) => b.name === brandName)
  const displayBrand = brandName.trim() || selectedBrand?.name || CATEGORY_LABELS[category]
  const title = layout === 'card' ? 'Guarantee Card - Card' : 'Guarantee Card - A4 Sheet'

  useEffect(() => {
    setBrandName('')
  }, [category])

  function buildGuaranteeDoc(): Quotation {
    return {
      id: number,
      number,
      date: new Date().toISOString(),
      customer,
      category,
      height: h,
      width: w,
      qty: qty || 1,
      sqft: areaSqft(h, w),
      rows: [
        {
          brandName: displayBrand,
          rate: selectedBrand?.rate ?? 0,
          guaranteeYears: years,
          cost: 0,
        },
      ],
      notes: '',
    }
  }

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

  const doc = buildGuaranteeDoc()

  return (
    <div className="flex h-[calc(100dvh-57px)] flex-col overflow-hidden md:h-screen">
      <PageHeader
        title={title}
        subtitle={number}
        actions={
          <Button onClick={() => setPreview(true)} disabled={!hasSize} className="flex items-center gap-1.5">
            <Printer size={16} /> Print
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 md:p-4">
        <Card className="shrink-0 p-4 text-stone-800 dark:text-stone-100">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">Customer</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Input label="M/s (Name)" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            <Input label="Mobile" value={customer.mobile} onChange={(e) => setCustomer({ ...customer, mobile: e.target.value })} />
            <Input label="UID" value={customer.uid} onChange={(e) => setCustomer({ ...customer, uid: e.target.value })} />
          </div>
        </Card>

        <Card className="shrink-0 p-4 text-stone-800 dark:text-stone-100">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">Guarantee</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Select label="Product" value={category} onChange={(e) => setCategory(e.target.value as ProductCategory)}>
              {CATEGORY_ORDER.map((c) => (
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
          <div className="mt-3 rounded-lg border border-stone-200 bg-stone-100 px-3 py-2 text-sm font-medium text-stone-600 dark:border-white/10 dark:bg-white/5 dark:text-stone-300">
            Size: <span className="font-bold">{formatSize(h, w) || '-'}</span> - Qty <span className="font-bold">{qty || 1}</span>
          </div>
        </div>
      </div>

      {preview && (
        <PrintPreview title={title} onClose={() => setPreview(false)}>
          <GuaranteeCard quote={doc} layout={layout} />
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

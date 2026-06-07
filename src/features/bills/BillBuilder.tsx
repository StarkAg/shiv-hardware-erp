import { useState, useRef, useLayoutEffect, useMemo, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  IndianRupee,
  Plus,
  ReceiptText,
  Trash2,
  X,
} from 'lucide-react'
import { useStore } from '../../lib/store'
import type { Bill, BillItem, BillPaymentMode, ProductCategory } from '../../lib/types'
import { CATEGORY_META } from '../../lib/types'
import { BillPrint } from './BillPrint'

const uid = () => Math.random().toString(36).slice(2, 10)
const today = () => new Date().toISOString().slice(0, 10)

const UNITS = ['Pc', 'kg', 'M', 'Rft', 'Set', 'L', 'Bl', 'Box', 'Pkt', 'Pair']

// --- Smart catalog item helpers -------------------------------------------

interface ProductOption { category: ProductCategory; label: string; keywords: string[] }
const PRODUCT_OPTIONS: ProductOption[] = [
  { category: 'block-board-19', label: '19mm Block Board', keywords: ['19', 'block', 'board', 'bb19'] },
  { category: 'block-board-12', label: '12mm Block Board', keywords: ['12', 'block', 'board', 'bb12'] },
  { category: 'plywood-6',      label: '6mm Plywood',      keywords: ['6', 'ply', 'plywood'] },
  { category: 'flush-door',     label: 'Flush Door',        keywords: ['flush', 'door', 'plain'] },
  { category: 'readymade-door', label: 'Readymade Door',    keywords: ['ready', 'made', 'readymade', 'door'] },
  { category: 'aluminium-door', label: 'Aluminium Door',    keywords: ['alu', 'aluminium', 'door'] },
  { category: 'window-2-track', label: '2 Track Window',    keywords: ['window', '2', '2track', 'sliding'] },
  { category: 'window-3-track', label: '3 Track Window',    keywords: ['window', '3', '3track', 'sliding'] },
]

const BOARD_CATS: ProductCategory[] = ['block-board-19', 'block-board-12', 'plywood-6']
const HEIGHT_OPTIONS = [78, 81, 84, 90, 96, 72, 74, 76, 42, 48, 36]
const WIDTH_OPTIONS  = [36, 38, 40, 42, 48, 30, 33, 44]

function calcCost(rateSqft: number, heightIn: number, widthIn: number, qty: number) {
  if (!rateSqft || !heightIn || !widthIn) return 0
  return Math.round(rateSqft * (heightIn * widthIn / 144) * qty)
}

function buildDescription(category: ProductCategory | undefined, brandName: string, heightIn: number, widthIn: number, qty: number) {
  const label = category ? (PRODUCT_OPTIONS.find(p => p.category === category)?.label ?? CATEGORY_META[category]?.short ?? '') : ''
  const size = heightIn && widthIn ? `${heightIn}×${widthIn}` : ''
  return [label, brandName, size, qty > 1 ? `${qty}Pc` : ''].filter(Boolean).join(' ')
}

// --- Smart item row -------------------------------------------------------
interface SmartItemRowProps {
  item: BillItem
  idx: number
  onUpdate: (id: string, patch: Partial<BillItem>) => void
  onRemove: (id: string) => void
  disabled?: boolean
}

function SmartItemRow({ item, idx, onUpdate, onRemove, disabled }: SmartItemRowProps) {
  const { sets } = useStore()
  const activeSet = sets[0]

  // product type search state
  const [search, setSearch] = useState(() =>
    item.category ? (PRODUCT_OPTIONS.find(p => p.category === item.category)?.label ?? '') : ''
  )
  const [showDrop, setShowDrop] = useState(false)

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return PRODUCT_OPTIONS
    return PRODUCT_OPTIONS.filter(p =>
      p.label.toLowerCase().includes(q) || p.keywords.some(k => k.startsWith(q))
    )
  }, [search])

  const brandsForCat = useMemo(() => {
    if (!item.category || !activeSet) return []
    return activeSet.brands.filter(b => b.category === item.category)
  }, [item.category, activeSet])

  // Sync description whenever catalog fields change
  useEffect(() => {
    if (!item.category) return
    const desc = buildDescription(item.category, item.brandName ?? '', item.heightIn ?? 0, item.widthIn ?? 0, item.qty)
    const cost = calcCost(item.rateSqft ?? 0, item.heightIn ?? 0, item.widthIn ?? 0, item.qty)
    if (desc !== item.description || cost !== item.amount) {
      onUpdate(item.id, { description: desc, amount: cost })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.category, item.brandName, item.heightIn, item.widthIn, item.qty, item.rateSqft])

  function selectCategory(opt: ProductOption) {
    const brands = activeSet?.brands.filter(b => b.category === opt.category) ?? []
    const firstBrand = brands[0]
    const isBoard = BOARD_CATS.includes(opt.category)
    const h = isBoard ? 84 : 78
    const w = isBoard ? 48 : 36
    const rate = firstBrand?.rate ?? 0
    const cost = calcCost(rate, h, w, item.qty)
    const desc = buildDescription(opt.category, firstBrand?.name ?? '', h, w, item.qty)
    setSearch(opt.label)
    setShowDrop(false)
    onUpdate(item.id, {
      category: opt.category,
      brandName: firstBrand?.name ?? '',
      heightIn: h,
      widthIn: w,
      rateSqft: rate,
      amount: cost,
      description: desc,
      unit: 'Pc',
    })
  }

  function handleBrandChange(brandName: string) {
    const brand = brandsForCat.find(b => b.name === brandName)
    const rate = brand?.rate ?? item.rateSqft ?? 0
    const cost = calcCost(rate, item.heightIn ?? 0, item.widthIn ?? 0, item.qty)
    const desc = buildDescription(item.category, brandName, item.heightIn ?? 0, item.widthIn ?? 0, item.qty)
    onUpdate(item.id, { brandName, rateSqft: rate, amount: cost, description: desc })
  }

  function handleDim(field: 'heightIn' | 'widthIn', val: number) {
    const h = field === 'heightIn' ? val : (item.heightIn ?? 0)
    const w = field === 'widthIn' ? val : (item.widthIn ?? 0)
    const cost = calcCost(item.rateSqft ?? 0, h, w, item.qty)
    const desc = buildDescription(item.category, item.brandName ?? '', h, w, item.qty)
    onUpdate(item.id, { [field]: val, amount: cost, description: desc })
  }

  function handleQty(qty: number) {
    const cost = calcCost(item.rateSqft ?? 0, item.heightIn ?? 0, item.widthIn ?? 0, qty)
    const desc = buildDescription(item.category, item.brandName ?? '', item.heightIn ?? 0, item.widthIn ?? 0, qty)
    onUpdate(item.id, { qty, amount: cost, description: desc })
  }

  function handleRate(rate: number) {
    const cost = calcCost(rate, item.heightIn ?? 0, item.widthIn ?? 0, item.qty)
    onUpdate(item.id, { rateSqft: rate, amount: cost })
  }

  function clearCategory() {
    setSearch('')
    onUpdate(item.id, {
      category: undefined,
      brandName: undefined,
      heightIn: undefined,
      widthIn: undefined,
      rateSqft: undefined,
    })
  }

  const isCatalog = !!item.category

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3 dark:border-white/10 dark:bg-stone-900">
      <div className="flex items-start gap-2">
        <span className="mt-2 w-5 shrink-0 text-center text-xs font-bold text-stone-400">{idx + 1}</span>
        <div className="flex-1 min-w-0 space-y-2">

          {/* Row 1: product type + brand */}
          <div className="flex gap-2">
            {/* Product type search */}
            <div className="relative flex-1 min-w-0">
              <input
                type="text"
                placeholder="19, 12, 6, flush, door…"
                value={isCatalog ? search : item.description}
                onFocus={() => !isCatalog && setShowDrop(true)}
                onChange={(e) => {
                  const v = e.target.value
                  if (isCatalog) {
                    // clear catalog if they start typing again
                    setSearch(v)
                    if (v !== search) clearCategory()
                    setShowDrop(true)
                  } else {
                    onUpdate(item.id, { description: v })
                    setSearch(v)
                    setShowDrop(true)
                  }
                }}
                onBlur={() => setTimeout(() => setShowDrop(false), 150)}
                className="w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
              />
              {isCatalog && (
                <button
                  onClick={clearCategory}
                  className="absolute right-1.5 top-1.5 rounded p-0.5 text-stone-400 hover:text-red-500"
                >
                  <X size={13} />
                </button>
              )}
              {showDrop && filtered.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-20 mt-0.5 rounded-lg border border-stone-200 bg-white shadow-lg dark:border-white/10 dark:bg-stone-800">
                  {filtered.map(opt => (
                    <button
                      key={opt.category}
                      onMouseDown={() => selectCategory(opt)}
                      className="flex w-full items-center px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-white/10"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Brand dropdown — only for catalog items */}
            {isCatalog && brandsForCat.length > 0 && (
              <select
                value={item.brandName ?? ''}
                onChange={(e) => handleBrandChange(e.target.value)}
                className="w-28 shrink-0 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
              >
                {brandsForCat.map(b => (
                  <option key={b.id} value={b.name}>{b.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Row 2: size + qty + rate + cost (catalog only) */}
          {isCatalog ? (
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              {/* Height */}
              <select
                value={item.heightIn ?? ''}
                onChange={(e) => handleDim('heightIn', Number(e.target.value))}
                className="w-16 rounded-lg border border-stone-200 bg-stone-50 px-1.5 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
              >
                {HEIGHT_OPTIONS.map(h => <option key={h} value={h}>{h}"</option>)}
              </select>
              <span className="text-stone-400">×</span>
              {/* Width */}
              <select
                value={item.widthIn ?? ''}
                onChange={(e) => handleDim('widthIn', Number(e.target.value))}
                className="w-16 rounded-lg border border-stone-200 bg-stone-50 px-1.5 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
              >
                {WIDTH_OPTIONS.map(w => <option key={w} value={w}>{w}"</option>)}
              </select>

              {/* Qty */}
              <input
                type="number"
                min={1}
                value={item.qty || ''}
                onChange={(e) => handleQty(Number(e.target.value))}
                className="w-14 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                placeholder="Pcs"
              />
              <span className="text-xs text-stone-400">Pc</span>

              {/* Rate per sqft */}
              <div className="flex items-center gap-0.5">
                <span className="text-xs text-stone-400">₹</span>
                <input
                  type="number"
                  min={0}
                  value={item.rateSqft ?? ''}
                  onChange={(e) => handleRate(Number(e.target.value))}
                  className="w-20 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                  placeholder="rate/sqft"
                />
                <span className="text-xs text-stone-400">/sq</span>
              </div>

              {/* Cost (read-only) */}
              <div className="ml-auto rounded-lg bg-shiv-green/10 px-3 py-1.5 text-sm font-bold text-stone-800 dark:text-white">
                ₹{(item.amount || 0).toLocaleString('en-IN')}
              </div>
            </div>
          ) : (
            /* Free-text row: qty + unit + amount */
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                placeholder="Qty"
                value={item.qty || ''}
                onChange={(e) => onUpdate(item.id, { qty: Number(e.target.value) })}
                className="w-20 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
              />
              <select
                value={item.unit}
                onChange={(e) => onUpdate(item.id, { unit: e.target.value })}
                className="w-20 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
              >
                {UNITS.map((u) => <option key={u}>{u}</option>)}
              </select>
              <div className="relative flex-1">
                <IndianRupee size={12} className="absolute left-2.5 top-2.5 text-stone-400" />
                <input
                  type="number"
                  min={0}
                  placeholder="Amount"
                  value={item.amount || ''}
                  onChange={(e) => onUpdate(item.id, { amount: Number(e.target.value) })}
                  className="w-full rounded-lg border border-stone-200 bg-stone-50 py-1.5 pl-7 pr-2.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                />
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => onRemove(item.id)}
          disabled={disabled}
          className="mt-1 rounded-lg p-1.5 text-stone-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30 dark:hover:bg-red-900/30"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  )
}

function emptyItem(): BillItem {
  return { id: uid(), description: '', qty: 1, unit: 'Pc', amount: 0 }
}

function emptyBill(number: string): Bill {
  return {
    id: uid(),
    number,
    date: today(),
    customerName: '',
    customerPhone: '',
    items: [emptyItem()],
    total: 0,
    paid: false,
    paymentMode: 'cash',
    upiRef: '',
    notes: '',
  }
}

function calcTotal(items: BillItem[]) {
  return items.reduce((s, i) => s + (Number(i.amount) || 0), 0)
}

// ---- Scaled preview wrapper -----------------------------------------------
const BILL_W_PX = 559 // 148mm at 96 dpi

function BillPreview({ bill }: { bill: Bill }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setScale(Math.min(1, el.clientWidth / BILL_W_PX))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">Preview</div>
      <div ref={wrapRef} className="overflow-hidden border border-stone-200 bg-stone-100 dark:border-white/10 dark:bg-stone-900"
        style={{ height: `calc(${scale} * 210mm)` }}>
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: BILL_W_PX }}>
          <BillPrint bill={bill} />
        </div>
      </div>
    </div>
  )
}

// ---- Bill list card -------------------------------------------------------
function BillCard({ bill, onEdit, onDelete }: { bill: Bill; onEdit: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm dark:border-white/10 dark:bg-stone-900">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0 text-xs font-bold text-shiv-green">#{bill.number}</span>
          <span className="truncate font-semibold text-stone-800 dark:text-stone-100">
            {bill.customerName || 'Unknown'}
          </span>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${bill.paid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
            {bill.paid ? 'PAID' : 'DUE'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-bold text-stone-700 dark:text-stone-200">₹{bill.total.toLocaleString('en-IN')}</span>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-stone-100 px-4 pb-4 pt-2 dark:border-white/10">
          <div className="mb-2 flex gap-4 text-xs text-stone-500 dark:text-stone-400">
            <span>{new Date(bill.date).toLocaleDateString('en-IN')}</span>
            {bill.customerPhone && <span>📞 {bill.customerPhone}</span>}
            {bill.paid && bill.paymentMode && <span className="capitalize">{bill.paymentMode}</span>}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-stone-400 dark:text-stone-500">
                <th className="pb-1 text-left">Item</th>
                <th className="pb-1 text-right">Qty</th>
                <th className="pb-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-white/5">
              {bill.items.map((item) => (
                <tr key={item.id}>
                  <td className="py-1 pr-2 text-stone-700 dark:text-stone-200">{item.description}</td>
                  <td className="py-1 pr-2 text-right text-stone-500 dark:text-stone-400 whitespace-nowrap">{item.qty} {item.unit}</td>
                  <td className="py-1 text-right font-medium text-stone-800 dark:text-stone-100">₹{(item.amount || 0).toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-stone-200 dark:border-white/10">
                <td colSpan={2} className="pt-2 font-bold text-stone-700 dark:text-stone-200">Total</td>
                <td className="pt-2 text-right font-bold text-stone-900 dark:text-white">₹{bill.total.toLocaleString('en-IN')}</td>
              </tr>
            </tfoot>
          </table>

          {bill.notes && (
            <p className="mt-2 text-xs text-stone-400 dark:text-stone-500 italic">{bill.notes}</p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={onEdit}
              className="flex-1 rounded-lg bg-shiv-green px-3 py-2 text-sm font-semibold text-stone-950 hover:bg-[#c6a15a]"
            >
              Edit
            </button>
            <button
              onClick={onDelete}
              className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Main component -------------------------------------------------------
export function BillBuilder() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const { bills, saveBill, deleteBill, nextBillNumber, customers } = useStore()

  const existing = id ? bills.find((b) => b.id === id) : undefined
  const [draft, setDraft] = useState<Bill>(() => existing ?? emptyBill(nextBillNumber()))
  const [view, setView] = useState<'list' | 'form'>(existing || !id ? 'list' : 'form')

  // -- helpers
  const total = calcTotal(draft.items)

  function startNew() {
    setDraft(emptyBill(nextBillNumber()))
    setView('form')
  }

  function editBill(b: Bill) {
    setDraft({ ...b })
    setView('form')
  }

  function updateItem(itemId: string, patch: Partial<BillItem>) {
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }))
  }

  function addItem() {
    setDraft((d) => ({ ...d, items: [...d.items, emptyItem()] }))
  }

  function removeItem(itemId: string) {
    setDraft((d) => ({ ...d, items: d.items.filter((i) => i.id !== itemId) }))
  }

  function save() {
    saveBill({ ...draft, total })
    setView('list')
    navigate('/bills', { replace: true })
  }

  function cancel() {
    setView('list')
    navigate('/bills', { replace: true })
  }

  // ---- FORM VIEW -----------------------------------------------------------
  if (view === 'form') {
    return (
      <div className="mx-auto max-w-2xl space-y-5 px-4 pb-24 pt-4 md:pt-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ReceiptText size={22} className="text-shiv-green" />
            <h1 className="text-xl font-bold text-stone-900 dark:text-white">
              {existing ? `Edit Bill #${draft.number}` : `Bill #${draft.number}`}
            </h1>
          </div>
          <input
            type="date"
            value={draft.date}
            onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
            className="rounded border border-stone-200 bg-transparent px-1.5 py-0.5 text-[11px] text-stone-500 dark:border-white/10 dark:text-stone-400"
          />
        </div>

        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-stone-500 dark:text-stone-400">Customer Name</label>
            <input
              type="text"
              list="bill-customers"
              placeholder="e.g. Rajesh Kumar ji"
              value={draft.customerName}
              onChange={(e) => {
                const name = e.target.value
                const match = customers.find(c => c.name === name)
                setDraft((d) => ({
                  ...d,
                  customerName: name,
                  customerPhone: match?.mobile ?? d.customerPhone,
                  customerUid: match?.uid ?? d.customerUid,
                }))
              }}
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
            />
            <datalist id="bill-customers">
              {customers.map(c => (
                <option key={c.id} value={c.name}>{c.mobile}</option>
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-stone-500 dark:text-stone-400">Phone (optional)</label>
            <input
              type="tel"
              placeholder="8051226996"
              value={draft.customerPhone ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, customerPhone: e.target.value }))}
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-stone-500 dark:text-stone-400">UID (optional)</label>
            <input
              type="text"
              placeholder="UPI / customer ID"
              value={draft.customerUid ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, customerUid: e.target.value }))}
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
            />
          </div>
        </div>

        {/* Items */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold text-stone-700 dark:text-stone-200">Items</h2>
            <button
              onClick={addItem}
              className="flex items-center gap-1 rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-200 dark:bg-white/10 dark:text-stone-200"
            >
              <Plus size={13} /> Add row
            </button>
          </div>

          <div className="space-y-2">
            {draft.items.map((item, idx) => (
              <SmartItemRow
                key={item.id}
                item={item}
                idx={idx}
                onUpdate={updateItem}
                onRemove={removeItem}
                disabled={draft.items.length === 1}
              />
            ))}
          </div>

          {/* Running total */}
          <div className="mt-3 flex justify-end">
            <div className="rounded-xl bg-stone-100 px-5 py-2 dark:bg-stone-800">
              <span className="text-sm text-stone-500 dark:text-stone-400">Total </span>
              <span className="text-lg font-bold text-stone-900 dark:text-white">₹{total.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>

        {/* Payment */}
        <div className="rounded-xl border border-stone-200 bg-white p-4 dark:border-white/10 dark:bg-stone-900">
          <h2 className="mb-3 text-sm font-bold text-stone-700 dark:text-stone-200">Payment</h2>
          <div className="flex gap-3">
            <button
              onClick={() => setDraft((d) => ({ ...d, paid: false }))}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-sm font-semibold transition ${
                !draft.paid
                  ? 'border-red-400 bg-red-50 text-red-600 dark:border-red-500 dark:bg-red-900/30 dark:text-red-400'
                  : 'border-stone-200 text-stone-400 hover:border-stone-300 dark:border-white/10'
              }`}
            >
              <Circle size={15} /> Due
            </button>
            <button
              onClick={() => setDraft((d) => ({ ...d, paid: true }))}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-sm font-semibold transition ${
                draft.paid
                  ? 'border-green-400 bg-green-50 text-green-700 dark:border-green-500 dark:bg-green-900/30 dark:text-green-400'
                  : 'border-stone-200 text-stone-400 hover:border-stone-300 dark:border-white/10'
              }`}
            >
              <CheckCircle2 size={15} /> Paid
            </button>
          </div>

          {draft.paid && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-stone-500 dark:text-stone-400">Mode</label>
                <select
                  value={draft.paymentMode ?? 'cash'}
                  onChange={(e) => setDraft((d) => ({ ...d, paymentMode: e.target.value as BillPaymentMode }))}
                  className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                >
                  <option value="cash">Cash</option>
                  <option value="online">Online</option>
                  <option value="upi">UPI</option>
                </select>
              </div>
              {(draft.paymentMode === 'online' || draft.paymentMode === 'upi') && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-stone-500 dark:text-stone-400">UPI / Ref</label>
                  <input
                    type="text"
                    placeholder="UPI ID or ref"
                    value={draft.upiRef ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, upiRef: e.target.value }))}
                    className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-stone-500 dark:text-stone-400">Notes (optional)</label>
          <textarea
            rows={2}
            placeholder="e.g. Haridwar Kander, delivery note…"
            value={draft.notes ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            className="w-full resize-none rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
          />
        </div>

        {/* Live print preview — scaled to fit phone width */}
        <BillPreview bill={{ ...draft, total }} />

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={cancel}
            className="flex-1 rounded-xl border border-stone-200 py-3 text-sm font-semibold text-stone-600 hover:bg-stone-50 dark:border-white/10 dark:text-stone-300"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="flex-1 rounded-xl bg-shiv-green py-3 text-sm font-bold text-stone-950 hover:bg-[#c6a15a]"
          >
            Save Bill
          </button>
        </div>
      </div>
    )
  }

  // ---- LIST VIEW -----------------------------------------------------------
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-24 pt-4 md:pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ReceiptText size={22} className="text-shiv-green" />
          <h1 className="text-xl font-bold text-stone-900 dark:text-white">Bills</h1>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-500 dark:bg-white/10 dark:text-stone-400">
            {bills.length}
          </span>
        </div>
        <button
          onClick={startNew}
          className="flex items-center gap-2 rounded-xl bg-shiv-green px-4 py-2 text-sm font-bold text-stone-950 hover:bg-[#c6a15a]"
        >
          <Plus size={16} /> New Bill
        </button>
      </div>

      {bills.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-stone-200 py-16 dark:border-white/10">
          <ReceiptText size={36} className="text-stone-300 dark:text-stone-600" />
          <p className="text-sm font-medium text-stone-400 dark:text-stone-500">No bills yet</p>
          <button
            onClick={startNew}
            className="mt-1 flex items-center gap-2 rounded-xl bg-shiv-green px-5 py-2.5 text-sm font-bold text-stone-950 hover:bg-[#c6a15a]"
          >
            <Plus size={15} /> Create first bill
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {bills.map((bill) => (
            <BillCard
              key={bill.id}
              bill={bill}
              onEdit={() => editBill(bill)}
              onDelete={() => { if (confirm(`Delete bill #${bill.number}?`)) deleteBill(bill.id) }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

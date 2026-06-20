import { useState, useRef, useLayoutEffect, useMemo, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  IndianRupee,
  Loader2,
  Plus,
  Printer,
  ReceiptText,
  Trash2,
  X,
} from 'lucide-react'
import { printBillOnServer, savePrintServerUrl, getSavedPrintServerUrl, fetchPrinters, getSavedPrinter, savePrinter } from '../../lib/printServer'
import { useStore } from '../../lib/store'
import type { Bill, BillItem, CatalogField, ProductCategory } from '../../lib/types'
import { CATEGORY_META } from '../../lib/types'
import { buildBillHtml } from '../../lib/billHtml'
import { billSqft, isFootSized } from '../../lib/pricing'
import { DropDown } from '../../components/ui'

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
  { category: 'hinge',          label: 'Hinges',            keywords: ['hinge', 'hinges'] },
  { category: 'screw',          label: 'Screw',             keywords: ['screw', 'ss'] },
  { category: 'aldrop',         label: 'Aldrop',            keywords: ['aldrop'] },
  { category: 'handle',         label: 'Handle',            keywords: ['handle'] },
  { category: 'tb',             label: 'Tower Bolt',        keywords: ['tb', 'tower', 'bolt', 'tower bolt'] },
  { category: 'fevicol',        label: 'Fevicol',           keywords: ['fev', 'fevicol', 'marine', 'heatx', 'sh', 'glue'] },
  { category: 'mica',           label: 'Mica',              keywords: ['mica'] },
  { category: 'tape',           label: 'Abro Tape',         keywords: ['tape', 'abro', 'abbro'] },
]

const BOARD_CATS: ProductCategory[] = ['block-board-19', 'block-board-12', 'plywood-6']
const HARDWARE_CATS: ProductCategory[] = ['hinge', 'screw', 'aldrop', 'handle', 'tb', 'fevicol', 'mica', 'tape']
// HARDWARE_SIZES and HARDWARE_BRANDS are now managed via the Inventory page
// and stored in the hardwareCatalog slice of the store.

const HARDWARE_DEFAULT_UNIT: Partial<Record<ProductCategory, string>> = {
  fevicol: 'kg',
  mica:    'Ply',
}
const QUICK_QTY: Partial<Record<ProductCategory, number[]>> = {
  hinge:    [4, 6, 8, 12, 16, 24],
  screw:    [50, 100, 150, 200, 500],
  aldrop:   [2, 4, 6, 8],
  handle:   [4, 6, 8, 10, 12],
  tb:       [4, 6, 8, 12],
  fevicol:  [1, 2, 4, 8, 10, 20],
  mica:     [1, 2, 4, 6, 8],
  tape:     [1, 2, 3, 6, 12, 24],
}
const HEIGHT_OPTIONS = [78, 81, 84, 90, 96, 72, 74, 76, 42, 48, 36]
const WIDTH_OPTIONS  = [36, 38, 40, 42, 48, 30, 33, 44]
// Boards/plywood are sized in whole feet (8'×4' etc.), not inches.
const BOARD_HEIGHT_FT = [8, 7, 6, 5, 4]
const BOARD_WIDTH_FT  = [4, 3, 5, 6, 7, 8]

function calcCost(rateSqft: number, heightIn: number, widthIn: number, qty: number, category?: ProductCategory) {
  if (!rateSqft || !heightIn || !widthIn) return 0
  return Math.round(rateSqft * billSqft(category, heightIn, widthIn) * qty)
}

function buildDescription(category: ProductCategory | undefined, brandName: string, heightIn: number, widthIn: number, qty: number) {
  const label = category ? (PRODUCT_OPTIONS.find(p => p.category === category)?.label ?? CATEGORY_META[category]?.short ?? '') : ''
  const size = heightIn && widthIn ? (isFootSized(category) ? `${heightIn}'×${widthIn}'` : `${heightIn}×${widthIn}`) : ''
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
  const { sets, hardwareCatalog, setHardwareCatalog, customCatalog, addCustomEntry, updateCustomEntry } = useStore()
  const activeSet = sets[0]
  const catSizes  = (cat: ProductCategory) => hardwareCatalog[cat]?.sizes ?? []
  const catBrands = (cat: ProductCategory) => hardwareCatalog[cat]?.brands ?? []
  const catFields = (cat: ProductCategory) => (hardwareCatalog[cat]?.fields ?? []).filter(f => f.values.length > 0)
  const catRate   = (cat: ProductCategory) => hardwareCatalog[cat]?.rate ?? 0

  // Persist the last-used rate for a hardware category so it pre-fills next time
  function saveRateToCatalog(cat: ProductCategory, rate: number) {
    if (!rate) return
    const current = hardwareCatalog[cat] ?? { sizes: [], brands: [] }
    setHardwareCatalog({ ...hardwareCatalog, [cat]: { ...current, rate } })
  }

  function handleFieldValue(label: string, value: string) {
    const fieldValues = { ...(item.fieldValues ?? {}), [label]: value }
    onUpdate(item.id, { fieldValues, description: hwDescription({ fieldValues }) })
  }

  // product type search state
  const [search, setSearch] = useState(() => {
    if (item.category) return PRODUCT_OPTIONS.find(p => p.category === item.category)?.label ?? ''
    if (item.customEntryId) return item.description
    return ''
  })
  const [showDrop, setShowDrop] = useState(false)
  // First tap shows dropdown without keyboard; second tap unlocks keyboard
  const [typingMode, setTypingMode] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)

  // "Add to catalog" inline form state
  const [addingNew, setAddingNew]   = useState(false)
  const [newName,   setNewName]     = useState('')
  const [newRate,   setNewRate]     = useState(0)
  const addingNewRef = useRef(false)  // ref copy so the blur closure reads current value
  // Creation form "More options" — sizes/brands to attach at creation time
  const [showMoreOpts,   setShowMoreOpts]   = useState(false)
  const [newItemSizes,   setNewItemSizes]   = useState<string[]>([])
  const [newItemBrands,  setNewItemBrands]  = useState<string[]>([])
  const [newSizeInput,   setNewSizeInput]   = useState('')
  const [newBrandInput,  setNewBrandInput]  = useState('')

  // Inline sub-option editing for a selected custom entry
  // inlineAdd: which sub-thing we're currently adding
  const [inlineAdd,        setInlineAdd]        = useState<'size' | 'brand' | 'field' | null>(null)
  const [inlineVal,        setInlineVal]        = useState('')
  const [inlineFieldLabel, setInlineFieldLabel] = useState('')
  // Adding a new value to an existing custom field (e.g. add "Blue" to Color)
  const [addToField,    setAddToField]    = useState<string | null>(null)  // field label
  const [addToFieldVal, setAddToFieldVal] = useState('')

  const filtered = useMemo(() => {
    // A committed category isn't a live query — show all options so the user
    // can switch. Filtering only kicks in once they actually type a new search.
    if (item.category) return PRODUCT_OPTIONS
    const q = search.toLowerCase().trim()
    if (!q) return PRODUCT_OPTIONS
    return PRODUCT_OPTIONS.filter(p =>
      p.label.toLowerCase().includes(q) || p.keywords.some(k => k.startsWith(q))
    )
  }, [search, item.category])

  // Custom catalog entries filtered by search
  const customFiltered = useMemo(() => {
    if (item.customEntryId) return customCatalog   // already selected → show all for switching
    const q = search.toLowerCase().trim()
    if (!q) return customCatalog
    return customCatalog.filter(e => e.name.toLowerCase().includes(q))
  }, [search, item.customEntryId, customCatalog])

  // The custom catalog entry currently selected (if any)
  const selectedCustomEntry = useMemo(() =>
    item.customEntryId ? customCatalog.find(e => e.id === item.customEntryId) : undefined,
    [item.customEntryId, customCatalog]
  )

  const brandsForCat = useMemo(() => {
    if (!item.category || !activeSet) return []
    return activeSet.brands.filter(b => b.category === item.category)
  }, [item.category, activeSet])

  // Sync description + cost whenever catalog fields change.
  // Hardware items skip this — they manage amount via rate×qty directly in their handlers.
  useEffect(() => {
    if (!item.category) return
    if (HARDWARE_CATS.includes(item.category)) return  // hardware: handlers own the amount
    const desc = buildDescription(item.category, item.brandName ?? '', item.heightIn ?? 0, item.widthIn ?? 0, item.qty)
    const cost = calcCost(item.rateSqft ?? 0, item.heightIn ?? 0, item.widthIn ?? 0, item.qty, item.category)
    if (desc !== item.description || cost !== item.amount) {
      onUpdate(item.id, { description: desc, amount: cost })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.category, item.brandName, item.heightIn, item.widthIn, item.qty, item.rateSqft])

  function selectCategory(opt: ProductOption) {
    setSearch(opt.label)
    setShowDrop(false)
    setTypingMode(false)
    if (HARDWARE_CATS.includes(opt.category)) {
      const defaultSize  = catSizes(opt.category)[0]  ?? ''
      const defaultBrand = opt.category !== 'mica' ? (catBrands(opt.category)[0] ?? '') : ''
      const defaultFieldValues: Record<string, string> = {}
      for (const f of catFields(opt.category)) defaultFieldValues[f.label] = f.values[0] ?? ''
      const fieldStr = Object.values(defaultFieldValues).filter(Boolean).join(' ')
      const savedRate = catRate(opt.category)
      onUpdate(item.id, {
        category: opt.category,
        sizeIn: defaultSize,
        brandName: defaultBrand,
        fieldValues: defaultFieldValues,
        heightIn: undefined,
        widthIn: undefined,
        rateSqft: savedRate || undefined,
        amount: savedRate ? Math.round(savedRate * 1) : 0,
        description: [opt.label, defaultSize, defaultBrand, fieldStr].filter(Boolean).join(' '),
        unit: HARDWARE_DEFAULT_UNIT[opt.category] ?? 'Pc',
      })
      return
    }
    const brands = activeSet?.brands.filter(b => b.category === opt.category) ?? []
    const firstBrand = brands[0]
    const isBoard = BOARD_CATS.includes(opt.category)
    // Boards default to a standard 8'×4' sheet (feet); doors to 78"×36" (inches).
    const h = isBoard ? 8 : 78
    const w = isBoard ? 4 : 36
    const rate = firstBrand?.rate ?? 0
    const cost = calcCost(rate, h, w, item.qty, opt.category)
    const desc = buildDescription(opt.category, firstBrand?.name ?? '', h, w, item.qty)
    onUpdate(item.id, {
      category: opt.category,
      brandName: firstBrand?.name ?? '',
      sizeIn: undefined,
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
    const cost = calcCost(rate, item.heightIn ?? 0, item.widthIn ?? 0, item.qty, item.category)
    const desc = buildDescription(item.category, brandName, item.heightIn ?? 0, item.widthIn ?? 0, item.qty)
    onUpdate(item.id, { brandName, rateSqft: rate, amount: cost, description: desc })
  }

  function handleDim(field: 'heightIn' | 'widthIn', val: number) {
    const h = field === 'heightIn' ? val : (item.heightIn ?? 0)
    const w = field === 'widthIn' ? val : (item.widthIn ?? 0)
    const cost = calcCost(item.rateSqft ?? 0, h, w, item.qty, item.category)
    const desc = buildDescription(item.category, item.brandName ?? '', h, w, item.qty)
    onUpdate(item.id, { [field]: val, amount: cost, description: desc })
  }

  function handleQty(qty: number) {
    const cost = calcCost(item.rateSqft ?? 0, item.heightIn ?? 0, item.widthIn ?? 0, qty, item.category)
    const desc = buildDescription(item.category, item.brandName ?? '', item.heightIn ?? 0, item.widthIn ?? 0, qty)
    onUpdate(item.id, { qty, amount: cost, description: desc })
  }

  function handleRate(rate: number) {
    const cost = calcCost(rate, item.heightIn ?? 0, item.widthIn ?? 0, item.qty, item.category)
    onUpdate(item.id, { rateSqft: rate, amount: cost })
  }

  // Compose hardware label: "Tower Bolt 8" Mona B/n Red", folding in any
  // selected custom-field values (Color, etc). Pass overrides for the field
  // being changed since onUpdate hasn't committed yet.
  function hwDescription(over: { sizeIn?: string; brandName?: string; fieldValues?: Record<string, string> } = {}) {
    const label = PRODUCT_OPTIONS.find(p => p.category === item.category)?.label ?? ''
    const sizeIn = over.sizeIn ?? item.sizeIn ?? ''
    const brandName = over.brandName ?? item.brandName ?? ''
    const fv = over.fieldValues ?? item.fieldValues ?? {}
    const fieldStr = Object.values(fv).filter(Boolean).join(' ')
    return [label, sizeIn, brandName, fieldStr].filter(Boolean).join(' ')
  }

  function handleSizeIn(sizeIn: string) {
    onUpdate(item.id, { sizeIn, description: hwDescription({ sizeIn }) })
  }

  function handleHardwareBrand(brandName: string) {
    onUpdate(item.id, { brandName, description: hwDescription({ brandName }) })
  }

  function clearCategory() {
    setSearch('')
    setTypingMode(false)
    onUpdate(item.id, {
      category: undefined,
      customEntryId: undefined,
      brandName: undefined,
      sizeIn: undefined,
      heightIn: undefined,
      widthIn: undefined,
      rateSqft: undefined,
      description: '',
    })
  }

  // ── Custom entry helpers ─────────────────────────────────────────────────
  function selectCustomEntry(entry: { id: string; name: string; sizes: string[]; brands: string[]; rate?: number }) {
    setSearch(entry.name)
    setShowDrop(false)
    setTypingMode(false)
    onUpdate(item.id, {
      customEntryId: entry.id,
      category: undefined,
      description: entry.name,
      sizeIn:    entry.sizes[0] ?? undefined,
      brandName: entry.brands[0] ?? undefined,
      rateSqft:  entry.rate ?? undefined,
      amount:    entry.rate ? Math.round(entry.rate * item.qty) : 0,
      heightIn:  undefined,
      widthIn:   undefined,
      unit: item.unit || 'Pc',
    })
  }

  function customDesc(over: { sizeIn?: string; brandName?: string; fieldValues?: Record<string,string> } = {}) {
    const name      = selectedCustomEntry?.name ?? item.description
    const sizeIn    = over.sizeIn    ?? item.sizeIn    ?? ''
    const brandName = over.brandName ?? item.brandName ?? ''
    const fv        = over.fieldValues ?? item.fieldValues ?? {}
    const fieldStr  = Object.values(fv).filter(Boolean).join(' ')
    return [name, sizeIn, brandName, fieldStr].filter(Boolean).join(' ')
  }

  function handleCustomSizeIn(sizeIn: string) {
    onUpdate(item.id, { sizeIn, description: customDesc({ sizeIn }) })
  }

  function handleCustomBrand(brandName: string) {
    onUpdate(item.id, { brandName, description: customDesc({ brandName }) })
  }

  function handleCustomFieldValue(label: string, value: string) {
    const fv = { ...(item.fieldValues ?? {}), [label]: value }
    onUpdate(item.id, { fieldValues: fv, description: customDesc({ fieldValues: fv }) })
  }

  function saveCustomEntryRate(entryId: string, rate: number) {
    if (!rate) return
    updateCustomEntry(entryId, { rate })
  }

  /** Confirm the current inline sub-option add (size / brand / new field). */
  function commitInlineAdd() {
    const val = inlineVal.trim()
    if (!val || !selectedCustomEntry) return
    if (inlineAdd === 'size') {
      const sizes = [...selectedCustomEntry.sizes, val]
      updateCustomEntry(selectedCustomEntry.id, { sizes })
      onUpdate(item.id, { sizeIn: val, description: customDesc({ sizeIn: val }) })
    } else if (inlineAdd === 'brand') {
      const brands = [...selectedCustomEntry.brands, val]
      updateCustomEntry(selectedCustomEntry.id, { brands })
      onUpdate(item.id, { brandName: val, description: customDesc({ brandName: val }) })
    } else if (inlineAdd === 'field') {
      const label    = inlineFieldLabel.trim() || 'Field'
      const newField: CatalogField = { id: Math.random().toString(36).slice(2,10), label, values: [val] }
      const fields   = [...(selectedCustomEntry.fields ?? []), newField]
      updateCustomEntry(selectedCustomEntry.id, { fields })
      const fv = { ...(item.fieldValues ?? {}), [label]: val }
      onUpdate(item.id, { fieldValues: fv, description: customDesc({ fieldValues: fv }) })
    }
    setInlineAdd(null)
    setInlineVal('')
    setInlineFieldLabel('')
  }

  /** Add a new value to an existing custom field (e.g. add "Blue" to the Color field). */
  function commitAddToField() {
    const val = addToFieldVal.trim()
    if (!val || !selectedCustomEntry || !addToField) return
    const fields = (selectedCustomEntry.fields ?? []).map(f =>
      f.label === addToField ? { ...f, values: [...f.values, val] } : f
    )
    updateCustomEntry(selectedCustomEntry.id, { fields })
    const fv = { ...(item.fieldValues ?? {}), [addToField]: val }
    onUpdate(item.id, { fieldValues: fv, description: customDesc({ fieldValues: fv }) })
    setAddToField(null)
    setAddToFieldVal('')
  }

  const isCatalog    = !!item.category || !!item.customEntryId
  const isHardware   = !!item.category && HARDWARE_CATS.includes(item.category)
  const isCustomEntry = !!item.customEntryId && !item.category

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3 dark:border-white/10 dark:bg-stone-900">
      <div className="flex items-start gap-2">
        <span className="mt-2 w-5 shrink-0 text-center text-xs font-bold text-stone-400">{idx + 1}</span>
        <div className="flex-1 min-w-0 space-y-2">

          {/* Description / product search */}
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <input
                type="text"
                placeholder="Tap to browse, tap again to type…"
                readOnly={!typingMode}
                value={isCatalog ? search : item.description}
                onMouseDown={(e) => {
                  if (!typingMode) {
                    // First tap: block keyboard, just show dropdown
                    e.preventDefault()
                    setShowDrop(true)
                    setTypingMode(true)
                  }
                  // Second tap: let focus happen normally → keyboard opens
                }}
                onFocus={(e) => {
                  setShowDrop(true)
                  if (isCatalog) e.target.select()
                }}
                onChange={(e) => {
                  const v = e.target.value
                  if (isCatalog) {
                    // Typing over a committed selection → drop it, start fresh.
                    onUpdate(item.id, {
                      category: undefined,
                      customEntryId: undefined,
                      brandName: undefined,
                      sizeIn: undefined,
                      heightIn: undefined,
                      widthIn: undefined,
                      rateSqft: undefined,
                      description: v,
                    })
                  } else {
                    onUpdate(item.id, { description: v })
                  }
                  setSearch(v)
                  setShowDrop(true)
                }}
                onBlur={() => {
                  setTypingMode(false)
                  setTimeout(() => { if (!addingNewRef.current) setShowDrop(false) }, 150)
                }}
                className={`w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm dark:border-white/10 dark:text-white ${
                  isCatalog
                    ? 'bg-stone-100 cursor-pointer dark:bg-stone-700'
                    : 'bg-stone-50 dark:bg-stone-800'
                }`}
              />
              {isCatalog && (
                <button
                  onClick={clearCategory}
                  className="absolute right-1.5 top-1.5 rounded p-0.5 text-stone-400 hover:text-red-500"
                >
                  <X size={13} />
                </button>
              )}
              {showDrop && (filtered.length > 0 || customFiltered.length > 0 || search.trim()) && (
                <div className="absolute top-full left-0 right-0 z-20 mt-0.5 max-h-72 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-xl dark:border-white/10 dark:bg-stone-800">

                  {/* ── Standard product options ── */}
                  {filtered.length > 0 && (
                    <div>
                      {filtered.length < PRODUCT_OPTIONS.length && (
                        <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Products</div>
                      )}
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

                  {/* ── Custom catalog entries ── */}
                  {customFiltered.length > 0 && (
                    <div className={filtered.length > 0 ? 'border-t border-stone-100 dark:border-white/5' : ''}>
                      <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">My Items</div>
                      {customFiltered.map(entry => (
                        <button
                          key={entry.id}
                          onMouseDown={() => selectCustomEntry(entry)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-white/10"
                        >
                          <span className="text-xs font-medium text-shiv-green">✦</span>
                          <span className="flex-1">{entry.name}</span>
                          {entry.rate ? <span className="text-xs text-stone-400">₹{entry.rate}</span> : null}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* ── Add new / inline form ── */}
                  <div className="border-t border-stone-100 dark:border-white/5">
                    {!addingNew ? (
                      search.trim() ? (
                        <button
                          onMouseDown={(e) => {
                            e.preventDefault()
                            addingNewRef.current = true
                            setNewName(search.trim())
                            setNewRate(0)
                            setAddingNew(true)
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-shiv-green hover:bg-stone-50 dark:hover:bg-white/5"
                        >
                          <Plus size={13} />
                          Add "{search.trim()}" to My Items
                        </button>
                      ) : (
                        <button
                          onMouseDown={(e) => {
                            e.preventDefault()
                            addingNewRef.current = true
                            setNewName('')
                            setNewRate(0)
                            setAddingNew(true)
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-stone-400 hover:bg-stone-50 dark:hover:bg-white/5"
                        >
                          <Plus size={13} />
                          Add new custom item
                        </button>
                      )
                    ) : (
                      <div
                        onMouseDown={(e) => e.preventDefault()}
                        className="p-3 space-y-2"
                      >
                        <div className="text-xs font-semibold text-stone-500 dark:text-stone-400">Add to My Items</div>

                        {/* Name + Rate */}
                        <div className="flex gap-2">
                          <input
                            autoFocus
                            type="text"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                            placeholder="Item name"
                            className="min-w-0 flex-1 rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-sm dark:border-white/10 dark:bg-stone-700 dark:text-white"
                          />
                          <div className="relative w-20 shrink-0">
                            <IndianRupee size={11} className="absolute left-2 top-2.5 text-stone-400" />
                            <input
                              type="number"
                              min={0}
                              value={newRate || ''}
                              onChange={(e) => setNewRate(Number(e.target.value))}
                              placeholder="Rate"
                              className="w-full rounded-lg border border-stone-200 bg-stone-50 py-1.5 pl-6 pr-1.5 text-sm dark:border-white/10 dark:bg-stone-700 dark:text-white"
                            />
                          </div>
                        </div>

                        {/* More options toggle */}
                        <button
                          type="button"
                          onClick={() => setShowMoreOpts(v => !v)}
                          className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
                        >
                          {showMoreOpts ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          {showMoreOpts ? 'Less options' : 'Add sizes / brands'}
                        </button>

                        {showMoreOpts && (
                          <div className="space-y-2 rounded-lg bg-stone-50 p-2 dark:bg-white/5">
                            {/* Sizes tag input */}
                            <div>
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Sizes</div>
                              <div className="flex flex-wrap gap-1 mb-1">
                                {newItemSizes.map(s => (
                                  <span key={s} className="flex items-center gap-0.5 rounded-full bg-stone-200 px-2 py-0.5 text-xs dark:bg-white/10">
                                    {s}
                                    <button type="button" onClick={() => setNewItemSizes(p => p.filter(x => x !== s))} className="text-stone-400 hover:text-red-500 ml-0.5"><X size={10} /></button>
                                  </span>
                                ))}
                              </div>
                              <div className="flex gap-1">
                                <input
                                  type="text"
                                  value={newSizeInput}
                                  onChange={(e) => setNewSizeInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if ((e.key === 'Enter' || e.key === ',') && newSizeInput.trim()) {
                                      e.preventDefault()
                                      setNewItemSizes(p => [...p, newSizeInput.trim()])
                                      setNewSizeInput('')
                                    }
                                  }}
                                  placeholder="Type size, press Enter"
                                  className="flex-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs dark:border-white/10 dark:bg-stone-700 dark:text-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => { if (newSizeInput.trim()) { setNewItemSizes(p => [...p, newSizeInput.trim()]); setNewSizeInput('') } }}
                                  className="rounded-lg bg-stone-200 px-2 py-1 text-xs dark:bg-white/10"
                                >+</button>
                              </div>
                            </div>

                            {/* Brands tag input */}
                            <div>
                              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Brands</div>
                              <div className="flex flex-wrap gap-1 mb-1">
                                {newItemBrands.map(b => (
                                  <span key={b} className="flex items-center gap-0.5 rounded-full bg-stone-200 px-2 py-0.5 text-xs dark:bg-white/10">
                                    {b}
                                    <button type="button" onClick={() => setNewItemBrands(p => p.filter(x => x !== b))} className="text-stone-400 hover:text-red-500 ml-0.5"><X size={10} /></button>
                                  </span>
                                ))}
                              </div>
                              <div className="flex gap-1">
                                <input
                                  type="text"
                                  value={newBrandInput}
                                  onChange={(e) => setNewBrandInput(e.target.value)}
                                  onKeyDown={(e) => {
                                    if ((e.key === 'Enter' || e.key === ',') && newBrandInput.trim()) {
                                      e.preventDefault()
                                      setNewItemBrands(p => [...p, newBrandInput.trim()])
                                      setNewBrandInput('')
                                    }
                                  }}
                                  placeholder="Type brand, press Enter"
                                  className="flex-1 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs dark:border-white/10 dark:bg-stone-700 dark:text-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => { if (newBrandInput.trim()) { setNewItemBrands(p => [...p, newBrandInput.trim()]); setNewBrandInput('') } }}
                                  className="rounded-lg bg-stone-200 px-2 py-1 text-xs dark:bg-white/10"
                                >+</button>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              addingNewRef.current = false
                              setAddingNew(false)
                              setShowMoreOpts(false)
                              setNewItemSizes([])
                              setNewItemBrands([])
                              setNewSizeInput('')
                              setNewBrandInput('')
                              setShowDrop(false)
                            }}
                            className="rounded-lg px-3 py-1.5 text-xs text-stone-500 hover:bg-stone-100 dark:hover:bg-white/10"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              const name = newName.trim()
                              if (!name) return
                              // Flush any half-typed size/brand input
                              const sizes  = newSizeInput.trim()  ? [...newItemSizes,  newSizeInput.trim()]  : newItemSizes
                              const brands = newBrandInput.trim() ? [...newItemBrands, newBrandInput.trim()] : newItemBrands
                              const newId = addCustomEntry(name)
                              updateCustomEntry(newId, {
                                ...(newRate  ? { rate: newRate }  : {}),
                                ...(sizes.length   ? { sizes }   : {}),
                                ...(brands.length  ? { brands }  : {}),
                              })
                              selectCustomEntry({ id: newId, name, sizes, brands, rate: newRate || undefined })
                              addingNewRef.current = false
                              setAddingNew(false)
                              setShowMoreOpts(false)
                              setNewItemSizes([])
                              setNewItemBrands([])
                              setNewSizeInput('')
                              setNewBrandInput('')
                              setShowDrop(false)
                            }}
                            className="rounded-lg bg-shiv-green px-3 py-1.5 text-xs font-semibold text-stone-900 disabled:opacity-40"
                            disabled={!newName.trim()}
                          >
                            Add →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                </div>
              )}
            </div>

            {/* Hardware: size dropdown — only if sizes exist for this category */}
            {isHardware && item.category && catSizes(item.category).length > 0 && (
              <DropDown
                className="w-16 shrink-0"
                value={item.sizeIn ?? catSizes(item.category)[0] ?? ''}
                onChange={handleSizeIn}
                options={catSizes(item.category)}
              />
            )}
            {/* Hardware: brand dropdown (not mica — mica uses free-text below) */}
            {isHardware && item.category && item.category !== 'mica' && catBrands(item.category).length > 0 && (
              <DropDown
                className="w-24 shrink-0"
                value={item.brandName ?? ''}
                onChange={handleHardwareBrand}
                options={catBrands(item.category)}
              />
            )}
            {/* Board/door: brand dropdown */}
            {isCatalog && !isHardware && !isCustomEntry && brandsForCat.length > 0 && (
              <DropDown
                className="w-28 shrink-0"
                value={item.brandName ?? ''}
                onChange={handleBrandChange}
                options={brandsForCat.map(b => ({ value: b.name, label: b.name }))}
              />
            )}
            {/* Custom entry: size dropdown */}
            {isCustomEntry && (selectedCustomEntry?.sizes.length ?? 0) > 0 && (
              <DropDown
                className="w-20 shrink-0"
                value={item.sizeIn ?? selectedCustomEntry!.sizes[0] ?? ''}
                onChange={handleCustomSizeIn}
                options={selectedCustomEntry!.sizes}
              />
            )}
            {/* Custom entry: brand dropdown */}
            {isCustomEntry && (selectedCustomEntry?.brands.length ?? 0) > 0 && (
              <DropDown
                className="w-24 shrink-0"
                value={item.brandName ?? selectedCustomEntry!.brands[0] ?? ''}
                onChange={handleCustomBrand}
                options={selectedCustomEntry!.brands}
              />
            )}

          </div>

          {/* Free-text: qty · unit · amount — only show after description is entered */}
          {!isCatalog && !!item.description.trim() && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                placeholder="Qty"
                value={item.qty || ''}
                onFocus={(e) => e.target.select()}
                onChange={(e) => onUpdate(item.id, { qty: Number(e.target.value) })}
                className="w-14 shrink-0 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
              />
              <DropDown
                className="w-16 shrink-0"
                value={item.unit}
                onChange={(u) => onUpdate(item.id, { unit: u })}
                options={UNITS}
              />
              <div className="relative ml-auto w-24 shrink-0">
                <IndianRupee size={11} className="absolute left-2 top-2.5 text-stone-400" />
                <input
                  type="number"
                  min={0}
                  placeholder="Amt"
                  value={item.amount || ''}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => onUpdate(item.id, { amount: Number(e.target.value) })}
                  className="w-full rounded-lg border border-stone-200 bg-stone-50 py-1.5 pl-6 pr-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                />
              </div>
            </div>
          )}

          {/* Hardware row 2: quick qty chips + qty · unit · rate → computed amount */}
          {isHardware && (
            <div className="space-y-1.5">
              {/* Custom catalog fields (Color, etc) — one dropdown each */}
              {item.category && catFields(item.category).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {catFields(item.category).map(f => (
                    <DropDown
                      key={f.id}
                      className="shrink-0 min-w-[4.5rem]"
                      value={item.fieldValues?.[f.label] ?? ''}
                      onChange={(v) => handleFieldValue(f.label, v)}
                      options={[{ value: '', label: f.label }, ...f.values.map(v => ({ value: v, label: v }))]}
                    />
                  ))}
                </div>
              )}
              {/* Mica: design number — full-width text input */}
              {item.category === 'mica' && (
                <input
                  type="text"
                  placeholder="Design no. (e.g. 8225 V0)"
                  value={item.brandName ?? ''}
                  onChange={(e) => handleHardwareBrand(e.target.value)}
                  className="w-full rounded-lg border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                />
              )}
              {/* Quick qty chips */}
              {item.category && (QUICK_QTY[item.category]?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1">
                  {QUICK_QTY[item.category]!.map(q => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => {
                        const rate = item.rateSqft ?? 0
                        onUpdate(item.id, { qty: q, amount: Math.round(rate * q) })
                        setTimeout(() => amountRef.current?.focus(), 50)
                      }}
                      className={`px-2.5 py-0.5 text-xs font-semibold rounded-lg border transition-colors ${
                        item.qty === q
                          ? 'bg-shiv-green border-shiv-green/50 text-stone-900'
                          : 'border-stone-200 bg-stone-50 text-stone-500 dark:border-white/10 dark:bg-stone-800 dark:text-stone-300'
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {/* qty · unit · rate input → computed amount pill */}
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} placeholder="Qty"
                  value={item.qty || ''}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const q = Number(e.target.value)
                    onUpdate(item.id, { qty: q, amount: Math.round((item.rateSqft ?? 0) * q) })
                  }}
                  className="w-14 shrink-0 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                />
                <DropDown
                  className="w-16 shrink-0"
                  value={item.unit}
                  onChange={(u) => onUpdate(item.id, { unit: u })}
                  options={UNITS}
                />
                <div className="relative shrink-0 w-20">
                  <IndianRupee size={11} className="absolute left-2 top-2.5 text-stone-400" />
                  <input
                    ref={amountRef}
                    type="number" min={0} placeholder="Rate"
                    value={item.rateSqft || ''}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const rate = Number(e.target.value)
                      onUpdate(item.id, { rateSqft: rate, amount: Math.round(rate * (item.qty || 1)) })
                    }}
                    onBlur={(e) => {
                      const rate = Number(e.target.value)
                      if (rate && item.category && HARDWARE_CATS.includes(item.category)) {
                        saveRateToCatalog(item.category, rate)
                      }
                    }}
                    className="w-full rounded-lg border border-stone-200 bg-stone-50 py-1.5 pl-6 pr-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                  />
                </div>
                <div className="ml-auto rounded-lg bg-shiv-green/15 px-3 py-1.5 text-sm font-bold text-stone-800 dark:text-white whitespace-nowrap">
                  ₹{(item.amount || 0).toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          )}

          {/* Custom entry: existing fields · sub-option chips · qty/rate */}
          {isCustomEntry && (
            <div className="space-y-1.5">

              {/* Existing custom fields (Color, Width, etc.) — each as a dropdown */}
              {(selectedCustomEntry?.fields?.filter(f => f.values.length > 0) ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedCustomEntry!.fields!.filter(f => f.values.length > 0).map(f => (
                    <div key={f.id} className="flex items-center gap-0.5">
                      {addToField === f.label ? (
                        // Inline input to add a new value to this field
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-stone-400">{f.label}:</span>
                          <input
                            autoFocus
                            type="text"
                            value={addToFieldVal}
                            placeholder={`new ${f.label.toLowerCase()}`}
                            onChange={(e) => setAddToFieldVal(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') commitAddToField(); if (e.key === 'Escape') { setAddToField(null); setAddToFieldVal('') } }}
                            className="w-24 rounded-lg border border-shiv-green/50 bg-stone-50 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-shiv-green/40 dark:bg-stone-800 dark:text-white"
                          />
                          <button onClick={commitAddToField} className="text-shiv-green hover:text-shiv-green/70"><CheckCircle2 size={14} /></button>
                          <button onClick={() => { setAddToField(null); setAddToFieldVal('') }} className="text-stone-400 hover:text-red-400"><X size={12} /></button>
                        </div>
                      ) : (
                        <DropDown
                          className="shrink-0 min-w-[5rem]"
                          value={item.fieldValues?.[f.label] ?? f.values[0] ?? ''}
                          onChange={(v) => {
                            if (v === '__add__') { setAddToField(f.label); setAddToFieldVal('') }
                            else handleCustomFieldValue(f.label, v)
                          }}
                          options={[
                            ...f.values.map(v => ({ value: v, label: v })),
                            { value: '__add__', label: `+ Add ${f.label}…` },
                          ]}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Sub-option add chips: + Size  + Brand  + [Color/Field] */}
              <div className="flex flex-wrap gap-1.5">
                {inlineAdd === 'size' ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      type="text"
                      value={inlineVal}
                      placeholder="e.g. 50kg"
                      onChange={(e) => setInlineVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitInlineAdd(); if (e.key === 'Escape') setInlineAdd(null) }}
                      className="w-24 rounded-lg border border-shiv-green/50 bg-stone-50 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-shiv-green/40 dark:bg-stone-800 dark:text-white"
                    />
                    <button onClick={commitInlineAdd} className="text-shiv-green hover:text-shiv-green/70"><CheckCircle2 size={14} /></button>
                    <button onClick={() => setInlineAdd(null)} className="text-stone-400 hover:text-red-400"><X size={12} /></button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setInlineAdd('size'); setInlineVal('') }}
                    className="flex items-center gap-1 rounded-lg border border-dashed border-stone-300 px-2 py-1 text-xs text-stone-500 hover:border-shiv-green hover:text-shiv-green dark:border-white/20 dark:hover:border-shiv-green"
                  >
                    <Plus size={11} /> Size
                  </button>
                )}

                {inlineAdd === 'brand' ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      type="text"
                      value={inlineVal}
                      placeholder="e.g. UltraTech"
                      onChange={(e) => setInlineVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitInlineAdd(); if (e.key === 'Escape') setInlineAdd(null) }}
                      className="w-28 rounded-lg border border-shiv-green/50 bg-stone-50 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-shiv-green/40 dark:bg-stone-800 dark:text-white"
                    />
                    <button onClick={commitInlineAdd} className="text-shiv-green hover:text-shiv-green/70"><CheckCircle2 size={14} /></button>
                    <button onClick={() => setInlineAdd(null)} className="text-stone-400 hover:text-red-400"><X size={12} /></button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setInlineAdd('brand'); setInlineVal('') }}
                    className="flex items-center gap-1 rounded-lg border border-dashed border-stone-300 px-2 py-1 text-xs text-stone-500 hover:border-shiv-green hover:text-shiv-green dark:border-white/20 dark:hover:border-shiv-green"
                  >
                    <Plus size={11} /> Brand
                  </button>
                )}

                {inlineAdd === 'field' ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      type="text"
                      value={inlineFieldLabel}
                      placeholder="Field (e.g. Color)"
                      onChange={(e) => setInlineFieldLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); (e.currentTarget.nextElementSibling as HTMLInputElement | null)?.focus() } if (e.key === 'Escape') setInlineAdd(null) }}
                      className="w-28 rounded-lg border border-shiv-green/50 bg-stone-50 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-shiv-green/40 dark:bg-stone-800 dark:text-white"
                    />
                    <input
                      type="text"
                      value={inlineVal}
                      placeholder="Value (e.g. Red)"
                      onChange={(e) => setInlineVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitInlineAdd(); if (e.key === 'Escape') setInlineAdd(null) }}
                      className="w-24 rounded-lg border border-shiv-green/50 bg-stone-50 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-shiv-green/40 dark:bg-stone-800 dark:text-white"
                    />
                    <button onClick={commitInlineAdd} className="text-shiv-green hover:text-shiv-green/70"><CheckCircle2 size={14} /></button>
                    <button onClick={() => setInlineAdd(null)} className="text-stone-400 hover:text-red-400"><X size={12} /></button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setInlineAdd('field'); setInlineVal(''); setInlineFieldLabel('') }}
                    className="flex items-center gap-1 rounded-lg border border-dashed border-stone-300 px-2 py-1 text-xs text-stone-500 hover:border-shiv-green hover:text-shiv-green dark:border-white/20 dark:hover:border-shiv-green"
                  >
                    <Plus size={11} /> Color / Field
                  </button>
                )}
              </div>

              {/* qty · unit · rate → amount */}
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} placeholder="Qty"
                  value={item.qty || ''}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const q = Number(e.target.value)
                    onUpdate(item.id, { qty: q, amount: Math.round((item.rateSqft ?? 0) * q) })
                  }}
                  className="w-14 shrink-0 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                />
                <DropDown
                  className="w-16 shrink-0"
                  value={item.unit}
                  onChange={(u) => onUpdate(item.id, { unit: u })}
                  options={UNITS}
                />
                <div className="relative shrink-0 w-20">
                  <IndianRupee size={11} className="absolute left-2 top-2.5 text-stone-400" />
                  <input
                    ref={amountRef}
                    type="number" min={0} placeholder="Rate"
                    value={item.rateSqft || ''}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const rate = Number(e.target.value)
                      onUpdate(item.id, { rateSqft: rate, amount: Math.round(rate * (item.qty || 1)) })
                    }}
                    onBlur={(e) => {
                      const rate = Number(e.target.value)
                      if (rate && item.customEntryId) saveCustomEntryRate(item.customEntryId, rate)
                    }}
                    className="w-full rounded-lg border border-stone-200 bg-stone-50 py-1.5 pl-6 pr-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                  />
                </div>
                <div className="ml-auto rounded-lg bg-shiv-green/15 px-3 py-1.5 text-sm font-bold text-stone-800 dark:text-white whitespace-nowrap">
                  ₹{(item.amount || 0).toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          )}

          {/* Board/door: size · qty · cost — single line. Boards pick feet, others inches. */}
          {isCatalog && !isHardware && !isCustomEntry && (
            <div className="flex items-center gap-1.5">
              <DropDown
                className="w-16 shrink-0"
                value={String(item.heightIn ?? '')}
                onChange={(v) => handleDim('heightIn', Number(v))}
                options={(isFootSized(item.category) ? BOARD_HEIGHT_FT : HEIGHT_OPTIONS).map(h => ({ value: String(h), label: isFootSized(item.category) ? `${h} ft` : `${h}"` }))}
              />
              <span className="text-xs text-stone-400">×</span>
              <DropDown
                className="w-16 shrink-0"
                value={String(item.widthIn ?? '')}
                onChange={(v) => handleDim('widthIn', Number(v))}
                options={(isFootSized(item.category) ? BOARD_WIDTH_FT : WIDTH_OPTIONS).map(w => ({ value: String(w), label: isFootSized(item.category) ? `${w} ft` : `${w}"` }))}
              />
              <input
                type="number"
                min={1}
                value={item.qty || ''}
                onFocus={(e) => e.target.select()}
                onChange={(e) => handleQty(Number(e.target.value))}
                className="w-12 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                placeholder="1"
              />
              <span className="text-xs text-stone-400">Pc</span>
              <div className="relative ml-auto shrink-0 w-[4.75rem]">
                <IndianRupee size={11} className="absolute left-2 top-2.5 text-stone-400" />
                <input
                  type="number" min={0} placeholder="Rate"
                  value={item.rateSqft || ''}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => handleRate(Number(e.target.value))}
                  className="w-full rounded-lg border border-stone-200 bg-stone-50 py-1.5 pl-6 pr-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                  title="Rate per sqft"
                />
              </div>
              <div className="shrink-0 rounded-lg bg-shiv-green/15 px-3 py-1.5 text-sm font-bold text-stone-800 dark:text-white whitespace-nowrap">
                ₹{(item.amount || 0).toLocaleString('en-IN')}
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

/** Returns true if the bill has at least a customer name or one item description. */
function hasMeaningfulContent(bill: Bill): boolean {
  return bill.customerName.trim().length > 0 || bill.items.some(i => i.description.trim().length > 0)
}

function calcTotal(items: BillItem[]) {
  return items.reduce((s, i) => s + (Number(i.amount) || 0), 0)
}

// ---- Scaled preview wrapper -----------------------------------------------
// 148mm × 210mm at 96 dpi (browser default resolution)
const BILL_W_PX = 559
const BILL_H_PX = 793

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

  const numPages = Math.max(1, Math.ceil((bill.items?.length ?? 0) / 14))
  const totalH = BILL_H_PX * numPages
  const srcDoc = useMemo(() => buildBillHtml(bill), [bill])

  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">Preview</div>
      {/* Outer div measures available width; inner box is sized to the scaled
          bill exactly and clips the iframe's unscaled layout box. */}
      <div ref={wrapRef}>
        <div
          className="border border-stone-200 bg-white dark:border-white/10 mx-auto overflow-hidden"
          style={{
            width: `${Math.round(BILL_W_PX * scale)}px`,
            height: `${Math.round(totalH * scale)}px`,
          }}
        >
          <iframe
            srcDoc={srcDoc}
            scrolling="no"
            style={{
              width: BILL_W_PX,
              height: totalH,
              border: 'none',
              display: 'block',
              overflow: 'hidden',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
            title="Bill preview"
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  )
}

// ---- Bill list card -------------------------------------------------------
function BillCard({ bill, onEdit, onDelete }: { bill: Bill; onEdit: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const isDraft = !!bill.isDraft
  return (
    <div className={`rounded-xl border shadow-sm ${isDraft
      ? 'border-amber-200 bg-amber-50/60 dark:border-amber-500/25 dark:bg-amber-900/10'
      : 'border-stone-200 bg-white dark:border-white/10 dark:bg-stone-900'}`}>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0 text-xs font-bold text-shiv-green">#{bill.number}</span>
          <span className="truncate font-semibold text-stone-800 dark:text-stone-100">
            {bill.customerName || <span className="text-stone-400 dark:text-stone-500">No name</span>}
          </span>
          {isDraft ? (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/25 dark:text-amber-400">
              DRAFT
            </span>
          ) : (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${bill.paid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
              {bill.paid ? 'PAID' : 'DUE'}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {isDraft ? (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">in progress</span>
          ) : (
            <span className="font-bold text-stone-700 dark:text-stone-200">₹{bill.total.toLocaleString('en-IN')}</span>
          )}
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-stone-100 px-4 pb-4 pt-2 dark:border-white/10">
          <div className="mb-2 flex gap-4 text-xs text-stone-500 dark:text-stone-400">
            <span>{bill.date.split('-').reverse().join('/')}</span>
            {bill.customerPhone && <span>📞 {bill.customerPhone}</span>}
            {!isDraft && bill.paid && bill.paymentMode && <span className="capitalize">{bill.paymentMode}</span>}
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
                  <td className="py-1 pr-2 text-stone-700 dark:text-stone-200">{item.description || <span className="italic text-stone-300 dark:text-stone-600">—</span>}</td>
                  <td className="py-1 pr-2 text-right text-stone-500 dark:text-stone-400 whitespace-nowrap">{item.qty} {item.unit}</td>
                  <td className="py-1 text-right font-medium text-stone-800 dark:text-stone-100">₹{(item.amount || 0).toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
            {!isDraft && (
              <tfoot>
                <tr className="border-t border-stone-200 dark:border-white/10">
                  <td colSpan={2} className="pt-2 font-bold text-stone-700 dark:text-stone-200">Total</td>
                  <td className="pt-2 text-right font-bold text-stone-900 dark:text-white">₹{bill.total.toLocaleString('en-IN')}</td>
                </tr>
              </tfoot>
            )}
          </table>

          {bill.notes && (
            <p className="mt-2 text-xs text-stone-400 dark:text-stone-500 italic">{bill.notes}</p>
          )}

          <div className="mt-3 flex gap-2">
            {isDraft ? (
              <button
                onClick={onEdit}
                className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600"
              >
                Continue →
              </button>
            ) : (
              <button
                onClick={onEdit}
                className="flex-1 rounded-lg bg-shiv-green px-3 py-2 text-sm font-semibold text-stone-950 hover:bg-[#c6a15a]"
              >
                Edit
              </button>
            )}
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
  const [printState, setPrintState] = useState<null | 'connecting' | 'printing' | 'done' | { error: string } | { pickPrinter: string[] }>(null)
  const [serverUrlInput, setServerUrlInput] = useState('')
  const [selectedPrinter, setSelectedPrinter] = useState<string>(() => getSavedPrinter() ?? '')

  // -- Draft auto-save refs (always point to the latest values for the unmount cleanup)
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])
  const viewRef  = useRef(view)
  useEffect(() => { viewRef.current = view }, [view])
  /** Set to true whenever the bill is explicitly committed (save / print / cancel) so the
   *  unmount cleanup doesn't double-save. */
  const committedRef = useRef(false)

  // Auto-save as draft when the user navigates away mid-bill (e.g. taps the navbar)
  useEffect(() => {
    return () => {
      if (committedRef.current) return
      if (viewRef.current !== 'form') return
      const d = draftRef.current
      if (!d) return
      const { bills: latestBills, saveBill: storeSaveBill } = useStore.getState()
      const inStore = latestBills.find(b => b.id === d.id)
      // Auto-draft: new bills that have content, or existing drafts being updated
      const shouldDraft = (!inStore && hasMeaningfulContent(d)) || !!inStore?.isDraft
      if (shouldDraft) {
        storeSaveBill({ ...d, total: calcTotal(d.items), isDraft: true })
      }
    }
  }, []) // empty deps — fires only on unmount

  // -- helpers
  const total = calcTotal(draft.items)

  function editBill(b: Bill) {
    setDraft({ ...b })
    setView('form')
  }

  function startNew() {
    setDraft(emptyBill(nextBillNumber()))
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
    committedRef.current = true
    saveBill({ ...draft, total, isDraft: undefined })
    setView('list')
    navigate('/bills', { replace: true })
  }

  function cancel() {
    committedRef.current = true
    // Auto-save as draft for new bills with content, or when updating an existing draft
    const billToSave = { ...draft, total }
    const inStore = bills.find(b => b.id === billToSave.id)
    const shouldDraft = (!inStore && hasMeaningfulContent(billToSave)) || !!inStore?.isDraft
    if (shouldDraft) {
      saveBill({ ...billToSave, isDraft: true })
    }
    setView('list')
    navigate('/bills', { replace: true })
  }

  async function doPrint(bill: typeof draft & { total: number }, printerOverride?: string) {
    setPrintState('connecting')
    try {
      // If no printer saved yet, fetch the list and ask user to pick
      const printer = printerOverride ?? getSavedPrinter() ?? undefined
      if (!printer) {
        const info = await fetchPrinters()
        const first = info.default || info.printers[0]
        if (!first) throw new Error('No printers found on the server')
        savePrinter(first)
        setSelectedPrinter(first)
        setPrintState('printing')
        await printBillOnServer(bill, 1, first)
      } else {
        setPrintState('printing')
        await printBillOnServer(bill, 1, printer)
      }
      setPrintState('done')
      setTimeout(() => setPrintState(null), 2200)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setPrintState({ error: msg })
      setServerUrlInput(getSavedPrintServerUrl() ?? '')
    }
  }

  function handlePrint() {
    committedRef.current = true
    const billToSave = { ...draft, total, isDraft: undefined }
    saveBill(billToSave)
    void doPrint(billToSave)
  }

  async function handleSaveServerUrl() {
    committedRef.current = true
    const raw = serverUrlInput.trim()
    if (!raw) return
    const url = /^https?:\/\//.test(raw) ? raw : `http://${raw}:3333`
    savePrintServerUrl(url)
    const billToSave = { ...draft, total, isDraft: undefined }
    saveBill(billToSave)
    await doPrint(billToSave)
  }

  async function handlePrinterPicked(name: string) {
    savePrinter(name)
    setSelectedPrinter(name)
    await doPrint({ ...draft, total }, name)
  }

  // ---- FORM VIEW -----------------------------------------------------------
  if (view === 'form') {
    return (
      <div className="mx-auto max-w-2xl space-y-5 px-4 pb-24 pt-4 md:pt-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ReceiptText size={22} className={draft.isDraft ? 'text-amber-500' : 'text-shiv-green'} />
            <h1 className="text-xl font-bold text-stone-900 dark:text-white">
              {draft.isDraft ? `Draft #${draft.number}` : existing ? `Edit Bill #${draft.number}` : `Bill #${draft.number}`}
            </h1>
            {draft.isDraft && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
                DRAFT
              </span>
            )}
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
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={10}
              placeholder="10-digit mobile"
              value={draft.customerPhone ?? ''}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 10)
                setDraft((d) => ({ ...d, customerPhone: v }))
              }}
              className={`w-full rounded-lg border px-3 py-2 text-sm transition-colors dark:bg-stone-800 dark:text-white ${
                (draft.customerPhone ?? '').length === 10
                  ? 'border-green-500 bg-green-50 dark:border-green-500'
                  : 'border-stone-200 bg-white dark:border-white/10'
              }`}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-stone-500 dark:text-stone-400">UID (optional)</label>
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={12}
              placeholder="12-digit Aadhaar"
              value={draft.customerUid ?? ''}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 12)
                setDraft((d) => ({ ...d, customerUid: v }))
              }}
              className={`w-full rounded-lg border px-3 py-2 text-sm transition-colors dark:bg-stone-800 dark:text-white ${
                (draft.customerUid ?? '').length === 12
                  ? 'border-green-500 bg-green-50 dark:border-green-500'
                  : 'border-stone-200 bg-white dark:border-white/10'
              }`}
            />
          </div>
        </div>

        {/* Items */}
        <div>
          <div className="mb-2">
            <h2 className="text-sm font-bold text-stone-700 dark:text-stone-200">Items</h2>
          </div>

          <div className="space-y-1">
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

          <button
            onClick={addItem}
            className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-stone-300 py-2 text-xs font-semibold text-stone-500 hover:border-stone-400 hover:bg-stone-50 dark:border-white/15 dark:text-stone-400 dark:hover:bg-white/5"
          >
            <Plus size={13} /> Add Item
          </button>

          {/* Running total */}
          <div className="mt-3 flex justify-end">
            <div className="rounded-xl bg-stone-100 px-5 py-2 dark:bg-stone-800">
              <span className="text-sm text-stone-500 dark:text-stone-400">Total </span>
              <span className="text-lg font-bold text-stone-900 dark:text-white">₹{total.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {/* Cancel — intentionally small to avoid accidental taps */}
          <button
            onClick={cancel}
            className="shrink-0 rounded-lg px-3 py-2.5 text-xs font-medium text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
          >
            Cancel
          </button>

          {/* Save + Print */}
          <div className="flex flex-1 gap-2">
            <button
              onClick={save}
              className="flex-1 rounded-xl bg-shiv-green py-3 text-sm font-bold text-stone-950 hover:bg-[#c6a15a]"
            >
              {draft.isDraft ? 'Finalise Bill' : 'Save Bill'}
            </button>
            <button
              onClick={handlePrint}
              disabled={printState === 'connecting' || printState === 'printing'}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-stone-800 px-4 py-3 text-sm font-bold text-white hover:bg-stone-700 disabled:opacity-60 dark:bg-stone-700 dark:hover:bg-stone-600"
            >
              <Printer size={15} /> Print
            </button>
          </div>
        </div>

        {/* Live print preview — scaled to fit phone width */}
        <BillPreview bill={{ ...draft, total }} />

        {/* Print modal */}
        {printState !== null && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="flex min-w-[200px] flex-col items-center gap-3 rounded-2xl bg-white px-8 py-6 shadow-2xl dark:bg-stone-900">
              {(printState === 'connecting' || printState === 'printing') && (
                <>
                  <Loader2 size={32} className="animate-spin text-stone-500" />
                  <p className="text-sm font-semibold text-stone-700 dark:text-stone-200">
                    {printState === 'connecting' ? 'Connecting…' : 'Sending to printer…'}
                  </p>
                  {selectedPrinter && printState === 'printing' && (
                    <p className="text-xs text-stone-400 dark:text-stone-500 max-w-[220px] truncate text-center">{selectedPrinter}</p>
                  )}
                </>
              )}
              {typeof printState === 'object' && 'pickPrinter' in printState && (
                <div className="w-full space-y-3 text-center">
                  <Printer size={26} className="mx-auto text-stone-500" />
                  <p className="text-sm font-semibold text-stone-700 dark:text-stone-200">Choose printer</p>
                  <div className="space-y-1.5">
                    {printState.pickPrinter.map(name => (
                      <button
                        key={name}
                        onClick={() => handlePrinterPicked(name)}
                        className="w-full rounded-lg border border-stone-200 px-3 py-2.5 text-left text-xs font-medium text-stone-700 hover:bg-shiv-green/10 hover:border-shiv-green dark:border-white/10 dark:text-stone-200"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setPrintState(null)}
                    className="text-xs text-stone-400 hover:text-stone-600 dark:text-stone-500"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {printState === 'done' && (
                <>
                  <CheckCircle2 size={32} className="text-green-500" />
                  <p className="text-sm font-semibold text-stone-700 dark:text-stone-200">Printed!</p>
                </>
              )}
              {typeof printState === 'object' && 'error' in printState && (
                <>
                  <AlertCircle size={28} className="text-red-500 shrink-0" />
                  {/* "Cannot find server" → show URL configurator */}
                  {printState.error.toLowerCase().includes('cannot find') || printState.error.toLowerCase().includes('cannot reach') ? (
                    <div className="w-full space-y-3 text-center">
                      <p className="text-sm font-semibold text-stone-700 dark:text-stone-200">Print server not found</p>
                      <p className="text-xs text-stone-500 dark:text-stone-400">Enter the IP of the computer running the server:</p>
                      <input
                        type="text"
                        placeholder="e.g. 192.168.29.174"
                        value={serverUrlInput}
                        onChange={e => setServerUrlInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSaveServerUrl()}
                        className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => setPrintState(null)}
                          className="flex-1 rounded-lg bg-stone-100 px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-200 dark:bg-white/10 dark:text-stone-300"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSaveServerUrl}
                          className="flex-1 rounded-lg bg-shiv-green px-3 py-2 text-sm font-bold text-stone-950 hover:bg-[#c6a15a]"
                        >
                          Save & Print
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full space-y-3 text-center">
                      <p className="max-w-[260px] text-sm font-semibold text-stone-700 dark:text-stone-200">{printState.error}</p>
                      <button
                        onClick={() => setPrintState(null)}
                        className="rounded-lg bg-stone-100 px-5 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-200 dark:bg-white/10 dark:text-stone-200"
                      >
                        Close
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ---- LIST VIEW -----------------------------------------------------------
  const drafts   = bills.filter(b => b.isDraft)
  const finished = bills.filter(b => !b.isDraft)

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-24 pt-4 md:pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ReceiptText size={22} className="text-shiv-green" />
          <h1 className="text-xl font-bold text-stone-900 dark:text-white">Bills</h1>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-500 dark:bg-white/10 dark:text-stone-400">
            {finished.length}
          </span>
        </div>
        <button
          onClick={startNew}
          className="flex items-center gap-2 rounded-xl bg-shiv-green px-4 py-2 text-sm font-bold text-stone-950 hover:bg-[#c6a15a]"
        >
          <Plus size={16} /> New Bill
        </button>
      </div>

      {/* Drafts section */}
      {drafts.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            Drafts — {drafts.length} in progress
          </p>
          {drafts.map((bill) => (
            <BillCard
              key={bill.id}
              bill={bill}
              onEdit={() => editBill(bill)}
              onDelete={() => { if (confirm(`Discard draft #${bill.number}?`)) deleteBill(bill.id) }}
            />
          ))}
        </div>
      )}

      {/* Saved bills */}
      {finished.length === 0 && drafts.length === 0 ? (
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
      ) : finished.length > 0 ? (
        <div className="space-y-3">
          {drafts.length > 0 && (
            <p className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Saved Bills</p>
          )}
          {finished.map((bill) => (
            <BillCard
              key={bill.id}
              bill={bill}
              onEdit={() => editBill(bill)}
              onDelete={() => { if (confirm(`Delete bill #${bill.number}?`)) deleteBill(bill.id) }}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

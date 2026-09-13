import { useState, useRef, useLayoutEffect, useMemo, useEffect, createContext, useContext, Fragment } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Camera, CheckCircle2, ChevronDown, ChevronUp, IndianRupee, Lock, Minus, Paperclip, Pencil, Plus, Printer, ReceiptText, Redo2, RefreshCw, Trash2, Truck, Undo2, X } from 'lucide-react'
import { useStore } from '../../lib/store'
import { useShortcuts } from '../../lib/useShortcuts'
// The ledger's own photo picker: files chosen here, and photographs the phone
// has already sent in. One picker for the whole shop rather than a second one
// that would drift from it.
import BillDropUntyped from '../ledger/components/BillDrop'
import BillViewerUntyped from '../ledger/components/BillViewer'
import VoucherBillPreviewUntyped from '../ledger/components/VoucherBillPreview'
import { useUploader } from '../ledger/lib/upload'

/**
 * A bill as plain data, for handing to the server.
 *
 * The store's bills carry keys whose value is `undefined` — a kind never set,
 * a phone never typed — and undefined is not something that survives the wire.
 * A round trip through JSON drops them and leaves exactly the bill.
 */
const plain = (bill: unknown) => JSON.parse(JSON.stringify(bill))

/** The picker is plain JSX; this states the props it actually takes. */
const BillDrop = BillDropUntyped as unknown as (props: {
  files: File[]
  onChange: (files: File[]) => void
  picked: { _id: string; storageId: string }[]
  onPick: (picked: { _id: string; storageId: string }[]) => void
  onViewBill?: (shown: unknown) => void
}) => JSX.Element

/** The ledger's full-screen photo viewer, likewise plain JSX. */
const BillViewer = BillViewerUntyped as unknown as (props: {
  voucher: unknown
  onClose: () => void
}) => JSX.Element

/** The bill drawn from its figures, as the ledger opens it; plain JSX too. */
const VoucherBillPreview = VoucherBillPreviewUntyped as unknown as (props: {
  bill: Bill
  onClose: () => void
}) => JSX.Element
import type { Bill, BillItem, ProductCategory } from '../../lib/types'
import { CATEGORY_META, isRoundupLine, isAmountOnlyLine, BILL_KINDS } from '../../lib/types'
import type { BillKind } from '../../lib/types'
import { buildBillHtml, formatItemDescription, toProperCase, withoutCourtesy } from '../../lib/billHtml'
import { deviceId, deviceName } from '../../lib/device'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
// The day book is the ledger's table, so it uses the ledger's own styling and
// formatters rather than a second set that would drift from them.
import '../ledger/ledger.css'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import { rupees } from '../ledger/lib/format'
import { TableSkeleton } from '../ledger/components/Skeleton'
import { billSqft, isFootSized } from '../../lib/pricing'
import { Button, DropDown } from '../../components/ui'
import { toast } from '../../components/Toast'
import Confirm from '../ledger/components/Confirm'

/**
 * Square-foot pricing for boards and doors is parked, not removed.
 *
 * With this off, every row bills the simple way: quantity x rate, with the size
 * typed into the item name ("19mm S 8 X 4"). The area maths — calcCost, the
 * height/width pickers, the per-sq-ft rate — is all still here and switches back
 * on with this one flag when the rate cards are ready.
 */
const AREA_PRICING = false

/**
 * Arrow-key movement across the whole bill, Tally-style: Down goes to the next
 * field, Up to the previous, walking customer details and every item row in
 * screen order. Fields opt in with data-bill-nav so a stray input can't trap
 * the cursor, and the item search opts out while its dropdown is open — there
 * the arrows belong to the list.
 */
/**
 * Up/Down move within a column, not along the DOM.
 *
 * The fields are laid out as a grid, so Up from an Amount should land on the
 * Amount above it — walking the DOM order instead sends you sideways into the
 * unit, which reads as the cursor jumping about. Falls back to plain field
 * order at the edges, so you can still leave the grid.
 */
function moveBillRow(dir: 1 | -1) {
  const el = document.activeElement as HTMLElement | null
  const col = el?.getAttribute('data-bill-col')
  const row = Number(el?.getAttribute('data-bill-row') ?? NaN)
  if (!col || Number.isNaN(row)) { moveBillFocus(dir); return }

  const target = document.querySelector<HTMLElement>(
    `[data-bill-row="${row + dir}"][data-bill-col="${col}"]`,
  )
  if (!target) { moveBillFocus(dir); return }
  target.focus()
  if (target instanceof HTMLInputElement) target.select?.()
}

/**
 * Terminal-style recall: the last few values typed into each column.
 *
 * Kept per column rather than per box, because the useful history of an Amount
 * is every amount recently typed, not the ones typed on this row. It lives for
 * the life of the page — long enough to finish a bill, gone by the next one, so
 * nothing is stored about what the shop sells.
 */
const HISTORY_CAP = 20
const fieldHistory = new Map<string, string[]>()
/** How far back each box has walked, so a second Up goes further rather than nowhere. */
const recallAt = new WeakMap<HTMLElement, number>()

const historyKeyOf = (el: HTMLElement) =>
  el.getAttribute('data-bill-hist') ?? el.getAttribute('data-bill-col')

function rememberField(key: string, value: string) {
  const past = fieldHistory.get(key) ?? []
  fieldHistory.set(key, [value, ...past.filter((v) => v !== value)].slice(0, HISTORY_CAP))
}

/**
 * Write through the input's own setter so React's onChange fires and the row's
 * state moves with the box, rather than only the box.
 */
function setFieldValue(input: HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(input) as object
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/**
 * Up walks back through what was typed in this column, Down walks forward out
 * of it. Offered on an empty box only — exactly where a terminal offers it —
 * so Up keeps moving between rows whenever there is something in the box to
 * move away from.
 *
 * Returns true when the key was spent on history rather than movement.
 */
function recallHistory(el: HTMLInputElement, older: boolean): boolean {
  const key = historyKeyOf(el)
  if (!key) return false
  const past = fieldHistory.get(key) ?? []
  if (!past.length) return false

  const walked = recallAt.get(el)
  if (walked === undefined) {
    if (!older || el.value !== '') return false
    recallAt.set(el, 0)
    setFieldValue(el, past[0])
    el.select()
    return true
  }

  const next = walked + (older ? 1 : -1)
  // Past the newest is the empty box the walk started from.
  if (next < 0) {
    recallAt.delete(el)
    setFieldValue(el, '')
    return true
  }
  // At the oldest it stops rather than wrapping, so the end is findable.
  if (next >= past.length) return true
  recallAt.set(el, next)
  setFieldValue(el, past[next])
  el.select()
  return true
}

function billArrowKeys(e: React.KeyboardEvent) {
  // Typing anything else ends the walk: what is in the box is now the
  // operator's, not a row lifted out of history.
  if (e.target instanceof HTMLInputElement
      && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
    recallAt.delete(e.target)
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    moveBillFocus(1)
    return
  }
  /**
   * Backspace on an empty field steps back a box, and Esc empties the box you
   * are in — Tally's two ways out of a field you landed on by mistake. Once
   * there is something typed, Backspace is the ordinary delete key again: it
   * has to erase the figure before it will walk off the field.
   */
  if (e.key === 'Backspace' || e.key === 'Escape') {
    const el = e.target as HTMLElement
    const input = el instanceof HTMLInputElement ? el : null
    if (e.key === 'Escape') {
      if (!input || input.value === '') return
      e.preventDefault()
      // Written through the input's own setter so React's onChange fires and
      // the row's state clears with the box, rather than only the box.
      const proto = Object.getPrototypeOf(input) as object
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return
    }
    if (!input || input.value !== '') return
    e.preventDefault()
    moveBillFocus(-1)
    return
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    // Number inputs treat Up/Down as increment — take the key before they do.
    e.preventDefault()
    if (e.target instanceof HTMLInputElement
        && recallHistory(e.target, e.key === 'ArrowUp')) return
    moveBillRow(e.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const el = e.target as HTMLElement
    // In a text field the arrows are for the caret; only hand them to the row
    // once the caret is already at that end, which is how a grid should feel.
    if (el instanceof HTMLInputElement && el.type !== 'number') {
      const at = el.selectionStart ?? 0
      const end = el.value.length
      const spans = (el.selectionEnd ?? 0) !== at
      if (spans) return
      if (e.key === 'ArrowLeft' && at > 0) return
      if (e.key === 'ArrowRight' && at < end) return
    }
    e.preventDefault()
    moveBillFocus(e.key === 'ArrowRight' ? 1 : -1)
  }
}

function moveBillFocus(dir: 1 | -1) {
  const fields = Array.from(document.querySelectorAll<HTMLElement>('[data-bill-nav]'))
    .filter((el) => el.offsetParent !== null)   // skip anything hidden
  if (!fields.length) return
  const i = fields.indexOf(document.activeElement as HTMLElement)
  const next = fields[i === -1 ? 0 : Math.min(fields.length - 1, Math.max(0, i + dir))]
  next?.focus()
  if (next instanceof HTMLInputElement) next.select?.()
}

const uid = () => Math.random().toString(36).slice(2, 10)
const today = () => new Date().toISOString().slice(0, 10)

/** The financial year a date falls in, written the way Tally's title bar does. */
function fyLabel(date: string): string {
  const d = new Date(date || today())
  const start = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

/** A balance the way the books state it: "90,293.48 Dr". */
const balanceText = (amount: number, side: string) =>
  `${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${side}`


// --- Smart catalog item helpers -------------------------------------------

interface ProductOption { category: ProductCategory; label: string; keywords: string[] }
/**
 * The bill screen has no built-in product list any more — every line is either
 * a My Items entry or typed in fresh. The type still exists for quotations and
 * guarantee cards, which price by category.
 */
const PRODUCT_OPTIONS: ProductOption[] = []

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
  /** Enter on the last field of the row: open the next line, adding one if needed. */
  onRowDone: (idx: number) => void
  /** Enter on an untouched row: discard it and finish entering lines. */
  onBlankRowDone: (id: string) => void
  disabled?: boolean
}

function SmartItemRow({ item, idx, onUpdate, onRemove, onRowDone, onBlankRowDone, disabled }: SmartItemRowProps) {
  const { sets, hardwareCatalog, setHardwareCatalog, customCatalog, addCustomEntry, updateCustomEntry, units, addUnit } = useStore()

  /** Stored units plus an "add" row, so the list only holds what the shop uses. */
  const unitOptions = useMemo(
    () => [...units.map(u => ({ value: u, label: u })), { value: '__add__', label: '+ Add unit…' }],
    [units],
  )
  /** Returns the canonical unit to store — a new one is remembered. */
  function pickUnit(v: string): string | null {
    if (!v || v === '__add__') return null
    const typed = v.trim()
    const saved = units.find((u) => u.toLowerCase() === typed.toLowerCase())
    if (saved) return saved
    addUnit(typed)
    return typed
  }

  /**
   * A unit belongs to both this bill line and its catalogue item. Reopening the
   * item therefore starts with the unit the counter actually uses for it.
   */
  function handleUnitPick(v: string) {
    const unit = pickUnit(v)
    if (!unit) return
    onUpdate(item.id, { unit })
    if (item.customEntryId) {
      updateCustomEntry(item.customEntryId, { unit })
    } else if (item.category && HARDWARE_CATS.includes(item.category)) {
      const current = hardwareCatalog[item.category] ?? { sizes: [], brands: [] }
      setHardwareCatalog({ ...hardwareCatalog, [item.category]: { ...current, unit } })
    }
  }
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

  /**
   * The dropdown's rows flattened in the order they render, so the keyboard can
   * walk products and My Items as one list — Tally-style: arrows move, Enter
   * takes the highlighted row.
   */
  /** An existing My Items entry with the same name as what's typed. */
  const duplicateEntry = useMemo(() => {
    const q = formatItemDescription(search.trim()).toLowerCase()
    if (!q) return undefined
    return customCatalog.find(e => formatItemDescription(e.name ?? '').toLowerCase() === q)
  }, [search, customCatalog])

  const navOptions = useMemo(() => [
    ...filtered.map(opt => ({ kind: 'category' as const, opt })),
    ...customFiltered.map(entry => ({ kind: 'custom' as const, entry })),
    // "Add <typed text>" is a row like any other, so Enter can reach it. Without
    // this, typing "19mm B" when "19mm Block Board" exists could never create
    // the shorter name — Enter always took the match.
    ...(search.trim() && !duplicateEntry ? [{ kind: 'add' as const }] : []),
    // Always offered, so an adjustment or a charge is one pick away.
    { kind: 'roundup' as const },
    { kind: 'fare' as const },
  ], [filtered, customFiltered, search, duplicateEntry])

  /** A fare, cartage or labour charge: a figure with a label, nothing else. */
  function pickFare() {
    onUpdate(item.id, {
      description: 'Fare',
      amountOnly: true,
      isRoundup: undefined,
      isDiscount: undefined,
      category: undefined,
      customEntryId: undefined,
      brandName: undefined,
      sizeIn: undefined,
      qty: 1,
      rateSqft: undefined,
      amount: 0,
    })
    setSearch('Fare')
    setShowDrop(false)
    requestAnimationFrame(() => moveBillFocus(1))
  }

  /** Turn this line into a round-off and send the cursor to the amount. */
  function pickRoundup() {
    onUpdate(item.id, {
      description: 'Roundup',
      isRoundup: true,
      isDiscount: undefined,
      amountOnly: undefined,
      category: undefined,
      customEntryId: undefined,
      brandName: undefined,
      sizeIn: undefined,
      qty: 1,
      rateSqft: undefined,
      amount: 0,
    })
    setSearch('Roundup')
    setShowDrop(false)
    requestAnimationFrame(() => moveBillFocus(1))
  }

  const [highlight, setHighlight] = useState(0)
  // Any change to the query puts the highlight back on the first row.
  useEffect(() => { setHighlight(0) }, [search, navOptions.length])

  const setPanelList = useContext(ListPanelContext)

  // Mirror the open list into the right-hand panel, Tally-style. Cleared on
  // close so the panel never shows a stale list from a field you have left.
  useEffect(() => {
    if (!showDrop || !navOptions.length || !search.trim()) return
    setPanelList({
      title: 'List of Items',
      highlight,
      rows: navOptions.map((o) =>
        o.kind === 'category' ? { value: `c:${o.opt.category}`, label: o.opt.label }
        : o.kind === 'custom' ? { value: `e:${o.entry.id}`, label: formatItemDescription(o.entry.name), hint: o.entry.rate ? `Rs ${o.entry.rate}` : undefined }
        : o.kind === 'roundup' ? { value: 'roundup', label: 'Roundup (minus)' }
        : o.kind === 'fare' ? { value: 'fare', label: 'Fare / cartage' }
        : { value: 'add', label: `Create "${search.trim()}"` },
      ),
      onPick: (v) => {
        if (v === 'roundup') { pickRoundup(); return }
        if (v === 'fare') { pickFare(); return }
        if (v === 'add') { addItemFromSearch(); return }
        if (v.startsWith('c:')) {
          const opt = filtered.find(o => o.category === v.slice(2))
          if (opt) selectCategory(opt)
          return
        }
        const entry = customFiltered.find(e => e.id === v.slice(2))
        if (entry) selectCustomEntry(entry)
      },
    })
    return () => setPanelList(null)
  })

  const dropRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showDrop) return
    dropRef.current?.querySelector('[data-hl="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [highlight, showDrop])

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
        unit: hardwareCatalog[opt.category]?.unit ?? HARDWARE_DEFAULT_UNIT[opt.category] ?? 'Pc',
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
  function selectCustomEntry(entry: { id: string; name: string; sizes: string[]; brands: string[]; rate?: number; unit?: string }) {
    const same = item.customEntryId === entry.id
    const name = formatItemDescription(entry.name)
    setSearch(name)
    setShowDrop(false)
    onUpdate(item.id, {
      customEntryId: entry.id,
      category: undefined,
      description: name,
      sizeIn:    entry.sizes[0] ?? undefined,
      brandName: entry.brands[0] ?? undefined,
      // Re-picking the item this line already holds must not disturb what's on
      // it — passing back through the field is navigation, not a fresh choice.
      rateSqft:  same ? item.rateSqft : (entry.rate ?? undefined),
      amount:    same ? item.amount : (entry.rate ? Math.round(entry.rate * item.qty) : 0),
      heightIn:  undefined,
      widthIn:   undefined,
      unit: same ? item.unit : (entry.unit || 'Pc'),
    })
  }

  /**
   * Enter on a typed-out name: save it to My Items and use it straight away,
   * skipping the add form. Rate, sizes and brands can be filled in on the row
   * afterwards — at the counter the point is to keep billing, not to stop and
   * fill a form for every new item.
   */
  function addItemFromSearch() {
    const name = formatItemDescription(search.trim())
    if (!name) return
    // Already in My Items — pick it rather than creating a duplicate.
    if (duplicateEntry) { selectCustomEntry(duplicateEntry); return }
    const newId = addCustomEntry(name)
    selectCustomEntry({ id: newId, name, sizes: [], brands: [] })
    addingNewRef.current = false
    setShowDrop(false)
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
    const entry = customCatalog.find(e => e.id === entryId)
    // Keep the figure at the front and drop any earlier copy of it, so the list
    // reads newest-first without repeats. Capped so it stays scannable.
    const rates = [rate, ...(entry?.rates ?? []).filter(r => r !== rate)].slice(0, 8)
    updateCustomEntry(entryId, { rate, rates })
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
  // A fare, cartage or roundup line is a figure and nothing else. None of the
  // catalog controls apply to it, whichever list the line was picked from —
  // picking "Fare" out of the item list must not bring qty, unit and rate back.
  const amountOnly = isRoundupLine(item) || isAmountOnlyLine(item)

  return (
    <div className="bg-white px-2 py-1.5 dark:bg-stone-900">
      <div className="flex items-start gap-2">
        <span className="mt-2 w-5 shrink-0 text-center text-xs font-bold text-muted">{idx + 1}</span>
        <div className="flex-1 min-w-0 space-y-2">

          {/* Description / product search */}
          {/* Wraps on a phone, stays on one line from md up — a laptop has
              the width, and a bill reads as a ledger only if each item is
              one line. */}
          <div className="flex flex-wrap items-start gap-2 md:flex-nowrap">
            <div className="relative flex-1 min-w-[140px]">
              <input
                type="text"
                placeholder="Type or pick an item…"
                value={isCatalog ? search : item.description}
                onMouseDown={() => {
                  // Strict: the list only ever appears once there is something
                  // to match. An empty field shows nothing, clicked or not.
                  if (search.trim()) setShowDrop(true)
                }}
                onFocus={(e) => {
                  // No list on arrival — it opens once there's something to
                  // match, so Enter can simply carry on to the next box.
                  if (isCatalog) e.target.select()
                }}
                onChange={(e) => {
                  const el = e.target
                  // Proper case is case-only, so it never disturbs the caret.
                  // The 8x4 -> 8 X 4 spacing changes length, so only apply it
                  // while typing at the end; mid-edit it would jump the cursor.
                  const atEnd = el.selectionStart === el.value.length
                  const v = atEnd ? formatItemDescription(el.value) : toProperCase(el.value)
                  if (atEnd && v !== el.value) {
                    requestAnimationFrame(() => el.setSelectionRange(v.length, v.length))
                  }
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
                  setShowDrop(!!v.trim())
                }}
                data-bill-item-desc="1"
                data-bill-nav="1"
                data-bill-row={idx}
                data-bill-col="desc"
                onKeyDown={(e) => {
                  if (addingNew) return
                  if (e.key === 'Backspace' && isCatalog) {
                    // A committed pick is one value, not text — clear it whole
                    // rather than nibbling characters off the end.
                    e.preventDefault()
                    clearCategory()
                    setShowDrop(true)
                    return
                  }
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    // Dropdown closed → the arrows belong to the bill, not the list.
                    if (!showDrop || !navOptions.length) {
                      e.preventDefault()
                      moveBillFocus(e.key === 'ArrowDown' ? 1 : -1)
                      return
                    }
                    e.preventDefault()
                    setShowDrop(true)
                    setHighlight(h => e.key === 'ArrowDown'
                      ? Math.min(h + 1, navOptions.length - 1)
                      : Math.max(h - 1, 0))
                    return
                  }
                  if (e.key === 'Escape') { setShowDrop(false); return }
                  if ((e.key === 'Home' || e.key === 'End') && showDrop && navOptions.length) {
                    // Tally: Home/End go to the first/last line of a list.
                    e.preventDefault()
                    setHighlight(e.key === 'Home' ? 0 : navOptions.length - 1)
                    return
                  }
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  // A blank stock-item field is Tally's signal that item entry
                  // is over. Do not create a made-up line or make the operator
                  // erase it manually before finishing the bill.
                  if (!search.trim() && !isCatalog) {
                    onBlankRowDone(item.id)
                    return
                  }
                  const pick = showDrop ? navOptions[highlight] : undefined
                  if (pick) {
                    // Take the highlighted row — first result unless arrowed away.
                    if (pick.kind === 'category') selectCategory(pick.opt)
                    else if (pick.kind === 'custom') selectCustomEntry(pick.entry)
                    else if (pick.kind === 'roundup') { pickRoundup(); return }
                    else if (pick.kind === 'fare') { pickFare(); return }
                    else addItemFromSearch()
                    // Let the dropdown close, then carry on to quantity.
                    requestAnimationFrame(() => moveBillFocus(1))
                    return
                  }
                  // Nothing matched: save what was typed as a new item and use it.
                  if (!search.trim()) return
                  addItemFromSearch()
                  requestAnimationFrame(() => moveBillFocus(1))
                }}
                onBlur={() => {
                  setTimeout(() => { if (!addingNewRef.current) setShowDrop(false) }, 150)
                }}
                className={`w-full rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm dark:border-white/10 dark:text-white ${
                  isCatalog
                    ? 'bg-stone-100 cursor-pointer dark:bg-stone-700'
                    : 'bg-stone-50 dark:bg-stone-800'
                }`}
              />
              {showDrop && (filtered.length > 0 || customFiltered.length > 0 || search.trim()) && (
                <div ref={dropRef} className="absolute top-full left-0 right-0 z-20 mt-0.5 max-h-72 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-xl dark:border-white/10 dark:bg-stone-800">

                  {/* ── Standard product options ── */}
                  {filtered.length > 0 && (
                    <div>
                      {filtered.map((opt, i) => (
                        <button
                          key={opt.category}
                          data-hl={highlight === i ? '1' : undefined}
                          onMouseDown={() => selectCategory(opt)}
                          onMouseEnter={() => setHighlight(i)}
                          className={`flex w-full min-w-0 items-center truncate px-3 py-2 text-left text-sm text-stone-700 dark:text-stone-200 ${highlight === i ? 'bg-stone-100 dark:bg-white/10' : ''}`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* ── Custom catalog entries ── */}
                  {customFiltered.length > 0 && (
                    <div className={filtered.length > 0 ? 'border-t border-stone-100 dark:border-white/5' : ''}>
                      {customFiltered.map((entry, ci) => (
                        <button
                          key={entry.id}
                          data-hl={highlight === filtered.length + ci ? '1' : undefined}
                          onMouseDown={() => selectCustomEntry(entry)}
                          onMouseEnter={() => setHighlight(filtered.length + ci)}
                          className={`flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-sm text-stone-700 dark:text-stone-200 ${highlight === filtered.length + ci ? 'bg-stone-100 dark:bg-white/10' : ''}`}
                        >
                          <span className="flex-1 truncate">{formatItemDescription(entry.name)}</span>
                          {entry.rate ? <span className="text-xs text-muted">₹{entry.rate}</span> : null}
                        </button>
                      ))}
                    </div>
                  )}

                  <button
                    onMouseDown={(e) => { e.preventDefault(); pickRoundup() }}
                    onMouseEnter={() => setHighlight(navOptions.length - 2)}
                    className={`flex w-full min-w-0 items-center gap-2 border-t border-stone-100 px-3 py-2 text-sm font-medium text-danger dark:border-white/5 ${
                      highlight === navOptions.length - 2 ? 'bg-stone-100 dark:bg-white/10' : ''
                    }`}
                  >
                    <Minus size={13} className="shrink-0" />
                    <span className="truncate">Roundup (minus)</span>
                  </button>

                  <button
                    onMouseDown={(e) => { e.preventDefault(); pickFare() }}
                    onMouseEnter={() => setHighlight(navOptions.length - 1)}
                    className={`flex w-full min-w-0 items-center gap-2 border-t border-stone-100 px-3 py-2 text-sm font-medium text-stone-600 dark:border-white/5 dark:text-stone-300 ${
                      highlight === navOptions.length - 1 ? 'bg-stone-100 dark:bg-white/10' : ''
                    }`}
                  >
                    <Truck size={13} className="shrink-0" />
                    <span className="truncate">Fare / cartage</span>
                  </button>

                  {/* ── Add new / inline form ── */}
                  <div className="border-t border-stone-100 dark:border-white/5">
                    {!addingNew ? (
                      search.trim() && !duplicateEntry ? (
                        <button
                          onMouseDown={(e) => {
                            e.preventDefault()
                            addingNewRef.current = true
                            setNewName(search.trim())
                            setNewRate(0)
                            setAddingNew(true)
                          }}
                          data-hl={highlight === navOptions.length - 1 ? '1' : undefined}
                          onMouseEnter={() => setHighlight(navOptions.length - 1)}
                          className={`flex w-full min-w-0 items-center gap-2 px-3 py-2 text-sm font-medium text-shiv-green ${
                            highlight === navOptions.length - 1 ? 'bg-stone-100 dark:bg-white/10' : ''
                          }`}
                        >
                          <Plus size={13} className="shrink-0" />
                          <span className="truncate">Add "{search.trim()}" to My Items</span>
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
                          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted hover:bg-stone-50 dark:hover:bg-white/5"
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
                        <div className="text-xs font-semibold text-muted">Add to My Items</div>

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
                            <IndianRupee size={11} className="absolute left-2 top-2.5 text-muted" />
                            <input
                              type="number"
                              min={0}
                              value={newRate || ''}
                              onChange={(e) => setNewRate(Number(e.target.value))}
                              placeholder="Rate" data-bill-nav="1" data-bill-row={idx} data-bill-col="rate" onKeyDown={billArrowKeys}
                              className="w-full rounded-lg border border-stone-200 bg-stone-50 py-1.5 pl-6 pr-1.5 text-sm dark:border-white/10 dark:bg-stone-700 dark:text-white"
                            />
                          </div>
                        </div>

                        {/* More options toggle */}
                        <button
                          type="button"
                          onClick={() => setShowMoreOpts(v => !v)}
                          className="flex items-center gap-1 text-xs text-muted hover:text-stone-600 dark:hover:text-stone-300"
                        >
                          {showMoreOpts ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          {showMoreOpts ? 'Less options' : 'Add sizes / brands'}
                        </button>

                        {showMoreOpts && (
                          <div className="space-y-2 rounded-lg bg-stone-50 p-2 dark:bg-white/5">
                            {/* Sizes tag input */}
                            <div>
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Sizes</div>
                              <div className="flex flex-wrap gap-1 mb-1">
                                {newItemSizes.map(s => (
                                  <span key={s} className="flex items-center gap-0.5 rounded-full bg-stone-200 px-2 py-0.5 text-xs dark:bg-white/10">
                                    {s}
                                    <button type="button" onClick={() => setNewItemSizes(p => p.filter(x => x !== s))} className="text-muted hover:text-danger ml-0.5"><X size={10} /></button>
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
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Brands</div>
                              <div className="flex flex-wrap gap-1 mb-1">
                                {newItemBrands.map(b => (
                                  <span key={b} className="flex items-center gap-0.5 rounded-full bg-stone-200 px-2 py-0.5 text-xs dark:bg-white/10">
                                    {b}
                                    <button type="button" onClick={() => setNewItemBrands(p => p.filter(x => x !== b))} className="text-muted hover:text-danger ml-0.5"><X size={10} /></button>
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
                            className="rounded-lg px-3 py-1.5 text-xs text-muted hover:bg-stone-100 dark:hover:bg-white/10"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => {
                              const name = formatItemDescription(newName.trim())
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
            {AREA_PRICING && isCatalog && !isHardware && !isCustomEntry && brandsForCat.length > 0 && (
              <DropDown
                className="w-28 shrink-0"
                value={item.brandName ?? ''}
                onChange={handleBrandChange}
                options={brandsForCat.map(b => ({ value: b.name, label: b.name }))}
              />
            )}
            {/* Custom entry: size dropdown */}
            {isCustomEntry && !amountOnly && (selectedCustomEntry?.sizes.length ?? 0) > 0 && (
              <DropDown
                className="w-20 shrink-0"
                value={item.sizeIn ?? selectedCustomEntry!.sizes[0] ?? ''}
                onChange={handleCustomSizeIn}
                options={selectedCustomEntry!.sizes}
              />
            )}
            {/* Custom entry: brand dropdown */}
            {isCustomEntry && !amountOnly && (selectedCustomEntry?.brands.length ?? 0) > 0 && (
              <DropDown
                className="w-24 shrink-0"
                value={item.brandName ?? selectedCustomEntry!.brands[0] ?? ''}
                onChange={handleCustomBrand}
                options={selectedCustomEntry!.brands}
              />
            )}

              {/* Free-text: qty · unit · amount — only show after description is entered */}
              {/* A deduction is a figure, not a quantity of something — showing
                  qty, unit and rate on it invites nonsense like "1 Pc @ -456". */}
              {amountOnly && !!item.description.trim() && (
                <div className="relative w-24 shrink-0">
                  <IndianRupee size={11} className="absolute left-2 top-2.5 text-muted" />
                  <input
                    type="number"
                    placeholder="Amt"
                    data-bill-nav="1"
                    data-bill-row={idx}
                    data-bill-col="amt"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); onRowDone(idx); return }
                      billArrowKeys(e)
                    }}
                    value={item.amount || ''}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => onUpdate(item.id, { amount: Number(e.target.value) })}
                    className={`w-full rounded-lg border border-stone-200 py-1.5 pl-6 pr-1.5 text-sm font-bold dark:border-white/10 ${isRoundupLine(item) ? "bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-300" : "bg-shiv-green/10 dark:bg-shiv-green/15 dark:text-white"}`}
                  />
                </div>
              )}

              {!amountOnly && (!isCatalog || (!AREA_PRICING && !isCustomEntry)) && !!item.description.trim() && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    min={0}
                    placeholder="Qty" data-bill-nav="1" data-bill-row={idx} data-bill-col="qty" onKeyDown={billArrowKeys}
                    value={item.qty || ''}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => onUpdate(item.id, { qty: Number(e.target.value) })}
                    className="w-12 shrink-0 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                  />
                  <UnitField
                    value={item.unit}
                    options={unitOptions}
                    onPick={handleUnitPick}
                    onNavKey={billArrowKeys}
                    onCommit={() => moveBillFocus(1)}
                  />
                  <div className="relative ml-auto w-24 shrink-0">
                    <IndianRupee size={11} className="absolute left-2 top-2.5 text-muted" />
                    <input
                      type="number"
                      placeholder="Amt" data-bill-row={idx} data-bill-col="amt"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); onRowDone(idx); return }
                      billArrowKeys(e)
                    }}
                      value={item.amount || ''}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => onUpdate(item.id, { amount: Number(e.target.value) })}
                      className="w-full rounded-lg border border-stone-200 bg-stone-50 py-1.5 pl-6 pr-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                    />
                  </div>
                </div>
              )}
              {/* qty · unit · amount · rate — the total is read before its rate. */}
              {isCustomEntry && !amountOnly && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number" min={1} placeholder="Qty" data-bill-nav="1" data-bill-row={idx} data-bill-col="qty" onKeyDown={billArrowKeys}
                    value={item.qty || ''}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => {
                      const q = Number(e.target.value)
                      // Only re-derive the amount when there's a rate to derive
                      // it from. A line priced by typing the total has no rate,
                      // and recalculating would wipe the figure that was typed.
                      onUpdate(item.id, {
                        qty: q,
                        ...(item.rateSqft ? { amount: Math.round(item.rateSqft * q) } : {}),
                      })
                    }}
                    className="w-12 shrink-0 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                  />
                  <UnitField
                    value={item.unit}
                    options={unitOptions}
                    onPick={handleUnitPick}
                    onNavKey={billArrowKeys}
                    onCommit={() => moveBillFocus(1)}
                  />
                  <div className="relative w-24 shrink-0">
                    <IndianRupee size={11} className="absolute left-2 top-2.5 text-muted" />
                    <input
                      type="number"
                      placeholder="Amt"
                      data-bill-row={idx} data-bill-col="amt"
                      data-bill-nav="1"
                      onKeyDown={billArrowKeys}
                      value={item.amount || ''}
                      onFocus={(e) => e.target.select()}
                      /* Typing a total works backwards to the rate, so a haggled
                         price can be entered as the figure actually agreed. */
                      onChange={(e) => {
                        const amount = Number(e.target.value)
                        const qty = item.qty || 1
                        onUpdate(item.id, { amount, rateSqft: qty ? Math.round((amount / qty) * 100) / 100 : amount })
                      }}
                      className={`w-full rounded-lg border border-stone-200 py-1.5 pl-6 pr-1.5 text-sm font-bold dark:border-white/10 ${(item.amount || 0) < 0 ? "bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-300" : "bg-shiv-green/10 dark:bg-shiv-green/15 dark:text-white"}`}
                    />
                  </div>
                  <div className="relative ml-auto shrink-0 w-[4.5rem]">
                    <IndianRupee size={11} className="absolute left-2 top-2.5 text-muted" />
                    <input
                      ref={amountRef}
                      type="number" placeholder="Rate" data-bill-nav="1" data-bill-row={idx} data-bill-col="rate"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); onRowDone(idx); return }
                        billArrowKeys(e)
                      }}
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
                </div>
              )}
              {/* Board/door: size · qty · cost — single line. Boards pick feet, others inches. */}
              {AREA_PRICING && isCatalog && !isHardware && !isCustomEntry && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <DropDown
                    className="w-16 shrink-0"
                    value={String(item.heightIn ?? '')}
                    onChange={(v) => handleDim('heightIn', Number(v))}
                    options={(isFootSized(item.category) ? BOARD_HEIGHT_FT : HEIGHT_OPTIONS).map(h => ({ value: String(h), label: isFootSized(item.category) ? `${h} ft` : `${h}"` }))}
                  />
                  <span className="text-xs text-muted"><X size={16} aria-hidden="true" /></span>
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
                  <span className="text-xs text-muted">Pc</span>
                  <div className="relative shrink-0 w-24">
                    <IndianRupee size={11} className="absolute left-2 top-2.5 text-muted" />
                    <input
                      type="number"
                      placeholder="Amt"
                      data-bill-row={idx} data-bill-col="amt"
                      data-bill-nav="1"
                      onKeyDown={billArrowKeys}
                      value={item.amount || ''}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const amount = Number(e.target.value)
                        const qty = item.qty || 1
                        onUpdate(item.id, { amount, rateSqft: qty ? Math.round((amount / qty) * 100) / 100 : amount })
                      }}
                      className={`w-full rounded-lg border border-stone-200 py-1.5 pl-6 pr-1.5 text-sm font-bold dark:border-white/10 ${(item.amount || 0) < 0 ? "bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-300" : "bg-shiv-green/10 dark:bg-shiv-green/15 dark:text-white"}`}
                    />
                  </div>
                  <div className="relative ml-auto shrink-0 w-[4.75rem]">
                    <IndianRupee size={11} className="absolute left-2 top-2.5 text-muted" />
                    <input
                      type="number" placeholder="Rate" data-bill-nav="1" data-bill-row={idx} data-bill-col="rate"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); onRowDone(idx); return }
                        billArrowKeys(e)
                      }}
                      value={item.rateSqft || ''}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => handleRate(Number(e.target.value))}
                      className="w-full rounded-lg border border-stone-200 bg-stone-50 py-1.5 pl-6 pr-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                      title="Rate per sqft"
                    />
                  </div>
                </div>
              )}
          </div>


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
                          : 'border-stone-200 bg-stone-50 text-muted dark:border-white/10 dark:bg-stone-800 dark:text-stone-300'
                      }`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {/* qty · unit · amount · rate */}
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} placeholder="Qty" data-bill-nav="1" data-bill-row={idx} data-bill-col="qty" onKeyDown={billArrowKeys}
                  value={item.qty || ''}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const q = Number(e.target.value)
                    onUpdate(item.id, {
                      qty: q,
                      ...(item.rateSqft ? { amount: Math.round(item.rateSqft * q) } : {}),
                    })
                  }}
                  className="w-12 shrink-0 rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                />
                <UnitField
                    value={item.unit}
                    options={unitOptions}
                    onPick={handleUnitPick}
                    onNavKey={billArrowKeys}
                    onCommit={() => moveBillFocus(1)}
                  />
                <div className="relative w-24 shrink-0">
                                  <IndianRupee size={11} className="absolute left-2 top-2.5 text-muted" />
                                  <input
                                    type="number"
                                    placeholder="Amt"
                                    data-bill-row={idx} data-bill-col="amt"
                                    data-bill-nav="1"
                                    onKeyDown={billArrowKeys}
                                    value={item.amount || ''}
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) => {
                                      const amount = Number(e.target.value)
                                      const qty = item.qty || 1
                                      onUpdate(item.id, { amount, rateSqft: qty ? Math.round((amount / qty) * 100) / 100 : amount })
                                    }}
                                    className={`w-full rounded-lg border border-stone-200 py-1.5 pl-6 pr-1.5 text-sm font-bold dark:border-white/10 ${(item.amount || 0) < 0 ? "bg-red-500/10 text-red-600 dark:bg-red-500/15 dark:text-red-300" : "bg-shiv-green/10 dark:bg-shiv-green/15 dark:text-white"}`}
                                  />
                                </div>
                <div className="relative ml-auto shrink-0 w-[4.5rem]">
                  <IndianRupee size={11} className="absolute left-2 top-2.5 text-muted" />
                  <input
                    ref={amountRef}
                    type="number" placeholder="Rate" data-bill-nav="1" data-bill-row={idx} data-bill-col="rate"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); onRowDone(idx); return }
                      billArrowKeys(e)
                    }}
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
              </div>
            </div>
          )}

          {/* Custom entry: existing fields · sub-option chips · qty/rate */}
          {isCustomEntry && !amountOnly && (
            <div className="space-y-1.5">

              {/* Existing custom fields (Color, Width, etc.) — each as a dropdown */}
              {(selectedCustomEntry?.fields?.filter(f => f.values.length > 0) ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedCustomEntry!.fields!.filter(f => f.values.length > 0).map(f => (
                    <div key={f.id} className="flex items-center gap-0.5">
                      {addToField === f.label ? (
                        // Inline input to add a new value to this field
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted">{f.label}:</span>
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
                          <button onClick={() => { setAddToField(null); setAddToFieldVal('') }} className="text-muted hover:text-red-400"><X size={12} /></button>
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

            </div>
          )}

        </div>

        <button
          onClick={() => onRemove(item.id)}
          disabled={disabled}
          className="mt-1 rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-danger disabled:opacity-30 dark:hover:bg-red-900/30"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  )
}

/**
 * Tally shows the options for the active field in the right-hand panel — "List
 * of Stock Items", "List of Units" — rather than in a dropdown under the box.
 * The focused field publishes its list here and the panel renders it, so there
 * is one list on screen at a time and it always sits in the same place.
 */
type PanelRow = { value: string; label: string; hint?: string }
type PanelList = { title: string; rows: PanelRow[]; highlight: number; onPick: (v: string) => void }

const ListPanelContext = createContext<(l: PanelList | null) => void>(() => {})

function TallyListPanel({ list }: { list: PanelList | null }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('[data-hl="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [list?.highlight, list?.rows.length])

  return (
    <aside className="no-print fixed right-0 top-0 z-30 hidden h-screen w-80 flex-col border-l border-stone-300 bg-stone-50 dark:border-white/15 dark:bg-stone-900 lg:flex xl:w-96">
      <div className="border-b border-stone-300 bg-stone-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted dark:border-white/15 dark:bg-white/5">
        {list?.title ?? 'List'}
      </div>
      <div ref={ref} className="flex-1 overflow-y-auto py-1">
        {list?.rows.length
          ? list.rows.map((r, i) => (
              <button
                key={r.value + i}
                type="button"
                data-hl={i === list.highlight ? '1' : undefined}
                onMouseDown={(e) => { e.preventDefault(); list.onPick(r.value) }}
                className={`block w-full px-3 py-1.5 text-left text-sm ${
                  i === list.highlight
                    ? 'bg-shiv-green/20 font-semibold text-stone-900 dark:text-white'
                    : 'text-stone-600 dark:text-stone-300'
                }`}
              >
                {/* The name, whole, and nothing beside it. A phone number in
                    the same row was eating the half of the name that tells two
                    Vishal Prasad Jees apart, which is the only thing anyone is
                    reading this list for. It wraps rather than truncates. */}
                <span className="break-words leading-snug">{r.label}</span>
              </button>
            ))
          : <div className="px-3 py-2 text-xs text-muted">No list on this field</div>}
      </div>
    </aside>
  )
}

/**
 * The unit picker for a bill line. It publishes its options to the right-hand
 * panel instead of opening a box under the field, so every list on this screen
 * appears in the same place. Deliberately local to the bill: the shared DropDown
 * is used across the panel and shouldn't take on this behaviour everywhere.
 */
function UnitField({ value, options, onPick, onNavKey, onCommit }: {
  value: string
  options: { value: string; label: string }[]
  onPick: (v: string) => void
  onNavKey: (e: React.KeyboardEvent) => void
  onCommit: () => void
}) {
  const setPanelList = useContext(ListPanelContext)
  const [text, setText] = useState(value)
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState(0)

  // Follow the row when the unit changes from elsewhere (a fresh line, undo).
  useEffect(() => { setText(value) }, [value])

  const real = options.filter((o) => o.value !== '__add__')
  /**
   * Ranked the way a counter expects: what the typing starts, before what
   * merely contains it. Typing "s" must offer Set before Bags, or the first
   * row — the one Enter takes — is the wrong unit.
   */
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    if (!q) return real
    const hit = real.filter((o) => o.label.toLowerCase().includes(q))
    return hit.sort((a, b) => {
      const rank = (o: { label: string }) => {
        const l = o.label.toLowerCase()
        return l === q ? 0 : l.startsWith(q) ? 1 : 2
      }
      return rank(a) - rank(b)
    })
  }, [options, text])
  const exact = real.some((o) => o.label.toLowerCase() === text.trim().toLowerCase())

  useEffect(() => { setHl(0) }, [text])

  useEffect(() => {
    if (!open || !text.trim()) return
    const rows = [
      ...matches.map((o) => ({ value: o.value, label: o.label })),
      ...(text.trim() && !exact ? [{ value: '__new__', label: `Create "${text.trim()}"` }] : []),
    ]
    if (!rows.length) return
    setPanelList({
      title: 'List of Units',
      highlight: hl,
      rows,
      onPick: (v) => { commit(v === '__new__' ? text.trim() : v); onCommit() },
    })
    return () => setPanelList(null)
  })

  function commit(v: string) {
    const unit = v.trim()
    if (unit) { onPick(unit); setText(unit) }
    setOpen(false)
  }

  const rows = [...matches, ...(text.trim() && !exact ? [{ value: '__new__', label: text.trim() }] : [])]

  // Leaving the field after a unique prefix should make the same choice as
  // Enter on the visible list. It prevents a partial "s" being stored when
  // the only matching unit is "Set".
  function resolveTypedUnit(typed: string) {
    const trimmed = typed.trim()
    const direct = real.find((o) => o.value.toLowerCase() === trimmed.toLowerCase())
    // A part-typed unit is not a unit. "s" with Set on the list is Set, the
    // same row Enter would have taken — storing the "s" put a unit on the bill
    // the shop does not use. Only text that matches nothing is kept as typed,
    // which is how a genuinely new unit gets created.
    return direct?.value ?? matches[0]?.value ?? trimmed
  }

  return (
    /* The list sits under the box it belongs to. It is published to the
       right-hand panel as well, but that panel is the width of the screen away
       from a unit field on a wide monitor — too far to read while typing,
       which is the whole job of a picker. */
    <div className="relative w-16 shrink-0">
    <input
      type="text"
      data-bill-nav="1"
      data-bill-hist="unit"
      value={text}
      placeholder="Unit"
      /* Typed like the item name: the list filters as you go and Enter takes
         the highlighted row, or keeps what you typed if nothing matches. */
      onChange={(e) => { setText(e.target.value); setOpen(!!e.target.value.trim()) }}
      onFocus={(e) => e.target.select()}
      onBlur={() => { setTimeout(() => setOpen(false), 120); if (text.trim() && text.trim() !== value) commit(resolveTypedUnit(text)) }}
      onKeyDown={(e) => {
        if (open && rows.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
          e.preventDefault()
          setHl((h) => Math.min(rows.length - 1, Math.max(0, h + (e.key === 'ArrowDown' ? 1 : -1))))
          return
        }
        if (open && (e.key === 'Home' || e.key === 'End')) {
          e.preventDefault(); setHl(e.key === 'Home' ? 0 : rows.length - 1); return
        }
        // Esc closes the list first; pressed again, with no list in the way,
        // it empties the box like it does in every other field on the bill.
        if (e.key === 'Escape') { e.preventDefault(); if (open) setOpen(false); else setText(''); return }
        if (e.key === 'Enter') {
          e.preventDefault()
          const pick = open ? rows[hl] : undefined
          commit(pick ? (pick.value === '__new__' ? text.trim() : pick.value) : resolveTypedUnit(text))
          onCommit()
          return
        }
        onNavKey(e)
      }}
      className="w-full rounded-lg border border-stone-200 bg-stone-50 px-2 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
    />
    {open && rows.length > 0 && (
      /* Wider than the 4rem box so "Set" and "Sqft" are not clipped, and it
         opens leftwards because the unit sits mid-row with the amount to its
         right. */
      <div className="absolute top-full left-0 z-30 mt-0.5 max-h-56 w-24 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-xl dark:border-white/10 dark:bg-stone-800">
        {rows.map((r, i) => (
          <button
            key={r.value + i}
            type="button"
            data-hl={hl === i ? '1' : undefined}
            onMouseDown={(e) => { e.preventDefault(); commit(r.value === '__new__' ? text.trim() : r.value); onCommit() }}
            onMouseEnter={() => setHl(i)}
            className={`block w-full truncate px-2.5 py-1.5 text-left text-sm text-stone-700 dark:text-stone-200 ${hl === i ? 'bg-stone-100 dark:bg-white/10' : ''}`}
          >
            {r.value === '__new__' ? `Add "${r.label}"` : r.label}
          </button>
        ))}
      </div>
    )}
    </div>
  )
}

function emptyItem(): BillItem {
  return { id: uid(), description: '', qty: 1, unit: 'Pc', amount: 0 }
}

/** A name the party field can offer, from the panel's bills or from the books. */
type PartyOption = {
  id: string
  name: string
  mobile: string
  uid?: string
  /** True when this name is an account in the books, not just a name on a bill. */
  account?: boolean
}

/**
 * Which side of the books each voucher is written on. A sale and a receipt are
 * both the customer's; a purchase and a payment are both the supplier's.
 */
/** The two vouchers that are money and nothing else. */
const MONEY_KINDS: BillKind[] = ['receipt', 'payment']

const PARTY_SIDE: Record<BillKind, 'customer' | 'supplier'> = {
  sale: 'customer',
  receipt: 'customer',
  purchase: 'supplier',
  payment: 'supplier',
}

function emptyBill(number: string, kind: BillKind = 'sale'): Bill {
  return {
    id: uid(),
    number,
    ...(kind === 'sale' ? {} : { kind }),
    date: today(),
    customerName: '',
    customerPhone: '',
    ref: '',
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
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Preview</div>
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
export function BillBuilder() {
  const { id, voucherId } = useParams<{ id?: string; voucherId?: string }>()
  const navigate = useNavigate()
  const { bills, saveBill, deleteBill, nextBillNumber } = useStore()

  const existing = id ? bills.find((b) => b.id === id) : undefined
  const [draft, setDraft] = useState<Bill>(() => existing ?? emptyBill(nextBillNumber()))
  const [panelList, setPanelList] = useState<PanelList | null>(null)


  // Customer suggestions. A <datalist> was used here, but iOS Safari ignores it
  // entirely, so the phone showed nothing — this is a real dropdown instead.
  const [showCust, setShowCust] = useState(false)
  const [custHl, setCustHl] = useState(0)
  /**
   * Suggestions come from the bills that currently exist, not a stored customer
   * list — a list keeps names from bills that were since deleted, and there is
   * no way to tell those apart later. Deriving means a delete cleans itself up.
   * Later bills overwrite earlier ones, so the newest phone/UID wins.
   */
  // A purchase or a payment is written against a supplier, and the shop's
  // suppliers live in the books rather than in the panel's customer list.
  const kind: BillKind = draft.kind ?? 'sale'

  /**
   * One list of names, and it is the books'.
   *
   * A sale used to offer names gathered from past bills while a purchase
   * offered ledger accounts — two tables for one thing, which is how the same
   * customer ends up spelled three ways and owed money on all three. The
   * accounts are the common table now: Sundry Debtors on a sale or receipt,
   * Sundry Creditors on a purchase or payment, so picking a name here is
   * picking the account the voucher will post against.
   *
   * Names typed on bills that never opened an account are still offered, so
   * nothing written before this is lost — they simply sort after the accounts.
   */
  const partyGroup = kind === 'purchase' || kind === 'payment' ? 'Sundry Creditors' : 'Sundry Debtors'
  const masters = useQuery(api.masters.all, {})

  const liveCustomers = useMemo<PartyOption[]>(() => {
    const byName = new Map<string, PartyOption>()

    for (const l of masters?.ledgers ?? []) {
      if (l.groupName !== partyGroup) continue
      byName.set(String(l.name).trim().toLowerCase(), {
        id: l._id,
        name: l.name,
        mobile: l.phone ?? '',
        uid: l.aadhaar ?? '',
        account: true,
      })
    }

    // Only the customer side has bills behind it; a supplier is never named on
    // one. An account of the same name already read wins — it carries the
    // balance, and offering both would put the two spellings side by side.
    if (kind === 'sale' || kind === 'receipt') {
      for (const b of bills) {
        const name = (b.customerName ?? '').trim()
        if (!name || byName.has(name.toLowerCase())) continue
        byName.set(name.toLowerCase(), {
          id: b.id,
          name: toProperCase(name),
          mobile: b.customerPhone ?? '',
          ...(b.customerUid ? { uid: b.customerUid } : {}),
        })
      }
    }

    return Array.from(byName.values()).sort(
      (a, b) => Number(!!b.account) - Number(!!a.account) || a.name.localeCompare(b.name),
    )
  }, [bills, kind, masters, partyGroup])

  const custMatches = useMemo(() => {
    const q = (draft.customerName ?? '').trim().toLowerCase()
    const pool = q
      ? liveCustomers.filter(c => c.name.toLowerCase().includes(q) || c.mobile.includes(q))
      : liveCustomers
    return pool.slice(0, 8)
  }, [draft.customerName, liveCustomers])
  useEffect(() => { setCustHl(0) }, [draft.customerName])

  // Same panel, different list — Tally shows "List of Ledgers" here.
  useEffect(() => {
    if (!showCust || !custMatches.length || !(draft.customerName ?? '').trim()) return
    setPanelList({
      title: partyGroup === 'Sundry Creditors' ? 'List of Suppliers' : 'List of Customers',
      highlight: custHl,
      rows: custMatches.map((c) => ({
        value: c.id,
        label: c.name,
        hint: c.mobile || (c.account ? '' : 'not in books'),
      })),
      onPick: (id) => {
        const c = custMatches.find((x) => x.id === id)
        if (c) pickCustomer(c)
      },
    })
    return () => setPanelList(null)
  })

  function pickCustomer(c: typeof liveCustomers[number]) {
    setDraft((d) => ({
      ...d,
      customerName: toProperCase(withoutCourtesy(c.name)),
      customerPhone: c.mobile,
      customerUid: c.uid ?? '',
    }))
    setShowCust(false)
  }
  /**
   * A link that names a bill opens that bill.
   *
   * This read `existing || !id ? 'list' : 'form'`, which is backwards: finding
   * the bill sent you to the day book, and only a link to a bill that did not
   * exist opened the editor. So the ledger's edit button, which navigates to
   * /bills/<id>, landed on the list every time.
   */
  const [view, setView] = useState<'list' | 'form'>(existing ? 'form' : 'list')
  // What the screen is waiting to be told: Alt+D, or walking away from a bill
  // that was never saved. Both used the browser's own dialog.
  const [asking, setAsking] = useState<null | 'delete' | 'leave'>(null)

  /**
   * What the party's account stands at, shown under their name the way Tally's
   * voucher screen shows it — the counter needs to know a customer is already
   * ninety thousand down before writing them another bill.
   */
  const partyBook = useQuery(
    partyGroup === 'Sundry Creditors' ? api.reports.outstanding : api.reports.receivables,
    {},
  )
  const partyBalance = useMemo(() => {
    // Past the courtesy on both sides: the box holds the bare name now, while
    // the books file the account with "M/s" in front of it.
    const name = withoutCourtesy(draft.customerName ?? '').toLowerCase()
    if (!name) return null
    const row = (partyBook?.rows ?? []).find(
      (r: any) => withoutCourtesy(String(r.ledger?.name ?? '')).toLowerCase() === name,
    )
    if (!row) return null
    return { amount: Number(row.closing) || 0, side: String(row.closingSide ?? 'Dr') }
  }, [partyBook, draft.customerName])

  /**
   * `/bills/voucher/<id>` — editing a voucher that has no bill behind it: one
   * written on the ledger's own form, or approved from a photograph. It opens
   * here as a bill with no lines and the photograph attached, because there is
   * one editor for a voucher now and this is it.
   */
  const voucher = useQuery(
    api.vouchers.detail,
    voucherId ? ({ id: voucherId } as never) : 'skip',
  ) as any
  const builtVoucher = useRef<string | null>(null)
  useEffect(() => {
    if (!voucherId || !voucher || builtVoucher.current === voucherId) return
    builtVoucher.current = voucherId
    const kindOf: Record<string, BillKind> = {
      sale: 'sale', purchase: 'purchase', receipt: 'receipt', payment: 'payment',
    }
    setDraft({
      ...emptyBill(String(voucher.vchLabel ?? ''), kindOf[voucher.kind] ?? 'sale'),
      id: `vch-${voucherId}`,
      number: String(voucher.vchLabel ?? ''),
      voucherId,
      date: new Date(voucher.date).toISOString().slice(0, 10),
      customerName: voucher.partyName ?? '',
      ref: voucher.refNo ?? '',
      notes: voucher.narration ?? '',
      // No lines: nobody wrote any. On a sale or a purchase the amount goes on
      // a line that is a figure and nothing else, so the total still adds up
      // and can be replaced by real lines whenever someone types them. A
      // receipt or a payment has nowhere to put a line — the amount is the
      // voucher — so it fills the money box instead.
      items: voucher.amount && !MONEY_KINDS.includes(kindOf[voucher.kind] ?? 'sale')
        ? [{ ...emptyItem(), description: voucher.narration || 'On account', amountOnly: true, qty: 1, unit: 'Pc', amount: voucher.amount }]
        : [emptyItem()],
      // The split between money and discount is not recorded on the voucher's
      // head, so it reopens as all money — which is what it was unless someone
      // says otherwise.
      ...(MONEY_KINDS.includes(kindOf[voucher.kind] ?? 'sale')
        ? { moneyAmount: voucher.amount ?? 0 }
        : {}),
      total: voucher.amount ?? 0,
      attachments: (voucher.attachments ?? []).map((a: any) => ({
        storageId: a.storageId, kind: a.kind ?? 'bill',
      })),
    })
    setView('form')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voucherId, voucher])

  // `/bills?new=purchase` from the sidebar or an F-key: start that kind of
  // bill at once, and spend the link so a refresh doesn't open a second one.
  // Read here rather than in the day book, which is not mounted while a bill
  // is open — the link would go unread on a second press.
  const [pageParams, setPageParams] = useSearchParams()
  const newKind = pageParams.get('new')
  // `&party=` comes from the account screens, where the voucher is being
  // written against an account already open — so the name is filled in rather
  // than typed again.
  const newParty = pageParams.get('party')
  useEffect(() => {
    if (!newKind) return
    setPageParams({}, { replace: true })
    const kind = newKind as BillKind
    /**
     * Changing the voucher type partway through keeps the typing.
     *
     * The counter reaches for another type having already written the name and
     * half the lines — most often because the voucher was started as the wrong
     * one. Handing back a blank form throws that away and is the reason it felt
     * safer to finish the wrong voucher and fix it afterwards.
     *
     * The party is the one thing that does not always carry: a supplier has no
     * business on a sale, so a switch across sides drops the name and takes the
     * account with it. Within a side — a sale becoming a receipt — it stays.
     */
    setDraft((d) => {
      const started = view === 'form' && hasMeaningfulContent({ ...d, total: calcTotal(d.items) })
      if (!started) {
        const fresh = emptyBill(nextBillNumber(), kind)
        return newParty ? { ...fresh, customerName: toProperCase(newParty) } : fresh
      }
      const crossed = PARTY_SIDE[d.kind ?? 'sale'] !== PARTY_SIDE[kind]
      return {
        ...d,
        kind,
        ...(newParty
          ? { customerName: toProperCase(newParty) }
          : crossed
            ? { customerName: '', customerPhone: '', customerUid: '', ledgerId: undefined }
            : {}),
      }
    })
    setView('form')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newKind])

  /**
   * The day book has its own address now, so which screen you are on is
   * something the URL says rather than something this component remembers.
   *
   * It used to share /bills with the voucher being written, and the only way
   * to tell "the operator asked for the day book" from "the screen rewrote its
   * own query" was to watch navigation types and count them. Every bug in this
   * area came from that guesswork: the day book unreachable behind an open
   * voucher, then a voucher that closed itself the instant it opened. A second
   * address costs one line and removes the question.
   */
  const location = useLocation()
  const onDayBook = location.pathname === '/day'

  // The store can fill in after this mounts: a cold open on a shared link, or
  // a Convex sync landing a moment later. Once per id, so typing is never
  // overwritten by the bill it started from.
  const openedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!id || openedFor.current === id) return
    const bill = bills.find((b) => b.id === id)
    if (!bill) return
    openedFor.current = id
    setDraft({ ...bill })
    setView('form')
  }, [id, bills])

  /**
   * Soft lock. Opening a bill claims it and a heartbeat keeps the claim alive;
   * another counter opening the same bill gets it read-only instead of quietly
   * typing over the top. The claim is refreshed rather than held, so a closed
   * tab or a flat battery frees the bill on its own.
   */
  const postToLedger = useMutation(api.billLedger.postBill)
  const claimFromPhone = useMutation(api.inbox.claim)
  const upload = useUploader()
  // Chosen here, not yet uploaded — uploading happens once, on save.
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [photoPicked, setPhotoPicked] = useState<{ _id: string; storageId: string }[]>([])
  const ledgerDark = useLedgerTheme()
  const [photoOpen, setPhotoOpen] = useState(false)
  const [photoShown, setPhotoShown] = useState<unknown>(null)
  // What the paperwork on this kind of voucher is called, and how much of it
  // is already on the bill — counted here so the button can say so while shut.
  const isMoneyVoucher = (draft.kind ?? 'sale') === 'receipt' || (draft.kind ?? 'sale') === 'payment'
  /** Written against a supplier: a purchase or a payment. */
  const isSupplierVoucher = PARTY_SIDE[draft.kind ?? 'sale'] === 'supplier'

  /**
   * The box after the date, whichever boxes this voucher actually shows.
   *
   * A purchase has no phone or UID on it, so reaching for them by name would
   * land the cursor nowhere and strand the operator on the date.
   */
  const nextAfterDate = () => {
    for (const sel of ['[data-bill-phone]', '[data-bill-uid]', '[data-bill-ref]']) {
      const box = document.querySelector<HTMLInputElement>(sel)
      if (box) { box.focus(); box.select?.(); return }
    }
    moveBillFocus(1)
  }
  const photoLabel = isMoneyVoucher ? 'Receipt photo' : 'Bill photo'
  const photoCount = (draft.attachments?.length ?? 0) + photoFiles.length + photoPicked.length
  const claimLock = useMutation(api.billLocks.claim)
  const releaseLock = useMutation(api.billLocks.release)
  const [lockedBy, setLockedBy] = useState<string | null>(null)

  useEffect(() => {
    if (view !== 'form') { setLockedBy(null); return }
    const id = draft.id
    let alive = true
    const beat = async () => {
      const res = await claimLock({ billId: id, deviceId: deviceId(), deviceName: deviceName() })
      if (alive) setLockedBy(res.ok ? null : res.heldBy)
    }
    void beat()
    const t = setInterval(beat, 10_000)   // well inside the 30s expiry
    return () => {
      alive = false
      clearInterval(t)
      void releaseLock({ billId: id, deviceId: deviceId() })
    }
  }, [view, draft.id, claimLock, releaseLock])

  const readOnly = lockedBy !== null

  /**
   * Everything typed into a column, kept for Up to walk back through.
   *
   * Recorded here rather than on each box's own onBlur: there are a dozen of
   * them across four row layouts, and one delegated listener cannot be
   * forgotten on the next one added.
   */
  useEffect(() => {
    const onLeave = (e: FocusEvent) => {
      const el = e.target
      if (!(el instanceof HTMLInputElement)) return
      recallAt.delete(el)
      const key = historyKeyOf(el)
      if (key && el.value.trim()) rememberField(key, el.value.trim())
    }
    document.addEventListener('focusout', onLeave)
    return () => document.removeEventListener('focusout', onLeave)
  }, [])

  // Opening a bill puts the cursor where entry starts, so the whole voucher can
  // be typed without reaching for the mouse first.
  useEffect(() => {
    if (view !== 'form' || readOnly) return
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLInputElement>('[data-bill-customer]')
      if (el && document.activeElement !== el) { el.focus(); el.select() }
    }, 50)
    return () => clearTimeout(t)
  }, [view, readOnly])
  /**
   * Undo / redo for the open bill.
   *
   * Snapshots the whole draft rather than tracking individual edits — a bill is
   * small, and it means a delete, a rate change and a swapped item all undo the
   * same way. Snapshots are taken on a short idle so a burst of typing collapses
   * into one step instead of one per keystroke.
   */
  const past = useRef<Bill[]>([])
  const future = useRef<Bill[]>([])
  const skipHistory = useRef(false)
  const [historyTick, setHistoryTick] = useState(0)

  useEffect(() => {
    if (view !== 'form') return
    if (skipHistory.current) { skipHistory.current = false; return }
    const t = setTimeout(() => {
      const last = past.current[past.current.length - 1]
      if (last && JSON.stringify(last) === JSON.stringify(draft)) return
      past.current = [...past.current, draft].slice(-50)
      future.current = []
      setHistoryTick((n) => n + 1)
    }, 600)
    return () => clearTimeout(t)
  }, [draft, view])

  function undo() {
    if (past.current.length < 2) return
    const prev = past.current[past.current.length - 2]
    future.current = [past.current[past.current.length - 1], ...future.current]
    past.current = past.current.slice(0, -1)
    skipHistory.current = true
    setDraft(prev)
    setHistoryTick((n) => n + 1)
  }

  function redo() {
    const next = future.current[0]
    if (!next) return
    future.current = future.current.slice(1)
    past.current = [...past.current, next]
    skipHistory.current = true
    setDraft(next)
    setHistoryTick((n) => n + 1)
  }

  const canUndo = past.current.length > 1
  const canRedo = future.current.length > 0

  // -- Draft auto-save refs (always point to the latest values for the unmount cleanup)
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])
  const viewRef  = useRef(view)
  useEffect(() => { viewRef.current = view }, [view])
  /** Set to true whenever the bill is explicitly committed (save / print / cancel) so the
   *  unmount cleanup doesn't double-save. */
  const committedRef = useRef(false)

  // Leaving the page files nothing: an unsaved bill was never written down,
  // and half of one is not a bill.

  // -- helpers
  /**
   * A receipt or a payment is the money itself, so its total is the money plus
   * whatever was knocked off — not a sum of item lines. Writing "Bill 30,080 /
   * Roundup -250 / Cash 29,830" on one used to total ₹59,660, because the same
   * money was counted once as the bill and again as the cash.
   *
   * A sale or a purchase is still the sum of what is on it.
   */
  const money = Math.max(0, Number(draft.moneyAmount) || 0)
  const discount = Math.max(0, Number(draft.discount) || 0)
  const total = isMoneyVoucher ? money + discount : calcTotal(draft.items)

  /**
   * Start a voucher from the day book.
   *
   * The day book has its own address, so which screen shows is the URL's to
   * say — setting the view here alone would leave the operator looking at the
   * list they pressed the button on. It goes the way every other voucher is
   * opened, by the address that asks for one, so there is one path in and it
   * is the one that is used all day.
   */
  function startNew(kind: BillKind = 'sale') {
    if (onDayBook) { navigate(`/bills?new=${kind}`); return }
    setDraft(emptyBill(nextBillNumber(), kind))
    setView('form')
  }

function updateItem(itemId: string, patch: Partial<BillItem>) {
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }))
  }

  function addItem() {
    setDraft((d) => ({ ...d, items: [...d.items, emptyItem()] }))
  }

  /**
   * Enter on a row's last field opens the next line, adding one when you're on
   * the last row — the way a Tally voucher keeps taking entries until you accept
   * it. Focus waits a frame so a freshly added row exists before we reach for it.
   */
  function rowDone(idx: number) {
    const isLast = idx === draft.items.length - 1
    if (isLast) addItem()
    requestAnimationFrame(() => {
      const rows = document.querySelectorAll<HTMLInputElement>('[data-bill-item-desc]')
      rows[idx + 1]?.focus()
    })
  }

  function finishItemEntry(itemId: string) {
    setDraft((d) => ({
      ...d,
      // Keep the first empty row on a brand-new bill, but discard a trailing
      // placeholder after real lines. It must not show up in the preview.
      items: d.items.length > 1
        ? d.items.filter((i) => i.id !== itemId)
        : d.items,
    }))
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>('[data-bill-save]')?.focus()
    })
  }

  function removeItem(itemId: string) {
    setDraft((d) => ({ ...d, items: d.items.filter((i) => i.id !== itemId) }))
  }

  /**
   * Tally's voucher keys, as documented by Tally: Ctrl+A accepts and saves the
   * screen, Esc closes it, Ctrl+Q exits, Alt+D deletes the voucher. Enter and
   * the arrows already walk the fields, so this covers the screen-level actions
   * a counter operator reaches for without looking up.
   */
  /**
   * There is no draft.
   *
   * A bill used to save itself every second and a half, half-typed, so another
   * counter could watch it being written. It also meant an abandoned bill left
   * a row behind, an unfinished line counted as a "bill" in the day book, and
   * deleting one of those could reach the books. Tally has no such thing: a
   * voucher is written and accepted, or it is not a voucher.
   *
   * What goes with it is the live view of a bill being typed on another
   * machine. The lock is what remains — a bill open on one counter tells the
   * other whose it is.
   */

  // Tally's own keys. The rules about what fires while typing live in the hook.
  useShortcuts({
    'mod+z': () => undo(),
    'mod+shift+z': () => redo(),
    'mod+a': () => save(),
    'mod+q': () => cancel(),
    'alt+d': () => setAsking('delete'),
    Escape: () => {
      // A dropdown swallows Esc first; reaching here means nothing is open.
      const el = document.activeElement as HTMLElement | null
      if (el?.closest('[data-bill-nav]')) return
      cancel()
    },
  }, { enabled: view === 'form' })

  /**
   * Post a bill and keep what the server made of it.
   *
   * One call. It either writes the voucher, its Dr/Cr lines and the bill in a
   * single transaction, or it throws and nothing was written — there is no
   * longer a middle state where the counter's list has a bill the books have
   * never heard of. A failure keeps the typing on this PC, marked unposted and
   * held back from sync, so it can be retried rather than retyped.
   */
  async function postStored(
    bill: Bill & { total: number },
    keepAsBill: boolean,
  ): Promise<{ bill: Bill & { total: number }; ledgerId?: string } | null> {
    try {
      const res = await postToLedger({
        bill: plain(bill) as never,
        attachments: (bill.attachments ?? []) as never,
        keepAsBill,
      })
      const stored = { ...bill, ...((res?.bill as Bill) ?? {}) } as Bill & { total: number }
      // Whatever went wrong last time is over; the mark has to go with it, or
      // a bill that posted on the retry would stay flagged and unsynced.
      delete stored.postError
      // The number, the voucher and the party account are the server's answer
      // now; adopting them is what keeps two PCs from arguing about them.
      if (keepAsBill) saveBill(stored)
      return { bill: stored, ledgerId: (res?.ledgerId as string) ?? undefined }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[ledger] posting failed', err)
      if (keepAsBill) saveBill({ ...bill, postError: message })
      toast(`Not saved to the books\n${message}\nKept on this PC as unposted.`, 'error')
      return null
    }
  }

  /** The open bill: photographs up first, then the one posting call. */
  async function postDraft() {
    // The photographs go up first: a bill that saved without them would leave
    // the paper it was written from nowhere, and the ledger showing a voucher
    // with no document against it.
    let attachments = draft.attachments ?? []
    try {
      const docKind = (draft.kind ?? 'sale') === 'receipt' || (draft.kind ?? 'sale') === 'payment'
        ? ('receipt' as const)
        : ('bill' as const)
      const uploaded = photoFiles.length ? await upload(photoFiles) : []
      attachments = [
        ...attachments,
        ...uploaded.map((storageId: string) => ({ storageId, kind: docKind })),
        ...photoPicked.map((p) => ({ storageId: p.storageId as string, kind: docKind })),
      ]
      // Claimed only once they are safely on the voucher's side, so a failure
      // here leaves the photo in the phone's queue rather than losing it.
      for (const p of photoPicked) await claimFromPhone({ id: p._id as never })
      setPhotoFiles([])
      setPhotoPicked([])
    } catch (err) {
      toast(`Could not attach the photos\n${err instanceof Error ? err.message : String(err)}`, 'error')
      return null
    }

    // A voucher opened from the books is edited here, but it is not one of the
    // shop's own bills and must not join their list — it would show twice in
    // the day book, once as the voucher and once as a bill of the same thing.
    // The `vch-` id is the test, not the voucherId: every posted bill has one.
    const borrowed = Boolean(voucherId) || String(draft.id).startsWith('vch-')
    return postStored({ ...draft, total, attachments }, !borrowed)
  }

  async function save() {
    if (readOnly) { toast(`This bill is open on ${lockedBy}.`, 'error'); return }
    committedRef.current = true

    const done = await postDraft()
    // Stay on the bill when the books refused it. Walking away to a screen
    // that looks like success is exactly what made the books drift.
    if (!done) return

    setView('list')
    /**
     * Straight to the party's own account, which is what you want to see next:
     * the voucher just written, and what they stand at now that it is in. The
     * side follows the voucher — a purchase lands on the supplier's account,
     * a sale on the customer's — and a bill the books never gave an account to
     * falls back to the day book.
     */
    const partyTab = partyGroup === 'Sundry Creditors' ? 'suppliers' : 'customers'
    navigate(
      done.ledgerId ? `/ledger/${partyTab}/${done.ledgerId}` : '/day',
      { replace: true },
    )
  }

  function cancel() {
    committedRef.current = true
    // Asked only when there is something to lose: a bill with lines on it and
    // no save behind it goes when you leave, so say so first.
    const unsaved =
      !bills.find((b) => b.id === draft.id) && hasMeaningfulContent({ ...draft, total })
    if (unsaved) { setAsking('leave'); return }
    setView('list')
    navigate('/day', { replace: true })
  }

  /** Leaves the bill for good — what Alt+D and a discarded draft both end in. */
  function leave() {
    committedRef.current = true
    setView('list')
    navigate('/day', { replace: true })
  }

  /**
   * Print the bill through the browser.
   *
   * The same HTML the preview shows is written into a hidden frame and that
   * frame is printed, so what comes out is the bill on its 148x210 page — not
   * the panel's screen around it. No print server, no discovery, no waiting on
   * anything to be switched on at the shop.
   */
  function doPrint(bill: Bill & { total: number }) {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    document.body.appendChild(frame)

    const done = () => setTimeout(() => frame.remove(), 1000)
    frame.onload = () => {
      const win = frame.contentWindow
      if (!win) return done()
      // Chrome resolves print() when the dialog closes; Safari returns at once.
      // Either way the frame is torn down after, never during, the dialog.
      win.focus()
      win.print()
      done()
    }
    frame.srcdoc = buildBillHtml(bill)
  }

  async function handlePrint() {
    if (readOnly) { toast(`This bill is open on ${lockedBy}.`, 'error'); return }
    committedRef.current = true

    /**
     * Printing saves. Paper carries a number, and a number handed to a
     * customer that the books never issued is the drift this path exists to
     * stop — the bill is posted first and what comes out of the printer is
     * what the server filed.
     *
     * A bill that is already posted still prints when the save cannot go
     * through: that is the shop reprinting an old bill with the internet down,
     * and nothing new is being claimed.
     */
    const done = await postDraft()
    if (done) { doPrint(done.bill); return }
    if (draft.postedAt) doPrint({ ...draft, total })
  }

  // ---- FORM VIEW -----------------------------------------------------------
  if (view === 'form' && !onDayBook) {
    return (
      <ListPanelContext.Provider value={setPanelList}>
        <TallyListPanel list={panelList} />

      {asking === 'delete' && (
        <Confirm
          title={`Delete bill ${draft.number}?`}
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            const gone = await deleteBill(draft.id)
            // A delete the server never agreed to is not a delete: the bill
            // would be back on the next sync, its voucher still in the books.
            if (!gone) throw new Error('Could not reach the books, so the bill was not deleted.')
            leave()
          }}
          onClose={() => setAsking(null)}
        />
      )}
      {asking === 'leave' && (
        <Confirm
          title="Leave without saving?"
          body="This bill will not be kept."
          confirmLabel="Leave"
          danger
          onConfirm={leave}
          onClose={() => setAsking(null)}
        />
      )}

      <div className="mx-auto max-w-2xl space-y-5 px-4 pb-24 pt-1 md:pt-2 lg:max-w-none lg:pl-8 lg:pr-[21rem] xl:pr-[25rem]">

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            className="px-2 py-1"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={!canUndo || readOnly}
            onClick={undo}
          >
            <Undo2 size={16} />
          </Button>
          <Button
            variant="ghost"
            className="px-2 py-1"
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
            disabled={!canRedo || readOnly}
            onClick={redo}
          >
            <Redo2 size={16} />
          </Button>
          {/* historyTick only exists to re-render these when the stacks move */}
          <span className="hidden">{historyTick}</span>
        </div>

        {readOnly && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <Lock size={15} className="shrink-0" />
            <span>Being edited on <b>{lockedBy}</b> — read only until they finish.</span>
          </div>
        )}
        {/* Tally's voucher chrome: what screen this is on the left, whose books
            on the right, then the voucher's own type and number under it. The
            colours are the panel's brass and parchment, not Tally's blue. */}
        <div className="overflow-hidden rounded-xl border border-stone-300 dark:border-white/15">
          <div className="flex items-center justify-between gap-3 bg-shiv-green px-3 py-1.5 text-stone-950">
            <span className="truncate text-[13px] font-bold">
              Accounting Voucher {existing ? 'Alteration' : 'Creation'}
            </span>
            <span className="truncate text-[13px] font-bold">
              M/S Shiv Hardware Store — {fyLabel(draft.date)}
            </span>
          </div>
          <div className="flex items-center gap-3 bg-stone-100 px-3 py-2 dark:bg-white/5">
            <span className="rounded bg-shiv-green/20 px-2 py-0.5 text-sm font-bold text-stone-900 dark:text-white">
              {BILL_KINDS[draft.kind ?? 'sale'].title}
            </span>
            <span className="text-sm text-muted">No.</span>
            <span className="text-sm font-bold text-stone-900 dark:text-white">{draft.number}</span>
            <div className="ml-auto flex items-center gap-2">
              <ReceiptText size={16} className="text-shiv-green" />
              <input
                type="date"
                value={draft.date}
                onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                data-bill-date="1"
                data-bill-nav="1"
                /* The date sits in the voucher's head, above the party block,
                   so plain field order would send Enter back down to the name
                   it just came from. The head is written name, date, phone —
                   so the date hands on to the phone by name, not by position. */
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    nextAfterDate()
                    return
                  }
                  billArrowKeys(e)
                }}
                /* color-scheme makes the browser's own calendar popup and its icon
                   follow the theme — without it both stay light-on-light in dark
                   mode, which is why the picker looked broken. */
                className="rounded-lg border border-stone-200 bg-stone-50 px-2 py-1 text-sm text-stone-700 accent-shiv-green dark:border-white/10 dark:bg-stone-800 dark:text-stone-200 dark:[color-scheme:dark]"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">
              {BILL_KINDS[draft.kind ?? 'sale'].party} A/c name
            </label>
            <div className="relative">
            {/* The bill prints "M/s <name>", so the voucher shows it too —
                drawn beside the box rather than typed into it. Storing it would
                put it on the party's account in the books and print it twice.

                In its own box: the wrapper below also holds the balance line
                and the dropdown, so centring on that put the "M/s" under the
                name instead of beside it. */}
            <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted">
              M/s
            </span>
            <input
              type="text"
              autoComplete="off"
              placeholder="e.g. Rajesh Kumar ji"
              data-bill-customer="1"
              data-bill-hist="party"
              data-bill-nav="1"
              value={draft.customerName}
              onFocus={() => { /* list opens on typing, not on arrival */ }}
              onBlur={() => {
                setTimeout(() => setShowCust(false), 150)
                // The screen and every printed document supply the "M/s"
                // themselves, so one typed into the box would be stored on the
                // account and come back out doubled.
                const bare = withoutCourtesy(draft.customerName ?? '')
                if (bare !== (draft.customerName ?? '').trim()) {
                  setDraft((d) => ({ ...d, customerName: bare }))
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  if (!showCust || !custMatches.length) { billArrowKeys(e); return }
                  e.preventDefault()
                  setShowCust(true)
                  setCustHl(h => e.key === 'ArrowDown'
                    ? Math.min(h + 1, custMatches.length - 1)
                    : Math.max(h - 1, 0))
                  return
                }
                if (e.key === 'Escape') { setShowCust(false); return }
                if (e.key !== 'Enter') return
                e.preventDefault()
                // Enter takes the highlighted match first, then moves on.
                const pick = showCust ? custMatches[custHl] : undefined
                if (pick && (draft.customerName ?? '').trim()) { pickCustomer(pick); return }
                /* Tally asks the date next, not the phone: the name and the
                   day are what every voucher needs, and the phone is filled in
                   once per customer and never again. */
                const dateBox = document.querySelector<HTMLInputElement>('[data-bill-date]')
                if (dateBox) { dateBox.focus(); dateBox.select?.(); return }
                nextAfterDate()
              }}
              onChange={(e) => {
                // Proper case as they type. Only letter case changes, never the
                // length, so the caret stays exactly where it was.
                // Nothing here may change the length: `withoutCourtesy` trims,
                // so calling it on every keystroke ate the space the moment it
                // was typed and "KM Traders" could never be written. The "M/s"
                // is taken off on the way out instead, where the caret has
                // already gone.
                const name = toProperCase(e.target.value)
                const match = liveCustomers.find(c => c.name.toLowerCase() === name.toLowerCase())
                setShowCust(true)
                setDraft((d) => ({
                  ...d,
                  customerName: name,
                  customerPhone: match ? match.mobile : d.customerPhone,
                  customerUid: match ? (match.uid ?? '') : d.customerUid,
                }))
              }}
              className="w-full rounded-lg border border-stone-200 bg-white py-2 pl-11 pr-3 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
            />
            </div>
            {/* What this account already stands at, and which ledger the
                voucher posts against — the two lines Tally puts here, so the
                counter can see the position without leaving the voucher. */}
            {partyBalance && (
              /* Spans the field rather than trailing its own label: the figure
                 lands on the box's right edge, so it sits in the same place on
                 every voucher instead of wandering with the label's width.
                 Tabular digits keep the columns of a figure lined up. */
              <div className="mt-1 flex items-baseline gap-2 pl-11 text-xs">
                <span className="italic text-muted">Current balance</span>
                <span className="font-semibold tabular-nums text-stone-700 dark:text-stone-300">
                  {balanceText(partyBalance.amount, partyBalance.side)}
                </span>
              </div>
            )}
            {showCust && custMatches.length > 0 && (draft.customerName ?? '').trim() && (
              <div className="absolute top-full left-0 right-0 z-30 mt-0.5 max-h-64 overflow-y-auto rounded-lg border border-stone-200 bg-white shadow-xl dark:border-white/10 dark:bg-stone-800">
                {custMatches.map((c, i) => (
                  <button
                    key={c.id}
                    onMouseDown={(e) => { e.preventDefault(); pickCustomer(c) }}
                    onMouseEnter={() => setCustHl(i)}
                    className={`flex w-full min-w-0 items-center justify-between gap-2 px-3 py-2 text-left text-sm text-stone-700 dark:text-stone-200 ${custHl === i ? 'bg-stone-100 dark:bg-white/10' : ''}`}
                  >
                    <span className="truncate">{toProperCase(c.name)}</span>
                    {/* An account in the books, or a name off an old bill that
                        never opened one — saving the bill opens it. */}
                    <span className="shrink-0 text-xs text-muted">
                      {c.mobile || (c.account ? '' : 'new')}
                    </span>
                  </button>
                ))}
              </div>
            )}
            </div>
          </div>
          {/* A supplier is a firm the shop buys from, reached on the number in
              the purchase book — not a customer on credit whose phone and
              Aadhaar are taken so they can be chased. Asking for them on a
              purchase is two boxes to tab past on every voucher. */}
          {!isSupplierVoucher && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Phone (optional)</label>
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={10}
              placeholder="10-digit mobile"
              data-bill-phone="1"
              data-bill-nav="1"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { billArrowKeys(e); return }
                if (e.key !== 'Enter') return
                e.preventDefault()
                const uid = document.querySelector<HTMLInputElement>('[data-bill-uid]')
                ;(uid ?? document.querySelector<HTMLInputElement>('[data-bill-ref]'))?.focus()
              }}
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
          )}
          {!isSupplierVoucher && (
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">UID (optional)</label>
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={12}
              placeholder="12-digit Aadhaar"
              data-bill-uid="1"
              data-bill-nav="1"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { billArrowKeys(e); return }
                if (e.key !== 'Enter') return
                e.preventDefault()
                document.querySelector<HTMLInputElement>('[data-bill-ref]')?.focus()
              }}
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
          )}
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Ref (optional)</label>
            <input
              type="text"
              placeholder="PO no., site, via…"
              data-bill-ref="1"
              data-bill-nav="1"
              value={draft.ref ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, ref: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { billArrowKeys(e); return }
                if (e.key !== 'Enter') return
                e.preventDefault()
                // Last of the head — hand off to where entry actually starts.
                // A receipt has no item rows, so reaching for one by name would
                // leave the cursor stranded here.
                const start = document.querySelector<HTMLInputElement>('[data-bill-item-desc]')
                  ?? document.querySelector<HTMLInputElement>('[data-bill-money]')
                if (start) { start.focus(); start.select?.(); return }
                moveBillFocus(1)
              }}
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
            />
          </div>
        </div>

        {/* The money, on a voucher that is nothing but money. It comes first
            because it is the whole entry — everything below it is a note. */}
        {isMoneyVoucher && (
          <div className="rounded-xl border border-stone-300 p-3 dark:border-white/15">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex-1 min-w-[9rem]">
                <span className="mb-1 block text-xs font-semibold text-muted">
                  Amount {(draft.kind ?? 'sale') === 'payment' ? 'paid' : 'received'}
                </span>
                <div className="relative">
                  <IndianRupee size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    /* No autoFocus: opening a voucher puts the cursor on the
                       party's name, and this stole it for the 50ms before that
                       effect ran — the cursor visibly jumped. */
                    data-bill-money="1"
                    data-bill-nav="1"
                    onKeyDown={billArrowKeys}
                    value={draft.moneyAmount ?? ''}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setDraft((d) => ({
                      ...d,
                      moneyAmount: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0),
                    }))}
                    className="w-full rounded-lg border border-stone-200 bg-shiv-green/10 py-2 pl-7 pr-2 text-sm font-bold dark:border-white/10 dark:bg-shiv-green/15 dark:text-white"
                  />
                </div>
              </label>

              {/* What the party was let off. It is not money, so it never
                  reaches the drawer — it clears the rest of their account. */}
              <label className="flex-1 min-w-[9rem]">
                <span className="mb-1 block text-xs font-semibold text-muted">
                  Discount {(draft.kind ?? 'sale') === 'payment' ? 'received' : 'allowed'}
                </span>
                <div className="relative">
                  <IndianRupee size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    data-bill-nav="1"
                    onKeyDown={billArrowKeys}
                    value={draft.discount ?? ''}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setDraft((d) => ({
                      ...d,
                      discount: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0),
                    }))}
                    className="w-full rounded-lg border border-stone-200 bg-stone-50 py-2 pl-7 pr-2 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
                  />
                </div>
              </label>
            </div>

            {discount > 0 && (
              <p className="mt-2 text-xs text-muted">
                Clears <b className="text-stone-700 dark:text-stone-300">₹{total.toLocaleString('en-IN')}</b> off
                the account — ₹{money.toLocaleString('en-IN')} in hand
                and ₹{discount.toLocaleString('en-IN')} allowed.
              </p>
            )}
          </div>
        )}

        {/* Items */}
        <div>
          {!isMoneyVoucher && (<>
          {/* Ledger head — Tally's voucher grid: a ruled band of column names,
              then one line per item, no cards. */}
          {/* No overflow-hidden here: the item and unit dropdowns are absolutely
              positioned inside these rows and would be clipped by it. */}
          <div className="rounded-lg border border-stone-300 dark:border-white/15">
            <div className="flex items-center gap-2 rounded-t-lg border-b border-stone-300 bg-stone-100 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted dark:border-white/15 dark:bg-white/5">
              {/* Mirrors a row exactly: index, particulars, then the control
                  group with its own tighter gap, then the actions column. */}
              <span className="w-5 shrink-0 text-center">#</span>
              <span className="flex-1 min-w-[190px]">Particulars</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="w-12 text-center">Qty</span>
                <span className="w-16 text-center">Unit</span>
                <span className="w-24 text-right">Amount</span>
                <span className="w-[4.5rem] text-center">Rate</span>
              </span>
              <span className="w-9 shrink-0" />
            </div>

          <div className="divide-y divide-stone-200 dark:divide-white/10">
            {draft.items.map((item, idx) => (
              <SmartItemRow
                key={item.id}
                item={item}
                idx={idx}
                onUpdate={updateItem}
                onRemove={removeItem}
                onRowDone={rowDone}
                onBlankRowDone={finishItemEntry}
                disabled={draft.items.length === 1}
              />
            ))}
          </div>
          </div>

          <button
            onClick={addItem}
            className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-stone-300 py-2 text-xs font-semibold text-muted hover:border-stone-400 hover:bg-stone-50 dark:border-white/15 dark:hover:bg-white/5"
          >
            <Plus size={13} /> Add Item
          </button>
          </>)}

          {/* Running total, and what was taken against it */}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {/* A receipt or a payment is the money itself, so it asks only
                where it went. A sale or a purchase asks how much of it was
                settled now — that amount posts as a line of this same
                voucher, against the drawer or the bank. */}
            {!isMoneyVoucher && (
              <div className="flex items-center gap-1.5 rounded-xl bg-stone-100 px-3 py-2 dark:bg-stone-800">
                <span className="text-sm text-muted">
                  {(draft.kind ?? 'sale') === 'purchase' ? 'Paid' : 'Received'}
                </span>
                <span className="text-sm text-muted">₹</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={total || undefined}
                  data-bill-nav="1"
                  value={draft.paidAmount ?? ''}
                  onChange={(e) => setDraft((d) => ({
                    ...d,
                    paidAmount: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value) || 0),
                    paid: Number(e.target.value) >= total && total > 0,
                  }))}
                  className="w-24 rounded-lg border border-stone-200 bg-white px-2 py-1 text-right text-sm dark:border-white/10 dark:bg-stone-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, paidAmount: total, paid: true }))}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-stone-200 dark:hover:bg-white/10"
                >
                  Full
                </button>
                {/* When the money came in. Blank is the usual counter sale —
                    paid with the bill — so it only asks once there is money to
                    date, and it defaults to the bill's own day. */}
                {(draft.paidAmount ?? 0) > 0 && (
                  <input
                    type="date"
                    data-bill-nav="1"
                    title="Date the money was received"
                    value={draft.paidDate ?? draft.date}
                    onChange={(e) => setDraft((d) => ({ ...d, paidDate: e.target.value || undefined }))}
                    className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs dark:border-white/10 dark:bg-stone-900 dark:text-white"
                  />
                )}
              </div>
            )}
            {(isMoneyVoucher || (draft.paidAmount ?? 0) > 0) && (
              <div className="flex items-center gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800">
                {(['cash', 'online'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, paymentMode: mode }))}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold capitalize ${
                      (draft.paymentMode ?? 'cash') === mode
                        ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white'
                        : 'text-muted'
                    }`}
                  >
                    {mode === 'cash' ? 'Cash' : 'Bank'}
                  </button>
                ))}
              </div>
            )}
            <div className="rounded-xl bg-stone-100 px-5 py-2 dark:bg-stone-800">
              <span className="text-sm text-muted">Total </span>
              <span className="text-lg font-bold text-stone-900 dark:text-white">₹{total.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>

        {/* Narration — Tally's last field before the voucher is accepted. It is
            the voucher's own wording, so it posts as the narration rather than
            living only on the bill. */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-muted">Narration</label>
          <input
            type="text"
            data-bill-nav="1"
            onKeyDown={billArrowKeys}
            value={draft.notes ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            placeholder="e.g. goods sent by tempo"
            className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {/* Cancel — intentionally small to avoid accidental taps */}
          <button
            onClick={cancel}
            className="shrink-0 rounded-lg px-3 py-2.5 text-xs font-medium text-muted hover:text-stone-600 dark:text-muted dark:hover:text-stone-300"
          >
            Cancel
          </button>

          {/* Save + Print */}
          <div className="flex flex-1 gap-2">
            <button
              data-bill-save="1"
              onClick={save}
              className="flex-1 rounded-xl bg-shiv-green py-3 text-sm font-bold text-stone-950 hover:bg-[#c6a15a]"
            >
              Save {BILL_KINDS[draft.kind ?? 'sale'].title}
            </button>
            <button
              onClick={handlePrint}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-stone-800 px-4 py-3 text-sm font-bold text-white hover:bg-stone-700 dark:bg-stone-700 dark:hover:bg-stone-600"
            >
              <Printer size={15} /> Print
            </button>
          </div>
        </div>

        {/* The paper this was written from, if there is any.
            Closed until asked for: the picker lists every photograph the phone
            has sent in and nobody has filed, which is a wall of pictures on a
            bill that has none — and most bills written at the counter have
            none, because the counter is where the bill is being made. */}
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPhotoOpen((open) => !open)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                photoOpen
                  ? 'border-shiv-green bg-shiv-green/10 text-stone-900 dark:text-white'
                  : 'border-stone-300 border-dashed text-muted hover:border-stone-400 hover:bg-stone-50 dark:border-white/15  dark:hover:bg-white/5'
              }`}
            >
              <Camera size={15} />
              {photoLabel}
              {photoCount > 0 && (
                <span className="rounded-full bg-shiv-green px-1.5 py-0.5 text-[10px] font-bold text-stone-950">
                  {photoCount}
                </span>
              )}
              {photoOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>

            {!photoOpen && photoCount > 0 && (
              <span className="text-xs text-muted">
                attached to this bill
              </span>
            )}
          </div>

          {photoOpen && (
            <div className={`ledger-root mt-2 ${ledgerDark ? 'dark' : ''}`}>
              <BillDrop
                files={photoFiles}
                onChange={setPhotoFiles}
                picked={photoPicked}
                onPick={setPhotoPicked}
                onViewBill={setPhotoShown}
              />
            </div>
          )}
        </div>

        {photoShown != null && (
          <BillViewer voucher={photoShown} onClose={() => setPhotoShown(null)} />
        )}

        {/* Live print preview — scaled to fit phone width */}
        <BillPreview bill={{ ...draft, total }} />

      </div>

      {/* Tally's key bar. The shortcuts it names are the ones the screen
          already answers to, so it is a reminder of the keys rather than a
          second set of buttons. */}
      <div className="no-print fixed bottom-0 left-0 right-0 z-20 hidden border-t border-stone-300 bg-stone-100 dark:border-white/15 dark:bg-stone-900 lg:flex lg:pr-[21rem] xl:pr-[25rem]">
        {[
          { key: 'Q', label: 'Quit', onClick: cancel },
          { key: 'A', label: 'Accept', onClick: save },
          { key: 'D', label: 'Delete', onClick: () => setAsking('delete') },
          { key: 'X', label: 'Cancel Vch', onClick: cancel },
        ].map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={k.onClick}
            className="flex-1 border-r border-stone-300 px-3 py-1.5 text-left text-xs text-stone-700 last:border-r-0 hover:bg-stone-200 dark:border-white/15 dark:text-stone-300 dark:hover:bg-white/10"
          >
            <span className="font-bold text-shiv-green underline">{k.key}</span>
            <span>: {k.label}</span>
          </button>
        ))}
      </div>
      </ListPanelContext.Provider>
    )
  }

  // ---- LIST VIEW -----------------------------------------------------------
  return (
    <BillDayBook
      bills={bills}
      onNew={startNew}
      onDelete={deleteBill}
      onRetry={(bill) => { void postStored({ ...bill, total: bill.total }, true) }}
    />
  )
}

// ── Day book ───────────────────────────────────────────────────────────────
// One day book, not two. The ledger had its own — the same vouchers, in the
// same table, one tab deep — and a shop has only one day. So the ledger's is
// gone and this is it: every voucher in the books, in the ledger's own table,
// plus the bills that have not been posted as vouchers and the drafts nobody
// has finished. Rendered inside `.ledger-root`, which is where that table's
// styling lives, so this reads exactly as the ledger's did.

const iso = (d: Date) => {
  const t = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return t.toISOString().slice(0, 10)
}

/**
 * The series a bill belongs to, in the books' own abbreviations. A bill is a
 * sale, so it is labelled SAL like every other sale — the BILL- form was the
 * reference the voucher carries, not a series of its own, and having two
 * namings for one thing made the day book read as two different books.
 *
 * The number is the bill's own until it posts and the books issue theirs.
 */
const VCH_ABBR: Record<string, string> = {
  sale: 'SAL', purchase: 'PUR', receipt: 'RCT', payment: 'PAY',
}
const billLabel = (b: Bill) =>
  // A voucher opened for editing already carries the books' own label —
  // prefixing it again gave rows reading "SAL-SAL-0003".
  b.voucherId ? String(b.number) : `${VCH_ABBR[b.kind ?? 'sale']}-${b.number}`

/**
 * Which tab an account opens on. A sale or a receipt is written against a
 * customer, a purchase or a payment against a supplier — so the voucher's own
 * series says where its party is filed, and the day book need not ask.
 */
const sideOf = (label: string): 'customers' | 'suppliers' =>
  label.startsWith('PUR') || label.startsWith('PAY') ? 'suppliers' : 'customers'

/** The line a day opens with — named where naming it helps. */
const dayLabel = (ms: number) => {
  const d = new Date(ms)
  const stamp = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
  const on = iso(d)
  if (on === iso(new Date())) return `Today · ${stamp}`
  if (on === iso(new Date(Date.now() - 864e5))) return `Yesterday · ${stamp}`
  return stamp
}

/** A bill's ISO date to the epoch milliseconds the vouchers are dated in. */
const startOfDay = (isoDate: string) => Date.parse(`${isoDate}T00:00:00`)

type DayRow = {
  key: string
  date: number
  label: string
  party: string
  partyId?: string
  ref: string
  side: 'customers' | 'suppliers'
  account: string
  amount: number | null
  photos: string[]
  billId?: string
  draft?: boolean
  onDelete?: () => void
  /** Why the books refused this bill, and how to ask them again. */
  problem?: string
  onRetry?: () => void
  /** When it was written, which is not the date written on it. */
  entered: number
}

function BillDayBook({ bills, onNew, onDelete, onRetry }: {
  bills: Bill[]
  onNew: (kind?: BillKind) => void
  onDelete: (id: string) => Promise<boolean>
  onRetry: (bill: Bill & { total: number }) => void
}) {
  const dark = useLedgerTheme()
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState<Bill | null>(null)
  const [previewing, setPreviewing] = useState<Bill | null>(null)

  // The period lives in the URL, so a day's book is a link someone can send.
  const [params, setParams] = useSearchParams()
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const byDate = params.get('order') === 'date'
  const setView = (f: string, t: string, dated: boolean) => {
    const next: Record<string, string> = {}
    if (f) next.from = f
    if (t) next.to = t
    if (dated) next.order = 'date'
    setParams(next, { replace: true })
  }
  const setPeriod = (f: string, t: string) => setView(f, t, byDate)

  // The server already knows how to answer for a window — the ledger's day
  // book has taken from/to since it was written; nothing ever passed them.
  const vouchers = useQuery(api.reports.dayBook, {
    from: from ? startOfDay(from) : undefined,
    to: to ? startOfDay(to) + 86_399_999 : undefined,
  })
  const loading = vouchers === undefined

  // Every bill is a bill: there are no drafts to keep apart any more.
  const finished = bills

  const rows = useMemo<DayRow[]>(() => {
    const list: DayRow[] = (vouchers ?? []).map((v: any) => ({
      key: v._id,
      date: v.date,
      label: v.vchLabel,
      party: v.party,
      partyId: v.partyLedgerId,
      ref: v.refNo || '',
      side: sideOf(v.vchLabel),
      account: (v.contra ?? []).join(', '),
      amount: v.status === 'pending' ? null : v.amount,
      photos: (v.attachmentUrls ?? []).map((a: any) => a?.url).filter(Boolean),
      entered: v.createdAt ?? v.date,
      billId: bills.find((b) => b.voucherId === v._id)?.id
        ?? (String(v.refNo ?? '').startsWith('BILL-')
          ? bills.find((b) => `BILL-${b.number}` === v.refNo)?.id
          : undefined),
    }))

    /**
     * A bill that never reached the books still happened, so it gets a row of
     * its own — but only if the books have not already got it, or the day book
     * shows one sale twice.
     *
     * The pairing is by the voucher the bill names. Matching on the `BILL-n`
     * reference alone was enough until a bill could carry a reference of its
     * own: a bill with "07" in its Ref box posted a voucher that matched no
     * bill, and the sale appeared as both SAL-0063 and bill 15. The reference
     * is still checked, for bills written before they recorded a voucher id.
     */
    const postedIds = new Set((vouchers ?? []).map((v: any) => String(v._id)))
    const postedRefs = new Set(
      (vouchers ?? []).map((v: any) => String(v.refNo ?? '')).filter((r) => r.startsWith('BILL-')),
    )
    for (const b of finished) {
      if (b.voucherId && postedIds.has(String(b.voucherId))) continue
      if (postedRefs.has(`BILL-${b.number}`)) continue
      const at = startOfDay(b.date)
      if (from && at < startOfDay(from)) continue
      if (to && at > startOfDay(to)) continue
      list.push({
        key: b.id,
        date: at,
        label: billLabel(b),
        party: b.customerName || '—',
        partyId: b.ledgerId,
        ref: b.ref || '',
        side: sideOf(billLabel(b)),
        account: b.postError ? `Not posted — ${b.postError}` : 'Not posted',
        amount: b.total,
        photos: [],
        entered: b.updatedAt ?? b.postedAt ?? at,
        billId: b.id,
        problem: b.postError,
        onRetry: b.postError ? () => onRetry({ ...b, total: b.total }) : undefined,
        onDelete: () => setDeleting(b),
      })
    }

    // Newest first: this is the screen you open to see what just happened, and
    // ascending order buries today under two hundred rows. By default that is
    // the latest *entered* — a slip from last week typed in just now belongs at
    // the top, not a week down — with the bill's own date as the other order.
    return byDate
      ? list.sort((a, b) => b.date - a.date || b.label.localeCompare(a.label))
      : list.sort((a, b) => b.entered - a.entered || b.label.localeCompare(a.label))
  }, [vouchers, finished, from, to, bills, onRetry, byDate])

  const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0)

  // A day book is read a day at a time: each date opens with its own line and
  // closes with what the day came to, and the date is not repeated down the
  // rows underneath it.
  const days = useMemo(() => {
    const out: { date: number; rows: DayRow[]; total: number }[] = []
    // In entry order the dates jump about, so there are no day lines to draw.
    if (!byDate) return rows.length ? [{ date: 0, rows, total: 0 }] : out
    for (const r of rows) {
      const key = iso(new Date(r.date))
      const last = out[out.length - 1]
      if (last && iso(new Date(last.date)) === key) last.rows.push(r)
      else out.push({ date: r.date, rows: [r], total: 0 })
    }
    for (const d of out) d.total = d.rows.reduce((s, r) => s + (r.amount ?? 0), 0)
    return out
  }, [rows, byDate])

  const today = iso(new Date())
  const yesterday = iso(new Date(Date.now() - 864e5))
  const monthStart = `${today.slice(0, 8)}01`
  const chips = [
    { label: 'Today', f: today, t: today },
    { label: 'Yesterday', f: yesterday, t: yesterday },
    { label: 'This month', f: monthStart, t: today },
    { label: 'All', f: '', t: '' },
  ]

  return (
    <div className={`ledger-root min-h-screen ${dark ? 'dark' : ''}`}>
      <div className="app">
        {deleting && (
          <Confirm
            title={`Delete bill #${deleting.number}?`}
            body="The bill and the voucher it posted go to Trash together."
            confirmLabel="Delete"
            danger
            onConfirm={async () => {
              const gone = await onDelete(deleting.id)
              if (!gone) throw new Error('Could not reach the books, so the bill was not deleted.')
            }}
            onClose={() => setDeleting(null)}
          />
        )}
        {previewing && (
          <VoucherBillPreview bill={previewing} onClose={() => setPreviewing(null)} />
        )}
        <header className="topbar">
          <h1 className="pagetitle">Day Book</h1>
          <div className="actions">
            <button className="btn" onClick={() => onNew()}>+ New Bill</button>
          </div>
        </header>

        <div className="toolbar">
          <div className="count">
            {loading ? 'Loading…' : `${rows.length} vouchers · ${rupees(total)}`}
          </div>
          <div className="actions">
            <input type="date" value={from} onChange={(e) => setPeriod(e.target.value, to)} />
            <input type="date" value={to} onChange={(e) => setPeriod(from, e.target.value)} />
            {chips.map((c) => (
              <button
                key={c.label}
                className={`btn${from === c.f && to === c.t ? '' : ' ghost'}`}
                onClick={() => setPeriod(c.f, c.t)}
              >
                {c.label}
              </button>
            ))}
            <button
              className="btn ghost"
              title={byDate ? 'Showing by bill date — switch to latest entered first' : 'Showing latest entered first — switch to bill date'}
              onClick={() => setView(from, to, !byDate)}
            >
              {byDate ? 'By bill date' : 'Latest entered'}
            </button>
          </div>
        </div>

        {loading ? (
          <TableSkeleton cols={7} rows={8} wide={2} />
        ) : (
          <div className="table-wrap">
            <div className="scroller">
              <table className="ledger">
                <thead>
                  <tr>
                    <th className="w-no">Vch</th>
                    <th>Party</th>
                    <th className="w-ref">Ref</th>
                    <th>Particulars</th>
                    <th className="num">Amount</th>
                    <th className="w-clip" />
                    <th className="w-acts" />
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <Fragment key={day.date}>
                      {byDate && (
                        <tr className="grouprow">
                          <td colSpan={4}>{dayLabel(day.date)}</td>
                          <td className="num">{rupees(day.total)}</td>
                          <td colSpan={2} />
                        </tr>
                      )}
                      {day.rows.map((r) => (
                    <tr key={r.key} className={r.problem ? 'unposted' : r.amount === null ? 'unpriced' : undefined}>
                      <td className="mono entryno" data-label="Vch">
                        {r.label}
                        {/* No day lines in entry order, so each row says its own date. */}
                        {!byDate && <div className="ref">{iso(new Date(r.date)).split('-').reverse().join('/').replace(/\/(\d\d)(\d\d)$/, '/$2')}</div>}
                      </td>
                      <td className="particulars" data-label="Party">
                        {/* The name is the account: it opens their ledger,
                            whether or not the voucher came from a bill. The
                            bill itself is behind the pencil, where an edit
                            belongs. */}
                        {r.partyId ? (
                          <button
                            className="link plain"
                            onClick={() => navigate(`/ledger/${r.side}/${r.partyId}`)}
                          >
                            {r.party}
                          </button>
                        ) : (
                          r.party
                        )}
                      </td>
                      <td className="ref mono" data-label="Ref">{r.ref || '—'}</td>
                      <td className="particulars" data-label="Particulars">
                        {r.problem ? <span className="warn">{r.account}</span> : (r.account || '—')}
                      </td>
                      <td className="num" data-label="Amount">
                        {r.amount === null ? <span className="warn">awaiting amount</span> : rupees(r.amount)}
                      </td>
                      <td className="w-clip" data-label="">
                        {r.photos.length > 0 && (
                          <button
                            className="clip"
                            aria-label="Bill photo"
                            onClick={() => window.open(r.photos[0], '_blank', 'noopener')}
                          >
                            <span aria-hidden="true"><Paperclip size={13} aria-hidden="true" /></span>
                            {r.photos.length > 1 && <span>{r.photos.length}</span>}
                          </button>
                        )}
                        {/* The bill itself, drawn from its figures — the same
                            receipt icon the ledger shows beside a line. */}
                        {r.billId && bills.some((b) => b.id === r.billId) && (
                          <button
                            className="clip"
                            aria-label="Show the bill"
                            title="Show the bill"
                            onClick={() => setPreviewing(bills.find((b) => b.id === r.billId) ?? null)}
                          >
                            <ReceiptText size={13} aria-hidden="true" />
                          </button>
                        )}
                      </td>
                      <td className="rowacts">
                        {/* One editor for everything: a voucher posted from a
                            bill opens that bill, any other opens as a bill with
                            no lines and its photograph attached. */}
                        <button
                          className="xbtn"
                          aria-label="Edit"
                          onClick={() => navigate(
                            r.billId ? `/bills/${r.billId}` : `/bills/voucher/${r.key}`,
                          )}
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                        {r.onRetry && (
                          <button className="xbtn" aria-label="Post to the books" title="Post to the books" onClick={r.onRetry}>
                            <RefreshCw size={14} aria-hidden="true" />
                          </button>
                        )}
                        {r.onDelete && (
                          <button className="xbtn del" aria-label="Delete" onClick={r.onDelete}><X size={14} aria-hidden="true" /></button>
                        )}
                      </td>
                    </tr>
                      ))}
                    </Fragment>
                  ))}

                  {!rows.length && (
                    <tr>
                      <td colSpan={7} className="particulars">
                        {from || to ? 'No vouchers in this period.' : 'No vouchers yet.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

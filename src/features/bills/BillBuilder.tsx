import { useState, useDeferredValue, useRef, useCallback, useLayoutEffect, useMemo, useEffect, createContext, useContext, Fragment } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Camera, Download, FolderOpen, RotateCcw, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, IndianRupee, Lock, Minus, Paperclip, Pencil, Plus, Printer, ReceiptText, Redo2, RefreshCw, Trash2, Truck, Undo2, X } from 'lucide-react'
import { flushLocal, useStore } from '../../lib/store'
import { useShortcuts } from '../../lib/useShortcuts'
// The ledger's own photo picker: files chosen here, and photographs the phone
// has already sent in. One picker for the whole shop rather than a second one
// that would drift from it.
import BillDropUntyped from '../ledger/components/BillDrop'
import BillViewerUntyped, { photoStrip as photoStripUntyped } from '../ledger/components/BillViewer'
import type { Attachment } from '../../lib/attachments'
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
  picked: PickedPhoto[]
  onPick: (picked: PickedPhoto[]) => void
  onViewBill?: (shown: unknown) => void
  attached?: { storageId: string }[]
  /** Set to a function that swaps the picked bill for the tile before (-1) or after (+1) it. */
  stepRef?: { current: ((dir: number) => boolean) | null }
  /** Where the picked bill sits among the tiles, or null when none is picked. */
  onPosition?: (pos: { index: number; count: number; label: string } | null) => void
  onWaiting?: (first: { key: string; shown: unknown } | null) => void
  onDetach?: (file: { storageId: string; contentType?: string | null }) => void
}) => JSX.Element

/** The ledger's full-screen photo viewer, likewise plain JSX. */
const photoStrip = photoStripUntyped as unknown as (entries: { key: string; vchLabel?: string; vchType?: string; date?: number; party?: string; amount?: number | null; refNo?: string; attachmentUrls?: unknown[] }[], clicked: string, title: string) => unknown
const BillViewer = BillViewerUntyped as unknown as (props: {
  voucher: unknown
  onClose: () => void
  docked?: boolean
  onExpand?: () => void
  /** Controls first in the viewer's zoom row. */
  toolsBefore?: React.ReactNode
}) => JSX.Element

/** A phone photo as the picker hands it over: the queue row, url and all. */
type PickedPhoto = { _id: string; storageId: string; source?: 'voucher' | 'legacy'; url?: string; at?: number; queueNo?: number }

/** The bill drawn from its figures, as the ledger opens it; plain JSX too. */
const VoucherBillPreview = VoucherBillPreviewUntyped as unknown as (props: {
  bill: Bill
  onClose: () => void
}) => JSX.Element
import type { Bill, BillItem, ProductCategory } from '../../lib/types'
import { CATEGORY_META, isRoundupLine, isAmountOnlyLine, isChargeName, BILL_KINDS, isQuotation, isBuyingBill, nextQuoteNumber, DEFAULT_PAYMENT_MODE } from '../../lib/types'
import type { BillKind } from '../../lib/types'
import { SiteSizesNote } from './WorkOrders'
import { DEFAULT_GST_RATE, GST_RATES, handLines, withCharges, type BillCharges } from '../../lib/billCharges'
import { MONEY_KINDS, buildBillHtml, formatItemDescription, toProperCase, withoutCourtesy } from '../../lib/billHtml'
import { deviceId, deviceName } from '../../lib/device'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
// The day book is the ledger's table, so it uses the ledger's own styling and
// formatters rather than a second set that would drift from them.
import '../ledger/ledger.css'
import { useLedgerTheme } from '../ledger/useLedgerTheme'
import { useLive } from '../ledger/lib/cache'
import { rupees } from '../ledger/lib/format'
import { TableSkeleton } from '../ledger/components/Skeleton'
import { billSqft, isFootSized } from '../../lib/pricing'
import { readBoardSize, sizeLabel, sqftFields, withSqft } from '../../lib/boardSize'
import { keepTyped, rateForUnit, withUnitRate } from '../../lib/linePick'
import { itemHistory, recallList, type ItemHistory, type RecalledItem } from '../../lib/itemHistory'
import { lastSoldRates, openingRate, type SoldRate } from '../../lib/rateFill'
import { canonicalUnit, foldName, isWithoutBillParty } from '../../../convex/lib/text'
import { catalogChangesFor } from '../../lib/learnCatalog'
import { paidByDefault, withPaidDefault } from '../../lib/paidDefault'
import { AgainstDeliveries, CheckedBy, ChecksNotice, deliveryChecks, type DeliveryRow } from './Deliveries'
import { StockMoves, stockGoesOut } from './StockMoves'
import { convexEnabled } from '../../lib/convexSync'
import { Button, DropDown } from '../../components/ui'
import { toast } from '../../components/Toast'
import { queueBillPhotos } from '../../lib/billPhotoOutbox'
import { knownPapers, partyPaperKnown } from '../../lib/paperUrls'
import { postingTrouble, queuePost } from '../../lib/postOutbox'
import Confirm from '../ledger/components/Confirm'
import { indiaDate, indiaToday } from '../../lib/businessDate'
import { clearFormDraft, draftKey, loadFormDraft, saveFormDraft } from '../../lib/formDrafts'

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
  // Past the last box is Accept, as in Tally. Without this, Enter on the
  // Narration of a payment or receipt went nowhere: it is the last box, and
  // the step clamped to it.
  if (dir === 1 && i === fields.length - 1) {
    const save = document.querySelector<HTMLButtonElement>('[data-bill-save]')
    if (save) { save.focus(); return }
  }
  const next = fields[i === -1 ? 0 : Math.min(fields.length - 1, Math.max(0, i + dir))]
  next?.focus()
  if (next instanceof HTMLInputElement) next.select?.()
}

const uid = () => Math.random().toString(36).slice(2, 10)
const today = indiaToday

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

/** "₹250/Pkt · ₹3/Pc" for an item sold in more than one unit, else its one rate. */
function rateHint(e: { rate?: number; unitRates?: Record<string, number> }, cur = '₹'): string | undefined {
  const byUnit = Object.entries(e.unitRates ?? {})
  if (byUnit.length > 1) return byUnit.map(([u, r]) => `${cur}${r}/${u}`).join(' · ')
  return e.rate ? `${cur}${e.rate}` : undefined
}

/**
 * Sheets of one thickness go out at one square-foot rate.
 *
 * Price one 30mm line and every other 30mm line still waiting for a price takes
 * the same ₹/sqft, worked to its own size and qty. A line with the same name
 * besides its size ("30mm S") is followed first, so two kinds of 19mm on one
 * bill keep their own rates; failing that any line of the thickness will do.
 *
 * Only empty lines are filled, and the ones filled this way (`auto`) keep
 * following the rate until someone prices them by hand (`hand`) — a line
 * someone typed a price into is never overwritten.
 */
function fillSheetRates(items: BillItem[], editedId: string, auto: Set<string>, hand: Set<string>): BillItem[] {
  const sheets = new Map<string, NonNullable<ReturnType<typeof readBoardSize>>>()
  for (const i of items) {
    if (isRoundupLine(i) || isAmountOnlyLine(i)) continue
    const s = readBoardSize(i.description)
    if (s) sheets.set(i.id, s)
  }
  const donors = items.filter(i => sheets.has(i.id) && !auto.has(i.id) && sqftFields(i).sqftRate)
  if (!donors.length) return items
  // The line just edited leads, so changing a rate carries to the others.
  donors.sort((a, b) => Number(b.id === editedId) - Number(a.id === editedId))
  const kind = (s: { rest: string }) => s.rest.toLowerCase()

  let changed = false
  const next = items.map(i => {
    const s = sheets.get(i.id)
    if (!s || hand.has(i.id)) return i
    // Catalog boards work their own price from the area pickers.
    if (i.category && !HARDWARE_CATS.includes(i.category)) return i
    if (i.amount && !auto.has(i.id)) return i
    const same = donors.filter(d => d.id !== i.id && sheets.get(d.id)!.thicknessMm === s.thicknessMm)
    const donor = same.find(d => kind(sheets.get(d.id)!) === kind(s)) ?? same[0]
    if (!donor) return i
    const qty = i.qty || 1
    const amount = Math.round(sqftFields(donor).sqftRate! * s.exactSqft * qty)
    auto.add(i.id)
    if (amount === i.amount) return i
    changed = true
    return withSqft({ ...i, amount, rateSqft: Math.round((amount / qty) * 100) / 100 })
  })
  return changed ? next : items
}

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
  /** The bill's account is a supplier's — decides which side a goods return is on. */
  supplierSide?: boolean
  item: BillItem
  idx: number
  onUpdate: (id: string, patch: Partial<BillItem>) => void
  onRemove: (id: string) => void
  /** Enter on the last field of the row: open the next line, adding one if needed. */
  onRowDone: (idx: number) => void
  /** Enter on an untouched row: discard it and finish entering lines. */
  onBlankRowDone: (id: string) => void
  /** My Items entries this bill made, and what this line may do to them. */
  myItems: {
    made: (entryId: string) => void
    rename: (entryId: string, lineId: string, name: string) => boolean
    drop: (entryId: string, lineId: string) => boolean
    sweep: () => void
  }
  /** Which side of the books this line is on — see saveCustomEntryRate. */
  kind: BillKind
  disabled?: boolean
  /** What this side of the books has billed lately — units, and Up's recall. */
  history: ItemHistory
  /** The last price each item was sold at, as Shiv Rates shows it — see rateFill. */
  sold: Map<string, SoldRate>
  /** Every line on this bill, whose rates a new line follows first. */
  lines: BillItem[]
  /** The lines above this one, which Up offers first. */
  linesAbove: BillItem[]
}

function SmartItemRow({ item, idx, onUpdate, onRemove, onRowDone, onBlankRowDone, myItems, kind, supplierSide = false, disabled, history, sold, lines, linesAbove }: SmartItemRowProps) {
  const { sets, hardwareCatalog, setHardwareCatalog, customCatalog, addCustomEntry, updateCustomEntry, units, addUnit } = useStore()

  /** Stored units plus an "add" row, so the list only holds what the shop uses. */
  const unitOptions = useMemo(
    () => [...units.map(u => ({ value: u, label: u })), { value: '__add__', label: '+ Add unit…' }],
    [units],
  )
  /** Returns the canonical unit to store — a new one is remembered. */
  function pickUnit(v: string): string | null {
    if (!v || v === '__add__') return null
    // One spelling per unit: "kg", "KG" and "Kg" are the same pick.
    const typed = canonicalUnit(v)
    if (!typed) return null
    const saved = units.find((u) => canonicalUnit(u) === typed)
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
    // A screw sells by the packet and by the piece at two figures: switching
    // the unit brings back the rate last used for that unit. With none saved
    // for it, a rate that was only the old unit's remembered one is cleared
    // rather than billing a packet's price per piece; a typed one stays.
    const remembered = item.customEntryId
      ? customCatalog.find(e => e.id === item.customEntryId)
      : item.category && HARDWARE_CATS.includes(item.category) ? hardwareCatalog[item.category] : undefined
    const rate = remembered ? rateForUnit(remembered, unit) : 0
    const oldRate = remembered ? rateForUnit(remembered, item.unit) : 0
    const qty = item.qty || 1
    const figures = rate
      ? { rateSqft: rate, amount: Math.round(rate * qty) }
      : oldRate && item.rateSqft === oldRate ? { rateSqft: undefined, amount: 0 } : {}
    onUpdate(item.id, { unit, ...figures })
    if (item.customEntryId) {
      updateCustomEntry(item.customEntryId, { unit })
    } else if (item.category && HARDWARE_CATS.includes(item.category)) {
      const current = hardwareCatalog[item.category] ?? { sizes: [], brands: [] }
      setHardwareCatalog({ ...hardwareCatalog, [item.category]: { ...current, unit } })
    }
  }
  const activeSet = sets[0]
  /** A supplier's side of the books: its prices are never a selling rate. */
  const buying = isBuyingBill(kind, supplierSide)
  const catSizes  = (cat: ProductCategory) => hardwareCatalog[cat]?.sizes ?? []
  const catBrands = (cat: ProductCategory) => hardwareCatalog[cat]?.brands ?? []
  const catFields = (cat: ProductCategory) => (hardwareCatalog[cat]?.fields ?? []).filter(f => f.values.length > 0)
  const catRate   = (cat: ProductCategory) => hardwareCatalog[cat]?.rate ?? 0

  // Persist the last-used rate for a hardware category so it pre-fills next time
  function saveRateToCatalog(cat: ProductCategory, rate: number) {
    if (!rate) return
    const current = hardwareCatalog[cat] ?? { sizes: [], brands: [] }
    setHardwareCatalog({ ...hardwareCatalog, [cat]: { ...current, rate, unitRates: withUnitRate(current.unitRates, item.unit, rate) } })
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
    // A catalogue item named like a built-in line (Bill, Fare, Cartage…) is a
    // leftover from before those were kept out of the catalogue: offered here it
    // sat above "Bill — total amount only" as a second Bill, priced at one old
    // bill's total. The built-in option is the one to use.
    const offered = customCatalog.filter((e) => !isAmountOnlyLine({ description: e.name }))
    const q = search.toLowerCase().trim()
    if (!q) return offered
    // An item folded in from a supplier's own entry keeps that wording as a
    // spelling that finds it, so an SRT bill can be typed as it is printed.
    return offered.filter(
      e =>
        e.name.toLowerCase().includes(q) ||
        (e.alsoKnownAs ?? []).some(also => also.toLowerCase().includes(q)),
    )
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
    { kind: 'bill' as const },
    { kind: 'roundup' as const },
    { kind: 'fare' as const },
  ], [filtered, customFiltered, search, duplicateEntry])

  /** A fare, cartage or labour charge: a figure with a label, nothing else. */
  function pickFare() { pickCharge('Fare') }

  /**
   * Any charge on the bill — fare, a discount, CGST 9% — as a label and an
   * amount. The line drops whatever a catalogue item brought with it: no
   * My Items link, unit or rate, so it cannot print with a quantity.
   */
  function pickCharge(label: string) {
    onUpdate(item.id, {
      description: label,
      amountOnly: true,
      unit: undefined,
      fieldValues: undefined,
      heightIn: undefined,
      widthIn: undefined,
      isRoundup: undefined,
      isDiscount: undefined,
      category: undefined,
      customEntryId: undefined,
      brandName: undefined,
      sizeIn: undefined,
      qty: 1,
      rateSqft: undefined,
      // An amount already typed stays; a charge is still that figure.
      amount: item.amount || 0,
    })
    setSearch(label)
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
  /**
   * Where the item this line already holds sits in the open list, or -1.
   *
   * Opening the list on a line that already has an item used to land on the
   * first row, so the list said nothing about what the line was: you had to
   * read every row to find the one you were on, and Enter would quietly
   * replace it with whatever happened to sort first.
   */
  const selectedIndex = useMemo(
    () =>
      item.customEntryId
        ? navOptions.findIndex((o) => o.kind === 'custom' && o.entry.id === item.customEntryId)
        : -1,
    [navOptions, item.customEntryId],
  )
  // The line's own item if the list is showing it; otherwise the first row —
  // which is what typing a fresh query wants, since the best match sorts first
  // and the old item has usually dropped out of the list by then.
  useEffect(() => {
    setHighlight(selectedIndex >= 0 ? selectedIndex : 0)
  }, [search, navOptions.length, selectedIndex])

  const setPanelList = useContext(ListPanelContext)

  /**
   * What a pick from the panel does, kept where the effect below can reach it
   * without depending on it.
   *
   * The handler closes over the row — its item, its search, the catalogue — so
   * it is a different function on every render. Naming it in the effect's
   * dependencies would put the list back into the panel on every render, and
   * the panel is the parent's state, so that is a render that causes a render.
   * A ref is one box whose contents are replaced; the box itself never
   * changes, so the effect can be left alone.
   */
  const pickFromPanel = useRef<(v: string) => void>(() => {})
  useEffect(() => {
    pickFromPanel.current = (v) => {
      if (v === 'roundup') { pickRoundup(); return }
      if (v === 'bill') { pickCharge('Bill'); return }
      if (v === 'fare') { pickFare(); return }
      if (v === 'add') { addItemFromSearch(); return }
      if (v.startsWith('c:')) {
        const opt = filtered.find(o => o.category === v.slice(2))
        if (opt) selectCategory(opt)
        return
      }
      const entry = customFiltered.find(e => e.id === v.slice(2))
      if (entry) selectCustomEntry(entry)
    }
  })

  // Mirror the open list into the right-hand panel, Tally-style. Cleared on
  // close so the panel never shows a stale list from a field you have left.
  useEffect(() => {
    if (!showDrop || !navOptions.length || !search.trim()) return
    setPanelList({
      title: 'List of Items',
      highlight,
      rows: navOptions.map((o) =>
        o.kind === 'category' ? { value: `c:${o.opt.category}`, label: o.opt.label }
        : o.kind === 'custom' ? { value: `e:${o.entry.id}`, label: formatItemDescription(o.entry.name), hint: rateHint(o.entry, 'Rs ') }
        : o.kind === 'roundup' ? { value: 'roundup', label: 'Roundup (minus)' }
        : o.kind === 'bill' ? { value: 'bill', label: 'Bill — total amount only' }
        : o.kind === 'fare' ? { value: 'fare', label: 'Fare / cartage' }
        : { value: 'add', label: `Create "${search.trim()}"` },
      ),
      onPick: (v) => pickFromPanel.current(v),
    })
    return () => setPanelList(null)
  }, [showDrop, navOptions, search, highlight, setPanelList])

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
        ...keepTyped(item, {
          rate: savedRate,
          unit: hardwareCatalog[opt.category]?.unit ?? HARDWARE_DEFAULT_UNIT[opt.category] ?? 'Pc',
          unitRates: hardwareCatalog[opt.category]?.unitRates,
        }),
        description: [opt.label, defaultSize, defaultBrand, fieldStr].filter(Boolean).join(' '),
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


  // ── Custom entry helpers ─────────────────────────────────────────────────
  function selectCustomEntry(entry: { id: string; name: string; sizes: string[]; brands: string[]; rate?: number; unit?: string; unitRates?: Record<string, number> }) {
    const same = item.customEntryId === entry.id
    const name = formatItemDescription(entry.name)
    // "Discount", "CGST 9%", "Fare" saved in My Items are charges, not goods:
    // the line takes the name and an amount, and nothing about a quantity.
    if (isChargeName(name)) {
      // Passing back through a line that already is this charge is
      // navigation: keep the amount that was typed on it.
      if (isAmountOnlyLine(item) && item.description.trim().toLowerCase() === name.toLowerCase()) {
        setSearch(name)
        setShowDrop(false)
        return
      }
      pickCharge(name)
      return
    }
    setSearch(name)
    setShowDrop(false)
    // The unit it went out in last time, then whatever the item remembers.
    const unit = history.unitOfEntry.get(entry.id) ?? history.unitOf.get(foldName(entry.name)) ?? entry.unit
    // A sale opens at the rate this bill already gives the item, then its last
    // selling price; only failing both does its own remembered rate fill it.
    const opening = buying || same ? null : openingRate(name, unit, lines, item.id, sold)
    onUpdate(item.id, {
      customEntryId: entry.id,
      category: undefined,
      description: name,
      sizeIn:    entry.sizes[0] ?? undefined,
      brandName: entry.brands[0] ?? undefined,
      // Re-picking the item this line already holds must not disturb what's on
      // it — passing back through the field is navigation, not a fresh choice.
      // What is typed on the line wins; the item's remembered rate and unit
      // only fill a line that has none yet. See keepTyped.
      ...(same ? {} : keepTyped(item, opening
        ? { rate: opening.rate, unit: opening.unit }
        : { rate: entry.rate, unit, unitRates: entry.unitRates })),
      heightIn:  undefined,
      widthIn:   undefined,
    })
  }

  /**
   * Enter on a typed-out name: save it to My Items and use it straight away,
   * skipping the add form. Rate, sizes and brands can be filled in on the row
   * afterwards — at the counter the point is to keep billing, not to stop and
   * fill a form for every new item.
   */
  /**
   * Up in an empty item box brings back the last item entered — the line
   * above first, then what was billed lately — and each further Up goes one
   * older; Down comes back, and past the newest the box is empty again.
   *
   * The item comes back whole: its My Items link, size and brand, the unit it
   * went out in and the rate it went at. Each step replaces the last, so the
   * walk never leaves one item's price on another. Typing ends the walk.
   */
  const walk = useRef<{ at: number; list: RecalledItem[] } | null>(null)
  function recallItem(older: boolean): boolean {
    let w = walk.current
    if (!w) {
      if (!older || search.trim() || isCatalog) return false
      const list = recallList(linesAbove, history.recent)
      if (!list.length) return false
      w = walk.current = { at: -1, list }
    }
    const next = w.at + (older ? 1 : -1)
    if (next < 0) {
      walk.current = null
      applyRecalled(null)
      return true
    }
    // At the oldest it stops rather than wrapping, so the end is findable.
    if (next >= w.list.length) return true
    w.at = next
    applyRecalled(w.list[next])
    return true
  }

  function applyRecalled(r: RecalledItem | null) {
    const entry = r?.customEntryId ? customCatalog.find(e => e.id === r.customEntryId) : undefined
    const unit = r?.unit || entry?.unit || 'Pc'
    // A sale takes the rate this bill already gives the item, then its last
    // selling price. Otherwise the price it went at when it was recalled from;
    // failing that, the item's remembered selling rate for that unit.
    const opening = r && !buying ? openingRate(r.description, unit, lines, item.id, sold) : null
    const rate = r ? (opening?.rate || r.rate || (entry && !buying ? rateForUnit(entry, unit) : 0)) : 0
    const qty = item.qty || 1
    const description = r?.description ?? ''
    onUpdate(item.id, {
      category: undefined,
      customEntryId: entry?.id,
      description,
      sizeIn: r?.sizeIn,
      brandName: r?.brandName,
      fieldValues: r?.fieldValues,
      heightIn: undefined,
      widthIn: undefined,
      unit,
      rateSqft: rate || undefined,
      amount: rate ? Math.round(rate * qty) : 0,
    })
    setSearch(description)
    setShowDrop(false)
  }

  function addItemFromSearch() {
    const name = formatItemDescription(search.trim())
    if (!name) return
    if (name.toLowerCase() === 'bill') { pickCharge('Bill'); return }
    // Already in My Items — pick it rather than creating a duplicate.
    if (duplicateEntry) { selectCustomEntry(duplicateEntry); return }
    const newId = addCustomEntry(name)
    myItems.made(newId)
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

  /**
   * What an item was just billed at, remembered for next time.
   *
   * With one division that costs real money. `rate` is the figure a fresh line
   * starts at, and it must only ever be learned from selling. Typing a
   * supplier's bill used to set it too — enter SRT's 12mm SG 8 X 4 at 1,888
   * and the next customer's line opened at 1,888 against the 3,072 the shop
   * asks. Nobody is told; the bill simply goes out at cost.
   *
   * The figure is still worth keeping either way, so it joins `rates` — the
   * list offered on the row — whichever side of the books it came from. Only
   * the default stays a selling price.
   */
  function saveCustomEntryRate(entryId: string, rate: number) {
    if (!rate) return
    const entry = customCatalog.find(e => e.id === entryId)
    // Keep the figure at the front and drop any earlier copy of it, so the list
    // reads newest-first without repeats. Capped so it stays scannable.
    const rates = [rate, ...(entry?.rates ?? []).filter(r => r !== rate)].slice(0, 8)
    updateCustomEntry(entryId, buying ? { rates } : { rate, rates, unitRates: withUnitRate(entry?.unitRates, item.unit, rate) })
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

  // A sheet named with its thickness and size gets its square-foot rate shown
  // under the line. Typing into it prices the line; otherwise it follows the
  // amount. While the field has focus it holds what is being typed, because
  // the amount rounds to a rupee and reading back through it would move the
  // figure under the cursor.
  const sheet = useMemo(() => (amountOnly ? null : readBoardSize(item.description)), [item.description, amountOnly])
  const [sqftTyping, setSqftTyping] = useState<string | null>(null)
  const sqftRate = sqftFields(item).sqftRate

  function handleSqftRate(text: string) {
    setSqftTyping(text)
    if (!sheet) return
    const rate = Number(text)
    const qty = item.qty || 1
    const amount = rate > 0 ? Math.round(rate * sheet.exactSqft * qty) : 0
    onUpdate(item.id, {
      amount,
      // Lines that carry a rate keep it as the price of one piece, as typing
      // the amount does.
      ...(isCustomEntry || isHardware ? { rateSqft: amount ? Math.round((amount / qty) * 100) / 100 : undefined } : {}),
    })
  }

  return (
    <div className="bg-white px-2 py-1.5 dark:bg-stone-900">
      <div className="flex items-start gap-2">
        <span className="mt-2 w-5 shrink-0 text-center text-xs font-bold text-muted">{idx + 1}</span>
        <div className="flex-1 min-w-0 space-y-2">

          {/* Description / product search */}
          {/* Wrap against the space left by the navigation and options panel. */}
          <div className="flex flex-wrap items-start gap-2">
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
                  walk.current = null
                  // Proper case is case-only, so it never disturbs the caret.
                  // The 8x4 -> 8 X 4 spacing changes length, so only apply it
                  // while typing at the end; mid-edit it would jump the cursor.
                  const atEnd = el.selectionStart === el.value.length
                  const v = atEnd ? formatItemDescription(el.value) : toProperCase(el.value)
                  if (atEnd && v !== el.value) {
                    requestAnimationFrame(() => el.setSelectionRange(v.length, v.length))
                  }
                  const mine = item.customEntryId
                  if (mine && !v.trim() && myItems.drop(mine, item.id)) {
                    // Clearing the name of an item this bill made takes the
                    // item with it: it was never anything but this line.
                    onUpdate(item.id, {
                      category: undefined,
                      customEntryId: undefined,
                      brandName: undefined,
                      sizeIn: undefined,
                      heightIn: undefined,
                      widthIn: undefined,
                      description: v,
                    })
                  } else if (mine && v.trim() && myItems.rename(mine, item.id, v)) {
                    // Correcting the name of an item this bill made corrects
                    // that item, and the line stays on it — otherwise Enter
                    // would add a second entry beside the misspelt first.
                    onUpdate(item.id, { description: v })
                  } else if (isCatalog) {
                    // Editing a picked name is editing text: the line lets go
                    // of the catalogue item but keeps its qty, unit, rate and
                    // amount — renaming "1" Baffer" must not unprice it.
                    onUpdate(item.id, {
                      category: undefined,
                      customEntryId: undefined,
                      brandName: undefined,
                      sizeIn: undefined,
                      heightIn: undefined,
                      widthIn: undefined,
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
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    // Dropdown closed → the arrows belong to the bill, not the
                    // list: recall on an empty box, else move between boxes.
                    if (!showDrop || !navOptions.length) {
                      e.preventDefault()
                      if (recallItem(e.key === 'ArrowUp')) return
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
                  // A recalled item is already whole on the line: Enter takes
                  // it and carries on, rather than filing its name as new.
                  if (walk.current && !showDrop) {
                    walk.current = null
                    moveBillFocus(1)
                    return
                  }
                  // A blank stock-item field is Tally's signal that item entry
                  // is over. Do not create a made-up line or make the operator
                  // erase it manually before finishing the bill.
                  if (!search.trim() && !isCatalog) {
                    onBlankRowDone(item.id)
                    return
                  }
                  if (search.trim().toLowerCase() === 'bill') { pickCharge('Bill'); return }
                  const pick = showDrop ? navOptions[highlight] : undefined
                  if (pick) {
                    // Take the highlighted row — first result unless arrowed away.
                    if (pick.kind === 'category') selectCategory(pick.opt)
                    else if (pick.kind === 'custom') selectCustomEntry(pick.entry)
                    else if (pick.kind === 'roundup') { pickRoundup(); return }
                    else if (pick.kind === 'bill') { pickCharge('Bill'); return }
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
                  walk.current = null
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
                          {rateHint(entry) ? <span className="text-xs text-muted">{rateHint(entry)}</span> : null}
                        </button>
                      ))}
                    </div>
                  )}

                  <button
                    onMouseDown={(e) => { e.preventDefault(); pickCharge('Bill') }}
                    onMouseEnter={() => setHighlight(navOptions.length - 3)}
                    className={`flex w-full items-center gap-2 border-t border-stone-100 px-3 py-2 text-sm dark:border-white/5 ${highlight === navOptions.length - 3 ? 'bg-stone-100 dark:bg-white/10' : ''}`}
                  >
                    <ReceiptText size={13} /> Bill — total amount only
                  </button>

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
                              myItems.made(newId)
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
                      placeholder="Amt" data-bill-nav="1" data-bill-row={idx} data-bill-col="amt"
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

          {sheet && !!item.description.trim() && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span className="font-semibold tabular-nums">
                {sheet.thicknessMm}mm · {sizeLabel(sheet)} · {sheet.sqft} sqft
              </span>
              <div className="relative w-28 shrink-0">
                <IndianRupee size={10} className="absolute left-1.5 top-2 text-muted" />
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  aria-label="Rate per sqft"
                  value={sqftTyping ?? (sqftRate ?? '')}
                  onFocus={(e) => { setSqftTyping(sqftRate ? String(sqftRate) : ''); e.target.select() }}
                  onBlur={() => {
                    setSqftTyping(null)
                    if (isCustomEntry && item.customEntryId && item.amount && item.qty) {
                      saveCustomEntryRate(item.customEntryId, Math.round((item.amount / item.qty) * 100) / 100)
                    }
                  }}
                  onChange={(e) => handleSqftRate(e.target.value)}
                  className="w-full rounded-md border border-stone-200 bg-stone-50 py-1 pl-5 pr-10 text-xs font-semibold tabular-nums dark:border-white/10 dark:bg-stone-800 dark:text-white"
                />
                <span className="pointer-events-none absolute right-2 top-1.5 text-[10px] font-semibold text-muted">/sqft</span>
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

/** How big the docked bill is, kept on this PC between bills. */
type DockSize = { w: number; h: number }
const DOCK_KEY = 'shiv.billDock'
function readDockSize(): DockSize {
  const fallback = { w: Math.round(Math.min(640, Math.max(360, window.innerWidth * 0.34))), h: Math.round(window.innerHeight * 0.42) }
  try {
    const kept = JSON.parse(localStorage.getItem(DOCK_KEY) ?? 'null')
    return kept && kept.w > 0 && kept.h > 0 ? kept : fallback
  } catch {
    return fallback
  }
}

/**
 * The bill photo kept open while the bill is typed from it: down the right of
 * the screen on a computer (beside the item list), across the bottom on a
 * phone. Its edge drags to make it wider or taller. The form makes room for
 * it rather than going under it, and typing carries on in the form.
 */
function BillDock({ size, onResize, children }: {
  size: DockSize
  onResize: (size: DockSize) => void
  children: React.ReactNode
}) {
  const drag = (event: React.PointerEvent, side: 'w' | 'h') => {
    event.preventDefault()
    const start = { x: event.clientX, y: event.clientY, ...size }
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    let next = size
    const move = (e: Event) => {
      const { clientX, clientY } = e as PointerEvent
      next = side === 'w'
        ? { ...size, w: Math.round(Math.min(window.innerWidth * 0.7, Math.max(280, start.w + start.x - clientX))) }
        : { ...size, h: Math.round(Math.min(window.innerHeight * 0.75, Math.max(160, start.h + start.y - clientY))) }
      onResize(next)
    }
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      try { localStorage.setItem(DOCK_KEY, JSON.stringify(next)) } catch { /* the size just isn't kept */ }
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }
  return (
    <aside
      className="no-print fixed inset-x-0 bottom-[var(--mobile-bottom-nav-space)] z-30 h-[var(--dock-h)] px-1.5 pt-3 md:inset-x-auto md:bottom-auto md:right-0 md:top-0 md:h-screen md:w-[var(--dock-w)] md:pb-2 md:pl-3 md:pr-2 md:pt-2 xl:right-80 2xl:right-96"
      style={{ '--dock-w': size.w + 'px', '--dock-h': size.h + 'px' } as React.CSSProperties}
      aria-label="Bill photo"
    >
      {/* Phone: the top edge drags up and down. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Drag to resize the bill photo"
        onPointerDown={(e) => drag(e, 'h')}
        className="absolute inset-x-0 top-0 flex h-4 cursor-row-resize touch-none items-center justify-center md:hidden"
      >
        <span className="h-1 w-12 rounded-full bg-stone-400 dark:bg-stone-500" />
      </div>
      {/* Computer: the left edge drags left and right. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize the bill photo"
        onPointerDown={(e) => drag(e, 'w')}
        className="absolute inset-y-0 left-0 hidden w-3 cursor-col-resize touch-none items-center justify-center hover:bg-shiv-green/20 md:flex"
      >
        <span className="h-12 w-1 rounded-full bg-stone-400 dark:bg-stone-500" />
      </div>
      <div className="h-full">{children}</div>
    </aside>
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
    <aside className="no-print fixed right-0 top-0 z-30 hidden h-screen w-80 flex-col border-l border-stone-300 bg-stone-50 dark:border-white/15 dark:bg-stone-900 xl:flex 2xl:w-96">
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

  // See the note on pickFromPanel in SmartItemRow: naming the handler in the
  // dependencies would set the parent's state on every render, for ever.
  const pickUnitFromPanel = useRef<(v: string) => void>(() => {})
  useEffect(() => {
    pickUnitFromPanel.current = (v) => { commit(v === '__new__' ? text.trim() : v); onCommit() }
  })

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
      onPick: (v) => pickUnitFromPanel.current(v),
    })
    return () => setPanelList(null)
  }, [open, text, matches, exact, hl, setPanelList])

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

/**
 * The empty row left at the foot of the form for the next item is not part of
 * the bill: it saved as a line with no name and no amount (bill 366 printed a
 * blank line 2). Charges and round-off lines are kept. A voucher whose only
 * line is blank — a receipt or payment — keeps it as it always has.
 */
function withoutBlankLines(items: BillItem[]): BillItem[] {
  const kept = items.filter((i) => i.description.trim() || Number(i.amount) || i.auto || i.isRoundup || i.isDiscount)
  return kept.length ? kept : items
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
  /** Customer or Supplier — shown where a list holds both, as a goods return's does. */
  side?: 'Customer' | 'Supplier'
}

/**
 * Which side of the books each voucher is written on. A sale and a receipt are
 * both the customer's; a purchase and a payment are both the supplier's.
 */
/** The two vouchers that are money and nothing else. */

const PARTY_SIDE: Record<BillKind, 'customer' | 'supplier' | 'both'> = {
  sale: 'customer',
  receipt: 'customer',
  purchase: 'supplier',
  payment: 'supplier',
  // A goods return comes back from a customer or goes back to a supplier.
  return: 'both',
  // Money handed back to a customer.
  refund: 'customer',
  // Goods in from a supplier, ahead of their bill.
  grn: 'supplier',
  // A price given to a customer, not yet a sale.
  quotation: 'customer',
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
    paymentMode: DEFAULT_PAYMENT_MODE,
    upiRef: '',
    notes: '',
  }
}

/** Returns true if the bill has at least a customer name or one item description. */
function hasMeaningfulContent(bill: Bill): boolean {
  return bill.customerName.trim().length > 0 || bill.items.some(i => i.description.trim().length > 0)
}

/**
 * Discount, GST and round-off for the whole bill. Each is a setting, and the
 * lines it writes are listed underneath with what they came to.
 */
/** Whether a bill uses a discount, GST or a round-off. */
const chargesInUse = (b: Bill) =>
  Number(b.offValue) > 0 || (b.gst ?? 'none') !== 'none' || (b.round ?? 'off') !== 'off'

function ChargesPanel({ bill, charges, onChange }: {
  bill: Bill
  charges: BillItem[]
  onChange: (patch: Partial<BillCharges>) => void
}) {
  const gst = bill.gst ?? 'none'
  const round = bill.round ?? 'off'
  const rate = bill.gstRate ?? DEFAULT_GST_RATE
  // A tax line typed by hand as well as the one written here would charge it twice.
  const typedTax = gst !== 'none' && handLines(bill.items).some((i) => /gst/i.test(i.description ?? '') && isChargeName(i.description))
  const typedRound = round !== 'off' && handLines(bill.items).some((i) => isRoundupLine(i))

  const seg = (on: boolean) =>
    `px-2.5 py-1.5 text-xs font-semibold transition first:rounded-l-lg last:rounded-r-lg ${
      on ? 'bg-shiv-green text-stone-950' : 'bg-white text-muted hover:bg-stone-50 dark:bg-stone-800 dark:hover:bg-stone-700'
    }`
  const group = 'flex overflow-hidden rounded-lg border border-stone-200 dark:border-white/10 [&>*+*]:border-l [&>*+*]:border-stone-200 dark:[&>*+*]:border-white/10'
  const field = 'w-20 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-right text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white'
  const num = (v: string) => (v === '' ? undefined : Number(v) || 0)

  return (
    <div className="mt-3 rounded-lg border border-stone-300 p-3 dark:border-white/15">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted">Discount</span>
          <div className={group}>
            <button type="button" className={seg(!bill.offIsPercent)} onClick={() => onChange({ offIsPercent: undefined })}>₹</button>
            <button type="button" className={seg(!!bill.offIsPercent)} onClick={() => onChange({ offIsPercent: true })}>%</button>
          </div>
          <input
            type="number" inputMode="decimal" min={0} max={bill.offIsPercent ? 100 : undefined}
            data-bill-nav="1" onKeyDown={billArrowKeys}
            aria-label={bill.offIsPercent ? 'Discount percent' : 'Discount in rupees'}
            placeholder="0"
            value={bill.offValue ?? ''}
            onFocus={(e) => e.target.select()}
            onChange={(e) => onChange({ offValue: num(e.target.value) })}
            className={field}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted">GST</span>
          <div className={group}>
            <button type="button" className={seg(gst === 'none')} onClick={() => onChange({ gst: undefined })}>None</button>
            <button type="button" className={seg(gst === 'local')} onClick={() => onChange({ gst: 'local' })}>CGST + SGST</button>
            <button type="button" className={seg(gst === 'igst')} onClick={() => onChange({ gst: 'igst' })}>IGST</button>
          </div>
          {gst !== 'none' && (
            <select
              aria-label="GST rate"
              value={rate}
              onChange={(e) => onChange({ gstRate: Number(e.target.value) })}
              className="rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-stone-800 dark:text-white"
            >
              {GST_RATES.map((r) => (
                <option key={r} value={r}>{gst === 'local' ? `${r}% (${r / 2} + ${r / 2})` : `${r}%`}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted">Round off</span>
          <div className={group}>
            <button type="button" className={seg(round === 'off')} onClick={() => onChange({ round: undefined })}>Off</button>
            <button type="button" className={seg(round === 'auto')} onClick={() => onChange({ round: 'auto' })}>Auto</button>
            <button type="button" className={seg(round === 'manual')} onClick={() => onChange({ round: 'manual' })}>Manual</button>
          </div>
          {round === 'manual' && (
            <input
              type="number" inputMode="decimal" step="any"
              data-bill-nav="1" onKeyDown={billArrowKeys}
              aria-label="Round off amount, minus to take off"
              placeholder="-0"
              value={bill.roundValue ?? ''}
              onFocus={(e) => e.target.select()}
              onChange={(e) => onChange({ roundValue: num(e.target.value) })}
              className={field}
            />
          )}
        </div>
      </div>

      {charges.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-stone-200 pt-2 text-sm dark:border-white/10">
          {charges.map((c) => (
            <div key={c.id} className="flex justify-end gap-6">
              <span className="text-muted">{c.description}</span>
              <span className={`w-28 text-right font-semibold tabular-nums ${c.amount < 0 ? 'text-red-600 dark:text-red-300' : 'dark:text-white'}`}>
                {c.amount < 0 ? '−' : '+'}₹{Math.abs(c.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          ))}
        </div>
      )}
      {round === 'manual' && (
        <p className="mt-2 text-xs text-muted">Type a minus figure to take money off, a plain one to add it.</p>
      )}
      {typedTax && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">A GST line is also typed in the items above, so tax is on this bill twice. Remove one.</p>
      )}
      {typedRound && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">A Roundup line is also typed in the items above. Remove it, or set Round off to Off.</p>
      )}
    </div>
  )
}

/**
 * A saved bill as the editor holds it: the lines the counter wrote. Discount,
 * GST and round-off lines are written again from the bill's settings, so the
 * copies saved with it are set aside rather than edited as goods.
 */
function forEditing(bill: Bill): Bill {
  const items = handLines(bill.items)
  return {
    ...bill,
    items: items.length ? items : [emptyItem()],
    // Some older sales have no paidAmount field. Their saved paid flag is the
    // record; editing one must not apply today's default to yesterday's sale.
    ...((bill.kind ?? 'sale') === 'sale' && bill.paidAmount == null
      ? { paidAmount: bill.paid ? bill.total : 0 }
      : {}),
  }
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
  const frameRef = useRef<HTMLIFrameElement>(null)
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

  /**
   * The bill as it prints, drawn again as it is typed. It used to be drawn on
   * every key pressed, and each time the frame was thrown away and loaded
   * afresh: the typing waited on it, and the preview blinked. Now it follows a
   * moment after the typing stops (useDeferredValue keeps keys first, the
   * timer lets a burst of keys settle), and the new bill is written into the
   * frame already there instead of loading a new one.
   */
  const settled = useDeferredValue(bill)
  const [shown, setShown] = useState(settled)
  useEffect(() => {
    const timer = setTimeout(() => setShown(settled), 180)
    return () => clearTimeout(timer)
  }, [settled])
  const numPages = Math.max(1, Math.ceil((shown.items?.length ?? 0) / 14))
  const totalH = BILL_H_PX * numPages
  const html = useMemo(() => buildBillHtml(shown), [shown])
  // The first drawing is the frame's own document; every one after is
  // written into it.
  const [srcDoc] = useState(html)
  const drawn = useRef(html)
  // What was last written in by hand, so the load that writing fires is not
  // taken for the first document arriving late.
  const written = useRef('')
  useEffect(() => {
    if (drawn.current === html) return
    const doc = frameRef.current?.contentDocument
    if (!doc) return
    drawn.current = html
    written.current = html
    doc.open()
    doc.write(html)
    doc.close()
  }, [html])

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
            ref={frameRef}
            srcDoc={srcDoc}
            // Should the first document finish loading after a newer bill was
            // written in, the newer one is written again over it.
            onLoad={() => {
              const doc = frameRef.current?.contentDocument
              if (!doc || drawn.current === srcDoc || written.current === drawn.current) return
              written.current = drawn.current
              doc.open(); doc.write(drawn.current); doc.close()
            }}
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

/** Bills whose posting is still on its way to the server, by id. */
const postingBills = new Set<string>()

// ---- Bill list card -------------------------------------------------------
export function BillBuilder() {
  const { id, voucherId } = useParams<{ id?: string; voucherId?: string }>()
  const navigate = useNavigate()
  const { bills, saveBill, deleteBill, nextBillNumber, customCatalog, addCustomEntry, updateCustomEntry, removeCustomEntry } = useStore()

  const existing = id ? bills.find((b) => b.id === id) : undefined
  const [draft, setDraft] = useState<Bill>(() => (existing ? forEditing(existing) : emptyBill(nextBillNumber())))
  /**
   * Unsaved typing, kept on this device (src/lib/formDrafts.ts). `opened` is
   * the form as it was opened, so an edit to a saved bill counts as typing
   * only once it differs from it; `quiet` stops the keeping once the voucher
   * has been saved, printed or discarded.
   */
  const opened = useRef<Bill | null>(existing ? forEditing(existing) : null)
  const quiet = useRef(false)
  const lastDraftKey = useRef<string | null>(null)
  const [restored, setRestored] = useState(false)
  /** Opens a form on `bill`, or on the typing left on it last time. */
  const openOn = (bill: Bill, key: string): Bill => {
    opened.current = bill
    quiet.current = false
    const kept = loadFormDraft(key)
    setRestored(!!kept)
    return kept ?? bill
  }
  /** A quotation takes the next Q- number; everything else the next bill number. */
  const numberFor = (k: BillKind) => (k === 'quotation' ? nextQuoteNumber(bills) : nextBillNumber())
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
  const partyGroup = kind === 'purchase' || kind === 'payment' || kind === 'grn' ? 'Sundry Creditors' : 'Sundry Debtors'
  /**
   * Purchase and Payment list suppliers only; Sale and Receipt customers only.
   * A Goods Return lists both, each marked, because a return comes back from
   * a customer or goes back to a supplier.
   */
  // A payment can also be wages to a member of staff or rent for a premises,
  // which are accounts of their own rather than suppliers.
  const partyGroups = kind === 'return'
    ? ['Sundry Debtors', 'Sundry Creditors']
    : kind === 'payment'
      ? [partyGroup, 'Staff', 'Rent Payable']
      : [partyGroup]
  const masters = useLive(api.masters.all, {}, 'masters')
  // The deliveries a purchase can be the bill for, and the ones this very
  // purchase already bills.
  const deliveries = useQuery(
    api.receipts.open,
    kind === 'purchase' ? { alsoFor: draft.voucherId ? String(draft.voucherId) : undefined } : 'skip',
  )?.rows as DeliveryRow[] | undefined
  // What the checks found at the last press of Save; a second press with the
  // same findings saves.
  const [checkList, setCheckList] = useState<string[]>([])
  const checksRef = useRef<string[]>([])
  /** The account the name on this voucher is, when it is one — its side decides a return. */
  const namedAccount = useMemo(() => {
    const wanted = foldName(draft.customerName)
    if (!wanted) return undefined
    return (masters?.ledgers ?? []).find(
      (l: any) => partyGroups.includes(l.groupName) && foldName(l.name) === wanted,
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masters, draft.customerName, kind])
  /** Which side of the books this voucher's party is on, as far as can be told. */
  const sideGroup = kind === 'return' ? (namedAccount?.groupName ?? 'Sundry Debtors') : partyGroup
  /** Buying or selling — a return to a supplier is buying. Decides which rates are offered and learned. */
  const buying = isBuyingBill(kind, sideGroup === 'Sundry Creditors')
  const suppliers = useMemo(
    () => new Set((masters?.ledgers ?? []).filter((l: any) => l.groupName === 'Sundry Creditors').map((l: any) => String(l._id))),
    [masters],
  )
  // What this side of the books has billed lately, newest first.
  const history = useMemo(() => itemHistory(bills, buying, suppliers), [bills, buying, suppliers])
  // What each item last sold at, for a sale line this bill does not already
  // price: the panel's own sales and the customers' slips read into the books,
  // read as Shiv Rates reads them.
  const scanned = useQuery(api.review.goods, !buying ? { limit: 5000 } : 'skip')
  const sold = useMemo(() => {
    if (buying) return new Map<string, SoldRate>()
    const customers = new Set((masters?.ledgers ?? []).filter(l => l.groupName === 'Sundry Debtors').map(l => String(l._id)))
    return lastSoldRates(bills, scanned?.lines ?? [], (id) => customers.has(id))
  }, [bills, scanned, masters, buying])

  const liveCustomers = useMemo<PartyOption[]>(() => {
    const byName = new Map<string, PartyOption>()

    for (const l of masters?.ledgers ?? []) {
      if (!partyGroups.includes(l.groupName)) continue
      // Keyed with case, spacing and "M/s" set aside, so "M/s Wb" and a bill
      // typed "Wb" are one party in the list, not two.
      byName.set(foldName(l.name), {
        id: l._id,
        name: l.name,
        mobile: l.phone ?? '',
        uid: l.aadhaar ?? '',
        account: true,
        side: l.groupName === 'Sundry Creditors' ? 'Supplier' : 'Customer',
      })
    }

    // Only the customer side has bills behind it; a supplier is never named on
    // one. An account of the same name already read wins — it carries the
    // balance, and offering both would put the two spellings side by side.
    if (kind === 'sale' || kind === 'receipt' || kind === 'refund') {
      // A supplier's name must not ride in on an old purchase or payment bill,
      // nor on a sale typed against a name that is a supplier's account.
      const suppliers = new Set(
        (masters?.ledgers ?? []).filter((l) => l.groupName === 'Sundry Creditors').map((l) => foldName(l.name)),
      )
      // A bill tied to an account is that account, under whatever it is called
      // now. Offering the name it was saved with is how a renamed customer came
      // back into this list under the old name, beside the new one.
      const accounts = new Set((masters?.ledgers ?? []).map((l) => String(l._id)))
      for (const b of bills) {
        const billKind = b.kind ?? 'sale'
        if (billKind !== 'sale' && billKind !== 'receipt') continue
        if (b.ledgerId && accounts.has(String(b.ledgerId))) continue
        const name = (b.customerName ?? '').trim()
        if (!name || byName.has(foldName(name)) || suppliers.has(foldName(name))) continue
        byName.set(foldName(name), {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills, kind, masters, partyGroup])

  const custMatches = useMemo(() => {
    const q = (draft.customerName ?? '').trim().toLowerCase()
    const pool = q
      ? liveCustomers.filter(c => c.name.toLowerCase().includes(q) || c.mobile.includes(q))
      : liveCustomers
    return pool.slice(0, 8)
  }, [draft.customerName, liveCustomers])
  useEffect(() => { setCustHl(0) }, [draft.customerName])

  // See the note on pickFromPanel in SmartItemRow: naming the handler in the
  // dependencies would set the parent's state on every render, for ever.
  const pickPartyFromPanel = useRef<(id: string) => void>(() => {})
  useEffect(() => {
    pickPartyFromPanel.current = (id) => {
      const c = custMatches.find((x) => x.id === id)
      if (c) pickCustomer(c)
    }
  })

  // Same panel, different list — Tally shows "List of Ledgers" here.
  useEffect(() => {
    if (!showCust || !custMatches.length || !(draft.customerName ?? '').trim()) return
    setPanelList({
      title: kind === 'return' ? 'List of Parties' : partyGroup === 'Sundry Creditors' ? 'List of Suppliers' : 'List of Customers',
      highlight: custHl,
      rows: custMatches.map((c) => ({
        value: c.id,
        label: c.name,
        hint: [kind === 'return' ? c.side : '', c.mobile].filter(Boolean).join(' · ') || (c.account ? '' : 'not in books'),
      })),
      onPick: (id) => pickPartyFromPanel.current(id),
    })
    return () => setPanelList(null)
  }, [showCust, custMatches, draft.customerName, custHl, kind, partyGroup, setPanelList])

  function pickCustomer(c: typeof liveCustomers[number]) {
    setDraft((d) => ({
      ...d,
      customerName: toProperCase(withoutCourtesy(c.name)),
      customerPhone: c.mobile,
      customerPhone2: '',
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
  const [asking, setAsking] = useState<null | 'delete' | 'leave' | 'quote'>(null)

  /**
   * What the party's account stands at, shown under their name the way Tally's
   * voucher screen shows it — the counter needs to know a customer is already
   * ninety thousand down before writing them another bill.
   */
  const partyBook = useLive(
    sideGroup === 'Sundry Creditors' ? api.reports.outstanding : api.reports.receivables,
    {},
    sideGroup === 'Sundry Creditors' ? 'payables' : 'receivables',
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
    return { amount: Number(row.closing) || 0, side: String(row.closingSide ?? 'Dr'), ledgerId: row.ledger?._id ? String(row.ledger._id) : '' }
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
  // Bumped by "Load newer" to read the voucher into the form again.
  const [voucherReload, setVoucherReload] = useState(0)
  useEffect(() => {
    if (!voucherId || !voucher || builtVoucher.current === voucherId) return
    builtVoucher.current = voucherId
    const fromBooks = (bill: Bill) => openOn(bill, draftKey({ voucherId, isNew: false }))
    const kindOf: Record<string, BillKind> = {
      sale: 'sale', purchase: 'purchase', receipt: 'receipt', payment: 'payment', 'goods return': 'return',
      refund: 'refund',
      'goods received': 'grn',
    }
    setDraft(fromBooks({
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
      // The money and the discount as they were posted, and where the money
      // went. Left to the new-voucher defaults, an unchanged save moved a cash
      // receipt to Bank and folded its discount into the money.
      ...(MONEY_KINDS.includes(kindOf[voucher.kind] ?? 'sale')
        ? { moneyAmount: voucher.moneyAmount ?? voucher.amount ?? 0, discount: voucher.discount ?? 0 }
        : {}),
      ...(voucher.paymentMode ? { paymentMode: voucher.paymentMode } : {}),
      rev: voucher.rev ?? 0,
      total: voucher.amount ?? 0,
      // Zero is deliberate here: an older ledger-only credit sale must stay
      // credit when opened in the bill editor and saved without changes.
      ...((kindOf[voucher.kind] === 'sale' || kindOf[voucher.kind] === 'purchase')
        ? { paidAmount: voucher.paidAmount ?? 0, paid: (voucher.paidAmount ?? 0) >= (voucher.amount ?? 0) && (voucher.amount ?? 0) > 0 }
        : {}),
      attachments: (voucher.attachments ?? []).map((a: any) => ({
        storageId: a.storageId, kind: a.kind ?? 'bill',
      })),
    }))
    setView('form')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voucherId, voucher, voucherReload])

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
  // `&grn=` comes from "Enter bill" on a delivery: the purchase is written
  // against that delivery, with its lines already on it.
  const newGrn = pageParams.get('grn')
  const [pendingGrn, setPendingGrn] = useState<string | null>(null)
  const clearPendingGrn = useCallback(() => setPendingGrn(null), [])
  useEffect(() => {
    if (!newKind) return
    setPendingGrn(newKind === 'purchase' ? newGrn : null)
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
    // A fresh form brings back what was typed on one of this kind and left
    // unsaved — unless it was opened for a named party, which is new work.
    const current = draftRef.current
    const startedNow = view === 'form' && hasMeaningfulContent({ ...current, total: calcTotal(current.items) })
    const freshForm = !startedNow || (kind === 'quotation' && !!current.postedAt)
    const fresh = emptyBill(numberFor(kind), kind)
    const freshBill = freshForm
      ? (newParty
        ? (() => { opened.current = fresh; quiet.current = false; setRestored(false); return { ...fresh, customerName: toProperCase(newParty) } })()
        // A kept new voucher takes today's next number: its old one may have
        // been issued since.
        : (() => { const kept = openOn(fresh, draftKey({ kind, isNew: true })); return kept === fresh ? fresh : { ...kept, number: fresh.number } })())
      : null
    setDraft((d) => {
      // A bill already in the books cannot become a quotation by switching —
      // its voucher would stay posted behind it — so that starts a fresh one.
      if (freshBill) return freshBill
      // Into a goods return the party always carries — it takes either side.
      const crossed = PARTY_SIDE[kind] !== 'both' && PARTY_SIDE[d.kind ?? 'sale'] !== PARTY_SIDE[kind]
      return {
        ...d,
        kind,
        // Moving into or out of a quotation moves between the two series.
        ...(isQuotation({ kind }) !== isQuotation(d) ? { number: numberFor(kind) } : {}),
        ...(newParty
          ? { customerName: toProperCase(newParty) }
          : crossed
            ? { customerName: '', customerPhone: '', customerPhone2: '', customerUid: '', ledgerId: undefined }
            : {}),
      }
    })
    // The bill photo open beside the form stays open across the switch. Only
    // marked when the switch starts a fresh voucher (a new id); a type changed
    // in place keeps the same id and closes nothing anyway.
    keepPhoto.current = Boolean(freshBill)
    // "New order" on the Work list: the quotation starts with Order on.
    if (pageParams.get('order') === '1') setDraft((d) => ({ ...d, workOrder: true }))
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
    setDraft(openOn(forEditing(bill), draftKey({ billId: id, isNew: false })))
    // "Convert to sale" from the customer's account lands here ready to save.
    if (pageParams.get('convert') === 'sale' && isQuotation(bill)) convertToSale()
    setView('form')
  }, [id, bills])

  /**
   * Soft lock. Opening a bill claims it and a heartbeat keeps the claim alive;
   * another counter opening the same bill gets it read-only instead of quietly
   * typing over the top. The claim is refreshed rather than held, so a closed
   * tab or a flat battery frees the bill on its own.
   */
  const postToLedger = useMutation(api.billLedger.postBill)
  const ensureParty = useMutation(api.billLedger.ensureParty)
  const syncQuote = useMutation(api.bills.save)
  const claimFromPhone = useMutation(api.inbox.claim)
  const claimVoucherPhoto = useMutation(api.voucherInbox.claim)
  const requeuePhoto = useMutation(api.voucherInbox.add)
  const removeFromBooks = useMutation(api.bills.removeImage)
  const upload = useUploader()
  // Chosen here, not yet uploaded — uploading happens once, on save.
  const [photoFiles, setPhotoFiles] = useState<File[]>([])
  const [photoPicked, setPhotoPicked] = useState<PickedPhoto[]>([])
  const ledgerDark = useLedgerTheme()
  // The bill being typed from, docked beside the form (BillDock) until closed;
  // full screen when asked. A new bill starts with nothing open.
  const [photoShown, setPhotoShown] = useState<unknown>(null)
  const [photoFull, setPhotoFull] = useState(false)
  const [dockSize, setDockSize] = useState<DockSize>(readDockSize)
  const [dockKey, setDockKey] = useState(0)
  // The phone queue's arrows on the docked photo (see BillDrop's stepRef).
  const stepPhoto = useRef<((dir: number) => boolean) | null>(null)
  const [photoPos, setPhotoPos] = useState<{ index: number; count: number; label: string } | null>(null)
  // The voucher a photo was last opened on by hand: what opens by itself never replaces that.
  const handShownFor = useRef('')
  const dockPhoto = (shown: unknown) => { setPhotoShown(shown); setPhotoFull(false); setDockKey((k) => k + 1) }
  const showPhoto = (shown: unknown) => { handShownFor.current = draft.id; dockPhoto(shown) }
  // A different bill closes the photo — except a switch of voucher type
  // (Sale to Receipt…), which starts a fresh voucher from the same paper: the
  // photo being typed from stays open (keepPhoto, set by that switch).
  const keepPhoto = useRef(false)
  const keptPhotoFor = useRef('')
  // Whether the voucher just left was a bill from the books with its own
  // paper. That paper is the old bill's, not what the new voucher is being
  // typed from, so it is never carried over, whatever started the new one.
  const leftPosted = useRef(false)
  useEffect(() => {
    const keep = keepPhoto.current && !leftPosted.current
    keepPhoto.current = false
    if (keep) { keptPhotoFor.current = draft.id; return }
    setPhotoShown(null); setPhotoFull(false)
  }, [draft.id])
  // A bill opened from the books comes with its paper: the photo already on
  // it is docked beside the form at once, without a click on its thumbnail.
  // Only for a bill that had its photo when it was opened: one being written
  // gains its photo on Save, and that must not spring the dock open. Once
  // closed, it stays closed until the bill is opened again.
  const paperAtOpen = useRef({ id: '', had: false, shown: false })
  if (paperAtOpen.current.id !== draft.id) {
    leftPosted.current = paperAtOpen.current.had
    paperAtOpen.current = { id: draft.id, had: (draft.attachments?.length ?? 0) > 0, shown: false }
  }
  // Known already when the bill was opened from a ledger (lib/paperUrls):
  // then there is nothing to ask the books.
  const paperKnown = paperAtOpen.current.had && draft.attachments?.length
    ? knownPapers(draft.attachments.map((a) => String(a.storageId)))
    : null
  const paperAsked = useQuery(
    api.files.describe,
    paperAtOpen.current.had && draft.attachments?.length && !paperKnown ? { storageIds: draft.attachments.map((a) => a.storageId) as never } : 'skip',
  )
  const paperOnBill = paperKnown ?? paperAsked
  useEffect(() => {
    const at = paperAtOpen.current
    if (!at.had || at.shown || at.id !== draft.id || !paperOnBill?.length) return
    at.shown = true
    if (handShownFor.current !== draft.id) dockPhoto({ attachmentUrls: paperOnBill, initialIndex: 0 })
  }, [paperOnBill, draft.id])
  // A new voucher starts from the paper: the first bill photo still waiting
  // to be filed (the first tile under "From the phone", told by BillDrop) is
  // docked beside the form as it opens. It is only shown, not picked: picking
  // is still a tap on its tile, so no voucher takes a photo it was not typed
  // from. When that photo is filed or thrown away while it is still the one
  // on show, the next waiting one takes its place.
  const [waitingPaper, setWaitingPaper] = useState<{ key: string; shown: unknown } | null | undefined>(undefined)
  // The account's newest bill, for a new receipt or payment (see below).
  // Known at once when the account's ledger was open (lib/paperUrls); asked
  // of the books only otherwise.
  const partyWanted = MONEY_KINDS.includes(draft.kind ?? 'sale') && !!partyBalance?.ledgerId && !voucherId && !bills.some((b) => b.id === draft.id)
  const partyKnown = partyWanted ? partyPaperKnown(partyBalance!.ledgerId) : undefined
  const partyAsked = useQuery(
    api.vouchers.lastPaper,
    partyWanted && partyKnown === undefined ? { ledgerId: partyBalance!.ledgerId as never } : 'skip',
  )
  const partyPaper = (partyKnown !== undefined ? partyKnown : partyAsked) as typeof partyAsked
  /**
   * A receipt or payment opened for an account (from its ledger, or with the
   * name typed) waits for that account's bill rather than showing the first
   * phone photo for a moment and then swapping it out. Only an account with
   * no bill photo gets the phone's.
   */
  const forParty = MONEY_KINDS.includes(draft.kind ?? 'sale') && !!withoutCourtesy(draft.customerName ?? '').trim()
  const partyStillComing = forParty && (partyBook === undefined || (!!partyBalance?.ledgerId && partyPaper === undefined))
  const autoPaper = useRef<{ id: string; key: string; shown: unknown }>({ id: '', key: '', shown: null })
  useEffect(() => {
    if (waitingPaper === undefined) return
    if (partyStillComing || (forParty && partyPaper)) return
    const isNew = !voucherId && !bills.some((b) => b.id === draft.id)
    if (!isNew || paperAtOpen.current.had || keptPhotoFor.current === draft.id) return
    if (photoPicked.length || photoFiles.length) return
    const auto = autoPaper.current
    const first = auto.id !== draft.id
    // Only what this put there is ever replaced, never a photo opened by hand.
    if (handShownFor.current === draft.id) return
    if (!first && (auto.key === (waitingPaper?.key ?? '') || photoShown !== auto.shown)) return
    autoPaper.current = { id: draft.id, key: waitingPaper?.key ?? '', shown: waitingPaper?.shown ?? null }
    if (waitingPaper) dockPhoto(waitingPaper.shown)
    else if (!first) setPhotoShown(null)
  }, [waitingPaper, draft.id, partyStillComing, partyPaper])
  /**
   * A new receipt or payment opens on the paper it is most likely written
   * against: the newest bill photo on that account's ledger, docked beside the
   * form once the account is chosen. It takes the place of a waiting phone
   * photo docked by itself, never of one opened by hand, and only once per
   * account chosen.
   */
  const partyPaperFor = useRef('')
  useEffect(() => {
    if (!partyPaper || !partyBalance?.ledgerId || handShownFor.current === draft.id) return
    const key = `${draft.id}:${partyBalance.ledgerId}`
    if (partyPaperFor.current === key) return
    partyPaperFor.current = key
    // The waiting phone photo, if it was docked by itself, gives way to this.
    autoPaper.current = { id: draft.id, key: autoPaper.current.key, shown: null }
    dockPhoto({ ...partyPaper, party: draft.customerName, initialIndex: 0 })
  }, [partyPaper, partyBalance?.ledgerId, draft.id])
  /**
   * A file taken off the bill it is attached to.
   *
   * A photo goes back to the phone's waiting queue first, so it can be put on
   * the voucher it belongs to: a file that nothing holds is deleted when the
   * bill is saved without it, and the queue is what holds it. Anything else
   * (a PDF) has no queue to wait in and is simply let go. The bill itself
   * changes on Save, like every other edit to it.
   */
  const detachPaper = async (file: { storageId: string; contentType?: string | null }) => {
    const isPhoto = (file.contentType ?? '').startsWith('image/')
    // In the books already: taken off the bill and its voucher there, at once
    // (bills.removeImage). Saving alone would not do it: posting only ever
    // adds to a voucher's papers.
    const kept = bills.find((b) => b.id === draft.id)
    const inBooks = draft.voucherId ?? kept?.voucherId ?? voucherId
    try {
      if (inBooks) {
        await removeFromBooks({
          ...(kept ? { billId: draft.id } : {}),
          voucherId: String(inBooks) as never,
          storageId: file.storageId as never,
        })
      } else if (isPhoto) {
        // Not posted yet: only this draft holds it. Back in the queue before
        // the draft lets go, so the file is never left with nothing holding it.
        await requeuePhoto({ storageId: file.storageId as never, groupId: `detached-${draft.id}` })
      }
    } catch (err) {
      toast(`Could not detach it\n${err instanceof Error ? err.message : String(err)}`, 'error')
      return
    }
    const without = (docs: Bill['attachments']) => (docs ?? []).filter((a) => a.storageId !== file.storageId)
    setDraft((d) => ({ ...d, attachments: without(d.attachments) }))
    // The copy this PC keeps of the bill, so a later sync does not put it back.
    if (kept) saveBill({ ...kept, attachments: without(kept.attachments) })
    setPhotoShown(null)
    toast(isPhoto ? 'Detached. The photo is back under From the phone.' : 'Taken off the bill.', 'info')
  }
  /**
   * Every paper on this bill: its own, and any that sits on its voucher alone.
   * The voucher can hold more than the bill does (a photo filed against it
   * from the ledger side, or one the bill let go of by an older Save), and
   * the day book counts the voucher's. Shown together, so what is counted
   * there can be seen here, and detached here.
   */
  const voucherOfBill = useQuery(api.vouchers.detail, draft.voucherId ? { id: draft.voucherId as never } : 'skip')
  const papersOnBill = useMemo(() => {
    const own = draft.attachments ?? []
    const seen = new Set(own.map((a) => a.storageId))
    const extra = ((voucherOfBill?.attachments ?? []) as { storageId: string; kind?: string }[])
      .filter((a) => !seen.has(a.storageId))
      .map((a) => ({ storageId: a.storageId, kind: (a.kind ?? 'bill') as NonNullable<Bill['attachments']>[number]['kind'] }))
    return extra.length ? [...own, ...extra] : own
  }, [draft.attachments, voucherOfBill])
  /** Picking a phone photo for the bill opens it, to type the bill from. */
  const pickPhotos = (next: PickedPhoto[]) => {
    const added = next.filter((p) => p.url && !photoPicked.some((o) => o._id === p._id))
    setPhotoPicked(next)
    if (added.length) {
      showPhoto({
        party: added.length > 1 ? `From the phone · ${added.length} pages` : 'From the phone',
        date: added[0].at,
        vchLabel: '',
        attachmentUrls: added.map((p) => ({
          storageId: p.storageId, url: p.url, previewUrl: p.url, kind: 'photo', contentType: 'image/jpeg',
          label: p.queueNo == null ? 'photo' : `#${String(p.queueNo).padStart(4, '0')}`,
        })),
      })
    }
  }
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  // What the paperwork on this kind of voucher is called, and how much of it
  // is already on the bill — counted here so the button can say so while shut.
  const isMoneyVoucher = MONEY_KINDS.includes(draft.kind ?? 'sale')
  /** A delivery with its rates already in: it files as a purchase too. */
  const pricedGrn = draft.kind === 'grn' && draft.items.some((i) => Number(i.amount) > 0 && !i.auto)
  /** Written against a supplier: a purchase or a payment. */
  const isWithoutBillSale = (draft.kind ?? 'sale') === 'sale' && isWithoutBillParty(draft.customerName)
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
  /**
   * What the customer's account already holds — a whole phone, a whole
   * Aadhaar, or both. Each one held is shown from the account, not asked for
   * on every bill; a box is only asked for what the account lacks. "Change"
   * brings both boxes back for this bill.
   */
  // The Discount · GST · Round off row, opened by its link (see chargesInUse).
  const [chargesOpen, setChargesOpen] = useState(false)
  const contactOnFile = useMemo(() => {
    const name = foldName(draft.customerName ?? '')
    const account = name ? liveCustomers.find((c) => c.account && foldName(c.name) === name) : undefined
    if (!account) return undefined
    const phone = /^\d{10}$/.test(account.mobile) ? account.mobile : ''
    const uid = /^\d{12}$/.test(account.uid ?? '') ? account.uid ?? '' : ''
    return phone || uid ? { id: account.id, phone, uid } : undefined
  }, [draft.customerName, liveCustomers])
  const [changeContact, setChangeContact] = useState(false)
  // The box for a second number, opened by its button; a bill that has one shows it anyway.
  const [secondPhone, setSecondPhone] = useState(false)
  useEffect(() => { setChangeContact(false) }, [contactOnFile?.id])
  // However the voucher was opened — the name typed, picked, or the voucher
  // started from the account itself — an empty box takes the account's
  // number, so the bill carries it and it need not be asked.
  useEffect(() => {
    if (!contactOnFile) return
    setDraft((d) => (
      (!d.customerPhone && contactOnFile.phone) || (!d.customerUid && contactOnFile.uid)
        ? {
            ...d,
            customerPhone: d.customerPhone || contactOnFile.phone,
            customerUid: d.customerUid || contactOnFile.uid,
          }
        : d))
  }, [contactOnFile])
  const phoneKnown = !!contactOnFile?.phone && !changeContact && (draft.customerPhone ?? '') === contactOnFile.phone
  const uidKnown = !!contactOnFile?.uid && !changeContact && (draft.customerUid ?? '') === contactOnFile.uid

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
  /** A bill neither the books nor this PC's storage would take: on screen only. */
  const [unkept, setUnkept] = useState<Bill | null>(null)
  const openCopyInput = useRef<HTMLInputElement>(null)
  /** The bill as a file, to keep when nothing else would. */
  function downloadCopy(bill: Bill) {
    const blob = new Blob([JSON.stringify({ shivPanelBill: 1, bill }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `bill-${bill.number || 'new'}-${bill.date}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  /** A copy downloaded earlier, back on the screen to be saved again. */
  async function openCopy(file: File) {
    try {
      const parsed = JSON.parse(await file.text())
      const bill = (parsed?.bill ?? parsed) as Bill
      if (!bill || typeof bill !== 'object' || !Array.isArray(bill.items)) throw new Error('Not a bill copy.')
      const { postError: _ignored, ...clean } = bill
      setDraft(clean as Bill)
      setView('form')
    } catch (err) {
      toast(`Could not open that file\n${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }
  /** Set when a save was refused because another counter saved first. */
  const [stale, setStale] = useState<{ newer: Bill | null } | null>(null)

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

  /**
   * Keeps the typing as it happens, so leaving by any route — the menu, a
   * shortcut, the Day Book, closing the tab — loses nothing. A new voucher is
   * kept once it has a name or a line; a saved one once it differs from how
   * it was opened.
   */
  useEffect(() => {
    if (view !== 'form' || readOnly || quiet.current) return
    const isNew = !voucherId && !bills.some((b) => b.id === draft.id)
    const key = draftKey({ billId: draft.id, voucherId, kind: draft.kind, isNew })
    // A new voucher switched to another kind moves its typing with it.
    if (lastDraftKey.current && lastDraftKey.current !== key && lastDraftKey.current.startsWith('new:')) {
      clearFormDraft(lastDraftKey.current)
    }
    lastDraftKey.current = key
    const timer = setTimeout(() => {
      const typed = isNew
        ? hasMeaningfulContent(draft)
        : !!opened.current && JSON.stringify(draft) !== JSON.stringify(opened.current)
      if (typed) saveFormDraft(key, draft)
      else clearFormDraft(key)
    }, 600)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, view, readOnly])

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
  // Discount, GST and round-off are written from the goods on every change,
  // so what is previewed, printed and posted is always the same bill.
  const priced = useMemo(() => (isMoneyVoucher ? draft : withCharges(draft)), [draft, isMoneyVoucher])
  const total = isMoneyVoucher ? money + discount : calcTotal(priced.items)
  const unpricedPurchase = draft.kind === 'purchase' &&
    (!(total > 0) || priced.items.some((item) =>
      item.description.trim() && !item.isRoundup && !item.isDiscount && !Number(item.amount)))
  const setCharges = (patch: Partial<BillCharges>) => setDraft((d) => ({ ...d, ...patch }))

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
    setDraft(emptyBill(numberFor(kind), kind))
    setView('form')
  }

  // Lines priced from another sheet's rate, and lines priced by hand — see fillSheetRates.
  const autoPriced = useRef(new Set<string>())
  const handPriced = useRef(new Set<string>())
  /**
   * Delivery lines arrive at what was last paid for each. A size never bought
   * before has no such figure, so it takes the square-foot rate of a sheet of
   * the same thickness on the bill — the same rule as typing one in.
   */
  const setDraftFromDeliveries = useCallback((fn: (d: Bill) => Bill) => {
    setDraft((d) => {
      const next = fn(d)
      return next.items === d.items
        ? next
        : { ...next, items: fillSheetRates(next.items, '', autoPriced.current, handPriced.current) }
    })
  }, [])

function updateItem(itemId: string, patch: Partial<BillItem>) {
    // A price typed in, rather than one re-worked for a new qty or size, makes
    // the line the operator's own: it stops following other lines' rates.
    const byHand = ('amount' in patch || 'rateSqft' in patch)
      && !('qty' in patch || 'description' in patch || 'heightIn' in patch || 'widthIn' in patch)
    if (byHand) { autoPriced.current.delete(itemId); handPriced.current.add(itemId) }
    // Every edit to a line passes here, so a sheet's square-foot rate is
    // re-read from its name, qty and amount whichever of them just changed.
    setDraft((d) => {
      const items = d.items.map((i) => (i.id === itemId ? withSqft({ ...i, ...patch }) : i))
      return { ...d, items: fillSheetRates(items, itemId, autoPriced.current, handPriced.current) }
    })
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

  /**
   * My Items entries this bill created, and what may be done to them.
   *
   * Typing a name that is not on the list makes an entry there and then, so
   * that billing need not stop to fill a form. Going back to that line and
   * correcting the name — or clearing it — should correct or remove the entry
   * just made, not leave a misspelling in My Items for ever and add a second
   * entry beside it.
   *
   * It must go no further than that. An entry the shop already uses is not
   * this line's to rename: typing over a picked "12mm SG 8 X 4" is editing a
   * line, and renaming the item under every bill that names it would be a
   * different and much larger act. So an entry follows the line only while it
   * was made on this bill and nothing else has claimed it — no other line
   * here, and no other bill anywhere.
   */
  const madeHere = useRef<Set<string>>(new Set())

  const entryIsThisLineAlone = useCallback(
    (entryId: string, lineId: string) => {
      if (!madeHere.current.has(entryId)) return false
      if (draft.items.some((i) => i.id !== lineId && i.customEntryId === entryId)) return false
      return !bills.some(
        (b) => b.id !== draft.id && (b.items ?? []).some((i) => i.customEntryId === entryId),
      )
    },
    [draft.items, draft.id, bills],
  )

  const myItems = useMemo(
    () => ({
      made: (entryId: string) => { madeHere.current.add(entryId) },
      /** Renamed if it is still this line's alone; says whether it was. */
      rename: (entryId: string, lineId: string, name: string) => {
        if (!entryIsThisLineAlone(entryId, lineId)) return false
        updateCustomEntry(entryId, { name })
        return true
      },
      /** Removed if it is still this line's alone; says whether it was. */
      drop: (entryId: string, lineId: string) => {
        if (!entryIsThisLineAlone(entryId, lineId)) return false
        removeCustomEntry(entryId)
        madeHere.current.delete(entryId)
        return true
      },
      /**
       * The bill is being abandoned: take its new items with it.
       *
       * Typing a name that is not on the list adds it to My Items at once, so
       * that billing need not stop. Walk away from the bill and that item has
       * no bill behind it and never will — a name nobody chose to keep, on the
       * list for ever, offered at every counter. Only what no saved bill has
       * claimed goes: a bill saved and then reopened and cancelled leaves its
       * items exactly where they are.
       */
      sweep: () => {
        for (const entryId of [...madeHere.current]) {
          const claimed = bills.some((b) =>
            (b.items ?? []).some((i) => i.customEntryId === entryId),
          )
          if (!claimed) removeCustomEntry(entryId)
          madeHere.current.delete(entryId)
        }
      },
    }),
    [entryIsThisLineAlone, updateCustomEntry, removeCustomEntry, bills],
  )

  function removeItem(itemId: string) {
    // A line thrown away takes with it an entry it alone had made.
    const held = draft.items.find((i) => i.id === itemId)
    if (held?.customEntryId) myItems.drop(held.customEntryId, itemId)
    setDraft((d) => ({ ...d, items: d.items.filter((i) => i.id !== itemId) }))
  }

  /**
   * Tally's voucher keys: Esc closes the screen, Ctrl+Q exits, Alt+D deletes
   * the voucher. Enter and the arrows already walk the fields, so this covers
   * the screen-level actions a counter operator reaches for without looking
   * up.
   *
   * Ctrl+A is deliberately NOT among them, though Tally accepts a voucher with
   * it. This screen is a browser, and Ctrl+A is select-all everywhere else in
   * one: binding it meant you could not select the text of a line you were
   * halfway through correcting without posting the bill. Saving is the button,
   * which is one key away by Tab and cannot be hit by muscle memory meant for
   * the text.
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
      // What this copy was opened from. A posted bill sends the server's count
      // it carries; a bill never in the books says so with null; a bill whose
      // state is not known here (an older copy without a voucher id) is not
      // checked rather than refused for nothing.
      const known = bills.find((b) => b.id === bill.id && !b.postError)
      const expectedRev = bill.voucherId ? bill.rev ?? 0 : known ? undefined : null
      const res = await postToLedger({
        bill: plain(bill) as never,
        attachments: (bill.attachments ?? []) as never,
        keepAsBill,
        ...(expectedRev !== undefined ? { expectedRev } : {}),
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
      // The server's reason travels as a ConvexError's data; the plain message
      // carries request ids and call-site noise around it.
      const data = (err as { data?: unknown })?.data
      // Another counter saved this bill after it was opened here. Nothing is
      // written and nothing is marked: the typing stays on screen, and the
      // newer copy is offered to look at.
      if (data && typeof data === 'object' && (data as { code?: string }).code === 'stale') {
        setStale({ newer: ((data as { newer?: Bill }).newer ?? null) })
        toast('Changed on another counter since you opened it.\nNot saved. Your typing is still here.', 'error')
        return null
      }
      const message = typeof data === 'string' ? data : err instanceof Error ? err.message : String(err)
      console.error('[ledger] posting failed', err)
      // A voucher borrowed from the ledger is not one of this PC's bills, so
      // there is nothing to keep it in — only the books, which refused it.
      if (!keepAsBill) {
        toast(`Not saved to the books\n${message}`, 'error')
        return null
      }
      saveBill({ ...bill, postError: message })
      // Said only once it is true. The PC's storage can be full or switched
      // off, and then the bill is on this screen and nowhere else.
      if (await flushLocal()) {
        toast(`Not saved to the books\n${message}\nKept on this PC as unposted.`, 'error')
      } else {
        setUnkept({ ...bill, postError: message })
        toast(`Not saved to the books, and not kept on this PC\n${message}\nDownload a copy before leaving this bill.`, 'error')
      }
      return null
    }
  }

  /** Attachments belong to quotations and posted vouchers alike. */
  async function prepareAttachments() {
    // The photographs go up first: a bill that saved without them would leave
    // the paper it was written from nowhere, and the ledger showing a voucher
    // with no document against it.
    let attachments = draft.attachments ?? []
    try {
      const docKind = MONEY_KINDS.includes(draft.kind ?? 'sale')
        ? ('receipt' as const)
        : ('bill' as const)
      const uploaded = photoFiles.length ? await upload(photoFiles) : []
      const allAttachments = [
        ...attachments,
        ...uploaded.map((storageId: string) => ({ storageId, kind: docKind })),
        ...photoPicked.map((p) => ({ storageId: p.storageId as string, kind: docKind })),
      ]
      attachments = [...new Map(allAttachments.map((doc) => [doc.storageId, doc])).values()]
      // An uploaded file belongs to this draft even if posting is refused.
      // Keep the phone's queue row until the voucher actually owns the photo.
      setDraft((d) => ({ ...d, attachments }))
      setPhotoFiles([])
    } catch (err) {
      toast(`Could not attach the photos\n${err instanceof Error ? err.message : String(err)}`, 'error')
      return null
    }

    return attachments
  }

  /** What is already in storage: the bill's own photos and any picked from the phone queue. */
  function attachedNow() {
    const docKind = MONEY_KINDS.includes(draft.kind ?? 'sale') ? ('receipt' as const) : ('bill' as const)
    const all = [
      ...(draft.attachments ?? []),
      ...photoPicked.map((p) => ({ storageId: p.storageId as string, kind: docKind })),
    ]
    return [...new Map(all.map((doc) => [doc.storageId, doc])).values()]
  }

  /**
   * The open bill: one posting call, then its new photographs in the
   * background (src/lib/billPhotoOutbox.ts) — Save no longer waits for every
   * page to be cropped and uploaded first.
   */
  async function postDraft(over?: Partial<Bill> & { total?: number }, opts: { wait?: boolean } = {}) {
    // A voucher opened from the books is edited here, but it is not one of the
    // shop's own bills and must not join their list — it would show twice in
    // the day book, once as the voucher and once as a bill of the same thing.
    // The `vch-` id is the test, not the voucherId: every posted bill has one.
    const borrowed = Boolean(voucherId) || String(draft.id).startsWith('vch-')
    // Such a voucher has no bill to add photos to afterwards, so its photos
    // still go up first.
    const later = borrowed ? [] : photoFiles
    const attachments = borrowed ? await prepareAttachments() : attachedNow()
    if (!attachments) return null
    // Stamped once more on the way out, for lines of an older bill that were
    // saved before sheets carried a square-foot rate and not touched since.
    const outgoing = {
      ...priced,
      // A W/B sale goes in as paid in full — see src/lib/paidDefault.ts.
      // Anything in `over` still wins.
      ...withPaidDefault(priced, total),
      total,
      ...((draft.kind ?? 'sale') === 'purchase' ? { checks: checksRef.current } : {}),
      ...over,
      items: withoutBlankLines(over?.items ?? priced.items).map(withSqft),
      attachments,
    } as Bill & { total: number }
    const photoKind = MONEY_KINDS.includes(draft.kind ?? 'sale') ? ('receipt' as const) : ('bill' as const)

    /*
     * Instant save. The bill is kept on this PC and the screen moves on; the
     * books get it in the background (src/lib/postOutbox.ts) and their answer
     * — the number, the voucher, the account — replaces this copy a moment
     * later. Until then it shows as "Posting…". A refusal marks it "Not
     * posted" with a Retry, as before. Only a caller that needs the books'
     * answer before it can go on (a delivery filed with its purchase) waits.
     */
    if (!borrowed && !opts.wait) {
      const known = bills.find((b) => b.id === outgoing.id && !b.postError && !b.pendingPost)
      const expectedRev = outgoing.voucherId ? outgoing.rev ?? 0 : known ? undefined : null
      queuePost(outgoing, expectedRev)
      if (later.length) {
        void queueBillPhotos({ id: outgoing.id, number: outgoing.number }, photoKind, later)
        setPhotoFiles([])
      }
      void claimPhotos()
      return { bill: outgoing, ledgerId: outgoing.ledgerId }
    }

    const result = await postStored(outgoing, !borrowed)
    // Posted, or kept on this PC as unposted: either way the bill exists, and
    // its photos follow it — the outbox keeps trying until the books have it.
    // Refused outright (changed on another counter), nothing is saved, so the
    // photos stay on the form with the typing.
    const kept = result?.bill ?? useStore.getState().bills.find((b) => b.id === draft.id && b.postError)
    if (later.length && kept) {
      void queueBillPhotos({ id: kept.id, number: kept.number }, photoKind, later)
      setPhotoFiles([])
    }
    if (!result) return null
    void claimPhotos()
    return result
  }

  async function claimPhotos() {
    const failedClaims = [] as typeof photoPicked
    for (const p of photoPicked) {
      try {
        if (p.source === 'voucher') await claimVoucherPhoto({ id: p._id as never })
        else await claimFromPhone({ id: p._id as never })
      } catch {
        failedClaims.push(p)
      }
    }
    setPhotoPicked(failedClaims)
    if (failedClaims.length) toast('Bill saved, but its photo is still in the phone queue.', 'error')
  }

  /**
   * Hand the bill to the catalogue.
   *
   * What is worth learning — which lines are products, which figure may become
   * a default price, what counts as already known — is decided in
   * src/lib/learnCatalog.ts, where it is tested. This only applies the answer.
   */
  function learnItemsFrom(items: BillItem[], kind: BillKind) {
    for (const change of catalogChangesFor(items, customCatalog, kind, sideGroup === 'Sundry Creditors')) {
      if (change.op === 'add') {
        const { op: _op, name, ...rest } = change
        const id = addCustomEntry(name)
        if (Object.keys(rest).length) updateCustomEntry(id, rest)
      } else {
        const { op: _op, id, ...rest } = change
        if (Object.keys(rest).length) updateCustomEntry(id, rest)
      }
    }
  }

  async function save() {
    await whileSaving(saveNow)
  }

  async function whileSaving(work: () => Promise<void>) {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try { await work() } finally { savingRef.current = false; setSaving(false) }
  }

  async function saveNow() {
    if (readOnly) { toast(`This bill is open on ${lockedBy}.`, 'error'); return }
    // A second Accept while this bill is still posting would post it twice:
    // the first call has not handed back a voucher to rewrite yet.
    if (postingBills.has(draft.id)) return

    // A purchase against deliveries is checked first. What the check finds is
    // shown once; pressing Save again with the same findings saves, and they
    // go on the voucher.
    const found = draft.kind === 'purchase' && !unpricedPurchase
      ? deliveryChecks({ ...priced, total }, deliveries) : []
    if (found.length && found.join('|') !== checkList.join('|')) {
      setCheckList(found)
      return
    }
    checksRef.current = found
    committedRef.current = true

    // A quotation opens the customer's account and shows there, but nothing
    // is posted until it is converted to a sale.
    if (isQuotation(draft)) {
      const quote = await saveQuote()
      if (!quote) return
      finishDraft()
      setView('list')
      navigate(quote.ledgerId ? `/ledger/customers/${quote.ledgerId}` : '/day', { replace: true })
      return
    }

    // Keep the editor and selected files available until saving succeeds.
    const partyTab = sideGroup === 'Sundry Creditors' ? 'suppliers' : 'customers'
    const borrowed = Boolean(voucherId) || String(draft.id).startsWith('vch-')
    // The catalogue learns from the bill before it is filed, so the next
    // person to type this item finds it waiting with its unit and its rate.
    learnItemsFrom(priced.items, (draft.kind ?? 'sale') as BillKind)

    if (!borrowed && pricedGrn) {
      await fileGrnWithPurchase()
      return
    }
    postingBills.add(draft.id)
    try {
      const saved = await postDraft()
      if (!saved) return
      finishDraft()
      if (draft.kind === 'purchase' && saved.bill.kind === 'grn') {
        toast('Filed as Goods Received. Enter the supplier bill amount when it arrives.', 'ok')
      }
      setView('list')
      const party = saved.ledgerId || draft.ledgerId
      navigate(party ? `/ledger/${partyTab}/${party}` : '/day', { replace: true })
    } finally {
      postingBills.delete(draft.id)
    }
  }

  /**
   * Keep a quotation, and open the customer's account for it.
   *
   * The account is where the shop looks a customer up, so the quotation is
   * listed there — as a quotation, with no Dr or Cr: nothing is posted and the
   * balance does not move. Kept first, so a failure to reach the books loses
   * nothing; the account opens on the next save instead.
   */
  async function saveQuote(): Promise<(Bill & { total: number }) | null> {
    const attachments = await prepareAttachments()
    if (!attachments) return null
    let quote: Bill & { total: number } = { ...priced, items: withoutBlankLines(priced.items).map(withSqft), total, attachments }
    saveBill(quote)
    const name = quote.customerName.trim()
    if (name) try {
      const ledgerId = String(await ensureParty({ name, phone: quote.customerPhone || undefined }))
      quote = { ...quote, ledgerId }
      saveBill(quote)
    } catch (err) {
      toast(`Quotation kept, but the account was not opened
${err instanceof Error ? err.message : String(err)}`, 'error')
    }
    try {
      const state = useStore.getState()
      const stored = state.bills.find((bill) => bill.id === quote.id) ?? quote
      await syncQuote({ bills: [plain(stored)], billSeq: state.billSeq })
      await claimPhotos()
      return quote
    } catch (err) {
      toast('Quotation kept on this PC. Could not finish saving its photos; please retry.\n' + (err instanceof Error ? err.message : String(err)), 'error')
      return null
    }
  }

  /**
   * A sale that was only ever a price: back out of the books, into a quotation.
   *
   * Done as a delete and a new quotation rather than a change of kind, because
   * the sale's voucher must leave the books in the same step — and a delete
   * already does that, sending both to Trash where they can be restored. The
   * quotation is made only once the books have agreed to let the sale go.
   */
  async function moveToQuotation() {
    const sale = bills.find((b) => b.id === draft.id)
    if (!sale) throw new Error('This bill is not saved yet — switch it to a quotation from the menu instead.')
    if ((sale.paidAmount ?? 0) > 0) {
      throw new Error('Money was taken against this bill. Take the payment off it first, then move it to a quotation.')
    }
    const attachments = await prepareAttachments()
    if (!attachments) return
    const gone = await deleteBill(sale.id)
    if (!gone) throw new Error('Could not reach the books, so the bill was not moved.')
    const quote: Bill = {
      ...sale,
      ...priced,
      id: uid(),
      kind: 'quotation',
      number: nextQuoteNumber(bills),
      total,
      paid: false,
      attachments,
    }
    for (const k of ['voucherId', 'postedAt', 'postError', 'paidAmount', 'paidDate', 'fromQuote', 'checks'] as (keyof Bill)[]) {
      delete (quote as Partial<Bill>)[k]
    }
    saveBill(quote)
    try {
      const state = useStore.getState()
      await syncQuote({ bills: [plain(quote)], billSeq: state.billSeq })
      await claimPhotos()
    } catch (err) {
      toast('Quotation kept on this PC. Reopen and save it to finish syncing its photos.\n' +
        (err instanceof Error ? err.message : String(err)), 'error')
    }
    toast(`Bill ${sale.number} is now quotation ${quote.number}.`, 'ok')
    committedRef.current = true
    navigate(`/bills/${quote.id}`, { replace: true })
  }

  /**
   * A goods received note carries no rate: the goods are in, the bill is not.
   * A delivery whose rates are already known is a purchase as well, so it is
   * filed as both, on the same day — the note with its counts and nothing
   * else, and the purchase with the rates, billed against that note. One
   * record of what came through the door, one of what it cost.
   */
  async function fileGrnWithPurchase() {
    const goods = priced.items
    const grn = {
      ...priced,
      items: goods.map((i) => {
        const bare = { ...i, amount: 0 }
        delete bare.rateSqft
        return bare
      }),
      total: 0,
    }
    postingBills.add(draft.id)
    let filed: Awaited<ReturnType<typeof postDraft>> = null
    try {
      filed = await postDraft(grn, { wait: true })
    } finally {
      postingBills.delete(draft.id)
    }
    const grnVoucher = filed?.bill.voucherId
    // The note did not reach the books, so there is nothing to bill against
    // yet; its rates stay on this screen's history rather than being lost.
    if (!grnVoucher) {
      toast('The delivery was not filed, so its purchase was not made. Retry the delivery from the day book, then enter its bill.', 'error')
      return
    }
    const purchase: Bill & { total: number } = {
      ...priced,
      id: uid(),
      kind: 'purchase',
      number: nextBillNumber(),
      grnIds: [String(grnVoucher)],
      items: goods.map((i) => withSqft({ ...i, id: uid() })),
      total,
      attachments: [],
    }
    for (const k of ['voucherId', 'postedAt', 'postError', 'receivedBy', 'checks', 'ledgerId'] as (keyof Bill)[]) {
      delete (purchase as Partial<Bill>)[k]
    }
    purchase.ledgerId = filed?.ledgerId ?? draft.ledgerId
    saveBill(purchase)
    const bought = await postStored(purchase, true)
    if (bought) toast(`Filed as a delivery and a purchase, both on ${purchase.date}.`, 'ok')
    finishDraft()
    setView('list')
    navigate(purchase.ledgerId ? `/ledger/suppliers/${purchase.ledgerId}` : '/day', { replace: true })
  }

  function convertToSale() {
    setDraft((d) => {
      const sale: Bill = { ...d, number: nextBillNumber(), date: today(), fromQuote: d.number }
      delete sale.kind
      // A work order made a sale is billed — off the Work list once saved — and
      // a made-to-measure job is not handed over at the counter, so it waits on
      // the Delivery list until it goes (untick nothing if it has).
      if (d.workOrder && !d.workDoneAt) {
        sale.workDoneAt = Date.now()
        sale.measuredAt = d.measuredAt ?? Date.now()
        if (d.undelivered === undefined) sale.undelivered = true
      }
      return sale
    })
    toast('Now a sale with all its lines — check it and press Save Bill.', 'ok')
  }

  function cancel() {
    committedRef.current = true
    // Asked only when there is something to lose: a bill with lines on it and
    // no save behind it goes when you leave, so say so first.
    const unsaved =
      !bills.find((b) => b.id === draft.id) &&
      (hasMeaningfulContent({ ...draft, total }) || photoFiles.length > 0 || photoPicked.length > 0)
    if (unsaved) { setAsking('leave'); return }
    finishDraft()
    myItems.sweep()
    setView('list')
    navigate('/day', { replace: true })
  }

  /** The voucher is saved, printed or discarded: its kept typing goes. */
  function finishDraft() {
    quiet.current = true
    setRestored(false)
    if (lastDraftKey.current) clearFormDraft(lastDraftKey.current)
  }

  /** Leaves the bill for good — what Alt+D and a discarded draft both end in. */
  function leave() {
    finishDraft()
    committedRef.current = true
    myItems.sweep()
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
    await whileSaving(printNow)
  }

  async function printNow() {
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
    if (isQuotation(draft)) {
      const quote = await saveQuote()
      if (quote) { finishDraft(); doPrint(quote) }
      return
    }
    const done = await postDraft()
    if (done) { finishDraft(); doPrint(done.bill); return }
    if (draft.postedAt) doPrint({ ...priced, total })
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
      {asking === 'quote' && (
        <Confirm
          title={`Move bill ${draft.number} to quotations?`}
          body="The sale comes out of the books — the customer's balance drops by its amount — and a quotation with the same lines is made in its place. The bill goes to Trash, so it can be restored."
          confirmLabel="Move to quotation"
          danger
          onConfirm={moveToQuotation}
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

      {photoShown != null && !photoFull && (
        <BillDock size={dockSize} onResize={setDockSize}>
          <BillViewer
            key={dockKey}
            voucher={photoShown}
            docked
            onExpand={() => setPhotoFull(true)}
            onClose={() => setPhotoShown(null)}
            // The next bill in the phone queue, in the same row as the zoom.
            toolsBefore={photoPos && photoPos.count > 1 ? (
              <>
                <button type="button" aria-label="Previous bill photo" disabled={photoPos.index <= 0} onClick={() => stepPhoto.current?.(-1)}>
                  <ChevronLeft size={18} />
                </button>
                <output className="tabular-nums" aria-label="Bill in the phone queue">
                  {photoPos.label || 'Photo'} · {photoPos.index + 1} of {photoPos.count}
                </output>
                <button type="button" aria-label="Next bill photo" disabled={photoPos.index >= photoPos.count - 1} onClick={() => stepPhoto.current?.(1)}>
                  <ChevronRight size={18} />
                </button>
              </>
            ) : undefined}
          />
        </BillDock>
      )}
      {photoShown != null && photoFull && (
        <BillViewer voucher={photoShown} onClose={() => setPhotoFull(false)} />
      )}

      <div
        className={photoShown != null && !photoFull
          // Room made for the docked bill, so nothing of the form is under it.
          ? 'max-w-2xl space-y-5 px-4 pb-[calc(var(--dock-h)+1.5rem)] pt-1 md:max-w-none md:pb-24 md:pl-6 md:pr-[calc(var(--dock-w)+1rem)] md:pt-2 xl:pl-8 xl:pr-[calc(var(--dock-w)+21rem)] 2xl:pr-[calc(var(--dock-w)+25rem)]'
          : 'mx-auto max-w-2xl space-y-5 px-4 pb-24 pt-1 md:pt-2 xl:max-w-none xl:pl-8 xl:pr-[21rem] 2xl:pr-[25rem]'}
        style={{ '--dock-w': dockSize.w + 'px', '--dock-h': dockSize.h + 'px' } as React.CSSProperties}
      >

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
          <Button
            variant="ghost"
            className="px-2 py-1"
            title="Open a downloaded copy"
            aria-label="Open a downloaded copy"
            onClick={() => openCopyInput.current?.click()}
          >
            <FolderOpen size={16} />
          </Button>
          <input
            ref={openCopyInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void openCopy(file)
            }}
          />
        </div>

        {unkept && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/60 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
            <AlertTriangle size={15} className="shrink-0" />
            <span className="flex-1">Not saved anywhere: not in the books, not on this PC.</span>
            <button
              className="flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700"
              onClick={() => { downloadCopy(unkept); setUnkept(null) }}
            >
              <Download size={13} /> Download a copy
            </button>
          </div>
        )}

        {readOnly && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <Lock size={15} className="shrink-0" />
            <span>Being edited on <b>{lockedBy}</b> — read only until they finish.</span>
          </div>
        )}
        {restored && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-400/60 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200">
            <RotateCcw size={15} className="shrink-0" />
            <span className="flex-1">Unsaved typing brought back.</span>
            <button
              className="rounded-md border border-sky-500/50 px-2.5 py-1 text-xs font-semibold hover:bg-sky-100 dark:hover:bg-sky-500/20"
              onClick={() => {
                if (lastDraftKey.current) clearFormDraft(lastDraftKey.current)
                if (opened.current) setDraft(opened.current)
                setRestored(false)
              }}
            >
              Discard
            </button>
          </div>
        )}
        {stale && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/60 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
            <AlertTriangle size={15} className="shrink-0" />
            <span className="flex-1">Changed on another counter. Not saved.</span>
            <button
              className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700"
              onClick={() => {
                // Their version, in place of this copy. For a voucher from the
                // ledger, reading it again is what brings theirs.
                if (stale.newer) setDraft(stale.newer)
                else if (voucherId) { builtVoucher.current = null; setVoucherReload((n) => n + 1) }
                setStale(null)
              }}
            >
              Load newer
            </button>
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
                // A name with no account of its own keeps numbers typed for it,
                // but not another customer's: bill 371 was moved from Chiranjeev
                // Sikdar to a new customer and kept his phone and Aadhaar, which
                // saving would have filed on the new account.
                const someoneElses = (field: 'mobile' | 'uid', value?: string) =>
                  !!value && liveCustomers.some((c) => c[field] === value)
                setShowCust(true)
                setDraft((d) => ({
                  ...d,
                  customerName: name,
                  customerPhone: match ? match.mobile : someoneElses('mobile', d.customerPhone) ? '' : d.customerPhone,
                  ...(match ? { customerPhone2: '' } : {}),
                  customerUid: match ? (match.uid ?? '') : someoneElses('uid', d.customerUid) ? '' : d.customerUid,
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
            {!isSupplierVoucher && (phoneKnown || uidKnown) && contactOnFile && (
              <div className="mt-0.5 flex items-baseline gap-2 pl-11 text-xs text-muted">
                <span className="tabular-nums">
                  {[
                    phoneKnown && contactOnFile.phone.replace(/(\d{5})(\d{5})/, '$1 $2'),
                    uidKnown && `UID ${contactOnFile.uid.replace(/(\d{4})(?=\d)/g, '$1 ')}`,
                  ].filter(Boolean).join(' · ')}
                </span>
                <button type="button" onClick={() => setChangeContact(true)} className="underline hover:text-stone-700 dark:hover:text-stone-200">
                  change
                </button>
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
          {!isSupplierVoucher && !phoneKnown && (
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
          {/* Under the phone box, or in its place when the account's own number
              is already on the bill. */}
          {!isSupplierVoucher && !secondPhone && !draft.customerPhone2 && (
            <button
              type="button"
              onClick={() => {
                setSecondPhone(true)
                requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-bill-phone2]')?.focus())
              }}
              className="block text-xs font-semibold text-brass-text hover:underline"
            >
              + Another number
            </button>
          )}
          {/* One more number to reach the customer on, for this bill: a son's,
              the site's. It prints beside the first. */}
          {!isSupplierVoucher && (secondPhone || !!draft.customerPhone2) && (
          <div>
            <label className="mb-1 flex items-center justify-between text-xs font-semibold text-muted">
              Second phone
              <button
                type="button"
                onClick={() => { setSecondPhone(false); setDraft((d) => ({ ...d, customerPhone2: '' })) }}
                className="font-semibold text-muted hover:text-red-600 hover:underline"
              >
                Remove
              </button>
            </label>
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={10}
              placeholder="10-digit mobile"
              data-bill-phone2="1"
              data-bill-nav="1"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { billArrowKeys(e); return }
                if (e.key !== 'Enter') return
                e.preventDefault()
                const uid = document.querySelector<HTMLInputElement>('[data-bill-uid]')
                ;(uid ?? document.querySelector<HTMLInputElement>('[data-bill-ref]'))?.focus()
              }}
              value={draft.customerPhone2 ?? ''}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 10)
                setDraft((d) => ({ ...d, customerPhone2: v }))
              }}
              className={`w-full rounded-lg border px-3 py-2 text-sm transition-colors dark:bg-stone-800 dark:text-white ${
                (draft.customerPhone2 ?? '').length === 10
                  ? 'border-green-500 bg-green-50 dark:border-green-500'
                  : 'border-stone-200 bg-white dark:border-white/10'
              }`}
            />
          </div>
          )}
          {!isSupplierVoucher && !uidKnown && (
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
                  Amount {(draft.kind ?? 'sale') === 'receipt' ? 'received' : 'paid'}
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
              {(draft.kind ?? 'sale') !== 'refund' && (
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
              )}
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

        {(draft.kind ?? 'sale') === 'grn' && (
          <CheckedBy
            value={draft.receivedBy}
            onChange={(name) => setDraft((d) => ({ ...d, receivedBy: name || undefined }))}
          />
        )}
        {(draft.kind ?? 'sale') === 'purchase' && (
          <AgainstDeliveries
            draft={draft}
            setDraft={setDraftFromDeliveries}
            rows={deliveries}
            ledgerId={namedAccount?._id}
            pendingGrn={pendingGrn}
            onPendingDone={clearPendingGrn}
          />
        )}

        {/* Items */}
        <div>
          {!isMoneyVoucher && (<>
          {/* Ledger head — Tally's voucher grid: a ruled band of column names,
              then one line per item, no cards. */}
          {/* No overflow-hidden here: the item and unit dropdowns are absolutely
              positioned inside these rows and would be clipped by it. */}
          <div className="rounded-lg border border-stone-300 dark:border-white/15">
            <div className="flex flex-wrap items-center gap-2 rounded-t-lg border-b border-stone-300 bg-stone-100 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted dark:border-white/15 dark:bg-white/5">
              {/* Mirrors a row exactly: index, particulars, then the control
                  group with its own tighter gap, then the actions column. */}
              <span className="w-5 shrink-0 text-center">#</span>
              <span className="flex-1 min-w-[140px]">Particulars</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span className="w-12 text-center">Qty</span>
                <span className="w-16 text-center">Unit</span>
                <span className="w-24 text-right">Amount</span>
                <span className="w-[4.5rem] text-center">Rate</span>
              </span>
              <span className="hidden w-9 shrink-0 sm:block" />
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
                myItems={myItems}
                kind={draft.kind ?? 'sale'}
                supplierSide={sideGroup === 'Sundry Creditors'}
                disabled={draft.items.length === 1}
                history={history}
                sold={sold}
                lines={draft.items}
                linesAbove={draft.items.slice(0, idx)}
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

          {/* The total as one figure, and the stock it moved — for a bill
              entered from its photo rather than line by line. */}
          {convexEnabled() && !isQuotation(draft) && (
            <StockMoves
              bill={draft}
              out={stockGoesOut(draft.kind, sideGroup)}
              onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            />
          )}

          {/* A delivery note is goods and counts; tax and discount belong to the bill. */}
          {/* Discount, GST and round-off are on a few bills, not most: one
              small link until opened, and open by itself whenever this bill
              uses any of them, so nothing set is ever out of sight. */}
          {(draft.kind ?? 'sale') !== 'grn' && (chargesOpen || chargesInUse(draft) ? (
          <ChargesPanel
            bill={draft}
            charges={priced.items.filter((i) => i.auto)}
            onChange={setCharges}
          />
          ) : (
            <button
              type="button"
              onClick={() => setChargesOpen(true)}
              className="mt-2 flex items-center gap-1 text-xs font-semibold text-muted hover:text-stone-700 dark:hover:text-stone-200"
            >
              <Plus size={13} /> Discount · GST · Round off
            </button>
          ))}
          </>)}

          {/* Running total, and what was taken against it */}
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {/* A receipt or a payment is the money itself, so it asks only
                where it went. A sale or a purchase asks how much of it was
                settled now — that amount posts as a line of this same
                voucher, against the drawer or the bank. */}
            {!isMoneyVoucher && (draft.kind ?? 'sale') !== 'return' && (draft.kind ?? 'sale') !== 'grn' && !isQuotation(draft) && (
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
                  readOnly={isWithoutBillSale}
                  value={isWithoutBillSale ? total : draft.paidAmount ?? (paidByDefault(draft, total) ? total : '')}
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
                {/* Said out loud, because a customer's account coming out
                    square with nobody having touched this box would otherwise
                    look like a mistake. */}
                {paidByDefault(draft, total) && (
                  <span className="text-xs text-muted" title="W/B is a cash sale, settled in full.">
                    Cash sale — paid in full
                  </span>
                )}
                {/* When the money came in. Blank is the usual counter sale —
                    paid with the bill — so it only asks once there is money to
                    date, and it defaults to the bill's own day. */}
                {((draft.paidAmount ?? 0) > 0 || paidByDefault(draft, total)) && (
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
            {(isMoneyVoucher || (draft.paidAmount ?? 0) > 0 || paidByDefault(draft, total)) && (
              <div className="flex items-center gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800">
                {/* UPI first and picked on a new bill. An older bill marked
                    "online" went to Bank the same way, so it shows as UPI; one
                    with no mode at all was posted as cash, and shows as Cash. */}
                {(['upi', 'cash'] as const).map((mode) => {
                  const current = draft.paymentMode ?? 'cash'
                  const on = mode === 'cash' ? current === 'cash' : current !== 'cash'
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, paymentMode: mode }))}
                      className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                        on
                          ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-white'
                          : 'text-muted'
                      }`}
                    >
                      {mode === 'cash' ? 'Cash' : 'UPI'}
                    </button>
                  )
                })}
              </div>
            )}
            <div className="rounded-xl bg-stone-100 px-5 py-2 dark:bg-stone-800">
              <span className="text-sm text-muted">Total </span>
              <span className="text-lg font-bold text-stone-900 dark:text-white">₹{total.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>

        {/* Sales only. Delivered is on from the start: untick it and the sale
            waits on the Delivery list. Order and Guarantee card are off on
            every new sale and put it on the Work list / Guarantee list. A
            list's own button takes it off again. */}
        {((draft.kind ?? 'sale') === 'sale' || isQuotation(draft)) && (
          <div className="flex flex-wrap items-center gap-2">
            {[
              {
                key: 'delivered', label: 'Delivered', hint: 'Untick when the goods go later: the sale waits on the Delivery list',
                on: (d: Bill) => !d.undelivered || !!d.deliveredAt,
                flip: (d: Bill): Bill => (!d.undelivered || d.deliveredAt
                  ? { ...d, undelivered: true, deliveredAt: undefined }
                  : { ...d, undelivered: undefined }),
              },
              {
                key: 'order', label: 'Order', hint: 'On the Work list until done',
                on: (d: Bill) => !!d.workOrder,
                flip: (d: Bill): Bill => ({ ...d, workOrder: !d.workOrder }),
              },
              {
                key: 'card', label: 'Guarantee card', hint: 'On the Guarantee list until the card is made',
                on: (d: Bill) => !!d.guaranteeCard,
                flip: (d: Bill): Bill => ({ ...d, guaranteeCard: !d.guaranteeCard }),
              },
            // A quotation is what to make before the sizes: only Order applies.
            ].filter(({ key }) => !isQuotation(draft) || key === 'order').map(({ key, label, hint, on: isOn, flip }) => {
              const on = isOn(draft)
              return (
                <button
                  key={key}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  title={hint}
                  disabled={readOnly}
                  onClick={() => setDraft(flip)}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    on
                      ? 'border-shiv-green bg-shiv-green/15 text-stone-900 dark:text-stone-50'
                      : 'border-stone-200 text-muted hover:border-stone-300 dark:border-white/10'
                  }`}
                >
                  <span className={`relative h-4 w-7 rounded-full transition ${on ? 'bg-shiv-green' : 'bg-stone-300 dark:bg-stone-600'}`}>
                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
                  </span>
                  {label}
                </button>
              )
            })}
          </div>
        )}

        {/* A work order's sizes from the site (the mechanic's phone), to type
            the lines from. Read from the saved bill: they can arrive while
            this one is open. */}
        {draft.workOrder && (() => {
          const sizes = bills.find((b) => b.id === draft.id)?.siteSizes ?? draft.siteSizes
          return sizes ? <SiteSizesNote bill={{ ...draft, siteSizes: sizes }} /> : null
        })()}

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

        <ChecksNotice checks={checkList} />

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Cancel — intentionally small to avoid accidental taps */}
          <Button
            variant="ghost"
            onClick={cancel}
            className="px-3"
          >
            Cancel
          </Button>

          {/* Save + Print */}
          <div className="flex flex-[1_1_250px] items-center gap-2">
            <Button
              data-bill-save="1"
              onClick={save}
              disabled={saving || readOnly}
              className="min-w-0 flex-1"
            >
              {saving ? 'Saving…' : pricedGrn ? 'Save Delivery + Purchase' : unpricedPurchase ? 'Save Goods Received' : `Save ${BILL_KINDS[draft.kind ?? 'sale'].title}`}
            </Button>
            <Button
              variant="outline"
              onClick={handlePrint}
              disabled={saving || readOnly}
            >
              <Printer size={15} /> Print
            </Button>
          </div>
          {/* A saved quotation the customer has taken up: the same lines, as a
              sale dated today with the next bill number. Nothing is posted
              until Save — cancelling leaves the quotation as it was. */}
          {/* A saved sale that turned out to be only a price. */}
          {(draft.kind ?? 'sale') === 'sale' && !voucherId && !String(draft.id).startsWith('vch-')
            && bills.some((b) => b.id === draft.id) && (
            <Button variant="ghost" onClick={() => setAsking('quote')} className="px-3">
              Move to Quotation
            </Button>
          )}
          {isQuotation(draft) && bills.some((b) => b.id === draft.id) && (
            <Button
              variant="outline"
              onClick={convertToSale}
              className="border-shiv-green text-stone-900 dark:text-white"
            >
              <ReceiptText size={15} /> Convert to Sale
            </Button>
          )}
        </div>

        {/* The paper this was written from. Always open, under its own
            heading: most bills now go in from their photo, so the photo is
            where the entry starts, not something to go looking for.
            Quotations can keep the same supporting photos as a bill. */}
        <div>
          <div className="flex items-center gap-2 border-b border-stone-200 pb-1.5 dark:border-white/10">
            <Camera size={15} className="text-muted" aria-hidden="true" />
            <h3 className="text-sm font-bold text-stone-900 dark:text-white">{photoLabel}</h3>
            {photoCount > 0 && (
              <span className="rounded-full bg-shiv-green px-1.5 py-0.5 text-[10px] font-bold text-stone-950">
                {photoCount}
              </span>
            )}
          </div>
          <div className={`ledger-root mt-2 ${ledgerDark ? 'dark' : ''}`}>
            <BillDrop
              files={photoFiles}
              attached={papersOnBill}
              onChange={setPhotoFiles}
              picked={photoPicked}
              onPick={pickPhotos}
              onViewBill={showPhoto}
              onWaiting={setWaitingPaper}
              onDetach={detachPaper}
              stepRef={stepPhoto}
              onPosition={(pos: typeof photoPos) => setPhotoPos((was) =>
                was?.index === pos?.index && was?.count === pos?.count && was?.label === pos?.label ? was : pos)}
            />
          </div>
        </div>

        {/* Live print preview — scaled to fit phone width */}
        <BillPreview bill={{ ...priced, total }} />

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

const iso = (d: Date) => indiaDate(d)

/**
 * The series a bill belongs to, in the books' own abbreviations. A bill is a
 * sale, so it is labelled SAL like every other sale — the BILL- form was the
 * reference the voucher carries, not a series of its own, and having two
 * namings for one thing made the day book read as two different books.
 *
 * The number is the bill's own until it posts and the books issue theirs.
 */
const VCH_ABBR: Record<string, string> = {
  sale: 'SAL', purchase: 'PUR', receipt: 'RCT', payment: 'PAY', return: 'GR', refund: 'REF', grn: 'GRN', quotation: 'QTN',
}
const billLabel = (b: Bill) =>
  // A voucher opened for editing already carries the books' own label —
  // prefixing it again gave rows reading "SAL-SAL-0003".
  b.voucherId ? String(b.number) : `${VCH_ABBR[b.kind ?? 'sale']}-${String(b.number).replace(/^Q-/, '')}`

/**
 * Which tab an account opens on. A sale or a receipt is written against a
 * customer, a purchase or a payment against a supplier — so the voucher's own
 * series says where its party is filed, and the day book need not ask.
 */
/** A voucher's series: "PUR" of "PUR-0153". It is what its type is filtered by. */
const seriesOf = (label: string) => label.split('-')[0]

/** Names for the series a bill can carry before the books have named it. */
const SERIES_NAME: Record<string, string> = {
  SAL: 'Sales', PUR: 'Purchase', RCT: 'Receipt', PAY: 'Payment', GR: 'Goods return',
  REF: 'Refund', GRN: 'Goods received', QTN: 'Quotation',
}

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
const startOfDay = (isoDate: string) => Date.parse(`${isoDate}T00:00:00Z`)

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
  photos: Attachment[]
  billId?: string
  draft?: boolean
  onDelete?: () => void
  /** Why the books refused this bill, and how to ask them again. */
  problem?: string
  onRetry?: () => void
  /** When it was written, which is not the date written on it. */
  entered: number
  /** A quotation: shown with its amount, but not money the day took in. */
  quote?: boolean
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
  const [viewingPhotos, setViewingPhotos] = useState<DayRow | null>(null)

  // The period lives in the URL, so a day's book is a link someone can send.
  const [params, setParams] = useSearchParams()
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const byDate = params.get('order') === 'date'
  const series = params.get('type') ?? ''
  const setView = (f: string, t: string, dated: boolean, type = series) => {
    const next: Record<string, string> = {}
    if (f) next.from = f
    if (t) next.to = t
    if (dated) next.order = 'date'
    if (type) next.type = type
    setParams(next, { replace: true })
  }
  const setPeriod = (f: string, t: string) => setView(f, t, byDate)
  const setSeries = (type: string) => setView(from, to, byDate, type)

  // The server already knows how to answer for a window — the ledger's day
  // book has taken from/to since it was written; nothing ever passed them.
  //
  // Opened on the list this device last saw for the same period, the way the
  // ledger's pages open, and swapped for the live one the moment it lands —
  // so coming back to the day book shows it at once rather than "Loading…".
  const vouchers = useLive(api.reports.dayBook, {
    from: from ? startOfDay(from) : undefined,
    to: to ? startOfDay(to) + 86_399_999 : undefined,
  }, `daybook:${from}:${to}`) as any[] | undefined
  const loading = vouchers === undefined

  // Every bill is a bill: there are no drafts to keep apart any more.
  const finished = bills

  // Whose side a bill not yet in the books is on: its kind says, except a
  // goods return, which goes by the group of the account it names.
  const masters = useQuery(api.masters.all, {})
  const billSide = (b: Bill): 'customers' | 'suppliers' => {
    const side = PARTY_SIDE[b.kind ?? 'sale']
    if (side !== 'both') return side === 'supplier' ? 'suppliers' : 'customers'
    const group = (masters?.ledgers ?? []).find((l: any) => String(l._id) === String(b.ledgerId ?? ''))?.groupName
    return group === 'Sundry Creditors' ? 'suppliers' : 'customers'
  }

  const allRows = useMemo<DayRow[]>(() => {
    // Notes written in the cash drawer are posted to the books (ref CASH-c-…)
    // so the ledgers balance, but they belong to the Cash page, not here.
    const list: DayRow[] = (vouchers ?? []).filter((v: any) => !String(v.refNo ?? '').startsWith('CASH-c-')).map((v: any) => ({
      key: v._id,
      date: v.date,
      label: v.vchLabel,
      party: v.party,
      partyId: v.partyLedgerId,
      ref: v.refNo || '',
      // A goods return can be either side, so its party's own group says which.
      side: v.partyGroup ? (v.partyGroup === 'Sundry Creditors' ? 'suppliers' : 'customers') : sideOf(v.vchLabel),
      account: (v.contra ?? []).join(', '),
      amount: v.status === 'pending' ? null : v.amount,
      photos: v.attachmentUrls ?? [],
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
      const quote = isQuotation(b)
      if (!quote && b.voucherId && postedIds.has(String(b.voucherId))) continue
      if (!quote && postedRefs.has(`BILL-${b.number}`)) continue
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
        side: billSide(b),
        account: quote ? 'Quotation — not in the books' : b.postError ? `Not posted — ${b.postError}`
          : b.pendingPost ? (postingTrouble(b.id) ? `Posting… retrying (${postingTrouble(b.id)})` : 'Posting…')
          // Just posted: the books' own row for it is a moment from arriving here.
          : b.voucherId ? 'Posted' : 'Not posted',
        quote,
        amount: b.total,
        photos: b.attachments ?? [],
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vouchers, finished, from, to, bills, onRetry, byDate, masters])

  // One type of voucher at a time when asked — the purchases of a month, the
  // goods received today. The count, the total and each day's line follow it.
  const rows = useMemo(
    () => (series ? allRows.filter((r) => seriesOf(r.label) === series) : allRows),
    [allRows, series],
  )
  // The types this period has, in the books' own order, each with how many;
  // the chosen one stays listed even when the period has none of it.
  const seriesOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of allRows) counts.set(seriesOf(r.label), (counts.get(seriesOf(r.label)) ?? 0) + 1)
    if (series && !counts.has(series)) counts.set(series, 0)
    const types = (masters?.voucherTypes ?? []) as { abbr: string; name: string }[]
    const rank = (abbr: string) => {
      const i = types.findIndex((t) => t.abbr === abbr)
      return i < 0 ? types.length : i
    }
    return [...counts.entries()]
      .map(([abbr, count]) => ({ abbr, count, name: types.find((t) => t.abbr === abbr)?.name ?? SERIES_NAME[abbr] ?? abbr }))
      .sort((a, b) => rank(a.abbr) - rank(b.abbr) || a.name.localeCompare(b.name))
  }, [allRows, series, masters])

  const total = rows.reduce((s, r) => s + (r.quote ? 0 : r.amount ?? 0), 0)

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
    for (const d of out) d.total = d.rows.reduce((s, r) => s + (r.quote ? 0 : r.amount ?? 0), 0)
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
        {/* Every photo of the days shown, in the book's order, opened at the
            row clicked: the arrows go on to the next voucher's. */}
        {viewingPhotos && <BillViewer voucher={photoStrip(
          days.flatMap((day) => day.rows).map((r) => ({ key: r.key, vchLabel: r.label, date: r.date, party: r.party, amount: r.amount, refNo: r.ref, attachmentUrls: r.photos })),
          viewingPhotos.key,
          'Day Book',
        )} onClose={() => setViewingPhotos(null)} />}
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
            <select value={series} onChange={(e) => setSeries(e.target.value)} aria-label="Voucher type">
              <option value="">All types</option>
              {seriesOptions.map((o) => (
                <option key={o.abbr} value={o.abbr}>{o.name} ({o.abbr}) · {o.count}</option>
              ))}
            </select>
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
                            onClick={() => setViewingPhotos(r)}
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

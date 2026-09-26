// Core domain types for Shiv Hardware panel.
// Modelled directly on the Excel sheets (Plywood/Door, Aluminium, Guarantee Card).

import { assetPath } from './assets'
import type { AutoKind, BillCharges } from './billCharges'

export type ProductCategory =
  | 'readymade-door'
  | 'flush-door'
  | 'plywood-6'
  | 'block-board-12'
  | 'block-board-19'
  | 'film-face-ply'
  | 'aluminium-door'
  | 'window-2-track'
  | 'window-3-track'
  | 'upvc-2-track'
  | 'upvc-2.5-track'
  | 'upvc-3-track'
  | 'upvc-door'
  | 'wpc-door-frame'
  // Hardware (bill-only, no sqft rate)
  | 'hinge'
  | 'screw'
  | 'aldrop'
  | 'handle'
  | 'tb'
  | 'fevicol'
  | 'mica'
  | 'tape'

/** A purchasable brand/grade within a category, with its per-sqft rate. */
export interface Brand {
  id: string
  category: ProductCategory
  name: string
  /** Rate per sqft (₹). For doors/boards this is the A-column rate in Excel. */
  rate: number
  /** Guarantee in years against borer (maps to a wax seal). 0 = none. */
  guaranteeYears: GuaranteeYears
  /** Excel has separate Guarantee and Warranty columns; default is guarantee. */
  coverage?: CoverageType
  /** Optional row tint copied from the source workbook. */
  accentColor?: string
  thicknessMm?: number
}

export type GuaranteeYears = 0 | 1 | 3 | 5 | 7 | 8 | 10 | 15 | 20 | 21 | 25 | 30
export type CoverageType = 'guarantee' | 'warranty'

/** A coded price set — a full copy of brands/rates (C1, C2, …). */
export interface BrandSet {
  id: string
  name: string
  brands: Brand[]
}

/** A measurement in feet + soot (eighths of an inch), as entered on the counter. */
export interface Dimension {
  /** whole inches */
  inches: number
  /** soot = eighths of an inch (0..7) */
  soot: number
}

export interface Customer {
  id: string
  name: string // "M/s ..."
  mobile: string
  altMobile?: string
  uid?: string
  address?: string
}

/** One brand row on a rate-card quotation: its cost for the quoted size. */
export interface BrandQuoteRow {
  brandName: string
  rate: number
  guaranteeYears: GuaranteeYears
  coverage?: CoverageType
  accentColor?: string
  cost: number
}

/** One row on a fixed rate card (Film Face Ply, WPC Door Frame): no size calc. */
export interface FixedCardRow {
  /** left column: weight (FF Ply) or chaukhat size (WPC) */
  label: string
  brand: string
  /** per-sqft rate (FF Ply only) */
  rate?: number
  cost: number
  guaranteeYears?: GuaranteeYears
  accentColor?: string
}

export interface GuaranteeCardItem {
  brandName: string
  guaranteeYears: GuaranteeYears
  sizeLabel?: string | null
  amount?: number | null
  /**
   * Per-row overlay fields for the compact PVC card table (Thickness/Length/
   * Height/Pcs columns) — each billed row can be its own size, unlike the A4
   * sheet which shares one document-level height/width/qty. Falls back to the
   * document-level height/width/qty and the category's default thickness
   * label when omitted.
   */
  thickness?: string | null
  height?: Dimension | null
  width?: Dimension | null
  qty?: number | null
}

export interface GuaranteeDocument {
  id: string
  number: string
  /**
   * The secret printed into this card's QR, minted with its reference.
   *
   * The page behind the QR is public — the customer scanning it has no account
   * — and card numbers run in a sequence, so the number alone would let anyone
   * walk the file. Both are needed to open a card.
   */
  token?: string
  date: string
  customer: Customer
  category: ProductCategory
  height: Dimension
  width: Dimension
  qty: number
  items: GuaranteeCardItem[]
}

/**
 * A quotation is for ONE size of ONE product category, listing the cost of
 * every available brand (exactly like the Excel ReadyMade / Plain / Block-Board
 * sheets). Aluminium is configured (thickness + add-ons) and shows one result.
 */
export interface Quotation {
  id: string
  /** sequential, human-facing number e.g. SH-2026-0007 */
  number: string
  date: string // ISO
  customer: Customer
  category: ProductCategory
  height: Dimension
  width: Dimension
  /** number of pieces — cost = rate × area × qty (matches the Excel Quantity field) */
  qty?: number
  sqft: number
  /** brand categories: one row per brand with its cost for this size */
  rows?: BrandQuoteRow[]
  /** fixed rate-card categories (Film Face Ply, WPC Door Frame): static price list */
  fixedRows?: FixedCardRow[]
  /** aluminium / UPVC categories: ALL thickness/brand variants shown like the Excel sheet */
  alu?: {
    addons: string[]
    glassType?: string
    /** One entry per thickness (1.2MM, 1.6MM, Hindalco) */
    thicknesses: {
      name: string
      doorRate: number; doorCost: number
      chaukhatRate: number; chaukhatCost: number
      accessories: number; total: number
      decorFilmRate: number; decorFilm: number
      brownCoatedRate?: number; brownCoated?: number
      /** windows */
      glassRate?: number; glassCost?: number
      reflectiveRate?: number; reflectiveCost?: number
      chaukhatRft?: number
    }[]
  }
  notes?: string
}

export const SHOP = {
  name: 'Shiv Hardware Store',
  address: 'Shivaji Road, Near Gandhi Highschool, Ramgarh Cantt – 829122',
  gstin: '20AGEPG3564B1Z6',
  phones: [
    { label: 'Tony', number: '8092850954' },
    { label: 'Shop', number: '9835350954' },
  ],
} as const

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  'readymade-door': 'Readymade Door',
  'flush-door': 'Flush Door (Plain)',
  'plywood-6': 'Water Proof Plywood 6mm',
  'block-board-12': 'Water Proof Block Board 12mm',
  'block-board-19': 'Water Proof Block Board 19mm',
  'film-face-ply': 'Film Face Ply',
  'aluminium-door': 'Aluminium Door',
  'window-2-track': '2 Track Sliding Window',
  'window-3-track': '3 Track Sliding Window',
  'upvc-2-track': '2 Track UPVC Sliding Window',
  'upvc-2.5-track': '2.5 Track UPVC Sliding Window',
  'upvc-3-track': '3 Track UPVC Sliding Window',
  'upvc-door': 'UPVC Door',
  'wpc-door-frame': 'WPC Door Frame (Chaukhat)',
  'hinge':    'Hinges',
  'screw':    'Screw',
  'aldrop':   'Aldrop',
  'handle':   'Handle',
  'tb':       'Tower Bolt',
  'fevicol':  'Fevicol',
  'mica':     'Mica',
  'tape':     'Abro Tape',
}

/** Icon key (resolved to a lucide-react component in the UI) per category. */
export type CategoryIcon = 'door' | 'board' | 'window'

export type ProductGroup = 'Doors' | 'Plywoods' | 'Aluminium' | 'UPVC' | 'WPC'

/** Sidebar group display order. */
export const GROUP_ORDER: ProductGroup[] = ['Doors', 'Plywoods', 'Aluminium', 'UPVC', 'WPC']

/** Short label + icon + image for each category, used on the sidebar submenu. */
export const CATEGORY_META: Record<
  ProductCategory,
  { short: string; icon: CategoryIcon; image?: string; group: ProductGroup }
> = {
  'readymade-door': { short: 'Readymade Door', icon: 'door', image: assetPath('assets/products/plywood.png'), group: 'Doors' },
  'flush-door': { short: 'Flush Door', icon: 'door', group: 'Plywoods' },
  'plywood-6': { short: 'Plywood 6mm', icon: 'board', group: 'Plywoods' },
  'block-board-12': { short: 'Block Board 12mm', icon: 'board', group: 'Plywoods' },
  'block-board-19': { short: 'Block Board 19mm', icon: 'board', group: 'Plywoods' },
  'film-face-ply': { short: 'Film Face Ply', icon: 'board', group: 'Plywoods' },
  'aluminium-door': { short: 'Aluminium Door', icon: 'door', image: assetPath('assets/products/aluminium-window.png'), group: 'Aluminium' },
  'window-2-track': { short: '2 Track Window', icon: 'window', image: assetPath('assets/products/aluminium-window.png'), group: 'Aluminium' },
  'window-3-track': { short: '3 Track Window', icon: 'window', image: assetPath('assets/products/aluminium-window.png'), group: 'Aluminium' },
  'upvc-2-track': { short: '2 Track UPVC', icon: 'window', group: 'UPVC' },
  'upvc-2.5-track': { short: '2.5 Track UPVC', icon: 'window', group: 'UPVC' },
  'upvc-3-track': { short: '3 Track UPVC', icon: 'window', group: 'UPVC' },
  'upvc-door': { short: 'UPVC Door', icon: 'door', group: 'UPVC' },
  'wpc-door-frame': { short: 'WPC Door Frame', icon: 'door', group: 'WPC' },
  // Hardware — bill-only, not shown in quotation sidebar
  'hinge':    { short: 'Hinges',   icon: 'board', group: 'Doors' },
  'screw':    { short: 'Screw',    icon: 'board', group: 'Doors' },
  'aldrop':   { short: 'Aldrop',   icon: 'board', group: 'Doors' },
  'handle':   { short: 'Handle',   icon: 'board', group: 'Doors' },
  'tb':       { short: 'Tower Bolt', icon: 'board', group: 'Doors' },
  'fevicol':  { short: 'Fevicol',  icon: 'board', group: 'Doors' },
  'mica':     { short: 'Mica',     icon: 'board', group: 'Doors' },
  'tape':     { short: 'Abro Tape', icon: 'board', group: 'Doors' },
}

// ---- Bills ----------------------------------------------------------------

export type BillPaymentMode = 'cash' | 'online' | 'upi'

/** The four vouchers the bill builder can write. */
/**
 * `return` is a Goods Return: goods coming back from a customer or going back to
 * a supplier. It takes either kind of party; which way it posts follows the
 * party's account.
 */
export type BillKind = 'sale' | 'purchase' | 'receipt' | 'payment' | 'return' | 'refund' | 'grn' | 'quotation'

/** What each one is called, and what the party on it is called. */
export const BILL_KINDS: Record<BillKind, { title: string; party: string; ref: string }> = {
  sale:     { title: 'Bill',     party: 'Customer', ref: 'Ref' },
  purchase: { title: 'Purchase', party: 'Supplier', ref: 'Bill no.' },
  receipt:  { title: 'Receipt',  party: 'Customer', ref: 'Receipt no.' },
  payment:  { title: 'Payment',  party: 'Supplier', ref: 'Voucher no.' },
  return:   { title: 'Goods Return', party: 'Party', ref: 'Ref' },
  refund:   { title: 'Refund',   party: 'Customer', ref: 'Slip no.' },
  grn:      { title: 'Goods Received', party: 'Supplier', ref: 'Challan no.' },
  quotation: { title: 'Quotation', party: 'Customer', ref: 'Ref' },
}

/**
 * A quotation is a price given, not a sale made: it is kept with the bills
 * but never posted, so no account is opened and no balance moves. It numbers
 * in a series of its own — Q-1, Q-2 — so it never takes a bill number, and
 * becomes a sale only when someone converts it.
 */
export const isQuotation = (b: { kind?: BillKind }) => b.kind === 'quotation'

/** The next free quotation number, counting ones already turned into sales. */
export function nextQuoteNumber(bills: { kind?: BillKind; number?: string; fromQuote?: string }[]): string {
  const n = (v?: string) => Number(String(v ?? '').replace(/^Q-/i, '')) || 0
  const used = bills.reduce((max, b) => Math.max(max, isQuotation(b) ? n(b.number) : 0, n(b.fromQuote)), 0)
  return `Q-${used + 1}`
}

export interface BillItem {
  id: string
  /** Free-text label (always set; auto-generated for catalog items) */
  description: string
  qty: number
  unit: string          // Pc, kg, M, Set, Bl, L, Rft …
  amount: number
  // ---- catalog / smart fields (set only for board/door items) ----
  category?: ProductCategory
  brandName?: string
  /** Size label for hardware items (e.g. "5\"", "¾\""). Boards use heightIn×widthIn instead. */
  sizeIn?: string
  /** Selected values for user-defined custom catalog fields, keyed by field label. */
  fieldValues?: Record<string, string>
  /**
   * A round-off line. It carries a negative amount and reduces the total, but
   * prints without a description — the shop shows the customer the adjustment
   * in the figures, not as a line item announcing itself.
   */
  isRoundup?: boolean
  /** @deprecated bills saved before the rename carry this instead. Read it
   *  through `isRoundupLine()`, never directly. */
  isDiscount?: boolean
  /**
   * A charge that is a figure, not a quantity of something — fare, cartage,
   * labour. It has an amount and nothing else: a rate and a piece count on a
   * delivery fare would be meaningless. Unlike a roundup it keeps its label,
   * because the customer should see what they are being charged for.
   */
  amountOnly?: boolean
  heightIn?: number
  widthIn?: number
  /** Rate per sqft (₹) — drives amount = rateSqft × (H×W/144) × qty */
  rateSqft?: number
  /**
   * For a sheet named with its thickness and size ("19mm Solid 8 X 4",
   * "30mm S 81 X 38"): the area of one piece in square feet, read from the
   * name. Kept on the line so the square-foot rate is on record with the bill.
   */
  sqft?: number
  /** That sheet's price per square foot — amount ÷ qty ÷ sqft. */
  sqftRate?: number
  /** ID of a CustomCatalogEntry that this item was picked from */
  customEntryId?: string
  /**
   * A discount, GST or round-off line written from the bill's own settings
   * rather than typed. See `billCharges.ts`.
   */
  auto?: AutoKind
}

/**
 * Charges the shop writes as a bare figure. A line typed by hand as "Fare"
 * behaves exactly like one picked from the item list — the counter should not
 * have to remember which way it was entered.
 */
// Also a discount taken off a purchase and the tax put on one — "Discount",
// "Less", "CGST 9%", "S GST 9%", "IGST 18%". None of them is a quantity of
// anything; picked from My Items they used to arrive with a qty, a unit and
// a rate. A name that only contains GST ("Sanmica GST 589") is still goods.
const AMOUNT_ONLY_NAMES = /^(?:fare|cartage|freight|labour|labor|transport|discount|less|(?:[csi]\s*\.?\s*)?gst\b.*)$/i

/** A name the counter writes for a charge on the bill rather than goods. */
export const isChargeName = (name: string | undefined) => AMOUNT_ONLY_NAMES.test((name ?? '').trim())

export const isAmountOnlyLine = (i: Pick<BillItem, 'amountOnly' | 'description'>) =>
  !!i.amountOnly || AMOUNT_ONLY_NAMES.test((i.description ?? '').trim())

/**
 * Bills written before the rename stored this line as `isDiscount`. Every read
 * goes through here so old bills keep printing and totalling correctly.
 */
export const isRoundupLine = (i: Pick<BillItem, 'isRoundup' | 'isDiscount'>) =>
  !!(i.isRoundup || i.isDiscount)

/**
 * The goods on a bill — the numbered lines. A fare or a round-off is not one
 * of them: it is a charge on the whole bill, and it prints down by the total.
 *
 * Half-typed rows are dropped here: they are not lines of the bill.
 */
export function billLines(items: BillItem[] = []): BillItem[] {
  return items.filter(
    (i) => (i.description?.trim() || Number(i.amount)) && !isChargeLine(i),
  )
}

/** Charges that sit above the total: the fare first, then the round-off. */
export function billCharges(items: BillItem[] = []): BillItem[] {
  return items
    .filter((i) => isChargeLine(i) && Number(i.amount))
    .sort((a, b) => Number(isRoundupLine(a)) - Number(isRoundupLine(b)))
}

const isChargeLine = (i: BillItem) => isRoundupLine(i) || isAmountOnlyLine(i)

export interface Bill extends BillCharges {
  id: string
  number: string        // sequential shop number e.g. "34", "35"
  date: string          // ISO date
  customerName: string
  customerPhone?: string
  customerUid?: string
  /** Optional free-text reference — PO number, site name, "via Ramesh" … */
  ref?: string
  /** The customer's account in the books, opened when the bill is saved. */
  ledgerId?: string
  /**
   * Which voucher this bill posts as. The builder started out writing sales
   * only, so a bill without one is a sale — every bill written before this
   * existed, and every bill written at the counter since.
   */
  kind?: BillKind
  /**
   * The voucher this bill writes to, when it was opened from the books rather
   * than written at the counter. Saving rewrites that voucher instead of
   * posting a second one beside it.
   */
  voucherId?: string
  /**
   * Photographs filed with this bill — the supplier's own bill, a slip, a
   * photo sent in from the phone. Held as storage ids so the bill and the
   * voucher it posts point at the same files rather than two copies.
   */
  attachments?: { storageId: string; kind: 'bill' | 'challan' | 'estimate' | 'receipt' | 'other' }[]
  items: BillItem[]
  total: number
  paid: boolean
  /**
   * Money taken at the counter against this bill, which may be none of it, a
   * part of it or all of it. It posts as a line of the bill's own voucher —
   * the customer is debited for what is still owed and the drawer for the
   * rest — so a part-paid bill reads the same in the party's account, the
   * day book and the trial balance.
   */
  paidAmount?: number
  /**
   * A receipt or a payment is the money itself, so it carries its own amount
   * rather than adding up item lines — the lines on one are a note of what it
   * settles, and summing them counted the same money twice.
   */
  moneyAmount?: number
  /**
   * Taken off at settlement: a discount allowed on a receipt, one received on
   * a payment. The party's account is cleared for the money and the discount
   * together, so a bill of ₹30,080 settled by ₹29,830 with ₹250 off leaves
   * nothing outstanding rather than ₹250 that will never be paid.
   */
  discount?: number
  /**
   * The day the money was taken, when that is not the day of the bill — a
   * customer who settles part of last week's bill today. Blank means the money
   * came in with the bill, which is the usual counter sale.
   */
  paidDate?: string
  paymentMode?: BillPaymentMode
  upiRef?: string       // UPI/phone used for payment
  /** On a Goods Received Note: who counted the goods in. */
  receivedBy?: string
  /** On a purchase: the deliveries (GRN voucher ids) this bill is for. */
  grnIds?: string[]
  /** On a purchase: what the checks against its deliveries said at saving. */
  checks?: string[]
  notes?: string
  /**
   * @deprecated There are no drafts. A bill is written and saved, or it is not
   * a bill — Tally has no half-written voucher either. Bills stored before
   * this still carry the flag; nothing reads it.
   */
  isDraft?: boolean
  /**
   * When this bill last changed on any device. Two counters can have the same
   * bill open; on sync the newer copy of each bill wins, so whoever typed most
   * recently keeps their work instead of one machine overwriting the other.
   */
  updatedAt?: number
  /**
   * When the books took this bill. The server writes it in the same
   * transaction as the voucher, so it is the one honest answer to "is this in
   * the accounts?" — bills written before this existed have no stamp and are
   * taken as posted, because that is what they were.
   */
  postedAt?: number
  /**
   * Why the last save did not reach the books. A bill carrying this is on this
   * device only: it is not pushed to the server, it shows as unposted in the
   * list, and it stays that way until a retry succeeds.
   */
  postError?: string
  /** The quotation this sale was converted from, e.g. "Q-4". */
  fromQuote?: string
}

// ---- Hardware catalog (managed via Inventory page) ------------------------

/** A user-defined labeled chip group (e.g. "Colors", "Widths") on a catalog item. */
export interface CatalogField { id: string; label: string; values: string[] }

export interface HardwareCatalogEntry {
  sizes: string[]
  brands: string[]
  fields?: CatalogField[]
  rate?: number
  /** The unit normally used when this hardware item is added to a bill. */
  unit?: string
  /**
   * The rate last sold at in each unit, keyed by canonical unit. A screw goes
   * out by the packet and by the piece at two different figures, and picking
   * the unit on a line brings back the figure for that unit.
   */
  unitRates?: Record<string, number>
}
export type HardwareCatalog = Partial<Record<ProductCategory, HardwareCatalogEntry>>

/**
 * No seeded hardware. The shop builds its own list from what it actually bills,
 * so an empty panel stays empty rather than refilling itself with Hinges,
 * Screw, Aldrop and the rest on the next load.
 */
export const DEFAULT_HARDWARE_CATALOG: HardwareCatalog = {}

// ---- Custom hardware catalog (user-defined extra items) -------------------

export interface CustomCatalogEntry {
  id: string
  name: string
  sizes: string[]
  brands: string[]
  fields?: CatalogField[]
  /** The rate used most recently — what a fresh line starts with. */
  rate?: number
  /** The unit used most recently — what a fresh line starts with. */
  unit?: string
  /**
   * The rate last sold at in each unit, keyed by canonical unit. A screw goes
   * out by the packet and by the piece at two different figures, and picking
   * the unit on a line brings back the figure for that unit.
   */
  unitRates?: Record<string, number>
  /**
   * Every distinct rate this item has been billed at, newest first. One item
   * genuinely sells at several prices — trade vs retail, old stock vs new — so
   * the previous figures are offered rather than overwritten.
   */
  rates?: number[]
  /**
   * Other wordings that should find this item.
   *
   * Left behind when a supplier's own entry is folded into the shop's — SRT
   * bills "12mm S 8 X 4" for what the shop sells as "12mm SG 8 X 4", and
   * whoever types the supplier's bill should be able to type what is printed
   * on it. Searched, never shown on a bill: the name that goes on the line is
   * always `name`. See `convex/itemFold.ts`.
   */
  alsoKnownAs?: string[]
}

// ---------------------------------------------------------------------------

/** Categories priced as (H × W / 144) sqft. Aluminium windows also use sqft but with slab logic later. */
export const CATEGORY_ORDER: ProductCategory[] = [
  'readymade-door',
  'flush-door',
  'plywood-6',
  'block-board-12',
  'block-board-19',
  'film-face-ply',
  'aluminium-door',
  'window-2-track',
  'window-3-track',
  'upvc-2-track',
  'upvc-2.5-track',
  'upvc-3-track',
  'upvc-door',
  'wpc-door-frame',
]

// ---- Toto drivers (call list for arranging a delivery) --------------------

/** green = free now, orange = maybe, red = not available. */
export type TotoAvailability = 'green' | 'orange' | 'red'

/** Toto is one vehicle type the shop hires; others get added as they're used. */
export type VehicleType = 'toto' | 'tempo' | 'pickup' | 'truck'

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  toto: 'Toto', tempo: 'Tempo', pickup: 'Pickup', truck: 'Truck',
}

export interface TotoDriver {
  id: string
  name: string
  phone: string
  availability: TotoAvailability
  /** Defaults to toto for the contacts seeded from the shop's paper list. */
  vehicle?: VehicleType
}

/** The shop's toto contacts, as kept on paper. */
export const TOTO_SEED: TotoDriver[] = [
  ['Ravi', '8521654821'], ['Rashid', '7004416864'], ['Adil', '7564939041'],
  ['Alim', '6201866831'], ['Arun Raj', '8582090406'], ['Deepak', '9113385575'],
  ['Hari', '7546850693'], ['Kanhaiya', '9709224361'], ['Kundan', '6287950658'],
  ['Lucky', '7903341200'], ['Mukesh Soni', '9507194752'], ['Seeman', '6301780010'],
  ['Sanjay', '6205743589'], ['Shekhar', '9835762143'], ['Sunil', '7461980838'],
].map(([name, phone], i) => ({ id: `toto-${i + 1}`, name, phone, availability: 'green' as const, vehicle: 'toto' as const }))

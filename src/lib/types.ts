// Core domain types for Shiv Hardware panel.
// Modelled directly on the Excel sheets (Plywood/Door, Aluminium, Guarantee Card).

import { assetPath } from './assets'

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
}

export interface GuaranteeDocument {
  id: string
  number: string
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
  heightIn?: number
  widthIn?: number
  /** Rate per sqft (₹) — drives amount = rateSqft × (H×W/144) × qty */
  rateSqft?: number
  /** ID of a CustomCatalogEntry that this item was picked from */
  customEntryId?: string
}

export interface Bill {
  id: string
  number: string        // sequential shop number e.g. "34", "35"
  date: string          // ISO date
  customerName: string
  customerPhone?: string
  customerUid?: string
  items: BillItem[]
  total: number
  paid: boolean
  paymentMode?: BillPaymentMode
  upiRef?: string       // UPI/phone used for payment
  notes?: string
  /** True while the bill is still being filled — cleared on Save or Print. */
  isDraft?: boolean
}

// ---- Hardware catalog (managed via Inventory page) ------------------------

/** A user-defined labeled chip group (e.g. "Colors", "Widths") on a catalog item. */
export interface CatalogField { id: string; label: string; values: string[] }

export interface HardwareCatalogEntry { sizes: string[]; brands: string[]; fields?: CatalogField[]; rate?: number }
export type HardwareCatalog = Partial<Record<ProductCategory, HardwareCatalogEntry>>

export const DEFAULT_HARDWARE_CATALOG: HardwareCatalog = {
  hinge:   { sizes: ['3"','4"','5"','6"'],                               brands: ['Acer Jazz','Norya Jazi','GI','SS'] },
  screw:   { sizes: ['½"','¾"','1"','1¼"','1½"','2"','2½"','3"'],        brands: ['SS (+)','SS (-)','GI','Plain'] },
  aldrop:  { sizes: ['6"','8"','10"','12"'],                             brands: ['Marla B/G','Mona B/n','GI'] },
  handle:  { sizes: ['4"','6"','8"','10"','12"'],                        brands: ['Mona B/n','Norta B/n','B/n'] },
  tb:      { sizes: ['6"','8"','10"','12"'],                             brands: ['Mona B/n','B/n'] },
  fevicol: { sizes: [],                                                  brands: ['SH','Marine','HeatX','SR','SpeedX','Probond','Hi-per Star'] },
  mica:    { sizes: [],                                                  brands: [] },
  tape:    { sizes: [],                                                  brands: [] },
}

// ---- Custom hardware catalog (user-defined extra items) -------------------

export interface CustomCatalogEntry {
  id: string
  name: string
  sizes: string[]
  brands: string[]
  fields?: CatalogField[]
  rate?: number
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

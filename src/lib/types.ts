// Core domain types for Shiv Hardware panel.
// Modelled directly on the Excel sheets (Plywood/Door, Aluminium, Guarantee Card).

import { assetPath } from './assets'

export type ProductCategory =
  | 'readymade-door'
  | 'flush-door'
  | 'plywood-6'
  | 'block-board-12'
  | 'block-board-19'
  | 'aluminium-door'
  | 'window-2-track'
  | 'window-3-track'

/** A purchasable brand/grade within a category, with its per-sqft rate. */
export interface Brand {
  id: string
  category: ProductCategory
  name: string
  /** Rate per sqft (₹). For doors/boards this is the A-column rate in Excel. */
  rate: number
  /** Guarantee in years against borer (maps to a wax seal). 0 = none. */
  guaranteeYears: GuaranteeYears
  thicknessMm?: number
}

export type GuaranteeYears = 0 | 1 | 3 | 5 | 7 | 8 | 10 | 15 | 20 | 21 | 25 | 30

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
  cost: number
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
  sqft: number
  /** brand categories: one row per brand with its cost for this size */
  rows?: BrandQuoteRow[]
  /** aluminium categories: ALL 3 thicknesses shown like the Excel sheet */
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
  'aluminium-door': 'Aluminium Door',
  'window-2-track': '2 Track Sliding Window',
  'window-3-track': '3 Track Sliding Window',
}

/** Icon key (resolved to a lucide-react component in the UI) per category. */
export type CategoryIcon = 'door' | 'board' | 'window'

export type ProductGroup = 'Doors' | 'Plywoods' | 'Aluminium'

/** Sidebar group display order. */
export const GROUP_ORDER: ProductGroup[] = ['Doors', 'Plywoods', 'Aluminium']

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
  'aluminium-door': { short: 'Aluminium Door', icon: 'door', image: assetPath('assets/products/aluminium-window.png'), group: 'Aluminium' },
  'window-2-track': { short: '2 Track Window', icon: 'window', image: assetPath('assets/products/aluminium-window.png'), group: 'Aluminium' },
  'window-3-track': { short: '3 Track Window', icon: 'window', image: assetPath('assets/products/aluminium-window.png'), group: 'Aluminium' },
}

/** Categories priced as (H × W / 144) sqft. Aluminium windows also use sqft but with slab logic later. */
export const CATEGORY_ORDER: ProductCategory[] = [
  'readymade-door',
  'flush-door',
  'plywood-6',
  'block-board-12',
  'block-board-19',
  'aluminium-door',
  'window-2-track',
  'window-3-track',
]

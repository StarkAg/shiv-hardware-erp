// Fixed rate cards — static price lists with NO size calculation.
// Transcribed from Latest/12mm FF Ply Rate.xlsm and Latest/WPC Door Frame.xlsm.
import type { FixedCardRow, ProductCategory } from '../types'

const WPC_GREEN = '#92D050'

export const FIXED_CARDS: Partial<Record<ProductCategory, FixedCardRow[]>> = {
  // Film Face Ply — Weight | Brand | Rate | Cost (8'x4' sheet)
  'film-face-ply': [
    { label: '24 Kg', brand: 'FF Red', rate: 41.25, cost: 1320 },
    { label: '30 Kg', brand: 'FF Red', rate: 52, cost: 1664 },
    { label: '32 Kg', brand: 'FF Red', rate: 67.5, cost: 2160 },
    { label: '32 Kg', brand: 'FF Signature Red', rate: 70, cost: 2240 },
  ],
  // WPC Door Frame (Chaukhat) — Size | Brand | Cost | Guarantee
  'wpc-door-frame': [
    { label: '4" x 3"',   brand: 'Wooden Imported Sakhuwa',    cost: 2600, accentColor: WPC_GREEN },
    { label: '3" x 2"',   brand: 'WPC Chowket Ekotimber',      cost: 2057 },
    { label: '3" x 2"',   brand: 'WPC Chowket Signature',      cost: 2320, guaranteeYears: 7 },
    { label: '3" x 2"',   brand: 'WPC Chowket Signature Gold', cost: 2845, guaranteeYears: 10 },
    { label: '4" x 2.5"', brand: 'WPC Chowket Ekotimber',      cost: 3020, accentColor: WPC_GREEN },
    { label: '4" x 2.5"', brand: 'WPC Chowket Signature',      cost: 3282, guaranteeYears: 7, accentColor: WPC_GREEN },
    { label: '4" x 2.5"', brand: 'WPC Chowket Signature Gold', cost: 3895, guaranteeYears: 10, accentColor: WPC_GREEN },
    { label: '5" x 2.5"', brand: 'WPC Chowket Signature',      cost: 3895, guaranteeYears: 7 },
  ],
}

export type FixedCardMeta = {
  title: string
  leftHeader: string
  showRate: boolean
  showGuarantee: boolean
  note?: string
  /** optional promo image shown between the header and the table */
  image?: string
}

export const FIXED_CARD_META: Partial<Record<ProductCategory, FixedCardMeta>> = {
  'film-face-ply': { title: 'Film Face Ply Rates', leftHeader: 'Weight', showRate: true, showGuarantee: false },
  'wpc-door-frame': { title: 'Door Chaukhat', leftHeader: 'Size', showRate: false, showGuarantee: true, note: 'INSTALLATION CHARGES 200 EXTRA', image: 'assets/products/wpc-door-frame-sheet.jpg' },
}

export function isFixedCard(category: ProductCategory): boolean {
  return category in FIXED_CARDS
}

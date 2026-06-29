// Pricing engine — ports the Excel formulas exactly.
//
// Excel reference (Plywood and Door.xlsm / Costing):
//   sqft  = ROUND( (Height_in * Width_in) / 144 , 2 )
//   cost  = ROUND( rate * (Height_in * Width_in / 144) * qty , 0 )
// Sizes are entered as inches + "soot" (eighths of an inch), shown as e.g. 78 4/8".

import type { Brand, BrandQuoteRow, Dimension, ProductCategory, Quotation } from './types'
import { assetPath } from './assets'
import { SEED_BRANDS } from './data/brands'

// Boards/plywood are sold by the sheet, sized in FEET (not inches) and with no
// soot. Their area is simply heightFt * widthFt — no /144. Everything else
// (doors, aluminium) is sized in inches + soot. The numeric value lives in
// Dimension.inches either way; the category decides how it's read.
export const FOOT_SIZED_CATEGORIES: ProductCategory[] = ['plywood-6', 'block-board-12', 'block-board-19']

export function isFootSized(category?: ProductCategory): boolean {
  return !!category && FOOT_SIZED_CATEGORIES.includes(category)
}

/** Total inches for a dimension (inches + soot/8). */
export function toInches(d: Dimension): number {
  return d.inches + (d.soot || 0) / 8
}

/** Human label for a dimension: 78 4/8" for inches, 8' for feet (boards). */
export function formatDimension(d: Dimension, unit: 'in' | 'ft' = 'in'): string {
  if (!d.inches && !d.soot) return ''
  if (unit === 'ft') return `${d.inches}'`
  if (!d.soot) return `${d.inches}"`
  return `${d.inches} ${d.soot}/8"`
}

/** Size label like Excel B9: 78 4/8" X 36" (doors) or 8' X 4' (boards). */
export function formatSize(height: Dimension, width: Dimension, category?: ProductCategory): string {
  const unit = isFootSized(category) ? 'ft' : 'in'
  const h = formatDimension(height, unit)
  const w = formatDimension(width, unit)
  if (h && w) return `${h} X ${w}`
  return h || w
}

// Size snapping — some categories bill on a standard "billing size", not the
// exact measurement. The Excel sheets do this with INDEX/MATCH(...,-1): the
// entered size rounds UP to the next size in the table before pricing.
//   ReadyMade sheet: heights {72,75,78,81,84}, widths {24,26,…,48}.
// So a 76" x 35" door is billed as 78" x 36". Categories without a table
// (aluminium, hardware, plywood sized in feet) price on the exact size.
const SIZE_SNAP: Partial<Record<ProductCategory, { heights: number[]; widths: number[] }>> = {
  'readymade-door': {
    heights: [72, 75, 78, 81, 84],
    widths: [24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48],
  },
}

/** Round a measurement UP to the next standard size. Clamps to the largest size
 *  when it exceeds the table (Excel errors here; we clamp so oversize still prices). */
function snapUp(value: number, steps: number[]): number {
  for (const s of steps) if (value <= s) return s
  return steps[steps.length - 1] ?? value
}

/** Billing inches for one axis: snapped to the category's standard size, or the
 *  raw measurement when the category isn't size-snapped. */
function billedInches(category: ProductCategory | undefined, dim: Dimension, axis: 'heights' | 'widths'): number {
  return billAxis(category, toInches(dim), axis)
}

function billAxis(category: ProductCategory | undefined, inches: number, axis: 'heights' | 'widths'): number {
  const table = category ? SIZE_SNAP[category] : undefined
  if (!table || inches <= 0) return inches
  return snapUp(inches, table[axis])
}

/** Billing size (inches) for a category, snapping each axis to the next standard
 *  size. Works on plain inch numbers (the bill builder stores inches, not Dimensions). */
export function billSizeInches(
  category: ProductCategory | undefined,
  heightIn: number,
  widthIn: number,
): { heightIn: number; widthIn: number } {
  return {
    heightIn: billAxis(category, heightIn, 'heights'),
    widthIn: billAxis(category, widthIn, 'widths'),
  }
}

/** Raw sqft for a category from Dimensions: feet*feet for boards, else inch
 *  area (/144) on the billed (snapped) size. */
function sqftForDims(category: ProductCategory | undefined, height: Dimension, width: Dimension): number {
  if (isFootSized(category)) return (height.inches || 0) * (width.inches || 0)
  return (billedInches(category, height, 'heights') * billedInches(category, width, 'widths')) / 144
}

/** sqft from plain numeric height/width (the bill builder stores numbers, not
 *  Dimensions): feet*feet for boards, else inch area (/144) on the snapped size. */
export function billSqft(category: ProductCategory | undefined, heightVal: number, widthVal: number): number {
  if (isFootSized(category)) return (heightVal || 0) * (widthVal || 0)
  const b = billSizeInches(category, heightVal, widthVal)
  return (b.heightIn * b.widthIn) / 144
}

/** Area in sqft, rounded to 2 dp (matches Excel ROUND(...,2)). Pass `category`
 *  so doors snap (76x35 -> 78x36) and boards bill in feet (8x4 = 32 sqft). */
export function areaSqft(height: Dimension, width: Dimension, category?: ProductCategory): number {
  return round(sqftForDims(category, height, width), 2)
}

/** Line amount = ROUND(rate * sqft * qty, 0), on the billed size. */
export function lineAmount(rate: number, height: Dimension, width: Dimension, qty: number, category?: ProductCategory): number {
  return Math.round(rate * sqftForDims(category, height, width) * (qty || 1))
}

/** Excel-style ROUND (half away from zero). */
export function round(value: number, digits = 0): number {
  const f = Math.pow(10, digits)
  return Math.sign(value) * Math.round(Math.abs(value) * f) / f
}

/** Build the all-brands rate-card rows for a given size (the quotation body). */
export function buildBrandRows(brands: Brand[], height: Dimension, width: Dimension, qty: number): BrandQuoteRow[] {
  return brands.map((b) => {
    const meta = seedBrandMeta(b.category, b.name)
    return {
      brandName: b.name,
      rate: b.rate,
      guaranteeYears: b.guaranteeYears,
      coverage: b.coverage ?? meta.coverage,
      accentColor: b.accentColor ?? meta.accentColor,
      cost: lineAmount(b.rate, height, width, qty, b.category),
    }
  })
}

function brandKey(category: ProductCategory, name: string) {
  return `${category}|${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`
}

const SEED_META = new Map(
  SEED_BRANDS.map((brand) => [
    brandKey(brand.category, brand.name),
    {
      coverage: brand.coverage,
      accentColor: brand.accentColor,
    },
  ]),
)

export function seedBrandMeta(category: ProductCategory, name: string): Partial<Pick<Brand, 'coverage' | 'accentColor'>> {
  return SEED_META.get(brandKey(category, name)) ?? {}
}

export function enrichBrandRows(rows: BrandQuoteRow[] | undefined, category: ProductCategory): BrandQuoteRow[] | undefined {
  return rows?.map((row) => {
    const meta = seedBrandMeta(category, row.brandName)
    return {
      ...row,
      coverage: row.coverage ?? meta.coverage,
      accentColor: row.accentColor ?? meta.accentColor,
    }
  })
}

export function enrichQuotation(quote: Quotation): Quotation {
  return {
    ...quote,
    rows: enrichBrandRows(quote.rows, quote.category),
  }
}

/** Indian-format currency, e.g. ₹1,23,456. */
export function formatINR(amount: number): string {
  return '₹' + Math.round(amount).toLocaleString('en-IN')
}

/** Map guarantee years to the wax-seal asset path. */
export function sealForYears(years: number): string | null {
  if ([1, 3, 7, 10, 25].includes(years)) return assetPath(`assets/seals/seal-${years}yr.png`)
  return null
}

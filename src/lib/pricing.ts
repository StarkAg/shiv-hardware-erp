// Pricing engine — ports the Excel formulas exactly.
//
// Excel reference (Plywood and Door.xlsm / Costing):
//   sqft  = ROUND( (Height_in * Width_in) / 144 , 2 )
//   cost  = ROUND( rate * (Height_in * Width_in / 144) * qty , 0 )
// Sizes are entered as inches + "soot" (eighths of an inch), shown as e.g. 78 4/8".

import type { Brand, BrandQuoteRow, Dimension } from './types'
import { assetPath } from './assets'

/** Total inches for a dimension (inches + soot/8). */
export function toInches(d: Dimension): number {
  return d.inches + (d.soot || 0) / 8
}

/** Human label for a dimension, matching Excel: 78 4/8" (soot shown as n/8). */
export function formatDimension(d: Dimension): string {
  if (!d.inches && !d.soot) return ''
  if (!d.soot) return `${d.inches}"`
  return `${d.inches} ${d.soot}/8"`
}

/** Size label like Excel B9: 78 4/8" X 36". */
export function formatSize(height: Dimension, width: Dimension): string {
  const h = formatDimension(height)
  const w = formatDimension(width)
  if (h && w) return `${h} X ${w}`
  return h || w
}

/** Area in sqft, rounded to 2 dp (matches Excel ROUND(...,2)). */
export function areaSqft(height: Dimension, width: Dimension): number {
  const sq = (toInches(height) * toInches(width)) / 144
  return round(sq, 2)
}

/** Line amount = ROUND(rate * sqft * qty, 0). */
export function lineAmount(rate: number, height: Dimension, width: Dimension, qty: number): number {
  const raw = rate * ((toInches(height) * toInches(width)) / 144) * (qty || 1)
  return Math.round(raw)
}

/** Excel-style ROUND (half away from zero). */
export function round(value: number, digits = 0): number {
  const f = Math.pow(10, digits)
  return Math.sign(value) * Math.round(Math.abs(value) * f) / f
}

/** Build the all-brands rate-card rows for a given size (the quotation body). */
export function buildBrandRows(brands: Brand[], height: Dimension, width: Dimension, qty: number): BrandQuoteRow[] {
  return brands.map((b) => ({
    brandName: b.name,
    rate: b.rate,
    guaranteeYears: b.guaranteeYears,
    cost: lineAmount(b.rate, height, width, qty),
  }))
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

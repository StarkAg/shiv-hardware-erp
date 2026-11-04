import { formatDimension, isFootSized, lineAmount, seedBrandMeta, toInches } from './pricing'
import { CATEGORY_META, type BrandSet, type CoverageType, type Dimension, type GuaranteeYears, type ProductCategory, type Quotation, type SizeRates } from './types'

/**
 * Size Rates: a brand, and what each of its sizes costs (owner's ask, 4 Nov 2026).
 * A brand from the price list brings its rate and how it is measured, feet for a
 * board and inches and soot for a door, and each size's cost is worked out as on
 * the other quotations. The brand can also be any words with a rate typed in,
 * and any cost can be typed over.
 */

/** As many as one printed sheet holds below the header. */
export const MAX_SIZES = 26

export type SizeUnit = 'ft' | 'in'
export interface SizePricing {
  rate: number
  unit: SizeUnit
  category?: ProductCategory
  /** The brand's own name on the sheet, without the product the box adds to it. */
  name?: string
  guaranteeYears?: GuaranteeYears
  coverage?: CoverageType
}
export interface SizeInput { height: Dimension; width: Dimension; cost: string }

const figure = (text: string) => Number(text.replace(/,/g, '').trim()) || 0
const sameBrand = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The price list as the brand box offers it: Signature is on several products, each at its own rate. */
export function priceList(sets: BrandSet[]) {
  return (sets[0]?.brands ?? []).map((brand) => ({
    label: `${brand.name} · ${CATEGORY_META[brand.category].short}`,
    name: brand.name,
    rate: brand.rate,
    category: brand.category,
    guaranteeYears: brand.guaranteeYears,
    coverage: brand.coverage ?? seedBrandMeta(brand.category, brand.name).coverage,
    unit: (isFootSized(brand.category) ? 'ft' : 'in') as SizeUnit,
  }))
}

export const findInPriceList = (list: ReturnType<typeof priceList>, name: string) =>
  list.find((item) => sameBrand(item.label, name))

/** The size in words, for History: 78 4/8" X 36" or 8' X 4'. */
export const sizeLabel = (height: Dimension, width: Dimension, unit: SizeUnit) =>
  `${formatDimension(height, unit)} X ${formatDimension(width, unit)}`

/** What a size comes to at this rate, by the same sum as the other quotations; 0 until it can be worked out. */
export function autoCost(height: Dimension, width: Dimension, { rate, unit, category }: Pick<SizePricing, 'rate' | 'unit' | 'category'>) {
  if (!(rate > 0) || !(toInches(height) > 0) || !(toInches(width) > 0)) return 0
  if (unit === 'ft') return Math.round(rate * height.inches * width.inches)
  return lineAmount(rate, height, width, 1, isFootSized(category) ? undefined : category)
}

/** What goes on the quotation: rows with both sides of a size and a cost, typed or worked out. */
export function buildSizeRates(brand: string, rows: SizeInput[], pricing: SizePricing): SizeRates {
  return {
    brand: brand.trim(),
    ...pricing,
    name: pricing.name ?? brand.trim(),
    rows: rows
      .filter((row) => toInches(row.height) > 0 && toInches(row.width) > 0)
      .map((row) => ({
        size: sizeLabel(row.height, row.width, pricing.unit),
        cost: figure(row.cost) || autoCost(row.height, row.width, pricing),
        height: row.height,
        width: row.width,
      }))
      .filter((row) => row.cost > 0),
  }
}

/** This brand's last Size Rates quotation, to start the next one from. */
export function lastRatesFor(quotations: Quotation[], brand: string, exceptId?: string) {
  if (!brand.trim()) return null
  const earlier = quotations
    .filter((q) => q.id !== exceptId && q.sizeRates?.rows.length && sameBrand(q.sizeRates.brand, brand))
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
  return earlier[0]?.sizeRates ?? null
}

import { isFootSized, lineAmount } from './pricing'
import { CATEGORY_META, type BrandSet, type ProductCategory, type Quotation, type SizeRates } from './types'

/**
 * Size Rates: a brand, and what each of its sizes costs (owner's ask, 4 Nov 2026).
 * A brand from the price list brings its rate, and each size's cost is worked out
 * as on the other quotations. The brand can also be any words with a rate typed
 * in, and any cost can be typed over.
 */

/** As many as one printed sheet holds below the header. */
export const MAX_SIZES = 26

export type SizeUnit = 'ft' | 'in'
export interface SizePricing { rate: number; unit: SizeUnit; category?: ProductCategory }

const figure = (text: string) => Number(text.replace(/,/g, '').trim()) || 0
const sameBrand = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The price list as the brand box offers it: Signature is on several products, each at its own rate. */
export function priceList(sets: BrandSet[]) {
  return (sets[0]?.brands ?? []).map((brand) => ({
    label: `${brand.name} · ${CATEGORY_META[brand.category].short}`,
    rate: brand.rate,
    category: brand.category,
    unit: (isFootSized(brand.category) ? 'ft' : 'in') as SizeUnit,
  }))
}

export const findInPriceList = (list: ReturnType<typeof priceList>, name: string) =>
  list.find((item) => sameBrand(item.label, name))

/** The two sides of a size written as "78 x 36", "78 4/8 x 36" or "7 x 3 ft"; null for anything else. */
export function parseSize(text: string) {
  const match = text.match(/^\s*(\d+(?:\.\d+)?)(?:\s+(\d)\/8)?\s*["']?\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s+(\d)\/8)?/i)
  if (!match) return null
  const side = (whole: string, soot?: string) => Number(whole) + (soot ? Number(soot) / 8 : 0)
  return { height: side(match[1], match[2]), width: side(match[3], match[4]) }
}

/** What a size comes to at this rate, by the same sum as the other quotations; 0 when it cannot be worked out. */
export function autoCost(size: string, { rate, unit, category }: SizePricing) {
  const sides = parseSize(size)
  if (!sides || !(rate > 0)) return 0
  if (unit === 'ft') return Math.round(rate * sides.height * sides.width)
  const dim = (inches: number) => ({ inches, soot: 0 })
  return lineAmount(rate, dim(sides.height), dim(sides.width), 1, isFootSized(category) ? undefined : category)
}

/** What goes on the quotation: rows with a size and a cost, typed or worked out. */
export function buildSizeRates(brand: string, rows: { size: string; cost: string }[], pricing: SizePricing): SizeRates {
  return {
    brand: brand.trim(),
    rate: pricing.rate,
    unit: pricing.unit,
    category: pricing.category,
    rows: rows
      .map((row) => ({ size: row.size.trim(), cost: figure(row.cost) || autoCost(row.size, pricing) }))
      .filter((row) => row.size && row.cost > 0),
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

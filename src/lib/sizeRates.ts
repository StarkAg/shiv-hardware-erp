import type { Quotation, SizeRates } from './types'

/**
 * Size Rates: a brand, and what each of its sizes costs (owner's ask, 4 Nov 2026).
 * Nothing is worked out: the sizes are as typed and the costs are the costs. The
 * brand can be any words, so a brand or product the shop has no price set for
 * can still be quoted.
 */

/** As many as one printed sheet holds below the header. */
export const MAX_SIZES = 26

const figure = (text: string) => Number(text.replace(/,/g, '').trim()) || 0

/** What goes on the quotation: only the rows with both a size and a cost. */
export function buildSizeRates(brand: string, rows: { size: string; cost: string }[]): SizeRates {
  return {
    brand: brand.trim(),
    rows: rows
      .map((row) => ({ size: row.size.trim(), cost: figure(row.cost) }))
      .filter((row) => row.size && row.cost > 0),
  }
}

const sameBrand = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The sizes and costs last quoted for this brand, to start the next one from. */
export function lastRatesFor(quotations: Quotation[], brand: string, exceptId?: string) {
  if (!brand.trim()) return null
  const earlier = quotations
    .filter((q) => q.id !== exceptId && q.sizeRates?.rows.length && sameBrand(q.sizeRates.brand, brand))
    .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
  return earlier[0]?.sizeRates?.rows ?? null
}

import type { Brand, GuaranteeDocument } from './types'

/** A displayed ₹/sq ft figure from a row's total and total covered area. */
export function rateFromAmount(amount: number | '', totalSqft: number): number | '' {
  if (amount === '' || Number(amount) === 0 || !(totalSqft > 0)) return ''
  return Math.round((Number(amount) / totalSqft) * 100) / 100
}

// One spreadsheet row of the guarantee card editor: Thickness / Type / Length /
// Height / Pcs / Rate / Amount, the same shape the shop is used to from Excel.
// Length/Height are a whole number plus an explicit soot (1/8") box: inches for
// doors (82 4/8), feet for boards (7 × 4), as the bill writes them.
export type SizeRow = {
  id: string
  thickness: string
  type: string
  length: number | ''
  lengthSoot: number | ''
  height: number | ''
  heightSoot: number | ''
  qty: number | ''
  /** ₹ per sq ft; while set, the amount is worked out from it. */
  sqftRate: number | ''
  amount: number | ''
  /** A hand-entered amount keeps its total while still showing its derived rate. */
  amountManual?: boolean
}

export const isRowFilled = (r: SizeRow) =>
  r.type.trim() !== '' ||
  r.thickness.trim() !== '' ||
  r.length !== '' ||
  r.lengthSoot !== '' ||
  r.height !== '' ||
  r.heightSoot !== '' ||
  r.qty !== '' ||
  r.sqftRate !== '' ||
  r.amount !== ''

/**
 * Sq ft of one piece. Both sides 12 or under are feet (a 7 × 4 board = 28),
 * anything bigger is inches (an 82 4/8 × 35 4/8 door, ÷ 144) — the same rule
 * the bill uses (lib/boardSize.ts).
 */
export function rowSqft(r: SizeRow): number {
  const l = Number(r.length || 0) + Number(r.lengthSoot || 0) / 8
  const h = Number(r.height || 0) + Number(r.heightSoot || 0) / 8
  if (!(l > 0) || !(h > 0)) return 0
  return l <= 12 && h <= 12 ? l * h : (l * h) / 144
}

export const rowQty = (r: SizeRow) => (r.qty === '' ? 1 : Number(r.qty))

/** ₹/sq ft for a brand at a thickness, or '' when nothing says. */
export type RateLookup = (type: string, thickness: string) => number | ''

export const brandKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')
/** "19MM", "19 mm", "18mm" → 19 (18mm is sold and written as 19MM); 0 when there is none. */
export const thicknessMm = (t: string | number | null | undefined) => {
  const mm = Number(String(t ?? '').match(/\d+(\.\d+)?/)?.[0] ?? 0)
  return mm === 18 ? 19 : mm
}
const rateKey = (type: string, thickness: string) => `${brandKey(type)}|${thicknessMm(thickness)}`

/** The price list's (Rates / quotation) ₹/sq ft for a brand at a thickness, when it names one rate. */
export function priceListRate(brands: Brand[], type: string, thickness: string): number | '' {
  const name = brandKey(type)
  if (!name) return ''
  const named = brands.filter((b) => b.rate > 0 && brandKey(b.name) === name)
  const mm = thicknessMm(thickness)
  const fits = mm ? named.filter((b) => thicknessMm(b.thicknessMm) === mm) : named
  const rates = new Set(fits.map((b) => b.rate))
  return rates.size === 1 ? [...rates][0] : ''
}

/**
 * The rate last put on a saved card for a name and thickness: what a name the
 * price list does not know (a new model typed on a card) was charged at.
 * Only whole-rupee rates are remembered. A rate with paise (299.34) was worked
 * back from a typed or rounded amount, and carrying it to the next card is how
 * rates drifted away from the quotation.
 */
export function savedCardRates(guarantees: GuaranteeDocument[]): RateLookup {
  const saved = new Map<string, number>()
  const when = (g: GuaranteeDocument) => g.updatedAt ?? (Date.parse(g.date) || 0)
  for (const g of [...guarantees].sort((a, b) => when(b) - when(a))) {
    for (const it of g.items ?? []) {
      const rate = Number(it.sqftRate)
      const key = rateKey(String(it.brandName ?? ''), String(it.thickness ?? ''))
      if (rate > 0 && Number.isInteger(rate) && !saved.has(key)) saved.set(key, rate)
    }
  }
  return (type, thickness) => saved.get(rateKey(type, thickness)) ?? ''
}

/** Where a row's rate comes from: the quotation (default price set) first, saved cards after. */
export type Rates = { list: RateLookup; saved: RateLookup }

/**
 * The quotation's default rate for a row: its own Type's when the price list
 * names it, else the card brand's (a model number of that brand).
 */
export const quoteRate = (rates: Rates, brand: string): RateLookup => (type, thickness) => {
  const own = rates.list(type, thickness)
  return own !== '' || !brand.trim() ? own : rates.list(brand, thickness)
}

/** The rate a row starts with: the quotation's, else the last whole-rupee rate a saved card used. */
export const rowRate = (rates: Rates, brand: string): RateLookup => (type, thickness) => {
  const quoted = quoteRate(rates, brand)(type, thickness)
  if (quoted !== '') return quoted
  const own = rates.saved(type, thickness)
  return own !== '' || !brand.trim() ? own : rates.saved(brand, thickness)
}

/**
 * A row after an edit. A new brand or thickness brings its rate (quotation,
 * else saved card) unless a rate of the counter's own is in; with a rate, the
 * amount is sq ft × rate × pcs. An amount typed by hand clears the rate, so it stays.
 */
export function applyRowEdit(row: SizeRow, patch: Partial<SizeRow>, rateFor: RateLookup): SizeRow {
  const next = { ...row, ...patch }
  const sqft = rowSqft(next)
  const totalSqft = sqft * rowQty(next)
  // An amount may be typed first (or come from an older bill). Derive the
  // price per square foot so staff can see and reuse it, without changing the
  // hand-entered total when size or quantity is edited afterwards.
  if ('amount' in patch) {
    if (next.amount === '') return { ...next, sqftRate: '', amountManual: false }
    return { ...next, sqftRate: rateFromAmount(next.amount, totalSqft), amountManual: true }
  }
  if ('sqftRate' in patch) next.amountManual = false
  if (('type' in patch || 'thickness' in patch) && !('sqftRate' in patch)) {
    const was = rateFor(row.type, row.thickness)
    if (!row.amountManual && (row.sqftRate === '' || row.sqftRate === was)) next.sqftRate = rateFor(next.type, next.thickness)
  }
  if (!next.amountManual && next.sqftRate !== '' && sqft > 0) next.amount = Math.round(totalSqft * Number(next.sqftRate))
  return next
}

/**
 * "Duplicate last row": the last filled row again (the next door of the same
 * brand), then a blank row. The copy is priced at the quotation's default
 * rate and its amount follows from its size, so neither a typed amount nor a
 * rate worked back from one is carried to the new row. Only a row the
 * quotation has no rate for keeps the source row's rate.
 */
export function duplicateLastRow(rows: SizeRow[], quote: RateLookup, newId: () => string, blank: () => SizeRow): SizeRow[] {
  const filled = rows.filter(isRowFilled)
  if (filled.length === 0) return [blank()]
  const source = filled[filled.length - 1]
  const quoted = quote(source.type, source.thickness)
  const rate = quoted !== '' ? quoted : source.sqftRate
  const copy: SizeRow = { ...source, id: newId() }
  return [...filled, rate === '' ? copy : applyRowEdit(copy, { sqftRate: rate }, quote), blank()]
}

/**
 * A brand picked for the card fills every filled row with its rate (the row's
 * own Type's quotation rate first), the amount following from the size. When
 * the new brand has no rate, a row priced by the old one is cleared; a row
 * with a rate or amount of its own is left.
 */
export function repriceForBrand(rows: SizeRow[], rates: Rates, oldBrand: string, newBrand: string): SizeRow[] {
  const was = rowRate(rates, oldBrand)
  const now = rowRate(rates, newBrand)
  return rows.map((r) => {
    if (!isRowFilled(r)) return r
    const rate = now(r.type, r.thickness)
    if (rate !== '') return rate === r.sqftRate && !r.amountManual ? r : applyRowEdit(r, { sqftRate: rate }, now)
    if (r.amountManual || r.sqftRate === '' || r.sqftRate !== was(r.type, r.thickness)) return r
    return applyRowEdit(r, { amount: '' }, now)
  })
}

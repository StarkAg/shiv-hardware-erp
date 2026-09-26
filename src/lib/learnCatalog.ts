/**
 * What a bill teaches the catalogue.
 *
 * The catalogue used to hold only items somebody had explicitly pressed
 * "Add to catalog" for. Everything else typed onto a bill was used once and
 * forgotten — the shop had billed 219 distinct items and the dropdown offered
 * 54 of them, so every screw, every nail and half the sunmica had to be typed
 * out in full each time, with the rate remembered by whoever was standing
 * there.
 *
 * So a product typed onto a bill joins the list. The decision of what to learn
 * lives here rather than in the builder, because it is the part worth being
 * sure of: which lines are products, which figure may become a default price,
 * and what counts as an item already known.
 */
import type { BillItem, BillKind, CustomCatalogEntry } from './types'
import { isAmountOnlyLine, isChargeName, isRoundupLine } from './types'
import { canonicalUnit, foldName } from '../../convex/lib/text'
import { withUnitRate } from './linePick'

/** One thing to do to the catalogue. The caller applies it to the store. */
export type CatalogChange =
  | { op: 'add'; name: string; unit?: string; rate?: number; rates?: number[]; unitRates?: Record<string, number> }
  | { op: 'update'; id: string; unit?: string; rate?: number; rates?: number[]; unitRates?: Record<string, number> }

/** How many past rates an item keeps. Enough to recognise, short enough to read. */
export const RATES_KEPT = 8

/**
 * A purchase is what the shop paid, not what it sells for.
 *
 * The figure is worth keeping either way, so it joins `rates` — the list
 * offered on the row — whichever side of the books it came from. Only the
 * default stays a selling price, because a default quietly set to cost price
 * sells the stock at cost.
 */
const isBuying = (kind: BillKind) => kind === 'purchase' || kind === 'grn'

/** The per-piece figure this line was billed at, or 0 when there is none. */
export function unitRateOf(item: Pick<BillItem, 'qty' | 'amount'>): number {
  const qty = Number(item.qty) || 0
  const amount = Number(item.amount) || 0
  if (!(qty > 0) || !(amount > 0)) return 0
  return Math.round((amount / qty) * 100) / 100
}

/** A line that is stock, as against a fare, a round-off or a discount. */
export function isProductLine(item: BillItem): boolean {
  const name = String(item.description ?? '').trim()
  if (!name) return false
  if (isRoundupLine(item) || isAmountOnlyLine(item)) return false
  if (isChargeName(name)) return false
  return true
}

export function catalogChangesFor(
  items: BillItem[],
  catalog: CustomCatalogEntry[],
  kind: BillKind,
): CatalogChange[] {
  const buying = isBuying(kind)
  const changes: CatalogChange[] = []
  // Names added earlier in this same bill, so two lines of the same new item
  // do not each add their own entry.
  const addedHere = new Set<string>()

  for (const item of items) {
    if (!isProductLine(item)) continue
    // Already a catalogue line: the row's own controls keep that one current.
    if (item.customEntryId) continue

    const name = String(item.description).trim()
    const key = foldName(name)
    if (!key || addedHere.has(key)) continue

    const rate = unitRateOf(item)
    const unit = item.unit ? canonicalUnit(item.unit) : undefined
    const known = catalog.find((e) => foldName(e.name) === key)

    if (known) {
      // Nothing new to learn from a line with no figure on it.
      if (!rate && !(unit && !known.unit)) continue
      const rates = rate
        ? [rate, ...(known.rates ?? []).filter((r) => r !== rate)].slice(0, RATES_KEPT)
        : undefined
      changes.push({
        op: 'update',
        id: known.id,
        ...(rates ? (buying ? { rates } : { rate, rates, unitRates: withUnitRate(known.unitRates, unit, rate) }) : {}),
        // An item learned from a purchase may have arrived with no unit.
        ...(unit && !known.unit ? { unit } : {}),
      })
      continue
    }

    addedHere.add(key)
    changes.push({
      op: 'add',
      name,
      ...(unit ? { unit } : {}),
      ...(rate ? (buying ? { rates: [rate] } : { rate, rates: [rate], unitRates: withUnitRate(undefined, unit, rate) }) : {}),
    })
  }

  return changes
}

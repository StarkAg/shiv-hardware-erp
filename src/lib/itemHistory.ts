/**
 * What the shop has been billing lately, read back out of its own bills.
 *
 * Two uses at the counter. The unit an item goes out in is whatever it went
 * out in last time — a screw sold by the packet opens by the packet — so the
 * line need not be corrected every time. And Up in an empty item box walks
 * back through the items entered most recently, the way a terminal recalls
 * commands, so the item just billed is one key away.
 *
 * Each side of the books keeps to its own: what a supplier sold the shop says
 * nothing about how the shop sells it.
 */
import type { Bill, BillItem, BillKind } from './types'
import { isAmountOnlyLine, isChargeName, isRoundupLine } from './types'
import { canonicalUnit, foldName } from '../../convex/lib/text'

export interface RecalledItem {
  description: string
  customEntryId?: string
  sizeIn?: string
  brandName?: string
  fieldValues?: Record<string, string>
  unit?: string
  /** What one piece went for, 0 when the line had no price. */
  rate: number
}

export interface ItemHistory {
  /** Newest first, one per item. */
  recent: RecalledItem[]
  /** Folded item name → the unit it was last billed in. */
  unitOf: Map<string, string>
  /** My Items entry → the unit it was last billed in, whatever size or brand. */
  unitOfEntry: Map<string, string>
}

const RECENT_KEPT = 40

const buyingKind = (kind: BillKind | undefined) => kind === 'purchase' || kind === 'grn'

/** A line that is goods, as against a fare, a round-off, a discount or a blank. */
export function isGoodsLine(i: BillItem): boolean {
  const name = String(i.description ?? '').trim()
  return Boolean(name) && !isRoundupLine(i) && !isAmountOnlyLine(i) && !isChargeName(name) && !i.auto
}

export function recalled(i: BillItem): RecalledItem {
  const qty = Number(i.qty) || 0
  const amount = Number(i.amount) || 0
  return {
    description: String(i.description).trim(),
    ...(i.customEntryId ? { customEntryId: i.customEntryId } : {}),
    ...(i.sizeIn ? { sizeIn: i.sizeIn } : {}),
    ...(i.brandName ? { brandName: i.brandName } : {}),
    ...(i.fieldValues ? { fieldValues: i.fieldValues } : {}),
    ...(i.unit ? { unit: canonicalUnit(i.unit) } : {}),
    rate: qty > 0 && amount > 0 ? Math.round((amount / qty) * 100) / 100 : 0,
  }
}

/**
 * The history for one side of the books, from the bills on hand. Bills are
 * taken newest first by when they were written, and lines within a bill last
 * first, so "most recent" means what the counter last typed.
 */
export function itemHistory(bills: Bill[], kind: BillKind | undefined): ItemHistory {
  const buying = buyingKind(kind)
  const ordered = bills
    .filter((b) => buyingKind(b.kind) === buying && b.kind !== 'receipt' && b.kind !== 'payment' && b.kind !== 'refund')
    .slice()
    .sort((a, b) => (b.updatedAt ?? b.postedAt ?? 0) - (a.updatedAt ?? a.postedAt ?? 0) || b.date.localeCompare(a.date))

  const recent: RecalledItem[] = []
  const seen = new Set<string>()
  const unitOf = new Map<string, string>()
  const unitOfEntry = new Map<string, string>()
  for (const bill of ordered) {
    for (const line of [...(bill.items ?? [])].reverse()) {
      if (!isGoodsLine(line)) continue
      const key = foldName(line.description)
      if (!key) continue
      if (line.unit && !unitOf.has(key)) unitOf.set(key, canonicalUnit(line.unit))
      if (line.unit && line.customEntryId && !unitOfEntry.has(line.customEntryId)) {
        unitOfEntry.set(line.customEntryId, canonicalUnit(line.unit))
      }
      if (seen.has(key)) continue
      seen.add(key)
      if (recent.length < RECENT_KEPT) recent.push(recalled(line))
    }
  }
  return { recent, unitOf, unitOfEntry }
}

/**
 * What Up offers on one row: the lines above it on this bill first, nearest
 * first, then everything billed lately — each item once.
 */
export function recallList(linesAbove: BillItem[], history: RecalledItem[]): RecalledItem[] {
  const out: RecalledItem[] = []
  const seen = new Set<string>()
  for (const item of [...linesAbove.filter(isGoodsLine).reverse().map(recalled), ...history]) {
    const key = foldName(item.description)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

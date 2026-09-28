/**
 * The rate a sale line opens at when an item is picked onto it.
 *
 * The bill being written is asked first. A board takes the square-foot rate of
 * a board of the same thickness already priced on it — give one 19mm sheet its
 * price and the next 19mm opens at the same ₹/sqft, worked to its own size —
 * and anything else takes the rate of the same item further up the bill. The
 * customer is being quoted one price for one thing, and the bill says so.
 *
 * Failing that, the last price the item was sold at, worked the way Shiv Rates
 * shows it as "Last sold": the panel's own sales and customers' slips read into
 * the books, whichever is newer. Only when neither knows the item does its own
 * remembered rate fill the line (see linePick).
 *
 * Buying never comes here: a supplier's price is not a selling rate.
 */
import type { Bill, BillItem } from './types'
import { isAmountOnlyLine, isRoundupLine } from './types'
import { readBoardSize, sqftFields } from './boardSize'
import { isGoodsLine } from './itemHistory'
import { canonicalUnit, foldName } from '../../convex/lib/text'

const round2 = (n: number) => Math.round(n * 100) / 100
const sameUnit = (a: string | undefined, b: string | undefined) =>
  !canonicalUnit(a) || !canonicalUnit(b) || canonicalUnit(a) === canonicalUnit(b)

/* ------------------------------------------------------------------ */
/* this bill                                                          */
/* ------------------------------------------------------------------ */

/**
 * The rate this bill already gives the item. A board prefers one named the
 * same besides its size ("19mm S"), so two kinds of 19mm keep their own rates;
 * failing that any board of the thickness will do — as fillSheetRates does.
 */
export function rateOnBill(
  name: string,
  unit: string | undefined,
  lines: BillItem[],
  selfId: string,
): { rate: number; unit: string } | null {
  const others = lines.filter((l) => l.id !== selfId && !isRoundupLine(l) && !isAmountOnlyLine(l))
  const size = readBoardSize(name)
  if (size) {
    const priced = others.flatMap((l) => {
      const s = readBoardSize(l.description)
      const perSqft = sqftFields(l).sqftRate
      return s && perSqft && s.thicknessMm === size.thicknessMm ? [{ s, perSqft }] : []
    })
    const kind = size.rest.toLowerCase()
    const donor = priced.find((p) => p.s.rest.toLowerCase() === kind) ?? priced[0]
    return donor ? { rate: round2(donor.perSqft * size.exactSqft), unit: unit || 'Pc' } : null
  }
  const key = foldName(name)
  const same = others.find((l) =>
    foldName(l.description) === key && Number(l.qty) > 0 && Number(l.amount) > 0 && sameUnit(l.unit, unit))
  return same ? { rate: round2(Number(same.amount) / Number(same.qty)), unit: same.unit || unit || 'Pc' } : null
}

/* ------------------------------------------------------------------ */
/* last sold — as Shiv Rates shows it                                 */
/* ------------------------------------------------------------------ */

export interface SoldRate {
  rate: number
  /** The unit that rate is for, '' when the bill did not say. */
  unit: string
  date: number
}

/** A line read off a photographed bill — see `billLines` in the schema. */
export interface ScannedLine {
  desc: string
  qty?: string
  rate?: string
  amount?: number
  date: number
  partyLedgerId: string
}

const GRAMS = new Set(['g', 'gm', 'gms', 'gram', 'grams'])

/**
 * "5pc", "1/2kg", "250 gm", "2 Set" — the quantity column of a read slip, as a
 * number and a unit. Grams become kilos, since nails and fevicol are priced by
 * the kilo. Anything else ("9 sft -3.6 6pc", "2/c") is not guessed at.
 */
export function readQty(text: string | undefined | null): { qty: number; unit: string } | null {
  const m = String(text ?? '').trim().match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*([a-z][a-z.]*)?$/i)
  if (!m) return null
  let qty = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1])
  const said = (m[3] ?? '').toLowerCase().replace(/\.$/, '')
  if (!(qty > 0) || !Number.isFinite(qty)) return null
  if (GRAMS.has(said)) {
    qty /= 1000
    return { qty, unit: canonicalUnit('kg') }
  }
  return { qty, unit: canonicalUnit(said) }
}

/** "₹ 1,200/-", "MRP 599" — a rate written on a slip, or null. */
function statedRate(text: string | undefined): number | null {
  const t = String(text ?? '').toLowerCase().replace(/mrp|rs\.?|inr|₹|\/-|,/g, ' ').replace(/\s+/g, ' ').trim()
  if (!/^\d+(?:\.\d+)?$/.test(t)) return null
  const n = Number(t)
  return n > 0 ? n : null
}

/**
 * A slip's rate for one unit. The rate written on it is taken when it agrees
 * with the amount over the quantity; a misread one (an MRP, a rate per dozen)
 * gives way to the worked figure. The same test Shiv Rates applies.
 */
function slipRate(qty: number, amount: number, stated: number | null): number {
  if (stated === null) return round2(amount / qty)
  const ratio = (stated * qty) / amount
  return ratio > 1.3 || ratio < 0.77 ? round2(amount / qty) : stated
}

/**
 * The last price each item was sold at, keyed by its folded name: from the
 * panel's own sales and from customers' slips read into the books, whichever
 * is the more recent.
 */
export function lastSoldRates(bills: Bill[], scanned: ScannedLine[], isCustomer: (ledgerId: string) => boolean): Map<string, SoldRate> {
  const out = new Map<string, SoldRate>()
  const offer = (name: string, sold: SoldRate) => {
    const key = foldName(name)
    if (!key || !(sold.rate > 0)) return
    const had = out.get(key)
    if (!had || sold.date >= had.date) out.set(key, sold)
  }

  for (const bill of bills) {
    if ((bill.kind ?? 'sale') !== 'sale') continue
    const date = Date.parse(bill.date)
    if (!Number.isFinite(date)) continue
    for (const line of bill.items ?? []) {
      const qty = Number(line.qty) || 0
      const amount = Number(line.amount) || 0
      if (!isGoodsLine(line) || !(qty > 0) || !(amount > 0)) continue
      // A catalog board's rateSqft is per square foot; on anything else it is
      // the price of one piece.
      const rate = !(line.heightIn && line.widthIn) && Number(line.rateSqft) > 0 ? Number(line.rateSqft) : round2(amount / qty)
      offer(line.description, { rate, unit: canonicalUnit(line.unit), date })
    }
  }

  for (const line of scanned) {
    if (!isCustomer(String(line.partyLedgerId))) continue
    const amount = Number(line.amount) || 0
    const read = readQty(line.qty)
    if (!(amount > 0) || !read) continue
    offer(line.desc, { rate: slipRate(read.qty, amount, statedRate(line.rate)), unit: read.unit, date: line.date })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* the opening rate                                                   */
/* ------------------------------------------------------------------ */

export interface OpeningRate {
  rate: number
  unit: string
  from: 'bill' | 'sold'
}

/**
 * This bill's rate for the item, else its last selling price in the unit the
 * line is going out in. `null` leaves the item's own remembered rate to fill it.
 */
export function openingRate(
  name: string,
  unit: string | undefined,
  lines: BillItem[],
  selfId: string,
  sold: Map<string, SoldRate>,
): OpeningRate | null {
  const onBill = rateOnBill(name, unit, lines, selfId)
  if (onBill) return { ...onBill, from: 'bill' }
  const last = sold.get(foldName(name))
  // A packet's price is not a piece's: a rate in another unit is no rate.
  if (!last || !sameUnit(unit, last.unit)) return null
  return { rate: last.rate, unit: last.unit || unit || 'Pc', from: 'sold' }
}

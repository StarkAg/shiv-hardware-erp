import type { QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { foldName } from './text'
import { round2 } from './money'
import { readBills } from './billRows'

/**
 * Deliveries, and what they are likely to cost.
 *
 * Shared by the posting path, Bills to Come and the phone, so a delivery is
 * judged open, and a rate is looked up, the same way everywhere.
 */

export const GRN_TYPE = 'Goods Received'
export const GRN_ABBR = 'GRN'

/** A line that is goods — not a fare, a discount, tax or a round-off. */
export const isGoods = (i: any) =>
  Boolean(String(i?.description ?? '').trim()) &&
  !i?.isRoundup && !i?.isDiscount && !i?.auto && !i?.amountOnly

/**
 * What one piece cost on a priced line, or 0 when the line has no price.
 *
 * The amount over the quantity, always: `rateSqft` on a sheet is the price of
 * a square foot, and reading it as the price of a sheet made a ₹3,500 board
 * look like it cost 27 paise.
 */
export const unitRate = (i: any) => {
  const amount = Number(i?.amount) || 0
  const qty = Number(i?.qty) || 0
  if (amount > 0 && qty > 0) return round2(amount / qty)
  const sized = Number(i?.sqft) || (Number(i?.heightIn) && Number(i?.widthIn))
  return sized ? 0 : round2(Number(i?.rateSqft) || 0)
}

export const itemKey = (description: unknown) => foldName(String(description ?? ''))

/** Every bill the shop holds. */
export async function allBills(ctx: QueryCtx): Promise<any[]> {
  return readBills(ctx)
}

/** The bill a voucher was written from, by the voucher it names or its BILL-n ref. */
export function billOf(bills: any[], voucher: Pick<Doc<'vouchers'>, '_id' | 'refNo'>) {
  const id = String(voucher._id)
  const named = bills.find((b) => String(b?.voucherId ?? '') === id)
  if (named) return named
  const ref = String(voucher.refNo ?? '')
  return ref.startsWith('BILL-')
    ? bills.find((b) => String(b?.number) === ref.slice('BILL-'.length)) ?? null
    : null
}

const billDay = (b: any) => {
  const ms = typeof b?.date === 'number' ? b.date : Date.parse(String(b?.date ?? ''))
  return Number.isFinite(ms) ? ms : 0
}

/** Whether a bill is this supplier's, by the account it posted to or its name. */
const isParty = (b: any, ledger: Pick<Doc<'ledgers'>, '_id' | 'name' | 'place'>) => {
  if (b?.ledgerId) return String(b.ledgerId) === String(ledger._id)
  const typed = foldName(b?.customerName)
  return typed === foldName(ledger.name) ||
    (ledger.place ? typed === foldName(`${ledger.name}, ${ledger.place}`) : false)
}

export type LastRate = { rate: number; unit: string; date: number; number: string }

/**
 * The last price paid this supplier for each item, keyed by the item's name.
 *
 * It is what a delivery is estimated at until the bill comes, and what a new
 * bill's rate is checked against.
 */
export function lastRates(bills: any[], ledger: Pick<Doc<'ledgers'>, '_id' | 'name' | 'place'>) {
  const out = new Map<string, LastRate>()
  const bought = bills
    .filter((b) => b?.kind === 'purchase' && isParty(b, ledger))
    .sort((a, b) => billDay(a) - billDay(b))
  for (const b of bought) {
    for (const i of b.items ?? []) {
      if (!isGoods(i)) continue
      const rate = unitRate(i)
      if (!(rate > 0)) continue
      out.set(itemKey(i.description), {
        rate,
        unit: String(i.unit ?? ''),
        date: billDay(b),
        number: String(b.number ?? ''),
      })
    }
  }
  return out
}

/**
 * The items this supplier usually sends, most often first — what the phone
 * offers as tiles so nobody has to type them.
 */
export function usualItems(bills: any[], ledger: Pick<Doc<'ledgers'>, '_id' | 'name' | 'place'>) {
  const seen = new Map<string, { name: string; unit: string; times: number; lastQty: number; last: number; customEntryId?: string }>()
  for (const b of bills) {
    if ((b?.kind !== 'purchase' && b?.kind !== 'grn') || !isParty(b, ledger)) continue
    for (const i of b.items ?? []) {
      if (!isGoods(i)) continue
      const key = itemKey(i.description)
      const day = billDay(b)
      const row = seen.get(key)
      if (!row) {
        seen.set(key, {
          name: String(i.description).trim(),
          unit: String(i.unit ?? ''),
          times: 1,
          lastQty: Number(i.qty) || 0,
          last: day,
          customEntryId: i.customEntryId,
        })
      } else {
        row.times += 1
        if (day >= row.last) {
          row.last = day
          row.lastQty = Number(i.qty) || row.lastQty
          row.unit = String(i.unit ?? row.unit)
        }
      }
    }
  }
  return [...seen.values()].sort((a, b) => b.times - a.times || b.last - a.last)
}

/**
 * Still waiting for its bill: a delivery nobody has billed, or one whose
 * purchase has since been deleted.
 */
export async function isOpen(ctx: QueryCtx, grn: Doc<'vouchers'>) {
  if (grn.status !== 'received') return false
  if (!grn.billedIn) return true
  return !(await ctx.db.get(grn.billedIn))
}

export async function grnType(ctx: QueryCtx) {
  return ctx.db
    .query('voucherTypes')
    .withIndex('by_name', (q) => q.eq('name', GRN_TYPE))
    .unique()
}

/** A delivery's lines with the estimate beside each, and the estimated total. */
export function estimate(bill: any, rates: Map<string, LastRate>) {
  let total = 0
  let unpriced = 0
  const items = (bill?.items ?? []).filter(isGoods).map((i: any) => {
    const qty = Number(i.qty) || 0
    const known = unitRate(i)
    const last = rates.get(itemKey(i.description))
    const rate = known || last?.rate || 0
    const value = round2(rate * qty)
    if (rate > 0) total += value
    else unpriced += 1
    return {
      description: String(i.description).trim(),
      qty,
      unit: String(i.unit ?? ''),
      rate,
      value,
      from: known ? 'bill' : last ? `last paid, bill ${last.number}` : null,
    }
  })
  return { items, total: round2(total), unpriced }
}

export type Link = Id<'vouchers'>

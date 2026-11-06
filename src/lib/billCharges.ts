import type { Bill, BillItem } from './types'

/**
 * Discount, GST and round-off, worked out from the goods instead of typed.
 *
 * They used to be lines the counter wrote by hand — "Discount -250", "CGST 9%
 * 488.90", "Roundup -459" — each figured on a calculator first. The bill now
 * says what it wants (18% GST in the state, 5% off, round to the rupee) and
 * the lines are written from that, in the order an invoice reads:
 *
 *   goods → discount → taxable value → CGST + SGST (or IGST) → round-off → total
 *
 * The lines are ordinary charge lines on the saved bill, so the print, the
 * books and a device that has never heard of this all read them as before.
 * Each carries `auto`, and the editor takes them off when a bill is opened
 * and writes them again from the goods, so they can never go stale.
 */

export type GstMode = 'none' | 'local' | 'igst'
export type RoundMode = 'off' | 'auto' | 'manual'

export interface BillCharges {
  /** CGST + SGST inside the state, IGST across it. */
  gst?: GstMode
  /** The whole rate, 18 for 18% — split 9 + 9 inside the state. */
  gstRate?: number
  /** Taken off the goods before tax, as rupees or as a percentage. */
  offValue?: number
  offIsPercent?: boolean
  /** Auto rounds to the nearest rupee; manual takes the figure as typed. */
  round?: RoundMode
  roundValue?: number
}

// 'bf' is the old dues taken back out of a paper total (see withBfInside).
export type AutoKind = 'discount' | 'cgst' | 'sgst' | 'igst' | 'round' | 'bf'

export const GST_RATES = [5, 12, 18, 28]
export const DEFAULT_GST_RATE = 18

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const pct = (n: number) => `${Number.isInteger(n) ? n : round2(n)}%`

/** The lines the counter wrote, without any this module wrote. */
export const handLines = (items: BillItem[] = []) => items.filter((i) => !i.auto)

/** What the bill comes to, line by line, before and after each step. */
export function chargeLines(items: BillItem[], c: BillCharges): BillItem[] {
  const own = handLines(items)
  const goods = round2(own.reduce((s, i) => s + (Number(i.amount) || 0), 0))
  const out: BillItem[] = []
  const add = (auto: AutoKind, description: string, amount: number, roundup = false) => {
    if (!amount) return
    out.push({
      id: `auto-${auto}`,
      description,
      qty: 0,
      unit: '',
      amount,
      auto,
      ...(roundup ? { isRoundup: true } : { amountOnly: true }),
    })
  }

  const offValue = c.offIsPercent
    ? Math.min(100, Math.max(0, Number(c.offValue) || 0))
    : Math.max(0, Number(c.offValue) || 0)
  const off = goods > 0
    ? round2(Math.min(goods, c.offIsPercent ? (goods * offValue) / 100 : offValue))
    : 0
  add('discount', c.offIsPercent && off ? `Discount ${pct(offValue)}` : 'Discount', -off)

  const taxable = goods - off
  const rate = Math.max(0, Number(c.gstRate ?? DEFAULT_GST_RATE) || 0)
  if (taxable > 0 && rate > 0 && c.gst === 'local') {
    // Each half is rounded on its own, the way it is printed and filed.
    const half = round2((taxable * rate) / 200)
    add('cgst', `CGST ${pct(rate / 2)}`, half)
    add('sgst', `SGST ${pct(rate / 2)}`, half)
  } else if (taxable > 0 && rate > 0 && c.gst === 'igst') {
    add('igst', `IGST ${pct(rate)}`, round2((taxable * rate) / 100))
  }

  const before = round2(goods + out.reduce((s, i) => s + i.amount, 0))
  if (c.round === 'auto') add('round', 'Roundup', round2(Math.round(before) - before), true)
  else if (c.round === 'manual') add('round', 'Roundup', round2(Number(c.roundValue) || 0), true)

  return out
}

/** The bill with its worked-out lines at the foot, ready to total and save. */
export function withCharges<T extends Pick<Bill, 'items'> & BillCharges>(bill: T): T {
  const own = handLines(bill.items)
  if (!hasCharges(bill)) return own.length === bill.items.length ? bill : { ...bill, items: own }
  return { ...bill, items: [...own, ...chargeLines(own, bill)] }
}

/**
 * A paper total typed as one "Bill" line already has the old dues in it: the
 * paper writes B/f at the top and adds it into the foot. Left alone, the sale
 * carried the B/f once in that figure and the account carried it again, so a
 * ₹9,255 paper (₹370 of it B/f) took the account from ₹370 to ₹9,625. A line
 * takes the B/f back out, leaving the sale as the goods alone; the B/f joins
 * the grand total again on top, which comes back to the paper's figure.
 * Written like the other worked-out lines, so a reopened bill rewrites it.
 */
export function withBfInside<T extends Pick<Bill, 'items'>>(bill: T, bf: number): T {
  const paperTotal = handLines(bill.items).some((i) => /^bill$/i.test((i.description ?? '').trim()) && Number(i.amount) > 0)
  if (!(bf > 0) || !paperTotal) return bill
  return { ...bill, items: [...bill.items, { id: 'auto-bf', description: 'Less B/f', qty: 0, unit: '', amount: -bf, auto: 'bf', amountOnly: true }] }
}

export const hasCharges = (c: BillCharges) =>
  (c.gst ?? 'none') !== 'none' || (Number(c.offValue) || 0) > 0 || (c.round ?? 'off') !== 'off'

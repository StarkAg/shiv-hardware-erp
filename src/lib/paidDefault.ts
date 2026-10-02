/**
 * Whether a sale counts as paid when nobody said.
 *
 * The shop sells two ways. Most sales go out on a written bill with the goods
 * on it, to customers who run an account — M/s WB has forty-odd lines and a
 * balance paid off in bits. Those are credit and must stay credit.
 *
 * The rest are entered as a figure with no goods lines: a photographed slip,
 * or a counter sale keyed in as an amount. Those are paid on the spot, and the
 * counter was entering each one twice — the sale, then a receipt beside it —
 * only so the customer's account would show that it had been settled.
 *
 * So a sale with no goods lines is taken as paid in full, and one with goods
 * on it is left alone. Deciding it by the lines rather than by the customer is
 * the point: the same customer can do both, and the bill is what says which.
 *
 * It is only ever a default. Anything typed into the Received box wins —
 * including 0, which is how a no-lines sale on credit is recorded.
 */
import type { Bill, BillItem } from './types'
import { isProductLine } from './learnCatalog'

/** Goods on the bill, as against only a figure, a fare or a round-off. */
export function hasGoods(items: BillItem[] | undefined): boolean {
  return (items ?? []).some(isProductLine)
}

/**
 * True when this bill will be saved as paid without being told to.
 *
 * Shown on screen as well as applied on save, so nobody is surprised by a
 * customer's account coming out square.
 */
export function paidByDefault(
  bill: Pick<Bill, 'kind' | 'items' | 'paidAmount'>,
  total: number,
): boolean {
  if ((bill.kind ?? 'sale') !== 'sale') return false
  // Somebody has said — even 0, which means credit.
  if (bill.paidAmount !== undefined && bill.paidAmount !== null) return false
  if (!(total > 0)) return false
  return !hasGoods(bill.items)
}

/** The paid fields to post with, after the default is applied. */
export function withPaidDefault<T extends Pick<Bill, 'kind' | 'items' | 'paidAmount' | 'paid'>>(
  bill: T,
  total: number,
): Pick<Bill, 'paidAmount' | 'paid'> {
  if (paidByDefault(bill, total)) return { paidAmount: total, paid: true }
  return { paidAmount: bill.paidAmount, paid: bill.paid }
}

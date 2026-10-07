/** Cash sales to W/B always settle in full; every other sale is on credit unless told. */
import type { Bill, BillItem } from './types'
import { isWithoutBillParty } from '../../convex/lib/text'
import { isProductLine } from './learnCatalog'

/** Goods on the bill, as against only a figure, a fare or a round-off. */
export function hasGoods(items: BillItem[] | undefined): boolean {
  return (items ?? []).some(isProductLine)
}

/**
 * True when this bill will be saved as paid without being told to.
 *
 * Only a W/B sale: it is a cash sale with no account behind it, so it is
 * settled in full. Every other party's sale is on credit unless somebody types
 * what was paid — taking an amount-only sale as paid put whole accounts square
 * that were not.
 *
 * Shown on screen as well as applied on save, so nobody is surprised by a
 * customer's account coming out square.
 */
export function paidByDefault(
  bill: Pick<Bill, 'kind' | 'items' | 'paidAmount'> & { customerName?: string },
  total: number,
): boolean {
  if ((bill.kind ?? 'sale') !== 'sale') return false
  return total > 0 && isWithoutBillParty(bill.customerName)
}

/** The paid fields to post with, after the default is applied. */
export function withPaidDefault<T extends Pick<Bill, 'kind' | 'items' | 'paidAmount' | 'paid'> & { customerName?: string }>(
  bill: T,
  total: number,
): Pick<Bill, 'paidAmount' | 'paid'> {
  if (paidByDefault(bill, total)) return { paidAmount: total, paid: true }
  return { paidAmount: bill.paidAmount, paid: bill.paid }
}

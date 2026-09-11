import type { Doc, Id } from '../_generated/dataModel'

/** Pair deleted bills with their voucher, without guessing when old references collide. */
export function linkTrashRows(bills: Doc<'billsTrash'>[], vouchers: Doc<'trash'>[]) {
  const links = new Map<Id<'billsTrash'>, Id<'trash'>>()
  const claimed = new Set<Id<'trash'>>()
  for (const bill of bills) {
    if (!bill.voucherTrashId) continue
    const voucher = vouchers.find(v => v._id === bill.voucherTrashId)
    if (voucher && !claimed.has(voucher._id)) {
      links.set(bill._id, voucher._id)
      claimed.add(voucher._id)
    }
  }
  // Older deletions only recorded BILL-n. Use that reference only when both
  // sides are unique; two financial years can otherwise share the same number.
  for (const bill of bills) {
    if (links.has(bill._id) || bill.voucherTrashId || !bill.voucherRef) continue
    if (bills.filter(b => b.voucherRef === bill.voucherRef).length !== 1) continue
    const candidates = vouchers.filter(v => v.refNo === bill.voucherRef && !claimed.has(v._id))
    if (candidates.length !== 1) continue
    const voucher = candidates[0]
    if (bill.bill?.ledgerId && bill.bill.ledgerId !== voucher.partyLedgerId) continue
    if (bill.bill?.date && new Date(bill.bill.date).getTime() !== voucher.date) continue
    if (typeof bill.bill?.total === 'number' && bill.bill.total !== voucher.amount) continue
    links.set(bill._id, voucher._id)
    claimed.add(voucher._id)
  }
  return links
}

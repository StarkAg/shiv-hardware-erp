import type { MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { fold } from './parties'

/**
 * Carries an account's new name into every copy of the old one.
 *
 * The ledger holds the name, but it is not the only place it is written. A bill
 * keeps the name it was saved with, and the bill builder offers names from past
 * bills alongside the accounts — so after a rename, every old bill still reading
 * "Ramesh" looked like a second party, and the old name came straight back into
 * the dropdown next to "Ramesh Traders". The same copy sat in the bin, where a
 * restore would bring it back, and in the shop's customer list.
 *
 * A bill belongs to the account when it names the account's id, or — for bills
 * written before bills recorded one — when its name is the old name set aside
 * case, spacing and "M/s". Those older bills are tied to the account here, so a
 * later rename finds them by id. Every changed bill is stamped newer, because
 * devices keep whichever copy of a bill changed last: an unstamped rename would
 * lose to the first device that pushed its stale copy back.
 *
 * Returns how many copies changed, for the history line.
 */
export async function carryRename(
  ctx: MutationCtx,
  ledger: { _id: Id<'ledgers'>; name: string; phone?: string },
  renamed: string,
  sideIsCustomer: boolean,
) {
  const was = fold(ledger.name)
  const now = Date.now()
  const ours = (bill: any) => {
    if (!bill) return false
    if (bill.ledgerId) return bill.ledgerId === ledger._id
    // Only a sale or a receipt names a customer on a bill; a supplier's name is
    // never matched against one, so a customer's rename cannot touch it.
    const kind = bill.kind ?? 'sale'
    const customerBill = kind === 'sale' || kind === 'receipt'
    return customerBill === sideIsCustomer && fold(bill.customerName) === was
  }
  const retitle = (bill: any) => ({ ...bill, customerName: renamed, ledgerId: ledger._id, updatedAt: now })

  let bills = 0
  const store = await ctx.db.query('billsStore').first()
  if (store) {
    let touched = false
    const next = (store.bills ?? []).map((bill: any) => {
      if (!ours(bill) || bill.customerName === renamed) return bill
      touched = true
      bills++
      return retitle(bill)
    })
    if (touched) await ctx.db.patch(store._id, { bills: next, savedAt: now })
  }

  // What the bin holds comes back as it was saved, so it has to say the new name.
  let binned = 0
  for (const row of await ctx.db.query('billsTrash').collect()) {
    if (!ours(row.bill) || row.bill.customerName === renamed) continue
    await ctx.db.patch(row._id, { bill: retitle(row.bill) })
    binned++
  }

  // The shop's own customer list is matched on the name, and on the number
  // where both have one, so a namesake with a different phone is left alone.
  let customers = 0
  if (sideIsCustomer) {
    for (const row of await ctx.db.query('customers').collect()) {
      if (fold(row.name) !== was) continue
      if (ledger.phone && row.mobile && row.mobile !== ledger.phone) continue
      await ctx.db.patch(row._id, { name: renamed, updatedAt: now })
      customers++
    }
  }

  return { bills, binned, customers }
}

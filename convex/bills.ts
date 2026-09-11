import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { requirePin } from './lib/pin'
import { linkTrashRows } from './lib/trashLinks'
import { record } from './lib/history'

/**
 * Saves what a device has, without ever deleting what it hasn't.
 *
 * This used to replace the snapshot outright, and that cost the shop every
 * bill it had — twice. A device that opens the panel with an empty store (a
 * new browser, cleared site data, a phone that has never synced) would push
 * its empty list two seconds later and take every bill down with it. Nothing
 * on the server said "these were deleted"; they were simply not mentioned.
 *
 * So a save is a merge: bills present here are updated, bills only on the
 * server are left alone, and the one way to remove a bill is `remove`, which
 * puts it in the trash where it can be got back. A bill already in the trash
 * is not re-added by a device that still has a copy of it.
 */
export const save = mutation({
  args: {
    bills:   v.array(v.any()),
    billSeq: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('billsStore').first()
    if (!existing) {
      await ctx.db.insert('billsStore', {
        bills: args.bills, billSeq: args.billSeq, savedAt: Date.now(),
      })
      return { kept: 0, written: args.bills.length }
    }

    const [inTrash, tombstones] = await Promise.all([
      ctx.db.query('billsTrash').collect(),
      ctx.db.query('billTombstones').collect(),
    ])
    // A deletion outlives the copy in the bin: emptying the bin used to make
    // the bill eligible to come back from any device that still had it.
    const deleted = new Set([
      ...inTrash.map((row) => row.billId),
      ...tombstones.map((row) => row.billId),
    ])
    const byId = new Map<string, any>()
    for (const bill of existing.bills ?? []) if (bill?.id) byId.set(bill.id, bill)

    let written = 0
    for (const bill of args.bills) {
      if (!bill?.id || deleted.has(bill.id)) continue
      // Newer wins. This took whatever it was handed, so a PC that had been
      // off for a week would overwrite today's edits with its own stale copy
      // the moment it reconnected.
      const mine = byId.get(bill.id)
      if (mine && (mine.updatedAt ?? 0) > (bill.updatedAt ?? 0)) continue
      byId.set(bill.id, bill)
      written++
    }

    await ctx.db.patch(existing._id, {
      bills: [...byId.values()],
      billSeq: Math.max(existing.billSeq ?? 0, args.billSeq),
      savedAt: Date.now(),
    })
    return { kept: byId.size - written, written }
  },
})

/** Return the single bills snapshot row (or null if nothing saved yet). */
export const get = query({
  args: {},
  handler: async (ctx) => ctx.db.query('billsStore').first(),
})

/**
 * Deleting a bill.
 *
 * A bill and the voucher it posted are one event written twice, so they go
 * together: the bill is kept whole in the trash and the voucher is moved to
 * the ledger's own trash, which takes its Dr/Cr lines out of the balances.
 * Leaving the voucher behind is what made a deleted bill look like it was
 * still there — an amount against the customer with nothing to open.
 */
export const remove = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const store = await ctx.db.query('billsStore').first()
    const bill = (store?.bills ?? []).find((b: any) => b?.id === id)
    if (!bill) return { removed: false as const }

    const ref = `BILL-${bill.number}`

    /**
     * The voucher goes only when this bill is the one that posted it. A bill
     * that names its voucher says so outright, and that id is the link — the
     * reference is how bills written before the id existed are matched, and
     * the only test available for them.
     *
     * Demanding both is what let a bill whose voucher had been given another
     * reference be deleted on its own, leaving an amount in the books with
     * nothing to open.
     */
    const voucher = bill.voucherId
      ? await ctx.db.get(bill.voucherId as Id<'vouchers'>)
      : (await ctx.db.query('vouchers').filter((q) => q.eq(q.field('refNo'), ref)).first()) ?? null
    const voucherTrashId = voucher
      ? await ctx.runMutation(api.vouchers.remove, { id: voucher._id })
      : null

    const deletedAt = Date.now()
    const tombstone = await ctx.db
      .query('billTombstones')
      .withIndex('by_bill', (q) => q.eq('billId', id))
      .unique()
    if (!tombstone) {
      await ctx.db.insert('billTombstones', {
        billId: id,
        number: bill.number ? String(bill.number) : undefined,
        deletedAt,
      })
    }

    await ctx.db.insert('billsTrash', {
      billId: id,
      bill,
      deletedAt,
      ...(voucher ? { voucherRef: voucher.refNo ?? ref } : {}),
      ...(voucherTrashId ? { voucherTrashId } : {}),
    })
    await ctx.db.patch(store!._id, {
      bills: (store!.bills ?? []).filter((b: any) => b?.id !== id),
      savedAt: Date.now(),
    })
    return { removed: true as const, voucherRemoved: Boolean(voucher) }
  },
})

/** What is in the bin, newest first. */
export const trashList = query({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('billsTrash').collect()).sort((a, b) => b.deletedAt - a.deletedAt),
})

/**
 * Which bills have been deleted, for devices that still hold a copy.
 *
 * Merging on its own only ever adds; a bill deleted on one PC stayed on the
 * other until its storage was cleared. This is the list the panel subscribes
 * to so a deletion travels the way a save does.
 */
export const deletedIds = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query('billTombstones').collect()).map((row) => row.billId),
})

/**
 * Restore the bill and its original accounting lines in the same transaction.
 * Restoring must not depend on somebody opening the editor and saving again.
 */
export const restore = mutation({
  args: { id: v.id('billsTrash') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (!row) return null
    const [deletedBills, deletedVouchers] = await Promise.all([
      ctx.db.query('billsTrash').collect(), ctx.db.query('trash').collect(),
    ])
    const voucherTrashId = linkTrashRows(deletedBills, deletedVouchers).get(id)
    if (row.voucherRef && !voucherTrashId) {
      // It may already have been restored through the old ledger trash screen.
      const live = await ctx.db.query('vouchers')
        .filter(q => q.eq(q.field('refNo'), row.voucherRef)).collect()
      if (live.length !== 1
        || (row.bill?.ledgerId && live[0].partyLedgerId !== row.bill.ledgerId)
        || (row.bill?.date && live[0].date !== new Date(row.bill.date).getTime())
        || (typeof row.bill?.total === 'number' && live[0].amount !== row.bill.total)) {
        throw new Error('The linked accounting voucher is missing or ambiguous. Review it before restoring this bill.')
      }
    }
    if (voucherTrashId) await ctx.runMutation(api.trash.restore, { id: voucherTrashId })
    // It is back on the books, so it is no longer deleted anywhere.
    const tombstone = await ctx.db
      .query('billTombstones')
      .withIndex('by_bill', (q) => q.eq('billId', row.billId))
      .unique()
    if (tombstone) await ctx.db.delete(tombstone._id)
    const bill = { ...row.bill, updatedAt: Date.now() }
    const store = await ctx.db.query('billsStore').first()
    const bills = (store?.bills ?? []).filter((b: any) => b?.id !== row.billId)
    if (store) await ctx.db.patch(store._id, { bills: [...bills, bill], savedAt: Date.now() })
    else await ctx.db.insert('billsStore', { bills: [bill], billSeq: Number(bill.number) || 0, savedAt: Date.now() })
    await ctx.db.delete(id)
    await record(ctx, 'bill.restore', `Restored bill ${bill.number}`, { entity: 'bill', entityId: row.billId })
    return bill
  },
})

/** Empties one out of the bin for good. Guarded, like every other erasure. */
export const purge = mutation({
  args: { id: v.id('billsTrash'), pin: v.string() },
  handler: async (ctx, { id, pin }) => {
    requirePin(pin)
    const row = await ctx.db.get(id)
    if (!row) return
    const [deletedBills, deletedVouchers] = await Promise.all([
      ctx.db.query('billsTrash').collect(), ctx.db.query('trash').collect(),
    ])
    const voucherTrashId = linkTrashRows(deletedBills, deletedVouchers).get(id)
    if (voucherTrashId) await ctx.runMutation(api.trash.purge, { id: voucherTrashId, pin })
    await ctx.db.delete(id)
    await record(ctx, 'bill.purge', `Permanently deleted bill ${row.bill?.number ?? ''}`)
  },
})

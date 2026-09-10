import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { requirePin } from './lib/pin'

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

    const deleted = new Set(
      (await ctx.db.query('billsTrash').collect()).map((row) => row.billId),
    )
    const byId = new Map<string, any>()
    for (const bill of existing.bills ?? []) if (bill?.id) byId.set(bill.id, bill)

    let written = 0
    for (const bill of args.bills) {
      if (!bill?.id || deleted.has(bill.id)) continue
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
    const candidate = bill.voucherId
      ? await ctx.db.get(bill.voucherId as Id<'vouchers'>)
      : await ctx.db.query('vouchers').filter((q) => q.eq(q.field('refNo'), ref)).first()

    /**
     * The voucher goes only when this bill is the one that posted it — its
     * reference names this bill. A row that is a voucher opened for editing
     * borrows a voucher it does not own, and deleting that row must leave the
     * books exactly as they were.
     */
    const voucher = candidate?.refNo === ref ? candidate : null
    if (voucher) await ctx.runMutation(api.vouchers.remove, { id: voucher._id })

    await ctx.db.insert('billsTrash', {
      billId: id,
      bill,
      deletedAt: Date.now(),
      ...(voucher ? { voucherRef: ref } : {}),
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
 * Puts a bill back. The voucher is not re-posted here — saving the restored
 * bill does that, and does it with whatever the bill says now rather than
 * with a copy of what it said when it was deleted.
 */
export const restore = mutation({
  args: { id: v.id('billsTrash') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (!row) return null
    const store = await ctx.db.query('billsStore').first()
    const bills = (store?.bills ?? []).filter((b: any) => b?.id !== row.billId)
    if (store) await ctx.db.patch(store._id, { bills: [...bills, row.bill], savedAt: Date.now() })
    else await ctx.db.insert('billsStore', { bills: [row.bill], billSeq: 0, savedAt: Date.now() })
    await ctx.db.delete(id)
    return row.bill
  },
})

/** Empties one out of the bin for good. Guarded, like every other erasure. */
export const purge = mutation({
  args: { id: v.id('billsTrash'), pin: v.string() },
  handler: async (ctx, { id, pin }) => {
    requirePin(pin)
    await ctx.db.delete(id)
  },
})

import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { mutation, query } from './lib/guarded'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { requirePin } from './lib/pin'
import { linkTrashRows } from './lib/trashLinks'
import { record } from './lib/history'
import { dropBill, readBill, readBills, storeMeta, writeBills } from './lib/billRows'
import { attachmentIds, deleteUnreferencedFiles } from './lib/attachmentFiles'
import { trashVoucher } from './vouchers'

/**
 * What the books were written from. On a bill already in the books these
 * change only through posting (`billLedger.postBill`), which rewrites the
 * voucher in the same transaction. A plain upload changing them would leave
 * the bill saying 2,000 while its voucher still says 1,000.
 */
const BOOKED = [
  'items', 'total', 'customerName', 'ledgerId', 'kind', 'date', 'number', 'voucherId', 'postedAt',
  'paid', 'paidAmount', 'paidDate', 'moneyAmount', 'discount', 'paymentMode',
  'gst', 'gstRate', 'offValue', 'offIsPercent', 'round', 'roundValue',
] as const
const booked = (bill: any) => JSON.stringify(BOOKED.map((k) => bill?.[k] ?? null))

/** A bill that is in the books: everything but a quotation, which never posts. */
const inTheBooks = (bill: any) => bill?.kind !== 'quotation'

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
    // Read once: a device sends every bill it holds, and a lookup per bill
    // would be thousands of reads for a handful of changes.
    const held = new Map((await readBills(ctx)).map((b: any) => [String(b.id), b]))
    const changed: any[] = []
    let refused = 0
    for (const bill of args.bills) {
      if (!bill?.id || deleted.has(bill.id)) continue
      // Newer wins. This took whatever it was handed, so a PC that had been
      // off for a week would overwrite today's edits with its own stale copy
      // the moment it reconnected.
      const mine = held.get(String(bill.id))
      if (mine && (mine.updatedAt ?? 0) >= (bill.updatedAt ?? 0)) continue
      // A bill the books refused stays on the device that wrote it. Uploaded,
      // it was a bill the accounts had never heard of.
      if (bill.postError) { refused += 1; continue }
      // Money on a posted bill changes only by posting it. Anything else the
      // device changed (a photo, a print mark) is still taken; what the books
      // were written from stays as the server has it.
      if (mine && inTheBooks(mine) && booked(mine) !== booked(bill)) {
        refused += 1
        const kept = { ...bill }
        for (const k of BOOKED) {
          if (k in mine) kept[k] = mine[k]
          else delete kept[k]
        }
        changed.push(kept)
        continue
      }
      changed.push(bill)
    }
    // A device that has nothing new to say changes nothing — and does not
    // wake every other device up to tell them so.
    if (changed.length) await writeBills(ctx, changed, args.billSeq)
    else {
      const meta = await storeMeta(ctx)
      if (meta && args.billSeq > (meta.billSeq ?? 0)) await ctx.db.patch(meta._id, { billSeq: args.billSeq })
    }
    return { kept: args.bills.length - changed.length, written: changed.length, refused }
  },
})

/**
 * Every bill, in the shape devices have always been sent: the list, the
 * running number, and when anything last changed.
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const meta = await storeMeta(ctx)
    if (!meta) return null
    return { bills: await readBills(ctx), billSeq: meta.billSeq ?? 0, savedAt: meta.savedAt }
  },
})

/** Add phone photos to an existing bill and its voucher in one transaction. */
export const addImages = mutation({
  args: { billId: v.string(), storageIds: v.array(v.id('_storage')) },
  handler: async (ctx, { billId, storageIds }) => {
    if (!storageIds.length || storageIds.length > 12) throw new Error('Choose 1 to 12 bill photos.')
    const bill = await readBill(ctx, billId)
    if (!bill?.voucherId) throw new Error('Choose a posted bill with an accounting voucher.')
    const voucherId = ctx.db.normalizeId('vouchers', String(bill.voucherId))
    const voucher = voucherId ? await ctx.db.get(voucherId) : null
    if (!voucher || (bill.ledgerId && voucher.partyLedgerId !== bill.ledgerId)) {
      throw new Error('The voucher linked to this bill is missing or belongs to another party.')
    }
    const unique = [...new Set(storageIds)]
    for (const id of unique) {
      const file = await ctx.db.system.get(id)
      if (!file || (file.contentType && !file.contentType.startsWith('image/'))) throw new Error('Choose an image file for this bill.')
    }
    const idOf = (doc: any) => typeof doc === 'string' ? doc : doc.storageId
    const onBill = new Set((bill.attachments ?? []).map(idOf))
    const onVoucher = new Set((voucher.attachments ?? []).map(idOf))
    const added = unique.filter(id => !onBill.has(id) || !onVoucher.has(id))
    if (!added.length) return { added: 0, total: onBill.size }
    const now = Date.now()
    const documents = unique.map(storageId => ({ storageId, kind: 'bill' as const }))
    await ctx.db.patch(voucher._id, {
      attachments: [...(voucher.attachments ?? []), ...documents.filter(doc => !onVoucher.has(doc.storageId))],
      updatedAt: now,
    })
    const updated = {
      ...bill,
      attachments: [...(bill.attachments ?? []), ...documents.filter(doc => !onBill.has(doc.storageId))],
      updatedAt: now,
    }
    await writeBills(ctx, [updated])
    const flow = await ctx.db.query('billFlows').withIndex('by_bill', q => q.eq('billId', billId)).unique()
    if (flow) {
      const photos = [...new Set([...flow.photos, ...unique])]
      await ctx.db.patch(flow._id, { photos, updatedAt: now,
        history: [...flow.history, { at: now, action: 'Bill photo added from phone' }] })
    }
    await record(ctx, 'bill.photo.add', `Added ${added.length} photo${added.length === 1 ? '' : 's'} to bill ${bill.number}`,
      { entity: 'bill', entityId: billId })
    return { added: added.length, total: updated.attachments.length }
  },
})

/**
 * Moves bills out of the old single row into a row each. Safe to run again:
 * a bill already moved is left as it is.
 *
 *   npx convex run --prod bills:moveToRows
 */
export const moveToRows = internalMutation({
  args: {},
  handler: async (ctx) => {
    const meta = await storeMeta(ctx)
    const legacy = ((meta?.bills ?? []) as any[]).filter((b) => b?.id)
    // One read of what has already moved, and one write of the rest: reading
    // the old row again for every bill runs past what one call may read.
    const already = new Map((await ctx.db.query('bills').collect()).map((r) => [r.billId, r]))
    const toMove = legacy.filter((bill) => {
      const row = already.get(String(bill.id))
      return !row || (row.bill?.updatedAt ?? 0) < (bill.updatedAt ?? 0)
    })
    if (toMove.length) await writeBills(ctx, toMove)
    const moved = toMove.length
    const rows = await ctx.db.query('bills').collect()
    // Only once every bill from the old row has one of its own is the old row emptied.
    const have = new Set(rows.map((r) => r.billId))
    const missing = legacy.filter((b) => !have.has(String(b.id)))
    if (missing.length) throw new Error(`${missing.length} bills did not move — nothing emptied`)
    if (meta && legacy.length) await ctx.db.patch(meta._id, { bills: [], savedAt: Date.now() })
    await record(ctx, 'bills.move', `Moved ${legacy.length} bills to a row each (${moved} written)`)
    return { legacy: legacy.length, moved, rows: rows.length }
  },
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
    const bill = await readBill(ctx, id)
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
    const byId = bill.voucherId ? await ctx.db.get(bill.voucherId as Id<'vouchers'>) : null
    /*
     * A voucher posted again under a new id leaves the bill naming the old,
     * gone one (bill 387, moved to a quotation, left SAL-0547 in the books).
     * Then the reference finds it — but only the same customer's, so last
     * year's BILL-387 is never the one taken.
     */
    const voucher = byId ?? (bill.ledgerId
      ? await ctx.db.query('vouchers')
          .withIndex('by_party', (q) => q.eq('partyLedgerId', bill.ledgerId as Id<'ledgers'>))
          .filter((q) => q.eq(q.field('refNo'), ref)).first()
      : bill.voucherId
        ? null
        : await ctx.db.query('vouchers').filter((q) => q.eq(q.field('refNo'), ref)).first()) ?? null
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
    await dropBill(ctx, id)
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
    await writeBills(ctx, [bill], Number(bill.number) || 0)
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
    await deleteUnreferencedFiles(ctx, attachmentIds(row.bill?.attachments ?? []))
    await record(ctx, 'bill.purge', `Permanently deleted bill ${row.bill?.number ?? ''}`)
  },
})

/**
 * One-off (2026-10-10): drop the blank line the bill form used to save at the
 * foot of a bill (no name, no amount) from bills that also have real lines.
 * Bills whose only line is blank (receipts, payments) are left as they are.
 * The bill's time moves on so every device takes the cleaned copy.
 *   npx convex run --prod bills:dropBlankLines '{}'   (then pass the cursor it returns)
 */
export const dropBlankLines = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('bills').paginate({ numItems: 200, cursor: cursor ?? null })
    const blank = (i: any) => !String(i?.description ?? '').trim() && !Number(i?.amount) && !i?.auto && !i?.isRoundup && !i?.isDiscount
    const changed: any[] = []
    for (const row of page.page) {
      const bill: any = row.bill ?? {}
      const items: any[] = Array.isArray(bill.items) ? bill.items : []
      const kept = items.filter((i) => !blank(i))
      if (!kept.length || kept.length === items.length) continue
      changed.push({ ...bill, items: kept, updatedAt: Date.now() })
    }
    // Written the way a save writes them, so the bill sequence moves and every
    // device pulls the cleaned bills.
    if (changed.length) await writeBills(ctx, changed)
    return { cleaned: changed.map((b) => String(b.number)), isDone: page.isDone, cursor: page.continueCursor }
  },
})

/**
 * One-off (2026-10-10): a bill already in the bin whose voucher stayed in the
 * books — deleted while it named a voucher id that no longer existed. Its
 * voucher is found by reference and the same customer, sent to Trash, and
 * linked to the binned bill so restoring brings both back together.
 *   npx convex run --prod bills:trashLeftVoucher '{"number": "387"}'
 */
export const trashLeftVoucher = internalMutation({
  args: { number: v.string() },
  handler: async (ctx, { number }) => {
    const binned = (await ctx.db.query('billsTrash').collect())
      .filter((t: any) => String(t.bill?.number) === number && !t.voucherTrashId)
      .sort((a: any, b: any) => b.deletedAt - a.deletedAt)[0] as any
    if (!binned) return { done: false, why: `no binned bill ${number} without its voucher` }
    const ref = `BILL-${number}`
    if (!binned.bill?.ledgerId) return { done: false, why: `binned bill ${number} names no customer account` }
    const voucher = await ctx.db.query('vouchers')
      .withIndex('by_party', (q) => q.eq('partyLedgerId', binned.bill.ledgerId as Id<'ledgers'>))
      .filter((q) => q.eq(q.field('refNo'), ref)).first()
    if (!voucher) return { done: false, why: `no ${ref} voucher for that customer in the books` }
    const voucherTrashId = await trashVoucher(ctx, voucher._id)
    await ctx.db.patch(binned._id, { voucherRef: voucher.refNo ?? ref, ...(voucherTrashId ? { voucherTrashId } : {}) })
    return { done: true, voucherNo: voucher.voucherNo, fy: voucher.fy }
  },
})

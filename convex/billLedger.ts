import { v } from 'convex/values'
import { mutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'

/**
 * Bills posting into the books.
 *
 * A bill and a ledger account for the same customer are the same real-world
 * thing recorded twice, so saving a bill opens the customer's account if they
 * don't have one and posts the sale against it:
 *
 *     Dr  <customer>        (Sundry Debtors — they owe us)
 *     Cr  Sales Accounts    (income)
 *
 * Re-saving rewrites that bill's voucher rather than adding a second one, so
 * editing a bill can't quietly double the customer's balance.
 */

/** Indian financial year: April to March, written "2026-27". */
function financialYear(at: number): string {
  const d = new Date(at)
  const y = d.getFullYear()
  const start = d.getMonth() >= 3 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

async function nextVoucherNo(ctx: MutationCtx, typeId: string, fy: string) {
  const key = `voucher:${typeId}:${fy}`
  const row = await ctx.db.query('counters').filter((q) => q.eq(q.field('name'), key)).first()
  const value = (row?.value ?? 0) + 1
  if (row) await ctx.db.patch(row._id, { value })
  else await ctx.db.insert('counters', { name: key, value })
  return value
}

/**
 * A bill written in the builder can be any of the four vouchers, so what the
 * builder posts is described here rather than hard-coded to a sale: which
 * account takes the other side, which group the party is opened under, and
 * which way round the two sides go.
 *
 * A receipt or payment posts against Bank because that is where the shop's
 * money moves; the counter can retype the account on the voucher afterwards.
 */
const KINDS = {
  sale:     { type: 'Sale',     account: 'Sales',     group: 'Sundry Debtors',   party: 'Dr', other: 'Cr' },
  purchase: { type: 'Purchase', account: 'Purchases', group: 'Sundry Creditors', party: 'Cr', other: 'Dr' },
  receipt:  { type: 'Receipt',  account: 'Bank',      group: 'Sundry Debtors',   party: 'Cr', other: 'Dr' },
  payment:  { type: 'Payment',  account: 'Bank',      group: 'Sundry Creditors', party: 'Dr', other: 'Cr' },
} as const

export type BillKind = keyof typeof KINDS

/** The party's account, opened under the group this kind belongs to. */
async function partyLedger(ctx: MutationCtx, name: string, phone?: string, group = 'Sundry Debtors') {
  const clean = name.trim()
  if (!clean) return null

  /**
   * Matched without regard to case or spacing.
   *
   * This compared names exactly, so "M/S Vishal Prasad Ji" and "M/s Vishal
   * Prasad Ji" were two different customers to it — and saving a bill under
   * the second spelling silently opened a second account and posted the sale
   * there, splitting one person's balance across both. One shop, one spelling
   * of a name: whichever is already in the books wins.
   */
  const fold = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ')
  const wanted = fold(clean)
  const existing = (await ctx.db.query('ledgers').collect())
    .find((l) => fold(l.name) === wanted)
  if (existing) {
    // Fill in a phone we didn't have, but never overwrite one already there.
    if (phone && !existing.phone) await ctx.db.patch(existing._id, { phone, updatedAt: Date.now() })
    return existing._id
  }

  const under = await ctx.db
    .query('groups')
    .filter((q) => q.eq(q.field('name'), group))
    .first()
  if (!under) return null

  const now = Date.now()
  return await ctx.db.insert('ledgers', {
    name: clean,
    groupId: under._id,
    ...(phone ? { phone } : {}),
    openingBalance: 0,
    openingSide: group === 'Sundry Creditors' ? ('Cr' as const) : ('Dr' as const),
    openingAsOf: now,
    active: true,
    createdAt: now,
    updatedAt: now,
  })
}

export const ensureParty = mutation({
  args: { name: v.string(), phone: v.optional(v.string()) },
  handler: async (ctx, { name, phone }) => partyLedger(ctx, name, phone),
})

export const postBill = mutation({
  args: {
    billNumber: v.string(),
    date: v.number(),
    customerName: v.string(),
    phone: v.optional(v.string()),
    total: v.number(),
    // Absent on every bill written before the builder could write anything but
    // a sale, so that is what absent means.
    kind: v.optional(v.union(
      v.literal('sale'), v.literal('purchase'), v.literal('receipt'), v.literal('payment'),
    )),
    // Photographs of the paper this bill was written from — a supplier's own
    // bill, a slip, whatever was in hand. Stored on the voucher, where the
    // ledger already knows how to show them.
    // Editing a voucher that already exists — one opened from the ledger or
    // the day book. Without it a saved edit would post a second voucher and
    // leave the original standing, doubling the party's balance.
    voucherId: v.optional(v.id('vouchers')),
    // The voucher's own reference and wording, kept when it has them: a
    // supplier's bill number is not "BILL-12" and must not become it.
    refNo: v.optional(v.string()),
    narration: v.optional(v.string()),
    attachments: v.optional(v.array(v.object({
      storageId: v.id('_storage'),
      kind: v.union(
        v.literal('bill'), v.literal('challan'), v.literal('estimate'),
        v.literal('receipt'), v.literal('other'),
      ),
    }))),
  },
  handler: async (ctx, args) => {
    if (!args.customerName.trim() || !args.total) return null

    const spec = KINDS[args.kind ?? 'sale']

    const ledgerId = await partyLedger(ctx, args.customerName, args.phone, spec.group)
    if (!ledgerId) return null

    const type = await ctx.db
      .query('voucherTypes')
      .filter((q) => q.eq(q.field('name'), spec.type))
      .first()
    // "Sales Accounts" is the group; the account itself is the "Sales" ledger
    // inside it. Crediting the group would have left the voucher unbalanced.
    const account = await ctx.db
      .query('ledgers')
      .filter((q) => q.eq(q.field('name'), spec.account))
      .first()
    // Without both sides this would post a half-entry and skew the books, so
    // it refuses rather than writing something that doesn't balance.
    if (!type || !account) return { ledgerId, voucherId: null as Id<'vouchers'> | null }

    const now = Date.now()
    const fy = financialYear(args.date)
    const ref = `BILL-${args.billNumber}`

    // One voucher per bill: the one being edited if this came from the books,
    // else this bill's own by its reference — so an edited bill updates rather
    // than posts twice.
    const existing = args.voucherId
      ? await ctx.db.get(args.voucherId)
      : await ctx.db
          .query('vouchers')
          .filter((q) => q.eq(q.field('refNo'), ref))
          .first()

    let voucherId: Id<'vouchers'>
    if (existing) {
      // Added to, never replaced: a photo filed against this voucher from the
      // ledger side must survive the bill being saved again.
      const already = new Set((existing.attachments ?? []).map((a: any) =>
        typeof a === 'string' ? a : a.storageId))
      const added = (args.attachments ?? []).filter((a) => !already.has(a.storageId))
      await ctx.db.patch(existing._id, {
        typeId: type._id,
        date: args.date, partyLedgerId: ledgerId, amount: args.total, updatedAt: now,
        // A voucher written in the books keeps its own reference and wording
        // unless the bill says otherwise; one posted from a bill keeps BILL-n.
        ...(args.refNo !== undefined ? { refNo: args.refNo || undefined } : {}),
        ...(args.narration !== undefined ? { narration: args.narration || undefined } : {}),
        // An amount typed onto a voucher that was filed without one makes it
        // final, and it starts affecting the balances.
        ...(existing.status === 'pending' && args.total ? { status: 'final' as const } : {}),
        ...(added.length ? { attachments: [...(existing.attachments ?? []), ...added] } : {}),
      })
      voucherId = existing._id
      for (const e of await ctx.db
        .query('voucherEntries')
        .withIndex('by_voucher', (q) => q.eq('voucherId', existing._id))
        .collect()) {
        await ctx.db.delete(e._id)
      }
    } else {
      voucherId = await ctx.db.insert('vouchers', {
        typeId: type._id,
        voucherNo: await nextVoucherNo(ctx, type._id, fy),
        fy,
        date: args.date,
        partyLedgerId: ledgerId,
        refNo: args.refNo ?? ref,
        narration: args.narration || `${spec.type} ${args.billNumber}`,
        status: 'final' as const,
        amount: args.total,
        attachments: args.attachments ?? [],
        createdAt: now,
        updatedAt: now,
      })
    }

    // The two sides that make it balance, which way round depending on the kind.
    await ctx.db.insert('voucherEntries', {
      voucherId, ledgerId, side: spec.party, amount: args.total, date: args.date,
    })
    await ctx.db.insert('voucherEntries', {
      voucherId, ledgerId: account._id, side: spec.other, amount: args.total, date: args.date,
    })
    return { ledgerId, voucherId }
  },
})

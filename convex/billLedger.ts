import { v } from 'convex/values'
import { mutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { fyOf, round2 } from './lib/money'
import { openParty } from './lib/parties'
import { nextVoucherNo, nextBillNo } from './lib/numbering'
import { writeLines, clearLines } from './lib/entries'
import { record, money, day } from './lib/history'

/**
 * Saving a bill, in one piece.
 *
 * A bill and a ledger account for the same customer are the same real-world
 * thing recorded twice, so saving a bill opens the customer's account if they
 * don't have one and posts the sale against it:
 *
 *     Dr  <customer>        (Sundry Debtors — they owe us)
 *     Cr  Sales Accounts    (income)
 *
 * This used to be two operations with the bill saved either way: the builder
 * posted the voucher, and whether that worked or not it went on to save the
 * bill. A shop cannot work like that. A counter that sees "saved" has to be
 * able to believe the books were updated, so the voucher, its Dr/Cr lines and
 * the bill itself are written here in one transaction — all of it, or none of
 * it and an error the operator can act on.
 *
 * Re-saving rewrites that bill's voucher rather than adding a second one, so
 * editing a bill — or retrying one that failed — can't quietly double the
 * customer's balance.
 */

/**
 * A bill written in the builder can be any of the four vouchers, so what the
 * builder posts is described here rather than hard-coded to a sale: which
 * account takes the other side, which group the party is opened under, and
 * which way round the two sides go.
 */
const KINDS = {
  sale:     { type: 'Sale',     account: 'Sales',     group: 'Sundry Debtors',   party: 'Dr', other: 'Cr', settles: false },
  purchase: { type: 'Purchase', account: 'Purchases', group: 'Sundry Creditors', party: 'Cr', other: 'Dr', settles: false },
  // A receipt or a payment is the money moving and nothing else, so the
  // account on the other side is the drawer or the bank itself.
  receipt:  { type: 'Receipt',  account: 'Cash',      group: 'Sundry Debtors',   party: 'Cr', other: 'Dr', settles: true },
  payment:  { type: 'Payment',  account: 'Cash',      group: 'Sundry Creditors', party: 'Dr', other: 'Cr', settles: true },
} as const

export type BillKind = keyof typeof KINDS

const attachmentDoc = v.object({
  storageId: v.id('_storage'),
  kind: v.union(
    v.literal('bill'), v.literal('challan'), v.literal('estimate'),
    v.literal('receipt'), v.literal('other'),
  ),
})

/** The bill's date as milliseconds, whatever form it was typed in. */
function whenOf(date: unknown): number {
  const ms = typeof date === 'number' ? date : Date.parse(String(date ?? ''))
  if (!Number.isFinite(ms)) throw new Error('This bill has no usable date.')
  return ms
}

/**
 * The number this bill keeps.
 *
 * Numbers come from the server now, but a bill written offline arrives with
 * one the device made up, and another PC may have taken it in the meantime.
 * A number already worn by a different bill — live or in the trash, since a
 * deleted bill can come back — is given up and a fresh one issued.
 */
async function billNumberFor(ctx: MutationCtx, bill: any): Promise<string> {
  const wanted = String(bill?.number ?? '').trim()
  if (wanted) {
    const store = await ctx.db.query('billsStore').first()
    const clash = (store?.bills ?? []).some((b: any) => b?.id !== bill.id && String(b?.number) === wanted)
      || (await ctx.db.query('billsTrash').collect())
        .some((row) => row.billId !== bill.id && String(row.bill?.number) === wanted)
    if (!clash) return wanted
  }
  return String(await nextBillNo(ctx))
}

export const ensureParty = mutation({
  args: { name: v.string(), phone: v.optional(v.string()) },
  handler: async (ctx, { name, phone }) => openParty(ctx, name, { phone }),
})

export const postBill = mutation({
  args: {
    // The bill as the counter holds it. `billsStore` keeps bills whole, so the
    // shape stays the panel's rather than being flattened into arguments here.
    bill: v.any(),
    attachments: v.optional(v.array(attachmentDoc)),
    /**
     * A voucher opened from the books and edited in the builder borrows the
     * builder's screen; it is not one of the shop's own bills and must not
     * join their list, or it shows twice in the day book — once as the voucher
     * and once as a bill of the same thing.
     */
    keepAsBill: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const bill = args.bill ?? {}
    // A borrowed voucher row is filed under `vch-<id>`, which is how the panel
    // has always told the two apart. A bill that has been posted before also
    // carries a voucherId, so that cannot be the test.
    const keepAsBill = args.keepAsBill
      ?? (Boolean(bill.id) && !String(bill.id).startsWith('vch-'))
    // A voucher the builder opened from the books rather than one of the
    // shop's own bills. It brought its own reference and wording with it.
    const borrowed = !keepAsBill

    const customerName = String(bill.customerName ?? '').trim()
    if (!customerName) throw new Error('This bill has no customer name, so there is no account to post it to.')

    const total = round2(Number(bill.total) || 0)
    if (!total) throw new Error('This bill has no amount, so there is nothing to post.')

    const date = whenOf(bill.date)
    const spec = KINDS[(bill.kind ?? 'sale') as BillKind] ?? KINDS.sale

    /**
     * Where the money itself went. Receipts and payments used to post to Bank
     * whatever the counter had actually done with the note, which made the
     * drawer and the bank account both wrong.
     */
    const drawer = bill.paymentMode === 'online' || bill.paymentMode === 'upi' ? 'Bank' : 'Cash'
    const accountName = spec.settles ? drawer : spec.account

    /**
     * Part payment against a bill, taken at the counter.
     *
     * It goes in as a line of the same voucher rather than a receipt beside
     * it: ₹10,000 sold with ₹4,000 in hand is Dr Customer 6,000, Dr Cash
     * 4,000, Cr Sales 10,000 — the customer owes what they owe, the drawer
     * holds what it holds, and there is one document to edit, delete or
     * restore instead of two that can come apart.
     */
    const asked = Number(bill.paidAmount ?? (bill.paid ? bill.total : 0)) || 0
    const received = spec.settles ? 0 : round2(Math.min(Math.max(asked, 0), Number(bill.total) || 0))

    // A bill deleted on another PC must not be quietly written back by a
    // device that still had it open.
    if (keepAsBill && bill.id) {
      const deleted = (await ctx.db.query('billsTrash').collect())
        .some((row) => row.billId === bill.id)
      if (deleted) throw new Error('This bill was deleted on another device. Restore it from Trash before saving again.')
    }

    const type = await ctx.db
      .query('voucherTypes')
      .withIndex('by_name', (q) => q.eq('name', spec.type))
      .unique()
    if (!type) throw new Error(`The "${spec.type}" voucher type is not set up.`)

    // "Sales Accounts" is the group; the account itself is the "Sales" ledger
    // inside it. Crediting the group would leave the voucher unbalanced.
    const byName = async (name: string) => await ctx.db
      .query('ledgers')
      .filter((q) => q.eq(q.field('name'), name))
      .first()

    const account = await byName(accountName)
    if (!account) throw new Error(`The "${accountName}" account is missing — set it up in Account Masters before saving this bill.`)

    const settlement = received > 0 ? await byName(drawer) : null
    if (received > 0 && !settlement) {
      throw new Error(`The "${drawer}" account is missing — set it up in Account Masters before taking money against this bill.`)
    }

    const ledgerId = await openParty(ctx, customerName, {
      phone: bill.customerPhone || undefined,
      group: spec.group,
    })

    const number = keepAsBill ? await billNumberFor(ctx, bill) : String(bill.number ?? '')
    const now = Date.now()
    const fy = fyOf(date)
    const ref = `BILL-${number}`
    const attachments = args.attachments ?? []

    /**
     * One voucher per bill: the one being edited if this came from the books,
     * else this bill's own by its reference — so an edited bill, or a retry
     * after a failed save, updates rather than posts twice.
     */
    const existing = bill.voucherId
      ? await ctx.db.get(bill.voucherId as Id<'vouchers'>)
      : await ctx.db
          .query('vouchers')
          .filter((q) => q.eq(q.field('refNo'), ref))
          .first()
    if (bill.voucherId && !existing) {
      throw new Error('The voucher this bill was opened from is no longer in the books.')
    }

    let voucherId: Id<'vouchers'>
    if (existing) {
      // Added to, never replaced: a photo filed against this voucher from the
      // ledger side must survive the bill being saved again.
      const already = new Set((existing.attachments ?? []).map((a: any) =>
        typeof a === 'string' ? a : a.storageId))
      const added = attachments.filter((a) => !already.has(a.storageId))
      await ctx.db.patch(existing._id, {
        typeId: type._id,
        date, partyLedgerId: ledgerId, amount: total, updatedAt: now,
        /**
         * `BILL-n` is how a bill and its voucher find each other, so it is not
         * the operator's to overwrite. Typing "07" in the bill's Ref box used
         * to land on the voucher, which then matched no bill — and the day
         * book showed the sale twice, once as SAL-0063 and once as bill 15.
         * Only a voucher opened from the books, which the builder is merely
         * borrowing, keeps a reference of its own.
         */
        ...(borrowed && bill.ref !== undefined ? { refNo: String(bill.ref) || undefined } : {}),
        ...(bill.notes !== undefined ? { narration: String(bill.notes) || undefined } : {}),
        // An amount typed onto a voucher that was filed without one makes it
        // final, and it starts affecting the balances.
        ...(existing.status === 'pending' ? { status: 'final' as const } : {}),
        ...(added.length ? { attachments: [...(existing.attachments ?? []), ...added] } : {}),
      })
      voucherId = existing._id
      await clearLines(ctx, voucherId)
    } else {
      voucherId = await ctx.db.insert('vouchers', {
        typeId: type._id,
        voucherNo: await nextVoucherNo(ctx, type, fy),
        fy,
        date,
        partyLedgerId: ledgerId,
        refNo: ref,
        narration: bill.notes ? String(bill.notes) : `${spec.type} ${number}`,
        status: 'final' as const,
        amount: total,
        attachments,
        createdAt: now,
        updatedAt: now,
      })
    }

    /**
     * The sides that make it balance, which way round depending on the kind.
     * Money taken now sits on the party's own side — a customer who paid part
     * of a sale is debited for less, and the drawer is debited for the rest.
     * Written through the same checked writer the ledger uses, so an
     * unbalanced set is refused here too.
     */
    await writeLines(ctx, voucherId, date, [
      { ledgerId, side: spec.party, amount: round2(total - received) },
      ...(settlement ? [{ ledgerId: settlement._id, side: spec.party, amount: received }] : []),
      { ledgerId: account._id, side: spec.other, amount: total },
    ].filter((line) => line.amount > 0))

    /**
     * The bill itself, in the same transaction as the voucher it posted. This
     * is the whole point: there is no longer a state where the counter's list
     * has a bill the books have never heard of.
     */
    let stored: any = null
    if (keepAsBill && bill.id) {
      stored = {
        ...bill,
        number,
        total,
        ledgerId,
        voucherId,
        attachments,
        postedAt: now,
        updatedAt: now,
      }
      // A bill that posted has no failure to remember.
      delete stored.postError
      const store = await ctx.db.query('billsStore').first()
      const kept = (store?.bills ?? []).filter((b: any) => b?.id !== bill.id)
      const billSeq = Math.max(store?.billSeq ?? 0, Number(number) || 0)
      if (store) await ctx.db.patch(store._id, { bills: [...kept, stored], billSeq, savedAt: now })
      else await ctx.db.insert('billsStore', { bills: [stored], billSeq, savedAt: now })
    }

    await record(
      ctx,
      existing ? 'bill.repost' : 'bill.post',
      `${spec.type} ${number || ref} · ${customerName} · ${money(total)} on ${day(date)}`,
      { entity: 'voucher', entityId: voucherId },
    )

    return { ledgerId, voucherId, number, bill: stored }
  },
})

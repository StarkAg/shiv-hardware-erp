import { isWithoutBillParty } from './lib/text'
import { ConvexError, v } from 'convex/values'
import { mutation } from './lib/guarded'
import type { MutationCtx } from './_generated/server'
import { internalMutation } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { fyOf, round2 } from './lib/money'
import { findParty, openParty } from './lib/parties'
import { nextVoucherNo, nextBillNo } from './lib/numbering'
import { writeLines, clearLines } from './lib/entries'
import { record, money, day } from './lib/history'
import { tidyBill } from './lib/billText'
import { GRN_ABBR, GRN_TYPE, isGoods } from './lib/receipts'
import { readBill, readBills, writeBills } from './lib/billRows'
import { ensureVoucherFlow, flowForVoucher } from './lib/billFlow'
import { postCashEntry } from './cash'
import { trashVoucher } from './vouchers'

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
  /**
   * Goods Return from a customer: they owe less, and the return sits on its
   * own account rather than netting Sales down. A return *to* a supplier is
   * the other way round and is chosen by the party's account; see
   * RETURN_TO_SUPPLIER.
   */
  return:   { type: 'Goods Return', account: 'Sales Return', group: 'Sundry Debtors', party: 'Cr', other: 'Dr', settles: false },
  /**
   * Money handed back to a customer — what was over after a return worth more
   * than they owed. It is a payment, but to a customer, so it keeps its own
   * series (REF) and reads as a refund on their account rather than as a
   * supplier being paid.
   */
  refund:   { type: 'Refund',   account: 'Cash',      group: 'Sundry Debtors',   party: 'Dr', other: 'Cr', settles: true },
  /**
   * Goods Received: the supplier's goods are in, their bill is not. It is
   * filed with its lines and no entries — nothing is owed on paper yet — and
   * the purchase written when the bill comes is linked back to it.
   */
  grn:      { type: GRN_TYPE,   account: 'Purchases', group: 'Sundry Creditors', party: 'Cr', other: 'Dr', settles: false },
} as const

/** Goods Return to a supplier: the shop owes them less. */
const RETURN_TO_SUPPLIER = {
  type: 'Goods Return', account: 'Purchase Return', group: 'Sundry Creditors', party: 'Dr', other: 'Cr', settles: false,
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
  // A photo-conversion retry has a stable bill id but begins with no number.
  // Reuse the number it received the first time, or a retry would post under
  // a new BILL-n reference and make a second voucher.
  if (bill?.id) {
    const same = (await readBills(ctx)).find((b: any) => b?.id === bill.id)
    // Except a quotation becoming a sale: Q-1 is the quotation series, and
    // reusing it posted the sale as BILL-Q-1. The sale takes a bill number;
    // the quotation it came from stays on it as `fromQuote`.
    const wasQuotation = same?.kind === 'quotation' && bill.kind !== 'quotation'
    if (same?.number && !wasQuotation) return String(same.number)
  }
  if (wanted) {
    const clash = (await readBills(ctx)).some((b: any) => b?.id !== bill.id && String(b?.number) === wanted)
      || (await ctx.db.query('billsTrash').collect())
        .some((row) => row.billId !== bill.id && String(row.bill?.number) === wanted)
    if (!clash) return wanted
  }
  return String(await nextBillNo(ctx))
}

/**
 * The receipt a W/B sale's cash is written on, brought in step with its bill.
 *
 * One per bill, found by the bill's reference: written the first time,
 * rewritten when the bill is saved again, and sent to the trash when the bill
 * no longer takes money that way — re-priced to nothing, or moved off W/B.
 */
async function syncBillReceipt(
  ctx: MutationCtx,
  { ref, number, ledgerId, date, amount, drawer }: {
    ref: string
    number: string
    ledgerId: Id<'ledgers'>
    date: number
    amount: number
    drawer: Doc<'ledgers'> | null
  },
) {
  const linked = await ctx.db
    .query('vouchers')
    .filter((q) => q.eq(q.field('paysFor'), ref))
    .collect()
  const [keep, ...extra] = linked
  for (const old of extra) await trashVoucher(ctx, old._id)
  if (!(amount > 0) || !drawer) {
    if (keep) await trashVoucher(ctx, keep._id)
    return
  }

  const type = await ctx.db
    .query('voucherTypes')
    .withIndex('by_name', (q) => q.eq('name', 'Receipt'))
    .unique()
  if (!type) throw new Error('The "Receipt" voucher type is not set up.')

  const now = Date.now()
  const narration = `${drawer.name === 'Bank' ? 'Paid online' : 'Cash'} with bill ${number}`
  let id: Id<'vouchers'>
  if (keep) {
    // The receipt follows its sale into the new year when the date crosses 1 April.
    const fy = fyOf(date)
    await ctx.db.patch(keep._id, {
      typeId: type._id, date, partyLedgerId: ledgerId, amount, status: 'final', narration, updatedAt: now,
      ...(keep.fy !== fy || keep.typeId !== type._id ? { voucherNo: await nextVoucherNo(ctx, type, fy), fy } : {}),
    })
    id = keep._id
    await clearLines(ctx, id)
  } else {
    const fy = fyOf(date)
    id = await ctx.db.insert('vouchers', {
      typeId: type._id,
      voucherNo: await nextVoucherNo(ctx, type, fy),
      fy,
      date,
      partyLedgerId: ledgerId,
      narration,
      status: 'final',
      amount,
      attachments: [],
      paysFor: ref,
      createdAt: now,
      updatedAt: now,
    })
  }
  await writeLines(ctx, id, date, [
    { ledgerId: drawer._id, side: 'Dr', amount },
    { ledgerId, side: 'Cr', amount },
  ])
}

/** Runs a mutation body, passing any error on as a ConvexError so its message reaches the counter. */
async function inWords<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof ConvexError) throw err
    throw new ConvexError(err instanceof Error ? err.message : String(err))
  }
}

export const ensureParty = mutation({
  args: { name: v.string(), phone: v.optional(v.string()), aadhaar: v.optional(v.string()) },
  handler: async (ctx, { name, phone, aadhaar }) => openParty(ctx, name, { phone, aadhaar }),
})

export const postBill = mutation({
  args: {
    // The bill as the counter holds it. Bills are kept whole (lib/billRows), so the
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
    flowId: v.optional(v.id('billFlows')),
    cashEntryId: v.optional(v.string()),
    /**
     * The voucher's `rev` when the counter opened this bill; null for a bill
     * not yet in the books. Sent by the bill editor, which then cannot save an
     * old copy over a newer save from another counter. Left out, no check.
     */
    expectedRev: v.optional(v.union(v.number(), v.null())),
    /**
     * The account to post to, when the caller already has it open (the
     * accounts app adding a bill from inside an account). Without it the
     * party is found, or opened, by the bill's name as before.
     */
    partyLedgerId: v.optional(v.id('ledgers')),
  },
  // Said in the server's own words: production hides a plain Error behind
  // "Server Error", and the counter has to know why a bill did not save.
  handler: async (ctx, args) => inWords(async () => {
    // Written the shop's way before anything reads it: the party in proper
    // case, item codes in capitals, one spelling per unit.
    const bill: any = tidyBill(args.bill ?? {})
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

    let total = round2(Number(bill.total) || 0)
    // A receipt, payment or refund is the money itself, as the bill screen
    // works it, and a goods line left on one from before its kind was changed
    // is no part of it. Kept, that line read as unpriced below: BILL-593, a
    // ₹15,000 UPI receipt with a stray "15000 × 1 Pc", went into the books as
    // a pending receipt with no amount, asking for rates.
    if (KINDS[bill.kind as BillKind]?.settles) bill.items = []
    // A bill photograph or an unpriced delivery can be filed before its amount
    // is known. It becomes a pending voucher with no entries, so no balance is
    // changed until a real amount is entered later.
    //
    // A bill with any goods line still lacking its rate is unpriced too, even
    // if a fare already gives it a total: "Mica × 11, Fare 100" is not a ₹100
    // sale, and posting it as one would put the wrong balance on the account.
    //
    // Lacking means no amount at all. A negative one is priced: a "Discount"
    // of -250 picked from My Items carries no roundup flag, and reading it as
    // unpriced parked a fully priced purchase as pending.
    const items: any[] = Array.isArray(bill.items) ? bill.items : []
    const unpricedLine = items.some((i) =>
      String(i?.description ?? '').trim() &&
      !i?.isRoundup && !i?.isDiscount &&
      !Number(i?.amount))
    // A supplier's goods without a complete price are a delivery, not a
    // purchase. File it in the GRN series so it appears under Bills to Come,
    // and never let a zero-amount PUR voucher linger in Pending Bills.
    const unpricedPurchase = bill.kind === 'purchase' && (!(total > 0) || unpricedLine)
    if (unpricedPurchase) {
      if (Array.isArray(bill.grnIds) && bill.grnIds.length) {
        throw new Error('This delivery is already in Goods Received. Enter its bill amount before saving a purchase.')
      }
      bill.kind = 'grn'
      bill.total = 0
      bill.paid = false
      delete bill.paidAmount
      bill.items = items.filter(isGoods).map((item) => {
        const line = { ...item, amount: 0 }
        delete line.rateSqft
        return line
      })
      total = 0
    }
    // A delivery note never carries an amount, whatever its lines say.
    const hasAmount = bill.kind !== 'grn' && total > 0 && !unpricedLine

    const date = whenOf(bill.date)
    const kind = (bill.kind ?? 'sale') as BillKind

    /**
     * A Goods Return goes whichever way its party's account says: back from a
     * customer, or back to a supplier. A name with no account has no side yet,
     * so it is refused rather than guessed — opening a customer for what was
     * a supplier's return would put the balance on the wrong side for good.
     */
    const returnParty = kind === 'return' ? await findParty(ctx, customerName) : null
    const returnGroup = returnParty ? (await ctx.db.get(returnParty.groupId))?.name : undefined
    if (kind === 'return' && returnGroup !== 'Sundry Debtors' && returnGroup !== 'Sundry Creditors') {
      throw new Error(`Pick the customer or supplier this goods return is for — "${customerName}" is not an account in the books.`)
    }
    const spec = kind === 'return' && returnGroup === 'Sundry Creditors'
      ? RETURN_TO_SUPPLIER
      : KINDS[kind] ?? KINDS.sale

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
     * it: ₹10,000 sold with ₹4,000 in hand is Dr Customer 10,000, Cr
     * Customer 4,000, Dr Cash 4,000, Cr Sales 10,000. The customer owes
     * ₹6,000, and there is one document to edit, delete or
     * restore instead of two that can come apart.
     */
    // A cashier entry has already posted the money. The goods voucher must not
    // post that same cash again, even if the read draft carries "paid".
    if (kind === 'sale' && isWithoutBillParty(customerName)) {
      bill.paidAmount = hasAmount ? total : 0
      bill.paid = hasAmount
    }
    const asked = args.cashEntryId ? 0 : Number(bill.paidAmount ?? (bill.paid ? bill.total : 0)) || 0
    // No money changes hands on a goods return; a refund is its own receipt or payment.
    const taken = spec.settles || kind === 'return' ? 0 : round2(Math.min(Math.max(asked, 0), Number(bill.total) || 0))
    /**
     * A W/B sale's cash is a receipt of its own.
     *
     * Every other sale takes money as a line of the same voucher. A W/B sale
     * is cash by definition, and the counter wants to see that cash among the
     * receipts — the RCT series, the day's receipt lines — not folded into the
     * sale. So the sale goes on the W/B account in full and a receipt clears
     * it, kept in step with the bill here: re-saving rewrites it, and deleting
     * or restoring the sale takes it along.
     *
     * Only for the shop's own bills, which carry the BILL-n reference the
     * receipt follows; and never when a cashier entry already posted the money.
     */
    const wbReceipt = kind === 'sale' && keepAsBill && isWithoutBillParty(customerName) && !args.cashEntryId
    const received = wbReceipt ? 0 : taken

    /**
     * Discount given up at settlement — allowed on a receipt, received on a
     * payment.
     *
     * The party is cleared for the money and the discount together, so a bill
     * of ₹30,080 settled by ₹29,830 with ₹250 off leaves the account square
     * rather than ₹250 short for ever. The ₹250 is not money and must not
     * reach the drawer: it goes to its own account, which is where the shop
     * can later see what a year of rounding off actually cost.
     */
    // Nothing is let off on a refund; the money handed back is the whole of it.
    const discount = spec.settles && kind !== 'refund'
      ? round2(Math.min(Math.max(Number(bill.discount) || 0, 0), total))
      : 0

    // A bill deleted on another PC must not be quietly written back by a
    // device that still had it open.
    if (keepAsBill && bill.id) {
      const deleted = (await ctx.db.query('billsTrash').collect())
        .some((row) => row.billId === bill.id)
      if (deleted) throw new Error('This bill was deleted on another device. Restore it from Trash before saving again.')
    }

    let type = await ctx.db
      .query('voucherTypes')
      .withIndex('by_name', (q) => q.eq('name', spec.type))
      .unique()
    // The Refund and Goods Received series open the first time one is written.
    if (!type && (spec.type === 'Refund' || spec.type === GRN_TYPE)) {
      const id = await ctx.db.insert('voucherTypes', spec.type === 'Refund'
        ? { name: 'Refund', abbr: 'REF', sort: 10 }
        : { name: GRN_TYPE, abbr: GRN_ABBR, sort: 11 })
      type = await ctx.db.get(id)
    }
    if (!type) throw new Error(`The "${spec.type}" voucher type is not set up.`)

    // "Sales Accounts" is the group; the account itself is the "Sales" ledger
    // inside it. Crediting the group would leave the voucher unbalanced.
    const byName = async (name: string) => await ctx.db
      .query('ledgers')
      .filter((q) => q.eq(q.field('name'), name))
      .first()

    const account = hasAmount ? await byName(accountName) : null
    if (hasAmount && !account) throw new Error(`The "${accountName}" account is missing — set it up in Account Masters before saving this bill.`)

    const settlement = taken > 0 ? await byName(drawer) : null
    if (taken > 0 && !settlement) {
      throw new Error(`The "${drawer}" account is missing — set it up in Account Masters before taking money against this bill.`)
    }

    // Allowed on a receipt, received on a payment — which side it lands on
    // follows the party's side, same as every other line on the voucher.
    const discountAccountName = spec.party === 'Cr' ? 'Discount Allowed' : 'Discount Received'
    const discountAccount = discount > 0 ? await byName(discountAccountName) : null
    if (discount > 0 && !discountAccount) {
      throw new Error(`The "${discountAccountName}" account is missing — set it up in Account Masters before taking a discount on this voucher.`)
    }

    const pinned = args.partyLedgerId ? await ctx.db.get(args.partyLedgerId) : null
    if (args.partyLedgerId && !pinned) throw new Error('That account is no longer in the books.')
    const ledgerId = pinned ? pinned._id : await openParty(ctx, customerName, {
      phone: bill.customerPhone || undefined,
      aadhaar: bill.customerUid || undefined,
      group: spec.group,
    })

    if (args.cashEntryId) {
      const cash = await ctx.db.query('cashEntries')
        .withIndex('by_entry_id', q => q.eq('entryId', args.cashEntryId!)).unique()
      if (!cash || cash.deleted || (cash.kind === 'in') !== (kind === 'sale')) {
        throw new Error('The linked cashier entry is missing or moves money the other way.')
      }
      // The reviewed photo may correct a cashier note that matched the wrong
      // similarly named account. Repost its existing voucher to this party.
      if (cash.ledgerId !== ledgerId) await ctx.db.patch(cash._id, { ledgerId })
      await postCashEntry(ctx, cash.entryId)
    }

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
      // Most often it was deleted from the books while the bill stayed open;
      // then it is in the Trash, and putting it back is the fix.
      const binned = (await ctx.db.query('trash').collect())
        .filter((row) => row.refNo === ref)
        .sort((a, b) => b.deletedAt - a.deletedAt)[0]
      if (binned) {
        const binType = await ctx.db.get(binned.typeId)
        throw new Error(
          `${binType?.abbr ?? 'VCH'}-${String(binned.voucherNo).padStart(4, '0')}, the entry this bill posted, was deleted on ${day(binned.deletedAt)}. ` +
          'Restore it from Trash, then save again.',
        )
      }
      throw new Error('The voucher this bill was opened from is no longer in the books.')
    }

    /**
     * Saved from an old copy? The soft lock only stops a second counter from
     * opening the bill; a counter that lost its lock (a sleeping laptop, a
     * dropped connection) could still send what it had, and posting replaced
     * the newer voucher with it. Refused instead, with the newer bill, so the
     * counter can see what changed — its own typing stays on its screen.
     */
    if (args.expectedRev !== undefined) {
      const current = existing ? existing.rev ?? 0 : null
      if (current !== args.expectedRev) {
        const newer = keepAsBill && bill.id ? await readBill(ctx, String(bill.id)) : null
        throw new ConvexError({
          code: 'stale',
          message: 'Changed on another counter since you opened it. Not saved.',
          newer,
          updatedAt: existing?.updatedAt ?? null,
        })
      }
    }
    const rev = (existing?.rev ?? 0) + 1

    let voucherId: Id<'vouchers'>
    if (existing) {
      // Added to, never replaced: a photo filed against this voucher from the
      // ledger side must survive the bill being saved again.
      const already = new Set((existing.attachments ?? []).map((a: any) =>
        typeof a === 'string' ? a : a.storageId))
      const added = attachments.filter((a) => !already.has(a.storageId))
      // A bill saved again as another kind moves into that kind's series.
      // Keeping the old number made a sale re-saved as a refund read REF-0144
      // — a number the Refund series never issued, and one it would issue
      // again later.
      //
      // So does one whose date moved across 1 April: 31 March to 1 April is
      // next year's voucher, and keeping last year's fy and number left it
      // counted in the wrong year's series.
      const retyped = existing.typeId !== type._id || existing.fy !== fy
      await ctx.db.patch(existing._id, {
        typeId: type._id,
        ...(retyped ? { voucherNo: await nextVoucherNo(ctx, type, fy), fy } : {}),
        date, partyLedgerId: ledgerId, updatedAt: now, rev,
        ...(hasAmount
          ? { amount: total, status: 'final' as const }
          : { amount: undefined, status: kind === 'grn' ? 'received' as const : 'pending' as const }),
        ...(kind === 'grn' ? { receivedBy: String(bill.receivedBy ?? '').trim() || undefined } : {}),
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
        status: hasAmount ? 'final' as const : kind === 'grn' ? 'received' as const : 'pending' as const,
        ...(kind === 'grn' && String(bill.receivedBy ?? '').trim()
          ? { receivedBy: String(bill.receivedBy).trim() }
          : {}),
        ...(hasAmount ? { amount: total } : {}),
        attachments,
        rev,
        createdAt: now,
        updatedAt: now,
      })
    }

    /**
     * The sides that make it balance, which way round depending on the kind.
     *
     * The party carries the whole bill, and money taken now goes against them
     * as a second line of the same voucher: ₹49,896 sold and paid on the spot
     * is Dr Customer 49,896 and Cr Customer 49,896, with Dr Cash and Cr Sales
     * making the other half.
     *
     * It used to net the two — debiting the customer only for what was still
     * owed. That balanced, but a sale paid in full left the customer's ledger
     * with nothing on it at all: the line was worth zero and was dropped. So
     * the counter wrote the sale, then wrote a receipt beside it by hand, for
     * every cash customer, purely to see on their account what they had bought
     * and that they had paid. Two vouchers for one event, which could then
     * drift apart when one was edited and the other was not.
     *
     * Now it is one voucher and both halves show. The balance is the same
     * either way; only the account became readable.
     *
     * The party's own line is written first on purpose. Both lines share a
     * voucher and a date, so the ledger orders them by when they were written
     * — and the sale has to come before the money, or the running balance dips
     * into credit for a line before coming back.
     *
     * Written through the same checked writer the ledger uses, so an
     * unbalanced set is refused here too.
     */
    const counterSide: 'Dr' | 'Cr' = spec.party === 'Dr' ? 'Cr' : 'Dr'
    if (hasAmount) {
      await writeLines(ctx, voucherId, date, [
        { ledgerId, side: spec.party, amount: total },
        { ledgerId, side: counterSide, amount: received },
        ...(settlement ? [{ ledgerId: settlement._id, side: spec.party, amount: received }] : []),
        // The drawer takes only what was actually handed over; the rest of
        // what the party was cleared for is the discount, on its own account.
        { ledgerId: account!._id, side: spec.other, amount: round2(total - discount) },
        ...(discountAccount
          ? [{ ledgerId: discountAccount._id, side: spec.other, amount: discount }]
          : []),
      ].filter((line) => line.amount > 0))
    }

    if (keepAsBill) {
      await syncBillReceipt(ctx, {
        ref,
        number,
        ledgerId,
        date,
        amount: wbReceipt && hasAmount ? taken : 0,
        drawer: settlement,
      })
    }

    /**
     * The deliveries this bill is for.
     *
     * Each must be this supplier's and not already billed elsewhere; anything
     * wrong refuses the whole save, since the transaction is one piece. A
     * delivery this bill no longer names goes back to waiting. A save that
     * says nothing about deliveries leaves the links as they were.
     */
    if (kind === 'purchase' && Array.isArray(bill.grnIds)) {
      const grnKind = await ctx.db
        .query('voucherTypes')
        .withIndex('by_name', (q) => q.eq('name', GRN_TYPE))
        .unique()
      const label = (no: number) => `${GRN_ABBR}-${String(no).padStart(4, '0')}`
      const linked: Id<'vouchers'>[] = []
      for (const raw of new Set((bill.grnIds as unknown[]).map(String))) {
        const id = ctx.db.normalizeId('vouchers', raw)
        const grn = id ? await ctx.db.get(id) : null
        if (!id || !grn || !grnKind || grn.typeId !== grnKind._id) {
          throw new Error('A delivery this bill was written against is no longer in the books.')
        }
        if (grn.partyLedgerId !== ledgerId) {
          throw new Error(`${label(grn.voucherNo)} is another supplier's delivery.`)
        }
        if (grn.billedIn && grn.billedIn !== voucherId) {
          const other = await ctx.db.get(grn.billedIn)
          if (other) {
            const otherType = await ctx.db.get(other.typeId)
            throw new Error(`${label(grn.voucherNo)} is already billed on ${otherType?.abbr ?? 'PUR'}-${String(other.voucherNo).padStart(4, '0')}.`)
          }
        }
        await ctx.db.patch(id, { billedIn: voucherId })
        linked.push(id)
      }
      for (const old of existing?.fromReceipts ?? []) {
        if (linked.includes(old)) continue
        const grn = await ctx.db.get(old)
        if (grn?.billedIn === voucherId) await ctx.db.patch(old, { billedIn: undefined })
      }
      const checks = Array.isArray(bill.checks) ? bill.checks.map(String).filter(Boolean) : []
      await ctx.db.patch(voucherId, {
        fromReceipts: linked.length ? linked : undefined,
        checks: checks.length ? checks : undefined,
      })
    } else if (kind === 'grn' && existing?.fromReceipts?.length) {
      // Reclassifying an edited purchase as a delivery releases the earlier
      // deliveries it had billed, so they return to Bills to Come.
      for (const old of existing.fromReceipts) {
        const delivery = await ctx.db.get(old)
        if (delivery?.billedIn === voucherId) await ctx.db.patch(old, { billedIn: undefined })
      }
      await ctx.db.patch(voucherId, { fromReceipts: undefined, checks: undefined })
    }

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
        rev,
      }
      // A bill that posted has no failure to remember.
      delete stored.postError
      await writeBills(ctx, [stored], Number(number) || 0)
    }

    await record(
      ctx,
      existing ? 'bill.repost' : 'bill.post',
      kind === 'grn'
        ? `${spec.type} ${number || ref} · ${customerName}${bill.receivedBy ? ` · checked by ${bill.receivedBy}` : ''} on ${day(date)}`
        : `${spec.type} ${number || ref} · ${customerName} · ${money(total)} on ${day(date)}`,
      { entity: 'voucher', entityId: voucherId },
    )

    if (kind === 'sale' || kind === 'purchase' || kind === 'grn') {
      // A priced purchase for an earlier GRN continues its delivery card.
      let flowId = args.flowId
      if (!flowId && kind === 'purchase' && Array.isArray(bill.grnIds) && bill.grnIds.length) {
        const grnId = ctx.db.normalizeId('vouchers', String(bill.grnIds[0]))
        const grnFlow = grnId ? await flowForVoucher(ctx, grnId) : null
        flowId = grnFlow?._id
      }
      await ensureVoucherFlow(ctx, {
        voucherId, kind, party: customerName, date: new Date(date).toISOString().slice(0, 10),
        amount: total || undefined, billId: keepAsBill ? String(bill.id) : undefined,
        cashEntryId: args.cashEntryId, flowId,
        photos: attachments.map(a => a.storageId),
      })
      if (kind === 'purchase' && Array.isArray(bill.grnIds)) {
        for (const raw of bill.grnIds.slice(1)) {
          const grnId = ctx.db.normalizeId('vouchers', String(raw))
          const other = grnId ? await flowForVoucher(ctx, grnId) : null
          if (!other) continue
          const at = Date.now()
          await ctx.db.patch(other._id, {
            tasks: { ...(other.tasks as Record<string, boolean>), purchaseLinked: true },
            stage: 'complete', updatedAt: at,
            history: [...other.history, { at, action: 'Purchase bill linked to this delivery' }],
          })
        }
      }
    }

    return { ledgerId, voucherId, number, bill: stored, rev }
  }),
})

/**
 * One-off backfill (2026-10-10): accounts take the phone and Aadhaar already
 * written on their bills, where the account has none — the same fill-only rule
 * as saving a bill. Before this, a bill's UID never reached the account, so
 * every new bill asked for it again. A page at a time:
 *   npx convex run billLedger:backfillPartyContacts '{}'   (then pass the cursor it returns)
 */
export const backfillPartyContacts = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('bills').paginate({ numItems: 200, cursor: cursor ?? null })
    let filled = 0
    for (const row of page.page) {
      const bill: any = row.bill ?? {}
      if (!bill.ledgerId) continue
      const phone = /^\d{10}$/.test(bill.customerPhone ?? '') ? bill.customerPhone : undefined
      const aadhaar = /^\d{12}$/.test(bill.customerUid ?? '') ? bill.customerUid : undefined
      if (!phone && !aadhaar) continue
      const account = await ctx.db.get(bill.ledgerId as Id<'ledgers'>).catch(() => null)
      if (!account) continue
      const fill = {
        ...(phone && !account.phone ? { phone } : {}),
        ...(aadhaar && !account.aadhaar ? { aadhaar } : {}),
      }
      if (Object.keys(fill).length) {
        await ctx.db.patch(account._id, { ...fill, updatedAt: Date.now() })
        filled += 1
      }
    }
    return { filled, isDone: page.isDone, cursor: page.continueCursor }
  },
})

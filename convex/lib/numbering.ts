/**
 * Every number the shop prints is handed out here.
 *
 * There were two counters. The ledger numbered its vouchers `vno:<abbr>:<fy>`
 * and the bill builder numbered the same vouchers `voucher:<typeId>:<fy>`, so
 * a Sale written at the counter and a Sale written in the books were counting
 * in parallel — both could reach 7, and two different vouchers would print the
 * same SAL-0007. Bill numbers were worse: they came from `billSeq` in the
 * browser's own storage, so two PCs writing at the same time both called their
 * bill 34.
 *
 * One counter per series, on the server, and every number checked against what
 * is already on the books before it is given out. The check is what makes this
 * safe to switch on over books that were numbered by the old pair: a counter
 * that has fallen behind is dragged forward rather than handing out a number
 * somebody is already holding.
 */
import type { MutationCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'

/** The counter row for a voucher series — the ledger's key, now the only one. */
export const voucherCounterName = (abbr: string, fy: string) => `vno:${abbr}:${fy}`

/** The shop's bill numbers are one unbroken run, not restarted each April. */
export const BILL_COUNTER = 'bill'

/**
 * Take the next value of a counter, never going below what is already used.
 *
 * `floor` is the highest number known to be taken. Passing it means a counter
 * that is missing, stale, or was written by the other path cannot reissue a
 * number that is already on a printed document.
 */
async function bump(ctx: MutationCtx, name: string, floor: number): Promise<number> {
  const row = await ctx.db
    .query('counters')
    .withIndex('by_name', (q) => q.eq('name', name))
    .unique()
  const next = Math.max(row?.value ?? 0, floor) + 1
  if (row) await ctx.db.patch(row._id, { value: next })
  else await ctx.db.insert('counters', { name, value: next })
  return next
}

/**
 * The next voucher number in a type's series for a financial year.
 *
 * Deleted vouchers count as used: one sitting in the trash keeps its number
 * and gets it back when it is restored, so handing that number out again would
 * make a duplicate appear the moment somebody undid a deletion.
 */
export async function nextVoucherNo(
  ctx: MutationCtx,
  type: Doc<'voucherTypes'>,
  fy: string,
): Promise<number> {
  const live = await ctx.db
    .query('vouchers')
    .withIndex('by_type_fy', (q) => q.eq('typeId', type._id).eq('fy', fy))
    .collect()
  const deleted = (await ctx.db.query('trash').collect())
    .filter((row) => row.typeId === type._id && row.fy === fy)

  const used = [...live, ...deleted].reduce((max, row) => Math.max(max, row.voucherNo ?? 0), 0)
  return bump(ctx, voucherCounterName(type.abbr, fy), used)
}

/** A bill's number, as it is printed and as `BILL-<n>` refers to it. */
export async function nextBillNo(ctx: MutationCtx): Promise<number> {
  const numeric = (value: unknown) => {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }

  const store = await ctx.db.query('billsStore').first()
  const live = (store?.bills ?? []).reduce((max: number, b: any) => Math.max(max, numeric(b?.number)), 0)
  // A deleted bill's number stays spoken for. It can be restored, and the
  // voucher it posted is still filed under `BILL-<n>`.
  const deleted = (await ctx.db.query('billsTrash').collect())
    .reduce((max, row) => Math.max(max, numeric(row.bill?.number)), 0)

  return bump(ctx, BILL_COUNTER, Math.max(live, deleted, store?.billSeq ?? 0))
}

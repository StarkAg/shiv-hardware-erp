import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Where bills are kept: one row each.
 *
 * They used to live together in a single `billsStore` row, and a Convex row
 * holds at most a megabyte — a few thousand bills, after which every save
 * would have failed at the counter. That row now keeps only the running bill
 * number and when anything last changed, which is what devices watch to know
 * a bill has moved.
 *
 * Until `bills:moveToRows` has run, bills still in the old row are read as
 * well; a bill with a row of its own wins over its old copy.
 */

export async function storeMeta(ctx: QueryCtx) {
  return ctx.db.query('billsStore').first()
}

/** Every bill, as the counter holds it. */
export async function readBills(ctx: QueryCtx): Promise<any[]> {
  const [rows, meta] = await Promise.all([ctx.db.query('bills').collect(), storeMeta(ctx)])
  const byId = new Map<string, any>()
  for (const legacy of (meta?.bills ?? []) as any[]) if (legacy?.id) byId.set(String(legacy.id), legacy)
  for (const row of rows) byId.set(row.billId, row.bill)
  return [...byId.values()]
}

export async function readBill(ctx: QueryCtx, id: string): Promise<any | null> {
  const row = await ctx.db
    .query('bills')
    .withIndex('by_bill', (q) => q.eq('billId', id))
    .unique()
  if (row) return row.bill
  const meta = await storeMeta(ctx)
  return ((meta?.bills ?? []) as any[]).find((b) => b?.id === id) ?? null
}

/** Records that bills changed, so every device picks the change up. */
async function touch(ctx: MutationCtx, billSeq?: number) {
  const meta = await storeMeta(ctx)
  const now = Date.now()
  if (meta) {
    await ctx.db.patch(meta._id, {
      savedAt: now,
      ...(billSeq !== undefined ? { billSeq: Math.max(meta.billSeq ?? 0, billSeq) } : {}),
    })
  } else {
    await ctx.db.insert('billsStore', { billSeq: billSeq ?? 0, savedAt: now })
  }
}

/**
 * The mechanic's sizes are written from his phone (workOrders.saveSizes) while
 * the same bill may be open at the counter. Bills are saved whole, so a
 * counter copy that had not yet heard of the sizes would wipe them out. They
 * go by their own clock instead: the newer sizes stay, whichever copy of the
 * rest of the bill is being written.
 */
function withNewerSizes(bill: any, held: any) {
  const mine = Number(held?.siteSizes?.at) || 0
  if (!mine || mine <= (Number(bill?.siteSizes?.at) || 0)) return bill
  return { ...bill, siteSizes: held.siteSizes, measuredAt: bill.measuredAt ?? held.measuredAt }
}

/** Writes each bill to its own row, replacing that bill's earlier copy. */
export async function writeBills(ctx: MutationCtx, bills: any[], billSeq?: number) {
  // One read for many bills; one indexed lookup for a single one.
  const rows = bills.length > 20
    ? new Map((await ctx.db.query('bills').collect()).map((r) => [r.billId, r]))
    : null
  for (const bill of bills) {
    if (!bill?.id) continue
    const billId = String(bill.id)
    const row = rows
      ? rows.get(billId) ?? null
      : await ctx.db
          .query('bills')
          .withIndex('by_bill', (q) => q.eq('billId', billId))
          .unique()
    const fields = {
      billId,
      number: String(bill.number ?? ''),
      updatedAt: Number(bill.updatedAt) || Date.now(),
      bill: withNewerSizes(bill, row?.bill),
    }
    if (row) await ctx.db.replace(row._id, fields)
    else await ctx.db.insert('bills', fields)
  }
  await touch(ctx, billSeq)
}

/** Takes a bill out of the live list — the caller has already kept it in the trash. */
export async function dropBill(ctx: MutationCtx, id: string) {
  const row = await ctx.db
    .query('bills')
    .withIndex('by_bill', (q) => q.eq('billId', id))
    .unique()
  if (row) await ctx.db.delete(row._id)
  const meta = await storeMeta(ctx)
  const legacy = (meta?.bills ?? []) as any[]
  if (meta && legacy.some((b) => b?.id === id)) {
    await ctx.db.patch(meta._id, { bills: legacy.filter((b) => b?.id !== id) })
  }
  await touch(ctx)
}

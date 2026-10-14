/**
 * The Dr/Cr lines under a voucher.
 *
 * Both ways into the books write these — the ledger's own voucher screens and
 * the bill builder — and they used to write them differently: the ledger
 * refused anything that did not balance, while the builder inserted its two
 * sides straight into the table and trusted itself. One writer now, so a bill
 * cannot post a half-entry the books would carry forever.
 */
import { ConvexError } from 'convex/values'
import type { MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { round2, balanced, signed, lastPostableDate } from './money'
import { record, day } from './history'

export type Line = { ledgerId: Id<'ledgers'>; side: 'Dr' | 'Cr'; amount: number }

/** Writes the lines, refusing anything that does not balance. */
export async function writeLines(
  ctx: MutationCtx,
  voucherId: Id<'vouchers'>,
  date: number,
  lines: Line[],
) {
  // Nothing is posted after today: a date in the future is a mistyped year
  // or day, and it would sit in next month's books where nobody looks. Here,
  // where every posting passes, so no screen can let one through.
  if (date > lastPostableDate(Date.now())) {
    throw new ConvexError(`The date ${day(date)} is after today. Check the day and the year.`)
  }
  const total = lines.reduce((t, l) => t + signed(l.side, round2(l.amount)), 0)
  if (!balanced(total)) {
    throw new Error(
      `Voucher does not balance — debits and credits differ by ${round2(total)}`,
    )
  }
  for (const line of lines) {
    await ctx.db.insert('voucherEntries', {
      voucherId,
      ledgerId: line.ledgerId,
      side: line.side,
      amount: round2(line.amount),
      date,
    })
  }
  // Sealed here, at the one place lines are written, so no way into the books
  // can change what a voucher posts without the chain taking its fingerprint
  // (lib/seal.ts). The line that says what was done is written by the caller.
  await record(ctx, 'voucher.lines', 'Lines written', { entity: 'voucher', entityId: voucherId, quiet: true })
}

/** Takes a voucher's lines back out, for a rewrite. */
export async function clearLines(ctx: MutationCtx, voucherId: Id<'vouchers'>) {
  const existing = await ctx.db
    .query('voucherEntries')
    .withIndex('by_voucher', (q) => q.eq('voucherId', voucherId))
    .collect()
  for (const line of existing) await ctx.db.delete(line._id)
}

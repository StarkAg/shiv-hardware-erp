import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import { mutation, query } from './lib/guarded'
import { readBills } from './lib/billRows'
import { findProblems } from './lib/integrity'

/**
 * Verify Data: the books checked against their own rules (lib/integrity.ts)
 * every night, and whenever someone presses "Check again" after putting a
 * problem right. The latest report is what the home page shows.
 *
 * Everything is read in one go. At ~900 vouchers and ~1,300 lines (Oct 2026)
 * that is a few thousand documents, far inside what one function may read;
 * it wants paging long before it nears the limit.
 */

const KEEP = 30

async function check(ctx: MutationCtx, by: string) {
  const [vouchers, entries, ledgers, types, bills] = await Promise.all([
    ctx.db.query('vouchers').collect(),
    ctx.db.query('voucherEntries').collect(),
    ctx.db.query('ledgers').collect(),
    ctx.db.query('voucherTypes').collect(),
    readBills(ctx),
  ])
  const problems = findProblems({ vouchers, entries, ledgers, types, bills, now: Date.now() } as any)
  await ctx.db.insert('integrityReports', { at: Date.now(), by, problems })
  const old = await ctx.db.query('integrityReports').withIndex('by_at').order('desc').collect()
  for (const row of old.slice(KEEP)) await ctx.db.delete(row._id)
  return problems
}

/** The nightly run (crons.ts). */
export const run = internalMutation({
  args: { by: v.string() },
  handler: async (ctx, { by }) => (await check(ctx, by)).length,
})

/** "Check again", from the home page, once something has been put right. */
export const runNow = mutation({
  args: {},
  handler: async (ctx) => (await check(ctx, 'hand')).length,
})

/** The latest report, for the home page; null before the first run. */
export const latest = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query('integrityReports').withIndex('by_at').order('desc').first()
    return row ? { at: row.at, by: row.by, problems: row.problems } : null
  },
})

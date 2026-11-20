import { v } from 'convex/values'
import { mutation, query } from './lib/guarded'

/**
 * The customer's screen, fed from the phone.
 *
 * The counter PC's own bill form reaches its customer screen without the
 * cloud (src/lib/customerDisplay.ts). A bill typed on the phone POS (the Shiv
 * Counter Android app) cannot, so the phone puts what its bill form shows
 * here, and the customer screen on the counter PC reads it. One row: only the
 * latest thing to show matters, never a history.
 */
const KEY = 'counter'

export const show = mutation({
  args: { state: v.any(), from: v.string() },
  handler: async (ctx, { state, from }) => {
    const at = Date.now()
    const row = await ctx.db.query('customerScreen').withIndex('by_key', (q) => q.eq('key', KEY)).first()
    if (row) await ctx.db.patch(row._id, { state, from, at })
    else await ctx.db.insert('customerScreen', { key: KEY, state, from, at })
    return at
  },
})

export const current = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query('customerScreen').withIndex('by_key', (q) => q.eq('key', KEY)).first()
    return row ? { state: row.state, from: row.from, at: row.at } : null
  },
})

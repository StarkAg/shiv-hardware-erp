import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

/** Replace the single-row bills snapshot. Creates the row if it doesn't exist yet. */
export const save = mutation({
  args: {
    bills:   v.array(v.any()),
    billSeq: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('billsStore').first()
    const data = { bills: args.bills, billSeq: args.billSeq, savedAt: Date.now() }
    if (existing) await ctx.db.patch(existing._id, data)
    else          await ctx.db.insert('billsStore', data)
  },
})

/** Return the single bills snapshot row (or null if nothing saved yet). */
export const get = query({
  args: {},
  handler: async (ctx) => ctx.db.query('billsStore').first(),
})

import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

/** Replace the single-row toto contacts snapshot. Creates the row if absent. */
export const save = mutation({
  args: {
    drivers: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('totoStore').first()
    const data = { ...args, savedAt: Date.now() }
    if (existing) await ctx.db.patch(existing._id, data)
    else          await ctx.db.insert('totoStore', data)
  },
})

/** Return the single toto snapshot row (or null if nothing saved yet). */
export const get = query({
  args: {},
  handler: async (ctx) => ctx.db.query('totoStore').first(),
})

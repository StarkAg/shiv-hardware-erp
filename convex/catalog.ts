import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

/** Replace the single-row catalog snapshot. Creates the row if it doesn't exist yet. */
export const save = mutation({
  args: {
    hardwareCatalog: v.any(),
    customCatalog:   v.array(v.any()),
    sets:            v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('catalogStore').first()
    const data = { ...args, savedAt: Date.now() }
    if (existing) await ctx.db.patch(existing._id, data)
    else          await ctx.db.insert('catalogStore', data)
  },
})

/** Return the single catalog snapshot row (or null if nothing saved yet). */
export const get = query({
  args: {},
  handler: async (ctx) => ctx.db.query('catalogStore').first(),
})

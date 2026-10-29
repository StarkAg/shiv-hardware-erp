import { v } from 'convex/values'
import { mutation, query } from './lib/guarded'

/**
 * Replace the aluminium costing. Edited as a whole on one screen, so the
 * newest edit wins: a copy older than the one held is refused, which stops a
 * device that was offline putting yesterday's rates back.
 */
export const save = mutation({
  args: { data: v.any(), savedAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('aluCostingStore').first()
    if (existing && existing.savedAt > args.savedAt) return { ignored: true as const, savedAt: existing.savedAt }
    if (existing) await ctx.db.patch(existing._id, args)
    else await ctx.db.insert('aluCostingStore', args)
    return { ignored: false as const, savedAt: args.savedAt }
  },
})

/** The costing as the server has it, or null before anything was saved. */
export const get = query({
  args: {},
  handler: async (ctx) => ctx.db.query('aluCostingStore').first(),
})

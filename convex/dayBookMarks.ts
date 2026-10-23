import { v } from 'convex/values'
import { mutation, query } from './lib/guarded'

/**
 * Marks put on Day Book lines while checking them: green for checked, yellow
 * for one to look at again, red for one that is wrong. Only a colour per line,
 * nothing about the voucher itself changes.
 */
const COLOR = v.union(v.literal('green'), v.literal('yellow'), v.literal('red'))

/** Every mark, as { key, color }. Small: one row per marked line. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('dayBookMarks').collect()
    return rows.map((r) => ({ key: r.key, color: r.color }))
  },
})

/** Puts a colour on a line, or takes it off (color null). */
export const set = mutation({
  args: { key: v.string(), color: v.union(COLOR, v.null()) },
  handler: async (ctx, { key, color }) => {
    const existing = await ctx.db.query('dayBookMarks').withIndex('by_key', (q) => q.eq('key', key)).unique()
    if (!color) {
      if (existing) await ctx.db.delete(existing._id)
      return
    }
    if (existing) await ctx.db.patch(existing._id, { color, at: Date.now() })
    else await ctx.db.insert('dayBookMarks', { key, color, at: Date.now() })
  },
})

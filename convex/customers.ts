import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(100, Math.max(1, Math.trunc(args.limit ?? 50)))
    return await ctx.db.query('customers').order('desc').take(limit)
  },
})

export const upsert = mutation({
  args: {
    localId: v.optional(v.string()),
    name: v.string(),
    mobile: v.optional(v.string()),
    altMobile: v.optional(v.string()),
    uid: v.optional(v.string()),
    address: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const existing = args.localId
      ? await ctx.db
        .query('customers')
        .withIndex('by_local_id', q => q.eq('localId', args.localId))
        .unique()
      : args.mobile
        ? await ctx.db
          .query('customers')
          .withIndex('by_mobile', q => q.eq('mobile', args.mobile))
          .unique()
        : null

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        updatedAt: now,
      })
      return existing._id
    }

    return await ctx.db.insert('customers', {
      ...args,
      updatedAt: now,
    })
  },
})


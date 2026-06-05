import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

export const recentQuotations = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(100, Math.max(1, Math.trunc(args.limit ?? 50)))
    return await ctx.db
      .query('quotations')
      .withIndex('by_created_at')
      .order('desc')
      .take(limit)
  },
})

export const saveQuotation = mutation({
  args: {
    localId: v.string(),
    number: v.string(),
    customer: v.any(),
    document: v.any(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const existing = await ctx.db
      .query('quotations')
      .withIndex('by_local_id', q => q.eq('localId', args.localId))
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, {
        number: args.number,
        customer: args.customer,
        document: args.document,
        updatedAt: now,
      })
      return existing._id
    }

    return await ctx.db.insert('quotations', {
      ...args,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const recentGuarantees = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(100, Math.max(1, Math.trunc(args.limit ?? 50)))
    return await ctx.db
      .query('guaranteeDocuments')
      .withIndex('by_created_at')
      .order('desc')
      .take(limit)
  },
})

export const saveGuarantee = mutation({
  args: {
    localId: v.string(),
    number: v.string(),
    customer: v.any(),
    document: v.any(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const existing = await ctx.db
      .query('guaranteeDocuments')
      .withIndex('by_local_id', q => q.eq('localId', args.localId))
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, {
        number: args.number,
        customer: args.customer,
        document: args.document,
        updatedAt: now,
      })
      return existing._id
    }

    return await ctx.db.insert('guaranteeDocuments', {
      ...args,
      createdAt: now,
      updatedAt: now,
    })
  },
})


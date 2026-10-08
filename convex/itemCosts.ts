import { v } from 'convex/values'
import { mutation, query } from './lib/guarded'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { money, record } from './lib/history'

/**
 * The costs the shop has settled by hand.
 *
 * Profit is worked out by matching a sale to the purchase of the same goods.
 * Where the shop buys and sells the very same item that pairing is automatic,
 * and where it buys and sells one item under two names the two are made one in
 * `itemSame`. This table is for neither of those: it is for an item priced
 * from a different item, and for stock with no purchase behind it at all.
 *
 * Two ways of saying it. `sameAs` points at what this is bought as, with `per`
 * saying how many of those make one of these — twenty 1 kg packs to a 20 kg
 * drum — so the cost keeps up with what the supplier charges. `cost` is a rate
 * typed outright, for stock bought before the panel or somewhere it never saw.
 * An item has one answer, not two: setting either clears the other.
 */

async function row(ctx: QueryCtx | MutationCtx, ref: string) {
  return ctx.db
    .query('itemCosts')
    .withIndex('by_ref', (q) => q.eq('ref', ref))
    .unique()
}

export const all = query({
  args: {},
  handler: async (ctx) => ctx.db.query('itemCosts').collect(),
})

/** A rate typed for this item, or the item it is bought as. One or the other. */
export const set = mutation({
  args: {
    ref: v.string(),
    label: v.string(),
    cost: v.optional(v.number()),
    sameAs: v.optional(v.string()),
    sameAsLabel: v.optional(v.string()),
    per: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.cost !== undefined && args.sameAs !== undefined) {
      throw new Error('An item is either bought as another or priced by hand, not both.')
    }
    if (args.cost === undefined && args.sameAs === undefined) {
      throw new Error('Say either what it costs or what it is bought as.')
    }
    if (args.cost !== undefined && !(args.cost > 0)) {
      throw new Error('A cost has to be a figure above nil.')
    }
    if (args.per !== undefined && !(args.per > 0)) {
      throw new Error('How many make one has to be a figure above nil.')
    }
    if (args.sameAs === args.ref) {
      throw new Error('An item cannot be bought as itself.')
    }

    const held = await row(ctx, args.ref)
    const data = {
      ref: args.ref,
      label: args.label,
      cost: args.cost,
      sameAs: args.sameAs,
      sameAsLabel: args.sameAsLabel,
      per: args.sameAs ? args.per : undefined,
      updatedAt: Date.now(),
    }
    if (held) await ctx.db.patch(held._id, data)
    else await ctx.db.insert('itemCosts', data)

    const per = args.per && args.per !== 1 ? ` (${args.per} to one)` : ''
    await record(
      ctx,
      'itemCosts.set',
      args.sameAs
        ? `${args.label} is bought as ${args.sameAsLabel ?? args.sameAs}${per}`
        : `${args.label} costs ${money(args.cost)}`,
    )
    return { ref: args.ref }
  },
})

/** Back to whatever the bills themselves say, which may be nothing. */
export const clear = mutation({
  args: { ref: v.string() },
  handler: async (ctx, { ref }) => {
    const held = await row(ctx, ref)
    if (!held) return { cleared: false as const }
    await ctx.db.delete(held._id)
    await record(ctx, 'itemCosts.clear', `${held.label} goes back to what the bills say`)
    return { cleared: true as const }
  },
})

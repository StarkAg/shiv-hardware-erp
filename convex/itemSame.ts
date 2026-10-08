import { v } from 'convex/values'
import { mutation, query } from './lib/guarded'
import { record } from './lib/history'

/**
 * Two My Items entries the shop has said are one item.
 *
 * Renaming settles most of it — a supplier's entry becomes the shop's, and
 * from then on one name covers both sides. What renaming cannot settle is a
 * duplicate on the customer's side, because a bill already given to a customer
 * keeps the name it was given. The shop sells one 81×30 door as "30mm SG
 * 81 X 30" and as "30mm S 81 X 30", and both are right on the bill they are
 * printed on; they are one door in the godown all the same, and this is where
 * that is written down.
 *
 * Nothing on a bill changes. This is read when the books are added up, never
 * when they are written.
 */

export const all = query({
  args: {},
  handler: async (ctx) => ctx.db.query('itemSame').collect(),
})

/**
 * These two are one item.
 *
 * Said in one direction — `from` answers to `to` — but read in both, because
 * the chain is followed to its end wherever a lookup starts. So it does not
 * matter which of the two the shop happened to be looking at.
 */
export const set = mutation({
  args: {
    from: v.string(),
    to: v.string(),
    fromLabel: v.string(),
    toLabel: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.from === args.to) throw new Error('An item is already itself.')

    // Following `to` onwards must come to a stop. Without this, saying A is B
    // and later that B is A would leave both pointing at each other and every
    // lookup for either going round for ever.
    const held = await ctx.db.query('itemSame').collect()
    const next = new Map(held.map((r) => [r.from, r.to]))
    next.set(args.from, args.to)
    let at = args.to
    const seen = new Set([args.from])
    while (next.has(at)) {
      if (seen.has(at)) throw new Error('That would make the two point at each other.')
      seen.add(at)
      at = next.get(at)!
    }

    const already = held.find((r) => r.from === args.from)
    const data = { ...args, updatedAt: Date.now() }
    if (already) await ctx.db.patch(already._id, data)
    else await ctx.db.insert('itemSame', data)

    await record(ctx, 'itemSame.set', `${args.fromLabel} and ${args.toLabel} are one item`)
    return { from: args.from, to: args.to }
  },
})

/** Two items told apart again. */
export const clear = mutation({
  args: { from: v.string() },
  handler: async (ctx, { from }) => {
    const held = await ctx.db
      .query('itemSame')
      .withIndex('by_from', (q) => q.eq('from', from))
      .unique()
    if (!held) return { cleared: false as const }
    await ctx.db.delete(held._id)
    await record(ctx, 'itemSame.clear', `${held.fromLabel} is not ${held.toLabel} after all`)
    return { cleared: true as const }
  },
})

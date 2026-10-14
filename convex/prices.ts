import { ConvexError, v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { mutation, query } from './lib/guarded'
import { record } from './lib/history'

/**
 * Price List — the makers' rates the shop quotes from (prices-web).
 *
 * Seeded from the makers' lists (prices-web/seed/*.csv, by
 * scripts/seed-prices.mjs) and kept up to date from the app, a rate at a time.
 * Behind the shop PIN like every other app: the net column is what the shop
 * pays, not for a customer's eyes.
 */

/** Every item. A few hundred rows: the phone filters them as you type. */
export const list = query({
  args: {},
  handler: async (ctx) => await ctx.db.query('priceItems').collect(),
})

const rate = v.union(v.number(), v.null())

/** One item's rates, as corrected from the app. null clears a rate. */
export const setRates = mutation({
  args: { id: v.id('priceItems'), mrp: v.optional(rate), net: v.optional(rate) },
  handler: async (ctx, { id, mrp, net }) => {
    const item = await ctx.db.get(id)
    if (!item) throw new ConvexError('That item is no longer on the list.')
    for (const n of [mrp, net]) {
      if (typeof n === 'number' && !(n >= 0 && Number.isFinite(n))) throw new ConvexError('Enter a rate of 0 or more.')
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() }
    if (mrp !== undefined) patch.mrp = mrp ?? undefined
    if (net !== undefined) patch.net = net ?? undefined
    await ctx.db.patch(id, patch)
    const name = [item.brand, item.grade, item.product, item.size, item.wire].filter(Boolean).join(' ')
    const was = `MRP ${item.mrp ?? '-'} / net ${item.net ?? '-'}`
    const now = `MRP ${mrp === undefined ? item.mrp ?? '-' : mrp ?? '-'} / net ${net === undefined ? item.net ?? '-' : net ?? '-'}`
    await record(ctx, 'price.update', `Rate of ${name}: ${was} → ${now}`, { entity: 'priceItem', entityId: id })
  },
})

const seedRow = v.object({
  category: v.string(),
  brand: v.string(),
  grade: v.optional(v.string()),
  code: v.optional(v.string()),
  product: v.string(),
  size: v.string(),
  wire: v.optional(v.string()),
  finish: v.optional(v.string()),
  mrp: v.optional(v.number()),
  net: v.optional(v.number()),
  netLabel: v.optional(v.string()),
})

const keyOf = (r: { brand: string; grade?: string; code?: string; product: string; size: string; wire?: string; finish?: string }) =>
  [r.brand, r.grade, r.code, r.product, r.size, r.wire, r.finish].map((s) => String(s ?? '').trim().toLowerCase()).join('|')

/**
 * Puts a maker's list in. An item already on the list keeps the rates it has
 * — they may have been corrected in the app since — unless `replace` says the
 * list is the newer word.
 *   node scripts/seed-prices.mjs prices-web/seed/godrej_olive_basket_rates.csv
 */
export const seed = internalMutation({
  args: { rows: v.array(seedRow), replace: v.optional(v.boolean()) },
  handler: async (ctx, { rows, replace }) => {
    let added = 0, updated = 0, kept = 0
    for (const row of rows) {
      const key = keyOf(row)
      const held = await ctx.db.query('priceItems').withIndex('by_key', (q) => q.eq('key', key)).unique()
      if (!held) {
        await ctx.db.insert('priceItems', { ...row, key, updatedAt: Date.now() })
        added += 1
      } else if (replace) {
        await ctx.db.replace(held._id, { ...row, key, updatedAt: Date.now() })
        updated += 1
      } else kept += 1
    }
    return { added, updated, kept }
  },
})

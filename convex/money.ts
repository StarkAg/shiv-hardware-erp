import { v } from 'convex/values'
import { mutation, query } from './lib/guarded'
import type { QueryCtx } from './_generated/server'
import { round2 } from './lib/money'
import { partyRows } from './reports'

/**
 * Shiv Money: where the shop's money is, against what it owes and is owed.
 *
 * The places (cash in the shop, at home, each bank, MSwipe) are counted by
 * hand; what is to pay to suppliers and to get from customers comes from the
 * books. A count is saved whole, so a later one can be read against it:
 * if what the business is worth has grown, it is making money.
 *
 * Behind the shop PIN, like the accounts (lib/guarded).
 */
const KIND = v.union(v.literal('have'), v.literal('owe'))

const DEFAULT_PLACES = [
  'Cash in shop', 'Cash at home', 'Mohan Murari PNB', 'Harsh HDFC', 'Neelam HDFC', 'SBI CA', 'MSwipe',
]

/** The places, in their order. Empty until `setUp` has written the shop's own. */
export const places = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('moneyPlaces').collect()
    return rows.sort((a, b) => a.sort - b.sort).map((r) => ({ id: r._id, name: r.name, kind: r.kind }))
  },
})

/** Writes the shop's places the first time the app is opened. Does nothing after. */
export const setUp = mutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query('moneyPlaces').first()) return
    const now = Date.now()
    for (const [i, name] of DEFAULT_PLACES.entries()) {
      await ctx.db.insert('moneyPlaces', { name, kind: 'have', sort: i, createdAt: now })
    }
  },
})

export const addPlace = mutation({
  args: { name: v.string(), kind: KIND },
  handler: async (ctx, { name, kind }) => {
    const clean = name.replace(/\s+/g, ' ').trim()
    if (!clean) throw new Error('Give the place a name.')
    const rows = await ctx.db.query('moneyPlaces').collect()
    if (rows.some((r) => r.name.toLowerCase() === clean.toLowerCase())) throw new Error(`${clean} is already on the list.`)
    const sort = rows.reduce((m, r) => Math.max(m, r.sort), -1) + 1
    return ctx.db.insert('moneyPlaces', { name: clean, kind, sort, createdAt: Date.now() })
  },
})

export const renamePlace = mutation({
  args: { id: v.id('moneyPlaces'), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const clean = name.replace(/\s+/g, ' ').trim()
    if (!clean) throw new Error('Give the place a name.')
    await ctx.db.patch(id, { name: clean })
  },
})

/** Takes a place off the list. Counts already saved keep what it held. */
export const removePlace = mutation({
  args: { id: v.id('moneyPlaces') },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.delete(id)
  },
})

/** Moves a place one up (-1) or down (1) the list. */
export const movePlace = mutation({
  args: { id: v.id('moneyPlaces'), by: v.number() },
  handler: async (ctx, { id, by }) => {
    const rows = (await ctx.db.query('moneyPlaces').collect()).sort((a, b) => a.sort - b.sort)
    const at = rows.findIndex((r) => r._id === id)
    const to = at + Math.sign(by)
    if (at < 0 || to < 0 || to >= rows.length) return
    const [a, b] = [rows[at], rows[to]]
    await ctx.db.patch(a._id, { sort: b.sort })
    await ctx.db.patch(b._id, { sort: a.sort })
  },
})

/**
 * What the books say right now, the way Shiv Accounts adds it up: suppliers'
 * credit balances are to pay and their debit ones paid ahead; customers' debit
 * balances are to get and their credit ones paid ahead.
 */
async function booksNow(ctx: QueryCtx) {
  const [suppliers, customers] = await Promise.all([
    partyRows(ctx, 'Sundry Creditors'),
    partyRows(ctx, 'Sundry Debtors'),
  ])
  const sum = (rows: { closing: number; closingSide: string }[], side: string) =>
    round2(rows.filter((r) => r.closingSide === side).reduce((t, r) => t + (Number(r.closing) || 0), 0))
  return {
    toPay: sum(suppliers, 'Cr'),
    advancesPaid: sum(suppliers, 'Dr'),
    toGet: sum(customers, 'Dr'),
    advancesTaken: sum(customers, 'Cr'),
  }
}

/** The books' four figures, live, for the count being made. */
export const books = query({
  args: {},
  handler: async (ctx) => booksNow(ctx),
})

/** Every count saved, newest first. */
export const counts = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('moneyCounts').withIndex('by_at').order('desc').collect()
    return rows.map((r) => ({ id: r._id, at: r.at, places: r.places, toPay: r.toPay, toGet: r.toGet, advancesPaid: r.advancesPaid, advancesTaken: r.advancesTaken, net: r.net, note: r.note }))
  },
})

/**
 * Saves the count as it stands. The books' figures are read here, at the
 * moment of saving, not taken from the phone: the count says what the books
 * really held when it was made.
 */
export const save = mutation({
  args: {
    places: v.array(v.object({ name: v.string(), kind: KIND, amount: v.number() })),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { places, note }) => {
    const clean = places.map((p) => ({ name: p.name, kind: p.kind, amount: round2(Number(p.amount) || 0) }))
    const b = await booksNow(ctx)
    const have = clean.filter((p) => p.kind === 'have').reduce((t, p) => t + p.amount, 0)
    const owe = clean.filter((p) => p.kind === 'owe').reduce((t, p) => t + p.amount, 0)
    // Customers' balances are left out of the worth: the books do not hold
    // them accurately enough to count on (kept on the count, not added in).
    const net = round2(have + b.advancesPaid - b.toPay - owe)
    return ctx.db.insert('moneyCounts', { at: Date.now(), places: clean, ...b, net, note: note?.trim() || undefined })
  },
})

export const removeCount = mutation({
  args: { id: v.id('moneyCounts') },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.delete(id)
  },
})

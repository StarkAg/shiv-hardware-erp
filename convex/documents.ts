import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requirePin } from './lib/pin'

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

/**
 * Every card, newest first — for the shop, not for the world.
 *
 * This handed out the whole file to anyone who called it: names, mobiles,
 * Aadhaar numbers, prices, and once cards carried one, the very secret that is
 * supposed to keep a card private. Putting a token in the QR would have been
 * pointless while a single unauthenticated call returned all of them.
 *
 * Nothing in the panel calls this — the History tab reopens cards from the
 * device's own copy — so the PIN costs nobody anything, and the same gate is
 * already on the operations that erase the books.
 */
export const recentGuarantees = query({
  args: {
    limit: v.optional(v.number()),
    pin: v.string(),
  },
  handler: async (ctx, args) => {
    requirePin(args.pin)
    const limit = Math.min(100, Math.max(1, Math.trunc(args.limit ?? 50)))
    return await ctx.db
      .query('guaranteeDocuments')
      .withIndex('by_created_at')
      .order('desc')
      .take(limit)
  },
})

/**
 * One card, for whoever is holding it.
 *
 * This answers the public internet: the customer scanning the QR has no
 * account and never will. So the number alone is not enough to open a card --
 * numbers run in a sequence, and the whole file was walkable from
 * GC-2026-0001, handing out names, mobiles, Aadhaar numbers and prices. The QR
 * carries a secret alongside the number and both must agree.
 *
 * A wrong token, a missing token and a card that does not exist all answer the
 * same way, so a guesser learns nothing about which numbers are real.
 */
export const getGuaranteeByNumber = query({
  args: {
    number: v.string(),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const clean = String(args.number ?? '').trim()
    if (!clean) return null

    // The QR and the print server both encode the `number` (e.g. GC-2026-0042).
    // Look it up by index; fall back to a full scan if the index hasn't been
    // back-filled yet.
    const indexed = await ctx.db
      .query('guaranteeDocuments')
      .withIndex('by_number', q => q.eq('number', clean))
      .first()

    const row = indexed ?? await ctx.db
      .query('guaranteeDocuments')
      .filter(q => q.eq(q.field('number'), clean))
      .first()

    if (!row) return null
    const given = String(args.token ?? '').trim()
    // A card with no token was written before this existed and stays shut
    // until one is minted for it -- see backfillGuaranteeTokens.
    if (!row.token || given !== row.token) return null
    return row
  },
})

export const saveGuarantee = mutation({
  args: {
    localId: v.string(),
    number: v.string(),
    /** Minted with the card's reference and printed into its QR. */
    token: v.optional(v.string()),
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
        // Never re-issued on an edit: the card already in the customer's hand
        // is printed with the old one and has to keep opening.
        ...(existing.token ? {} : { token: tokenOf(args) }),
        updatedAt: now,
      })
      return existing._id
    }

    return await ctx.db.insert('guaranteeDocuments', {
      ...args,
      token: tokenOf(args),
      createdAt: now,
      updatedAt: now,
    })
  },
})

/**
 * The secret that goes in a card's QR.
 *
 * Twenty characters of crypto-grade randomness, from an alphabet with no
 * look-alikes in it -- the thing is printed small and occasionally read back
 * over the phone, and an O mistaken for a 0 is a card that will not open.
 */
/**
 * The card's secret, wherever it came in by.
 *
 * The panel mints it and prints it into the QR before the card is saved, so
 * the stored card must keep that exact one — a fresh one here would not match
 * the paper. It arrives nested inside `document`, because the cloud API
 * forwards that object whole and nothing else is guaranteed to survive.
 */
function tokenOf(args: { token?: string; document?: unknown }): string {
  const nested = (args.document as { token?: string } | null | undefined)?.token
  return String(args.token ?? nested ?? '').trim() || mintToken()
}

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function mintToken(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join('')
}

/**
 * Give the cards written before tokens existed one each.
 *
 * They are unreachable until this runs, which is the point: their printed QRs
 * carry no token and the file was public until now. Cards already in a
 * customer's hand need reprinting to scan again.
 */
export const backfillGuaranteeTokens = mutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const rows = await ctx.db.query('guaranteeDocuments').collect()
    const minted: { number: string; token: string }[] = []
    for (const row of rows) {
      if (row.token) continue
      const token = mintToken()
      minted.push({ number: row.number, token })
      if (!dryRun) await ctx.db.patch(row._id, { token, updatedAt: Date.now() })
    }
    return { dryRun: Boolean(dryRun), alreadyHad: rows.length - minted.length, minted }
  },
})

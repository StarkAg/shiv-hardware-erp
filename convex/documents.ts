import { v } from 'convex/values'
import { internalMutation, type QueryCtx } from './_generated/server'
import { mutation, query } from './lib/guarded'
// Reached by customers from a guarantee card's QR code, with no device to trust.
import { query as openQuery } from './_generated/server'
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
 * Takes a quotation out of the cloud copy, from the command line only:
 * `npx convex run --prod documents:removeQuotation '{"localId":"..."}'`.
 * Deleting one in History is remembered on that device and leaves this copy.
 */
export const removeQuotation = internalMutation({
  args: { localId: v.string() },
  handler: async (ctx, { localId }) => {
    const row = await ctx.db.query('quotations').withIndex('by_local_id', q => q.eq('localId', localId)).unique()
    if (row) await ctx.db.delete(row._id)
    return row?.number ?? null
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
    // Every card unless a limit is asked for. History once asked for 100 with a
    // cap of 100 here, which would have hidden the oldest cards from every new
    // device once the shop passed 100 (92 on 28 Nov 2026). A card is about
    // 1.3 KB, so even 5,000 is a few MB, inside a query's limits.
    const limit = Math.min(5000, Math.max(1, Math.trunc(args.limit ?? 5000)))
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
export const getGuaranteeByNumber = openQuery({
  args: {
    number: v.string(),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => (await cardsForQr(ctx, args.number, args.token))[0] ?? null,
})

/**
 * Every card a QR opens -- usually one. Before 2026-10-02 a slot-2 card was
 * printed with slot 1's number AND secret, so both cards of that tray pass
 * carry the very same QR; this returns both so each customer finds theirs.
 * Same gate as getGuaranteeByNumber: no matching token, nothing.
 */
export const getGuaranteesForQr = query({
  args: {
    number: v.string(),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => await cardsForQr(ctx, args.number, args.token),
})

export async function cardsForQr(ctx: QueryCtx, number: string, token: string | undefined) {
  const clean = String(number ?? '').trim()
  const given = String(token ?? '').trim()
  // A card with no token was written before this existed and stays shut
  // until one is minted for it -- see backfillGuaranteeTokens.
  if (!clean || !given) return []

  // The QR encodes the `number` (e.g. GC-2026-0042) and its token. Numbers
  // are minted per device, so two cards can share one (a fresh install
  // restarted at 0001); the token tells them apart, so match on both rather
  // than taking the first row with the number -- which opened the wrong card,
  // or none. Falls back to a scan if the index hasn't been back-filled yet.
  let rows = await ctx.db
    .query('guaranteeDocuments')
    .withIndex('by_number', q => q.eq('number', clean))
    .collect()
  if (!rows.length) {
    rows = await ctx.db
      .query('guaranteeDocuments')
      .filter(q => q.eq(q.field('number'), clean))
      .collect()
  }
  return rows
    .filter(row => row.token && row.token === given)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}

/**
 * The highest GC-<year>-NNNN sequence already issued this year, so a device
 * with an empty or stale local counter (a fresh install, a second counter)
 * continues the shop's numbering instead of reissuing 0001. Returns only a
 * number -- nothing about any card.
 */
export const latestGuaranteeSeq = query({
  args: { year: v.number() },
  handler: async (ctx, args) => {
    const re = new RegExp(`^GC-${Math.trunc(args.year)}-(\\d{4})$`)
    let max = 0
    // Newest first; a year's cards are all recent, so the last 500 cover it.
    const rows = await ctx.db.query('guaranteeDocuments').withIndex('by_created_at').order('desc').take(500)
    for (const row of rows) {
      const m = re.exec(String(row.number ?? ''))
      if (m) max = Math.max(max, Number(m[1]))
    }
    return max
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
  handler: async (ctx, incoming) => {
    const now = Date.now()
    const byLocalId = (localId: string) => ctx.db
      .query('guaranteeDocuments')
      .withIndex('by_local_id', q => q.eq('localId', localId))
      .unique()

    let args = incoming
    const sent = String(args.token ?? (args.document as { token?: string } | null)?.token ?? '').trim()

    // An edit of a card already saved: the same physical card is the same
    // number + token, whatever id this device knows it by (a card pulled from
    // the cloud can carry a device-local id). Update that row, never add one.
    if (sent) {
      const sameCard = (await ctx.db
        .query('guaranteeDocuments')
        .withIndex('by_number', q => q.eq('number', args.number))
        .collect()).find(row => row.token === sent)
      if (sameCard) {
        await ctx.db.patch(sameCard._id, {
          customer: args.customer,
          document: args.document,
          updatedAt: now,
        })
        return sameCard._id
      }
    }

    let existing = await byLocalId(args.localId)

    // A different physical card that happens to reuse this id. Card numbers
    // are counted per device, so a fresh install reissued GC-2026-0002 and its
    // save overwrote July's GC-2026-0002 (keeping July's token, so neither
    // card's QR opened the right one). The token says which card this is:
    // when it differs, the card gets a row of its own instead.
    if (existing?.token && sent && existing.token !== sent) {
      const ownId = `${args.localId}#${sent.slice(0, 8)}`
      args = { ...args, localId: ownId }
      existing = await byLocalId(ownId)
    }

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
/**
 * Move one saved card to a new number and secret, in place (admin only —
 * `npx convex run --prod documents:renumberGuarantee`). For the slot-2 cards
 * printed before 2026-10-02, which shared slot 1's number and QR: each gets a
 * number of its own and is reprinted. saveGuarantee deliberately never
 * re-issues a token, so this is the one place that does.
 */
export const renumberGuarantee = internalMutation({
  args: { localId: v.string(), number: v.string(), token: v.string() },
  handler: async (ctx, { localId, number, token }) => {
    const row = await ctx.db
      .query('guaranteeDocuments')
      .withIndex('by_local_id', q => q.eq('localId', localId))
      .unique()
    if (!row) throw new Error(`No guarantee card with localId ${localId}`)
    const taken = await ctx.db
      .query('guaranteeDocuments')
      .withIndex('by_number', q => q.eq('number', number))
      .first()
    if (taken) throw new Error(`${number} is already used`)
    const document = row.document && typeof row.document === 'object'
      ? { ...(row.document as object), id: number, number, token }
      : row.document
    await ctx.db.patch(row._id, { localId: number, number, token, document, updatedAt: Date.now() })
    return { from: row.number, to: number }
  },
})

/**
 * Removes cards that were never real: duplicate saves of one card, test cards.
 * Matched on number AND token, so only the exact rows named can go. Run from
 * the CLI (`npx convex run --prod documents:removeGuaranteeCards …`).
 */
export const removeGuaranteeCards = internalMutation({
  args: { cards: v.array(v.object({ number: v.string(), token: v.string() })) },
  handler: async (ctx, { cards }) => {
    const removed: string[] = []
    for (const { number, token } of cards) {
      const rows = await ctx.db
        .query('guaranteeDocuments')
        .withIndex('by_number', q => q.eq('number', number))
        .collect()
      for (const row of rows.filter(r => r.token === token)) {
        await ctx.db.delete(row._id)
        removed.push(number)
      }
    }
    return removed
  },
})

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

import { ConvexError, v } from 'convex/values'
import type { MutationCtx } from './_generated/server'
import { mutation, query, phoneMutation, phoneQuery, INTRO_APP } from './lib/guarded'
import { parseMobile } from './lib/contactRead'

/**
 * Shiv Intro: a new customer's name, place and number, typed at the counter.
 * Two separate jobs on one row:
 *
 *   Save  the owner's Samsung listens to `waiting` over its own live connection
 *         (shiv-intro/), writes the contact into the phone and answers `report`.
 *         The phone is the one who knows what it holds, so it decides whether
 *         the number is already there.
 *   Send  the WhatsApp Bills service listens to `toSend` and sends, from
 *         Tony's number, whichever were ticked: the shop's greeting and
 *         visiting card, the shop's QR (MSwipe) or Harsh's QR (Paytm).
 *         Send needs only the number; Save needs a name too.
 *
 * A job stays waiting until its worker has answered, so a phone that is off or
 * a link that is down loses nothing.
 */

const person = { name: v.optional(v.string()), place: v.optional(v.string()), phone: v.string() }
type Person = { name?: string; place?: string; phone: string }

const what = v.union(v.literal('card'), v.literal('shop'), v.literal('harsh'))
type What = 'card' | 'shop' | 'harsh'
const ORDER: What[] = ['card', 'shop', 'harsh']

/** Whether this customer already has the greeting and card. Rows from before the choices had only the card. */
const hasCard = (row: { cardSentAt?: number; sendStatus?: string; sendWhat?: What[] }) =>
  Boolean(row.cardSentAt) || (row.sendStatus === 'sent' && !row.sendWhat)

/**
 * The row for this number, made or brought up to date from what was typed.
 * A name left empty keeps the one already there.
 */
async function upsert(ctx: MutationCtx, args: Person, needName: boolean) {
  const typedName = (args.name ?? '').trim().replace(/\s+/g, ' ')
  const typedPlace = (args.place ?? '').trim().replace(/\s+/g, ' ')
  const phone = parseMobile(args.phone)
  if (!phone) throw new ConvexError('Enter a 10-digit mobile number.')
  const row = await ctx.db.query('introContacts').withIndex('by_phone', (q) => q.eq('phone', phone)).first()
  const name = typedName || row?.name || ''
  const place = typedName ? typedPlace : (row?.place ?? typedPlace)
  if (needName && !name) throw new ConvexError('Enter the name.')
  const now = Date.now()
  if (row) {
    await ctx.db.patch(row._id, { name, place, updatedAt: now })
    return (await ctx.db.get(row._id))!
  }
  const id = await ctx.db.insert('introContacts', { name, place, phone, createdAt: now, updatedAt: now })
  return (await ctx.db.get(id))!
}

/** Save: on its way to the main phone. Pressed twice, it is still one contact. */
export const save = mutation({
  args: person,
  handler: async (ctx, args) => {
    const row = await upsert(ctx, args, true)
    await ctx.db.patch(row._id, { saveStatus: 'waiting', savedAs: undefined, saveError: undefined, savedAt: undefined, askedAt: Date.now() })
    return row._id
  },
})

/**
 * Send: whichever were ticked, to the customer. The QRs can go any number of
 * times; a second greeting and card has to be asked for on purpose.
 */
export const send = mutation({
  args: { ...person, what: v.optional(v.array(what)), again: v.optional(v.boolean()) },
  handler: async (ctx, { again, what: picked, ...args }) => {
    const items = ORDER.filter((item) => (picked ?? ['card']).includes(item))
    if (!items.length) throw new ConvexError('Tick what to send.')
    const row = await upsert(ctx, args, false)
    if (row.sendStatus === 'requested' || row.sendStatus === 'sending') return row._id
    if (items.includes('card') && hasCard(row) && !again) {
      throw new ConvexError(`${row.name || row.phone} was already sent the card.`)
    }
    await ctx.db.patch(row._id, { sendStatus: 'requested', sendWhat: items, sendError: undefined, sentAt: undefined, sendAskedAt: Date.now() })
    return row._id
  },
})

/** The latest customers, and when the main phone last checked in. */
export const recent = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('introContacts').withIndex('by_updated').order('desc').take(30)
    const phones = (await ctx.db.query('trustedDevices').collect()).filter((d) => d.app === INTRO_APP)
    const phoneSeenAt = phones.reduce<number | null>((at, d) => Math.max(at ?? 0, d.lastSeenAt ?? 0), null)
    return { rows, phoneSeenAt }
  },
})

// ── The main phone ──────────────────────────────────────────────────────────

/** What the phone still has to save, oldest first. */
export const waiting = phoneQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('introContacts')
      .withIndex('by_save', (q) => q.eq('saveStatus', 'waiting')).take(50)
    return rows.map((row) => ({
      id: row._id,
      // How the shop writes a party: name, then place.
      name: row.place ? `${row.name}, ${row.place}` : row.name,
      phone: row.phone,
    }))
  },
})

/** The phone's answer. A repeat changes nothing, so it can safely be sent again. */
export const report = phoneMutation({
  args: {
    id: v.id('introContacts'),
    result: v.union(v.literal('saved'), v.literal('already'), v.literal('failed')),
    savedAs: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { id, result, savedAs, error }) => {
    const row = await ctx.db.get(id)
    if (row?.saveStatus !== 'waiting') return
    await ctx.db.patch(id, { saveStatus: result, savedAs, saveError: error, savedAt: Date.now() })
  },
})

/** "Still here", every few minutes, so the page can say when the phone is not. */
export const seen = phoneMutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    const id = identity && ctx.db.normalizeId('trustedDevices', identity.subject)
    if (id) await ctx.db.patch(id, { lastSeenAt: Date.now() })
  },
})

// ── The WhatsApp Bills service ──────────────────────────────────────────────

/** Who is waiting for the card, oldest first. */
export const toSend = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('introContacts')
      .withIndex('by_send', (q) => q.eq('sendStatus', 'requested')).take(10)
    return rows.map((row) => ({ id: row._id, name: row.name || row.phone, phone: row.phone, what: row.sendWhat ?? ['card'] }))
  },
})

/**
 * Taken before anything goes out, and not given back by itself: a service that
 * stops halfway must not greet a customer twice. The page offers Try again.
 */
export const claimSend = mutation({
  args: { id: v.id('introContacts') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (row?.sendStatus !== 'requested') return false
    await ctx.db.patch(id, { sendStatus: 'sending', sendAskedAt: Date.now() })
    return true
  },
})

const sendResult = v.union(v.literal('sent'), v.literal('skipped'), v.literal('failed'))

export const recordSend = mutation({
  args: { id: v.id('introContacts'), status: sendResult, reason: v.optional(v.string()) },
  handler: async (ctx, { id, status, reason }) => {
    const row = await ctx.db.get(id)
    if (row?.sendStatus !== 'sending') return
    const now = Date.now()
    const card = status === 'sent' && (row.sendWhat ?? ['card']).includes('card')
    await ctx.db.patch(id, {
      sendStatus: status,
      sendError: reason,
      sentAt: status === 'sent' ? now : undefined,
      ...(card ? { cardSentAt: now } : {}),
    })
  },
})

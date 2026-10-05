import { ConvexError, v } from 'convex/values'
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { cardsForQr } from './documents'

/**
 * Guarantee claims, filed by the customer from the card's own page.
 *
 * That page answers the public internet, so everything a customer can call here
 * needs the card's number AND its QR secret, the same gate that opens the card.
 * Without both, every call answers as if the card did not exist.
 */

// Cracks are not covered (no longer offered); old claims filed as cracks stay in the schema.
const ISSUES = ['borer', 'air'] as const
const STATUSES = ['new', 'reviewing', 'approved', 'rejected', 'replaced'] as const
const OPEN: Doc<'guaranteeClaims'>['status'][] = ['new', 'reviewing']
const MAX_PHOTOS = 3
const MAX_PHOTO_BYTES = 8 * 1024 * 1024
const MAX_OPEN_PER_CARD = 3
const MAX_PER_CARD = 12

const issueArg = v.union(...ISSUES.map((i) => v.literal(i)))
const statusArg = v.union(...STATUSES.map((s) => v.literal(s)))

async function cardFor(ctx: QueryCtx | MutationCtx, number: string, token: string) {
  const card = (await cardsForQr(ctx as QueryCtx, number, token))[0]
  if (!card) throw new ConvexError('This guarantee card could not be found.')
  return card
}

type Dim = { inches?: number; soot?: number } | null | undefined
const dim = (d: Dim) => (!d || (!d.inches && !d.soot) ? '' : d.soot ? `${d.inches || 0} ${d.soot}/8"` : `${d.inches}"`)

/** "DDoor Flush Door · 32MM · 81" x 33 4/8"", as the shop writes it. */
function itemLabel(item: Record<string, unknown>) {
  const size = [dim(item.height as Dim), dim(item.width as Dim)].filter(Boolean).join(' x ')
  return [String(item.brandName || 'Item'), String(item.thickness || ''), size].filter(Boolean).join(' · ')
}

function cardItems(card: Doc<'guaranteeDocuments'>): Record<string, unknown>[] {
  const items = (card.document as { items?: unknown } | null)?.items
  return Array.isArray(items) ? items : []
}

const text = (value: string, field: string, min: number, max: number) => {
  const t = value.replace(/\s+/g, ' ').trim()
  if (t.length < min) throw new ConvexError(`Please fill in ${field}.`)
  if (t.length > max) throw new ConvexError(`${field[0].toUpperCase()}${field.slice(1)} is too long.`)
  return t
}

/** One upload link per photo, only for someone holding the card. */
export const uploadUrl = mutation({
  args: { number: v.string(), token: v.string() },
  handler: async (ctx, { number, token }) => {
    await cardFor(ctx, number, token)
    return await ctx.storage.generateUploadUrl()
  },
})

export const submit = mutation({
  args: {
    number: v.string(),
    token: v.string(),
    name: v.string(),
    phone: v.string(),
    email: v.string(),
    address: v.string(),
    itemIndex: v.number(),
    doors: v.number(),
    issue: issueArg,
    description: v.string(),
    /** The original guarantee card, the original bill, and the door with the card held beside it. */
    cardPhoto: v.id('_storage'),
    billPhoto: v.id('_storage'),
    doorPhoto: v.id('_storage'),
    /** Close-ups of the damage. */
    photos: v.array(v.id('_storage')),
    agreed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const card = await cardFor(ctx, args.number, args.token)
    if (!args.agreed) throw new ConvexError('Please confirm you will bring the original card and bill.')

    const name = text(args.name, 'your name', 2, 80)
    const address = text(args.address, 'your address', 8, 300)
    const description = text(args.description, 'what is wrong', 10, 1000)
    const digits = args.phone.replace(/\D/g, '')
    const phone = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
    if (!/^[6-9]\d{9}$/.test(phone)) throw new ConvexError('Please enter a 10-digit mobile number.')
    const email = args.email.trim().toLowerCase()
    if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(email)) throw new ConvexError('Please enter a valid email address.')

    const items = cardItems(card)
    const item = items[args.itemIndex]
    if (!Number.isInteger(args.itemIndex) || !item) throw new ConvexError('Please choose the item on this card.')
    const qty = Number(item.qty) || 0
    const doors = Math.trunc(args.doors)
    if (doors < 1 || (qty > 0 && doors > qty) || doors > 999) {
      throw new ConvexError(qty > 0 ? `Number of doors must be between 1 and ${qty}.` : 'Please enter the number of doors.')
    }

    if (args.photos.length < 1 || args.photos.length > MAX_PHOTOS) throw new ConvexError(`Please attach 1 to ${MAX_PHOTOS} close-ups of the damage.`)
    const every = [args.cardPhoto, args.billPhoto, args.doorPhoto, ...args.photos]
    if (new Set(every).size !== every.length) throw new ConvexError('The same photo was attached twice.')
    for (const id of every) {
      const file = await ctx.db.system.get(id)
      if (!file || !String(file.contentType ?? '').startsWith('image/') || file.size > MAX_PHOTO_BYTES) {
        throw new ConvexError('One of the photos could not be used. Please attach it again.')
      }
    }

    const earlier = await ctx.db.query('guaranteeClaims').withIndex('by_card', (q) => q.eq('cardId', card._id)).collect()
    if (earlier.filter((c) => OPEN.includes(c.status)).length >= MAX_OPEN_PER_CARD) {
      throw new ConvexError('This card already has claims under review. The shop will contact you.')
    }
    if (earlier.length >= MAX_PER_CARD) throw new ConvexError('Please contact the shop about this card.')

    const now = Date.now()
    // Continues from the highest number this card has used, so a deleted claim's number is never reissued.
    const used = earlier.map((c) => Number(c.ref.match(/-C(\d+)$/)?.[1]) || 0)
    const ref = `${card.number}-C${Math.max(0, ...used) + 1}`
    await ctx.db.insert('guaranteeClaims', {
      ref,
      cardId: card._id,
      number: card.number,
      name,
      phone,
      email,
      address,
      itemIndex: args.itemIndex,
      itemLabel: itemLabel(item),
      doors,
      issue: args.issue,
      description,
      cardPhoto: args.cardPhoto,
      billPhoto: args.billPhoto,
      doorPhoto: args.doorPhoto,
      photos: args.photos,
      status: 'new',
      createdAt: now,
      updatedAt: now,
    })
    return { ref }
  },
})

/** The card holder's own claims and where each one stands (for the card page). */
export const forCard = query({
  args: { number: v.string(), token: v.string() },
  handler: async (ctx, { number, token }) => {
    const card = (await cardsForQr(ctx, number, token))[0]
    if (!card) return []
    const rows = await ctx.db.query('guaranteeClaims').withIndex('by_card', (q) => q.eq('cardId', card._id)).order('desc').collect()
    return rows.map((c) => ({
      ref: c.ref, status: c.status, issue: c.issue, doors: c.doors, itemLabel: c.itemLabel, note: c.note ?? null, createdAt: c.createdAt,
    }))
  },
})

// ── The shop's side (panel) ─────────────────────────────────────────────

export const list = query({
  args: { status: v.optional(statusArg) },
  handler: async (ctx, { status }) => {
    const rows = await ctx.db.query('guaranteeClaims').withIndex('by_created_at').order('desc').take(200)
    const shown = status ? rows.filter((c) => c.status === status) : rows
    const url = (id: Id<'_storage'>) => ctx.storage.getUrl(id)
    return await Promise.all(shown.map(async (c) => ({
      ...c,
      cardPhotoUrl: await url(c.cardPhoto),
      billPhotoUrl: await url(c.billPhoto),
      doorPhotoUrl: await url(c.doorPhoto),
      photoUrls: (await Promise.all(c.photos.map((id: Id<'_storage'>) => ctx.storage.getUrl(id)))).filter(Boolean) as string[],
    })))
  },
})

/** Claims waiting on the shop (received or under review): the panel's badge. */
export const openCount = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query('guaranteeClaims').collect()).filter((c) => OPEN.includes(c.status)).length,
})

export const setStatus = mutation({
  args: { id: v.id('guaranteeClaims'), status: statusArg, note: v.optional(v.string()) },
  handler: async (ctx, { id, status, note }) => {
    const claim = await ctx.db.get(id)
    if (!claim) throw new ConvexError('That claim is gone.')
    const clean = note === undefined ? claim.note : note.trim().slice(0, 500) || undefined
    // A refusal is the decision most likely to be questioned later, so it is never
    // recorded without its reason (which the customer also sees on the card page).
    if (status === 'rejected' && !clean) throw new ConvexError('Give the reason it is not approved. The customer sees it.')
    await ctx.db.patch(id, { status, note: clean, updatedAt: Date.now() })
  },
})

/**
 * Delete a claim and its photos (admin only, for spam or a test):
 *   npx convex run --prod guaranteeClaims:remove '{"ref":"GC-2026-0016-C1"}'
 */
export const remove = internalMutation({
  args: { ref: v.string() },
  handler: async (ctx, { ref }) => {
    const rows = (await ctx.db.query('guaranteeClaims').collect()).filter((c) => c.ref === ref)
    for (const c of rows) {
      for (const id of [c.cardPhoto, c.billPhoto, c.doorPhoto, ...c.photos]) await ctx.storage.delete(id)
      await ctx.db.delete(c._id)
    }
    return rows.length
  },
})

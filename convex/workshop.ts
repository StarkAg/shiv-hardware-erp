import { ConvexError, v } from 'convex/values'
import { mutation, query, deviceOf } from './lib/guarded'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'

/**
 * Workshop: a work order as a conversation, in pictures (workshop-web).
 *
 * The counter photographs the order and it appears on the workshop's phone,
 * Gopal & Bandhu's; they visit the site and answer with a photograph of the
 * measurements. No item list and no money: the paper says it all. Each job is
 * one thread, read like a chat in both apps, and each side is told what is
 * new to it since it last opened the thread.
 *
 * Trusted devices only, like the panel: the shop PIN once on the phone.
 *
 * Nothing is taken out of a thread without the counter's delete PIN. It lives
 * in the deployment's environment, never in source or in the app:
 *   npx convex env set WORKSHOP_DELETE_PIN <pin>
 */

const side = v.union(v.literal('shop'), v.literal('workshop'))
const stage = v.union(v.literal('measurement'), v.literal('assemble'), v.literal('fitting'))
const COUNTER = 'workshop-job'
const MAX_PHOTOS = 10

/** A party's name as it is said: without the "M/s" the books write before it. */
const bare = (name: string | undefined) => String(name ?? '').replace(/^m\/s\.?\s+/i, '').trim()

const clean = (text: string | undefined, max: number) => {
  const tidy = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  return tidy || undefined
}

/** Compared to the end, whatever differs, so timing says nothing about how close a guess was. */
function requireDeletePin(pin: string) {
  const expected = process.env.WORKSHOP_DELETE_PIN
  if (!expected) throw new ConvexError('No delete PIN is set on this deployment.')
  let diff = pin.length ^ expected.length
  for (let i = 0; i < pin.length; i++) diff |= pin.charCodeAt(i) ^ expected.charCodeAt(i % expected.length)
  if (diff !== 0) throw new ConvexError('Wrong PIN.')
}

async function checkPhotos(ctx: MutationCtx, photos: Id<'_storage'>[]) {
  if (photos.length > MAX_PHOTOS) throw new ConvexError(`At most ${MAX_PHOTOS} photos at a time.`)
  for (const id of photos) {
    if (!(await ctx.db.system.get(id))) throw new ConvexError('A photo did not upload. Try again.')
  }
}

/**
 * The shop's customers, for the counter to pick who an order is for: every
 * account under Sundry Debtors, by name. Only what the picker shows — the
 * name, the place and the phone — and nothing else the books hold on them.
 */
export const customers = query({
  args: {},
  handler: async (ctx) => {
    const group = (await ctx.db.query('groups').collect()).find((g) => g.name === 'Sundry Debtors')
    if (!group) return []
    const accounts = await ctx.db.query('ledgers').withIndex('by_group', (q) => q.eq('groupId', group._id)).collect()
    return accounts
      .filter((l) => l.active !== false && bare(l.name))
      .map((l) => ({ id: l._id, name: bare(l.name), place: l.place ?? '', phone: l.phone ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },
})

/** The jobs a phone shows, newest first, each with its photos' links: the last three hundred open, and sixty finished. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const open = await ctx.db
      .query('workshopJobs')
      .withIndex('by_status_updated', (q) => q.eq('status', 'open'))
      .order('desc')
      .take(300)
    const done = await ctx.db
      .query('workshopJobs')
      .withIndex('by_status_updated', (q) => q.eq('status', 'done'))
      .order('desc')
      .take(60)
    return Promise.all(
      [...open, ...done].map(async (job) => {
        // The customer's account, read as it stands in the books today.
        const account = job.ledgerId ? await ctx.db.get(job.ledgerId) : null
        return {
        id: job._id,
        number: job.number,
        title: (account ? bare(account.name) : '') || job.title || '',
        ledgerId: account?._id ?? null,
        place: account?.place ?? '',
        phone: account?.phone ?? '',
        status: job.status,
        stage: job.stage ?? 'measurement',
        shopSeenAt: job.shopSeenAt,
        workshopSeenAt: job.workshopSeenAt,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        messages: await Promise.all(
          job.messages.map(async (m) => ({
            id: m.id,
            from: m.from,
            text: m.text ?? '',
            by: m.by ?? '',
            at: m.at,
            photos: (
              await Promise.all(m.photos.map(async (storageId) => ({ storageId, url: await ctx.storage.getUrl(storageId) })))
            ).filter((p) => p.url),
          })),
        ),
        }
      }),
    )
  },
})

/**
 * A new work order from the counter: its photographs, and who it is for —
 * a customer's account picked from the books, or a name typed for someone
 * who has none yet.
 */
export const create = mutation({
  args: {
    ledgerId: v.optional(v.id('ledgers')),
    title: v.optional(v.string()),
    // Which box it goes in on the list; measurement when the counter did not say.
    stage: v.optional(stage),
    photos: v.array(v.id('_storage')),
    text: v.optional(v.string()),
  },
  handler: async (ctx, { ledgerId, title, stage, photos, text }) => {
    if (!photos.length) throw new ConvexError('Add a photo of the work order.')
    await checkPhotos(ctx, photos)
    const account = ledgerId ? await ctx.db.get(ledgerId) : null
    if (ledgerId && !account) throw new ConvexError('That customer is no longer in the books. Pick again.')
    const now = Date.now()
    const device = await deviceOf(ctx)
    const counter = await ctx.db.query('counters').withIndex('by_name', (q) => q.eq('name', COUNTER)).unique()
    const number = (counter?.value ?? 0) + 1
    if (counter) await ctx.db.patch(counter._id, { value: number })
    else await ctx.db.insert('counters', { name: COUNTER, value: number })
    return await ctx.db.insert('workshopJobs', {
      number,
      ...(account ? { ledgerId: account._id } : {}),
      // Kept beside the account too, so the job still has a name if the account is ever removed.
      title: clean(account ? bare(account.name) : title, 80),
      status: 'open',
      ...(stage ? { stage } : {}),
      messages: [{ id: `${now}-0`, from: 'shop', photos, text: clean(text, 500), by: device?.name, at: now }],
      shopSeenAt: now,
      workshopSeenAt: 0,
      createdAt: now,
      updatedAt: now,
    })
  },
})

/** A reply in a job's thread, from either side: photographs, a line of text, or both. */
export const send = mutation({
  args: {
    jobId: v.id('workshopJobs'),
    from: side,
    photos: v.array(v.id('_storage')),
    text: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, from, photos, text }) => {
    const job = await ctx.db.get(jobId)
    if (!job) throw new ConvexError('That work order is gone.')
    const said = clean(text, 500)
    if (!photos.length && !said) throw new ConvexError('Add a photo or write something.')
    await checkPhotos(ctx, photos)
    const now = Date.now()
    const device = await deviceOf(ctx)
    await ctx.db.patch(jobId, {
      messages: [...job.messages, { id: `${now}-${job.messages.length}`, from, photos, text: said, by: device?.name, at: now }],
      updatedAt: now,
      // Whoever writes has read what was there.
      ...(from === 'shop' ? { shopSeenAt: now } : { workshopSeenAt: now }),
    })
  },
})

/** This side has the thread open: nothing in it is new to it any more. */
export const seen = mutation({
  args: { jobId: v.id('workshopJobs'), side },
  handler: async (ctx, { jobId, side }) => {
    const job = await ctx.db.get(jobId)
    if (!job) return
    await ctx.db.patch(jobId, side === 'shop' ? { shopSeenAt: Date.now() } : { workshopSeenAt: Date.now() })
  },
})

/** Who a job is for, set or corrected after it was sent: an account from the books, or a typed name. */
export const setCustomer = mutation({
  args: { jobId: v.id('workshopJobs'), ledgerId: v.optional(v.id('ledgers')), title: v.optional(v.string()) },
  handler: async (ctx, { jobId, ledgerId, title }) => {
    const job = await ctx.db.get(jobId)
    if (!job) throw new ConvexError('That work order is gone.')
    const account = ledgerId ? await ctx.db.get(ledgerId) : null
    if (ledgerId && !account) throw new ConvexError('That customer is no longer in the books. Pick again.')
    await ctx.db.patch(jobId, {
      ledgerId: account?._id,
      title: clean(account ? bare(account.name) : title, 80),
      updatedAt: Date.now(),
    })
  },
})

/** Where the work stands: measurement, then assembling, then fitting. Either side moves it. */
export const setStage = mutation({
  args: { jobId: v.id('workshopJobs'), stage },
  handler: async (ctx, { jobId, stage }) => {
    const job = await ctx.db.get(jobId)
    if (!job) throw new ConvexError('That work order is gone.')
    await ctx.db.patch(jobId, { stage, updatedAt: Date.now() })
  },
})

/** Finished with, or opened again. The thread and its photographs stay. */
export const setStatus = mutation({
  args: { jobId: v.id('workshopJobs'), status: v.union(v.literal('open'), v.literal('done')) },
  handler: async (ctx, { jobId, status }) => {
    const job = await ctx.db.get(jobId)
    if (!job) throw new ConvexError('That work order is gone.')
    await ctx.db.patch(jobId, { status, updatedAt: Date.now() })
  },
})

/**
 * One message taken out of a thread, with its photographs, for good: the
 * counter's to do, and only with the delete PIN. A thread left with nothing
 * in it goes too, so a job sent by mistake is removed by removing what it said.
 */
export const removeMessage = mutation({
  args: { jobId: v.id('workshopJobs'), messageId: v.string(), pin: v.string() },
  handler: async (ctx, { jobId, messageId, pin }) => {
    requireDeletePin(pin)
    const job = await ctx.db.get(jobId)
    const gone = job?.messages.find((m) => m.id === messageId)
    if (!job || !gone) return
    for (const id of gone.photos) {
      try { await ctx.storage.delete(id) } catch { /* already gone */ }
    }
    const left = job.messages.filter((m) => m.id !== messageId)
    if (left.length) await ctx.db.patch(jobId, { messages: left, updatedAt: Date.now() })
    else await ctx.db.delete(jobId)
  },
})

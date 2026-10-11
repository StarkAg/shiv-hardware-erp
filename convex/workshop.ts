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
 */

const side = v.union(v.literal('shop'), v.literal('workshop'))
const COUNTER = 'workshop-job'
const MAX_PHOTOS = 10

const clean = (text: string | undefined, max: number) => {
  const tidy = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  return tidy || undefined
}

async function checkPhotos(ctx: MutationCtx, photos: Id<'_storage'>[]) {
  if (photos.length > MAX_PHOTOS) throw new ConvexError(`At most ${MAX_PHOTOS} photos at a time.`)
  for (const id of photos) {
    if (!(await ctx.db.system.get(id))) throw new ConvexError('A photo did not upload. Try again.')
  }
}

/** Every open job, and the last sixty finished, each with its photos' links. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const open = await ctx.db
      .query('workshopJobs')
      .withIndex('by_status_updated', (q) => q.eq('status', 'open'))
      .order('desc')
      .collect()
    const done = await ctx.db
      .query('workshopJobs')
      .withIndex('by_status_updated', (q) => q.eq('status', 'done'))
      .order('desc')
      .take(60)
    return Promise.all(
      [...open, ...done].map(async (job) => ({
        id: job._id,
        number: job.number,
        title: job.title ?? '',
        status: job.status,
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
      })),
    )
  },
})

/** A new work order from the counter: its photographs, and who it is for if that was typed. */
export const create = mutation({
  args: {
    title: v.optional(v.string()),
    photos: v.array(v.id('_storage')),
    text: v.optional(v.string()),
  },
  handler: async (ctx, { title, photos, text }) => {
    if (!photos.length) throw new ConvexError('Add a photo of the work order.')
    await checkPhotos(ctx, photos)
    const now = Date.now()
    const device = await deviceOf(ctx)
    const counter = await ctx.db.query('counters').withIndex('by_name', (q) => q.eq('name', COUNTER)).unique()
    const number = (counter?.value ?? 0) + 1
    if (counter) await ctx.db.patch(counter._id, { value: number })
    else await ctx.db.insert('counters', { name: COUNTER, value: number })
    return await ctx.db.insert('workshopJobs', {
      number,
      title: clean(title, 80),
      status: 'open',
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

/** Finished with, or opened again. The thread and its photographs stay. */
export const setStatus = mutation({
  args: { jobId: v.id('workshopJobs'), status: v.union(v.literal('open'), v.literal('done')) },
  handler: async (ctx, { jobId, status }) => {
    const job = await ctx.db.get(jobId)
    if (!job) throw new ConvexError('That work order is gone.')
    await ctx.db.patch(jobId, { status, updatedAt: Date.now() })
  },
})

/** A job made by mistake: it and its photographs are removed for good. */
export const remove = mutation({
  args: { jobId: v.id('workshopJobs') },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId)
    if (!job) return
    for (const m of job.messages) {
      for (const id of m.photos) {
        try { await ctx.storage.delete(id) } catch { /* already gone */ }
      }
    }
    await ctx.db.delete(jobId)
  },
})

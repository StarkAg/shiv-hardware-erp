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
 * Nothing is taken out, a message or a whole work order, without the delete
 * PIN, on either phone. It lives in the deployment's environment, never in
 * source or in the app:
 *   npx convex env set WORKSHOP_DELETE_PIN <pin>
 */

const side = v.union(v.literal('shop'), v.literal('workshop'))
const stage = v.union(v.literal('measurement'), v.literal('quotation'), v.literal('assemble'), v.literal('goahead'), v.literal('fitting'))
const tag = v.union(v.literal('visit'), v.literal('measurement'), v.literal('quotation'), v.literal('assemble'), v.literal('arrived'), v.literal('goahead'), v.literal('fitting'))
type Stage = 'measurement' | 'quotation' | 'assemble' | 'goahead' | 'fitting'
type Tag = 'visit' | 'arrived' | Stage
type Side = 'shop' | 'workshop'
/**
 * The order the work goes in, and whose turn each step is:
 *
 *   measurement  the workshop measures on site and photographs the figures
 *   quotation    the shop makes the work order from them and sends its photograph
 *   assemble     the workshop builds it, saying how many boards are made, then Complete;
 *                and where the work order asks for it, the shop orders it in from a
 *                supplier and says Arrived. A work order asks for either or both
 *                (`needsOf`), and both go on side by side
 *   goahead      the shop rings the customer and says when to go and whom to ring
 *   fitting      the workshop fits it and photographs it; the job is finished
 *
 * Each step is done by the side whose turn it is, and that moves the job on.
 * Nothing in a thread is free text: every message is tagged with what it is.
 */
const TURN: Record<Stage, Side> = { measurement: 'workshop', quotation: 'shop', assemble: 'workshop', goahead: 'shop', fitting: 'workshop' }
const NEXT: Record<Stage, Stage | null> = { measurement: 'quotation', quotation: 'assemble', assemble: 'goahead', goahead: 'fitting', fitting: null }
/** Whose each tag is to send. The visit order is the shop's, at any time; the ordered items' arrival is the shop's, while assembling. */
const SENDER: Record<Tag, Side> = { visit: 'shop', arrived: 'shop', ...TURN }
const ORDER: Stage[] = ['measurement', 'quotation', 'assemble', 'goahead', 'fitting']
/**
 * Only the present step can be added to. One not come to yet cannot be
 * skipped to, and one that is done is closed: once the job is measured there
 * is no going back to the visit order or the measurements, and so on down the
 * line. The visit order belongs to the first step, while the job is still to
 * be measured.
 */
function onlyNow(step: Tag, at: Stage) {
  const of: Stage = step === 'visit' ? 'measurement' : step === 'arrived' ? 'assemble' : step
  if (ORDER.indexOf(of) > ORDER.indexOf(at)) throw new ConvexError('That step comes later. The one before it is not done yet.')
  if (ORDER.indexOf(of) < ORDER.indexOf(at)) throw new ConvexError('That step is already done. It cannot be gone back to.')
}

/** A count of pieces (the field is still called boards): a whole number nobody could mistype into the thousands. */
function boardCount(n: number) {
  if (!Number.isFinite(n) || n < 0 || n > 999) throw new ConvexError('Give the number of pieces.')
  return Math.trunc(n)
}
/**
 * What a job's work order asks for. A job from before a work order could ask
 * to order anything in is to be assembled, as every job then was.
 */
type Needs = { needsAssemble?: boolean; needsOrder?: boolean; assembled?: boolean; arrived?: boolean }
const needsOf = (job: Needs) => ({ assemble: job.needsAssemble !== false, order: job.needsOrder === true })
/** Whether everything the work order asks for is done, so the go-ahead can be given. */
const workDone = (job: Needs) => {
  const n = needsOf(job)
  return (!n.assemble || job.assembled === true) && (!n.order || job.arrived === true)
}
function checkNeeds(assemble: boolean, order: boolean) {
  if (!assemble && !order) throw new ConvexError('Tick Assemble, Order, or both.')
}

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
        boardsTotal: job.boardsTotal ?? null,
        boardsMade: job.boardsMade ?? null,
        needsAssemble: needsOf(job).assemble,
        needsOrder: needsOf(job).order,
        assembled: job.assembled === true,
        arrived: job.arrived === true,
        visitAt: job.visitAt ?? null,
        callPhone: job.callPhone ?? '',
        shopSeenAt: job.shopSeenAt,
        workshopSeenAt: job.workshopSeenAt,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        messages: await Promise.all(
          job.messages.map(async (m) => ({
            id: m.id,
            from: m.from,
            step: m.step ?? null,
            boards: m.boards ?? null,
            assemble: m.assemble ?? null,
            order: m.order ?? null,
            complete: m.complete === true,
            arrived: m.arrived === true,
            visitAt: m.visitAt ?? null,
            callPhone: m.callPhone ?? '',
            // Lines typed before threads became tags only.
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
    // Sent by apps from before the steps were fixed; not used. A job starts at measurement.
    stage: v.optional(stage),
    photos: v.array(v.id('_storage')),
    text: v.optional(v.string()),
  },
  handler: async (ctx, { ledgerId, title, photos }) => {
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
      messages: [{ id: `${now}-0`, from: 'shop', photos, step: 'visit', by: device?.name, at: now }],
      shopSeenAt: now,
      workshopSeenAt: 0,
      createdAt: now,
      updatedAt: now,
    })
  },
})

/**
 * What either side adds to a job's thread. Never free text: photographs
 * tagged with what they are, or a marker.
 *
 * From the workshop:
 *   - photographs of the measurements or of the fitted piece (`step`);
 *   - the work status while assembling: `boards` made so far;
 *   - `complete`: assembling is finished.
 * From the shop:
 *   - photographs of the visit order (any time) or of the work order, with
 *     the `boards` it asks for and whether it is to be assembled (`assemble`),
 *     ordered in (`order`), or both;
 *   - `arrived`: what was ordered has come in, with photographs of the
 *     challan if there are any;
 *   - the go-ahead: `visitAt` and `callPhone`, once the work is complete.
 *
 * What is the present step's, from the side whose turn it is, moves the job
 * on: the measurements, the work order, Complete, the go-ahead, and the
 * fitted piece, after which the job is finished. A job being assembled and
 * ordered moves on with whichever of Complete and Arrived comes last. Only the present step can be
 * added to: none is skipped, and one that is done is closed (`onlyNow`).
 */
export const send = mutation({
  args: {
    jobId: v.id('workshopJobs'),
    from: side,
    photos: v.array(v.id('_storage')),
    step: v.optional(tag),
    boards: v.optional(v.number()),
    assemble: v.optional(v.boolean()),
    order: v.optional(v.boolean()),
    complete: v.optional(v.boolean()),
    arrived: v.optional(v.boolean()),
    visitAt: v.optional(v.number()),
    callPhone: v.optional(v.string()),
    // Sent by apps from before threads were tags only; no longer kept.
    text: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, from, photos, step: named, boards, assemble, order, complete, arrived, visitAt, callPhone }) => {
    const job = await ctx.db.get(jobId)
    if (!job) throw new ConvexError('That work order is gone.')
    await checkPhotos(ctx, photos)
    const now = Date.now()
    const device = await deviceOf(ctx)
    const at: Stage = job.stage ?? 'measurement'
    const open = job.status !== 'done'

    let step: Tag
    let moves = false
    const marks: { boards?: number; assemble?: boolean; order?: boolean; complete?: boolean; arrived?: boolean; visitAt?: number; callPhone?: string } = {}
    const facts: Needs & { boardsTotal?: number; boardsMade?: number; visitAt?: number; callPhone?: string } = {}
    const needs = needsOf(job)

    if (from === 'workshop' && complete) {
      if (!open || at !== 'assemble' || !needs.assemble) throw new ConvexError('Only a job being assembled can be marked complete.')
      if (job.assembled) throw new ConvexError('Assembling is already complete.')
      step = 'assemble'
      marks.complete = facts.assembled = true
      moves = workDone({ ...job, ...facts })
    } else if (from === 'workshop' && boards !== undefined) {
      if (!open || at !== 'assemble' || !needs.assemble || job.assembled) throw new ConvexError('The work status is for a job being assembled.')
      step = 'assemble'
      marks.boards = facts.boardsMade = boardCount(boards)
    } else if (from === 'workshop') {
      if (!photos.length) throw new ConvexError('Send a photo of the measurements.')
      if (!open) throw new ConvexError('This job is finished.')
      // The step named, when it is the workshop's; else the present one.
      step = named && named !== 'visit' && SENDER[named] === 'workshop' ? named : at
      if (TURN[step as Stage] !== 'workshop') throw new ConvexError('This step is the shop\'s to do.')
      onlyNow(step, at)
      if (step === 'assemble' && !needs.assemble) throw new ConvexError('This job is not to be assembled. The shop is ordering it in.')
      // Assembling is finished by Complete, not by a photograph of it.
      moves = step !== 'assemble'
    } else if (arrived) {
      if (!open || at !== 'assemble' || !needs.order) throw new ConvexError('Nothing is being ordered in for this job.')
      if (job.arrived) throw new ConvexError('The ordered items are already marked arrived.')
      step = 'arrived'
      marks.arrived = facts.arrived = true
      moves = workDone({ ...job, ...facts })
    } else if (visitAt !== undefined) {
      if (!open || at !== 'goahead') {
        throw new ConvexError(open && at === 'fitting' ? 'The go-ahead is already given.' : 'The go-ahead is given once the work is complete.')
      }
      const phone = String(callPhone ?? '').replace(/[^\d+]/g, '')
      if (!Number.isFinite(visitAt) || visitAt <= 0) throw new ConvexError('Say when to visit.')
      if (phone.replace(/\D/g, '').length < 7) throw new ConvexError('Say which number to call.')
      step = 'goahead'
      marks.visitAt = facts.visitAt = visitAt
      marks.callPhone = facts.callPhone = phone
      moves = true
    } else {
      if (!photos.length) throw new ConvexError('Add a photo.')
      if (!open) throw new ConvexError('This job is finished.')
      // The visit order while the job is still to be measured; the work order once it is.
      step = named === 'visit' || named === 'quotation' ? named : at === 'measurement' ? 'visit' : 'quotation'
      onlyNow(step, at)
      if (step === 'quotation' && boards !== undefined) marks.boards = facts.boardsTotal = boardCount(boards)
      if (step === 'quotation') {
        // An app from before the ticks sends neither: the job is to be assembled.
        const a = assemble ?? !order
        const o = order === true
        checkNeeds(a, o)
        marks.assemble = facts.needsAssemble = a
        marks.order = facts.needsOrder = o
      }
      moves = step === 'quotation'
    }

    await ctx.db.patch(jobId, {
      messages: [...job.messages, { id: `${now}-${job.messages.length}`, from, photos, step, ...marks, by: device?.name, at: now }],
      updatedAt: now,
      ...facts,
      ...(moves ? (NEXT[at] ? { stage: NEXT[at]! } : { status: 'done' as const }) : {}),
      // Whoever writes has read what was there.
      ...(from === 'shop' ? { shopSeenAt: now } : { workshopSeenAt: now }),
    })
  },
})

/**
 * What the work order asks for, changed by the shop while the job is being
 * assembled or ordered: a job found to need a part ordered in after all, or
 * one ticked for the wrong thing. What is already done stays done, and a job
 * left with everything asked for done moves on to the go-ahead.
 */
export const setNeeds = mutation({
  args: { jobId: v.id('workshopJobs'), assemble: v.boolean(), order: v.boolean() },
  handler: async (ctx, { jobId, assemble, order }) => {
    const job = await ctx.db.get(jobId)
    if (!job) throw new ConvexError('That work order is gone.')
    if (job.status === 'done' || (job.stage ?? 'measurement') !== 'assemble') throw new ConvexError('That can be changed only while the job is being assembled or ordered.')
    checkNeeds(assemble, order)
    const next = { ...job, needsAssemble: assemble, needsOrder: order }
    await ctx.db.patch(jobId, {
      needsAssemble: assemble,
      needsOrder: order,
      updatedAt: Date.now(),
      ...(workDone(next) ? { stage: 'goahead' as const } : {}),
      shopSeenAt: Date.now(),
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
 * One message taken out of a thread, with its photographs, for good: either
 * side's to do, and only with the delete PIN. A thread left with nothing in
 * it goes too.
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

/**
 * A whole work order taken off the list, with every photograph in its thread,
 * for good: either side's to do, and only with the delete PIN.
 */
export const remove = mutation({
  args: { jobId: v.id('workshopJobs'), pin: v.string() },
  handler: async (ctx, { jobId, pin }) => {
    requireDeletePin(pin)
    const job = await ctx.db.get(jobId)
    if (!job) return
    for (const id of job.messages.flatMap((m) => m.photos)) {
      try { await ctx.storage.delete(id) } catch { /* already gone */ }
    }
    await ctx.db.delete(jobId)
  },
})

import { v } from 'convex/values'
import { mutation, query } from './lib/guarded'

const jobKind = v.union(v.literal('quotation'), v.literal('guarantee'), v.literal('raw-file'))
const jobSource = v.union(v.literal('android'), v.literal('web'), v.literal('whatsapp'), v.literal('server'))

const ACTIVE_LEASE_MS = 2 * 60 * 1000

function publicJob(job: {
  _id: unknown
  status: string
  kind: string
  source: string
  copies: number
  requestedBy?: string
  assignedPrinterId?: string
  claimedBy?: string
  claimedAt?: number
  printedAt?: number
  failedAt?: number
  error?: string
  createdAt: number
  updatedAt: number
} | null) {
  if (!job) return null
  return {
    _id: job._id,
    status: job.status,
    kind: job.kind,
    source: job.source,
    copies: job.copies,
    requestedBy: job.requestedBy,
    assignedPrinterId: job.assignedPrinterId,
    claimedBy: job.claimedBy,
    claimedAt: job.claimedAt,
    printedAt: job.printedAt,
    failedAt: job.failedAt,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }
}

export const create = mutation({
  args: {
    kind: jobKind,
    source: jobSource,
    payload: v.any(),
    copies: v.optional(v.number()),
    requestedBy: v.optional(v.string()),
    assignedPrinterId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const copies = Math.min(20, Math.max(1, Math.trunc(args.copies ?? 1)))

    return await ctx.db.insert('printJobs', {
      status: 'pending',
      kind: args.kind,
      source: args.source,
      payload: args.payload,
      copies,
      requestedBy: args.requestedBy,
      assignedPrinterId: args.assignedPrinterId,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const listPending = query({
  args: {
    printerId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(50, Math.max(1, Math.trunc(args.limit ?? 20)))
    const jobs = args.printerId
      ? await ctx.db
        .query('printJobs')
        .withIndex('by_printer_status_created_at', q =>
          q.eq('assignedPrinterId', args.printerId).eq('status', 'pending'),
        )
        .order('asc')
        .take(limit)
      : await ctx.db
        .query('printJobs')
        .withIndex('by_status_created_at', q => q.eq('status', 'pending'))
        .order('asc')
        .take(limit)

    return jobs
  },
})

export const getById = query({
  args: {
    id: v.id('printJobs'),
  },
  handler: async (ctx, args) => {
    return publicJob(await ctx.db.get(args.id))
  },
})

export const claimNext = mutation({
  args: {
    printerId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const limit = Math.min(10, Math.max(1, Math.trunc(args.limit ?? 1)))
    const assigned = await ctx.db
      .query('printJobs')
      .withIndex('by_printer_status_created_at', q =>
        q.eq('assignedPrinterId', args.printerId).eq('status', 'pending'),
      )
      .order('asc')
      .take(limit)

    const unassignedNeeded = Math.max(0, limit - assigned.length)
    const unassigned = unassignedNeeded === 0
      ? []
      : (await ctx.db
        .query('printJobs')
        .withIndex('by_status_created_at', q => q.eq('status', 'pending'))
        .order('asc')
        .take(limit * 3))
        .filter(job => !job.assignedPrinterId)
        .slice(0, unassignedNeeded)

    const jobs = [...assigned, ...unassigned]
    for (const job of jobs) {
      await ctx.db.patch(job._id, {
        status: 'claimed',
        claimedBy: args.printerId,
        claimedAt: now,
        leaseExpiresAt: now + ACTIVE_LEASE_MS,
        updatedAt: now,
      })
    }

    return jobs
  },
})

export const markPrinting = mutation({
  args: {
    id: v.id('printJobs'),
    printerId: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id)
    if (!job) throw new Error('Print job not found')
    if (job.claimedBy && job.claimedBy !== args.printerId) {
      throw new Error('Print job is claimed by another printer')
    }

    await ctx.db.patch(args.id, {
      status: 'printing',
      claimedBy: args.printerId,
      updatedAt: Date.now(),
    })
  },
})

export const complete = mutation({
  args: {
    id: v.id('printJobs'),
    printerId: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id)
    if (!job) throw new Error('Print job not found')
    if (job.claimedBy && job.claimedBy !== args.printerId) {
      throw new Error('Print job is claimed by another printer')
    }

    const now = Date.now()
    await ctx.db.patch(args.id, {
      status: 'printed',
      claimedBy: args.printerId,
      printedAt: now,
      updatedAt: now,
    })
  },
})

export const fail = mutation({
  args: {
    id: v.id('printJobs'),
    printerId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.id)
    if (!job) throw new Error('Print job not found')
    if (job.claimedBy && job.claimedBy !== args.printerId) {
      throw new Error('Print job is claimed by another printer')
    }

    const now = Date.now()
    await ctx.db.patch(args.id, {
      status: 'failed',
      claimedBy: args.printerId,
      failedAt: now,
      error: args.error,
      updatedAt: now,
    })
  },
})

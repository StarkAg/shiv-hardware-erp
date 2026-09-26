import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { api } from './_generated/api'

/**
 * Fabrication jobs — the estimate, the site measurements and the work order,
 * kept as one record instead of three sheets of paper.
 *
 * The sync contract is the cash book's, because it is already proven on a
 * phone with no signal: the device writes locally, appends the same change to
 * an outbox, and flushes it in order when the network returns. Two rules make
 * a replayed flush safe — every row carries the id the device gave it, so the
 * server matches rather than inserts, and `updatedAt` settles conflicts, so a
 * late flush cannot overwrite a newer correction made somewhere else.
 */

const newer = (existing: { updatedAt?: number }, updatedAt: number) =>
  updatedAt >= (existing.updatedAt ?? 0)

export const push = mutation({
  args: { ops: v.array(v.any()) },
  handler: async (ctx, { ops }) => {
    let applied = 0
    let skipped = 0

    for (const op of ops) {
      if (op?.t !== 'job') continue

      const existing = await ctx.db
        .query('jobs')
        .withIndex('by_job_id', (q) => q.eq('jobId', op.jobId))
        .unique()

      const row = {
        jobId: String(op.jobId),
        number: String(op.number ?? ''),
        status: String(op.status ?? 'estimate'),
        customer: op.customer ?? {},
        estimate: op.estimate ?? null,
        openings: op.openings ?? [],
        order: op.order ?? null,
        variance: op.variance ?? null,
        at: Number(op.at) || Date.now(),
        updatedAt: Number(op.updatedAt) || Date.now(),
        deleted: !!op.deleted,
      }

      if (!existing) await ctx.db.insert('jobs', row)
      else if (newer(existing, row.updatedAt)) await ctx.db.patch(existing._id, row)
      else { skipped++; continue }
      applied++
    }

    return { applied, skipped, serverTime: Date.now() }
  },
})

export const pull = query({
  args: { since: v.optional(v.number()) },
  handler: async (ctx, { since }) => {
    const from = since ?? 0
    const jobs = await ctx.db
      .query('jobs')
      .withIndex('by_updated_at', (q) => q.gt('updatedAt', from))
      .collect()

    // Taken after the read, so a row written during it is picked up next time
    // rather than skipped.
    return { jobs, serverTime: Date.now() }
  },
})

/**
 * The next pad number.
 *
 * Counted from what is already stored rather than from a counter row, so a
 * device that has been offline for a week cannot hand out a number the shop
 * has already written on a pink slip. The phone proposes one immediately for
 * the screen; this is what settles it.
 */
export const nextNumber = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('jobs').collect()
    let top = 0
    for (const row of rows) {
      const n = parseInt(String(row.number || '').replace(/\D/g, ''), 10)
      if (Number.isFinite(n) && n > top) top = n
    }
    return { next: String(top + 1) }
  },
})

/**
 * Take an advance against a job into the cash book.
 *
 * The money is real the moment it is taken, so it goes to the drawer through
 * the same door every other note does — cash.push — rather than being a second
 * set of figures that somebody has to remember to copy across in the evening.
 */
export const postAdvance = mutation({
  args: {
    entryId: v.string(),
    date: v.string(),
    name: v.string(),
    amount: v.number(),
    mode: v.optional(v.string()),
    at: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(api.cash.push, {
      ops: [{
        t: 'entry',
        entryId: args.entryId,
        date: args.date,
        kind: 'in',
        mode: args.mode === 'online' ? 'online' : 'cash',
        name: args.name,
        amount: args.amount,
        at: args.at ?? Date.now(),
        updatedAt: Date.now(),
      }],
    })
    return { ok: true }
  },
})

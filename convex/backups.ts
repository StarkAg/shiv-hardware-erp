import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { query } from './lib/guarded'

/**
 * What the nightly backup reports about itself.
 *
 * The job runs on Railway with the deployment's key and calls `record` after
 * every attempt; Home reads `latest` so a missed night is seen the next
 * morning rather than on the day a backup is needed.
 */

export const record = internalMutation({
  args: {
    ok: v.boolean(),
    kind: v.union(v.literal('tables'), v.literal('full')),
    file: v.optional(v.string()),
    bytes: v.optional(v.number()),
    vouchers: v.optional(v.number()),
    /** How many items the copy held — the inventory lives inside one row, so
     *  the row count says nothing about whether the list is still there. */
    items: v.optional(v.number()),
    /** A copy that saved cleanly but holds noticeably less than the last one.
     *  Kept, because it is an honest record — but said out loud. */
    warning: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('backupRuns', { at: Date.now(), ...args })
    // A year of nightly rows is plenty to look back on.
    const old = await ctx.db
      .query('backupRuns')
      .withIndex('by_at', (q) => q.lt('at', Date.now() - 400 * 864e5))
      .take(50)
    for (const row of old) await ctx.db.delete(row._id)
  },
})

export const latest = query({
  args: {},
  handler: async (ctx) => {
    const recent = await ctx.db.query('backupRuns').withIndex('by_at').order('desc').take(30)
    const good = recent.find((r) => r.ok) ?? null
    const lastFull = recent.find((r) => r.ok && r.kind === 'full') ?? null
    return {
      lastGood: good && {
        at: good.at, kind: good.kind, bytes: good.bytes ?? null,
        vouchers: good.vouchers ?? null, items: good.items ?? null,
      },
      lastFull: lastFull && { at: lastFull.at, bytes: lastFull.bytes ?? null },
      lastFailed: recent[0] && !recent[0].ok ? { at: recent[0].at, error: recent[0].error ?? '' } : null,
      /**
       * A copy that saved but lost something. Surfaced beside the failures
       * because a backup that quietly holds less than last night's is the
       * thing nobody goes looking for.
       */
      lastWarning: recent.find((r) => r.ok && r.warning)
        ? { at: recent.find((r) => r.ok && r.warning)!.at, warning: recent.find((r) => r.ok && r.warning)!.warning ?? '' }
        : null,
    }
  },
})

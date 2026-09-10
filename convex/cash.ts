import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

// ── Cash book sync ──────────────────────────────────────────────────────────
// The phone is the writer and the source of truth for anything it has not sent
// yet; this is the place those writes land. Two calls only:
//
//   push  — hand over a queue of changes, in the order they were made
//   pull  — everything that changed on the server since a cursor
//
// Both are safe to repeat. push matches rows by the id the device generated, so
// a queue that gets flushed twice (a dropped response, a reload mid-send) does
// not duplicate anything. Conflicts are settled by updatedAt: the later write
// wins, which is right for a shop where two phones rarely touch the same line.

type Table = 'cashEntries' | 'cashCloses' | 'cashOpenings'

// Only take the incoming write if it is not older than what is already stored.
// Without this, a queue flushed late would overwrite a newer correction.
function newer(existing: { updatedAt: number } | null, updatedAt: number) {
  return !existing || updatedAt >= existing.updatedAt
}

export const push = mutation({
  args: { ops: v.array(v.any()) },
  handler: async (ctx, { ops }) => {
    let applied = 0
    let skipped = 0

    for (const op of ops) {
      if (op?.t === 'entry') {
        const existing = await ctx.db
          .query('cashEntries')
          .withIndex('by_entry_id', (q) => q.eq('entryId', op.entryId))
          .unique()
        const row = {
          entryId: op.entryId,
          date: op.date,
          kind: op.kind,
          mode: op.mode,
          name: op.name ?? '',
          amount: Number(op.amount) || 0,
          at: Number(op.at) || Date.now(),
          updatedAt: Number(op.updatedAt) || Date.now(),
          deleted: !!op.deleted,
          dealer: !!op.dealer,
        }
        if (!existing) await ctx.db.insert('cashEntries', row)
        else if (newer(existing, row.updatedAt)) await ctx.db.patch(existing._id, row)
        else { skipped++; continue }
        applied++
        continue
      }

      if (op?.t === 'close' || op?.t === 'opening') {
        const table: Table = op.t === 'close' ? 'cashCloses' : 'cashOpenings'
        const existing = await ctx.db
          .query(table)
          .withIndex('by_date', (q) => q.eq('date', op.date))
          .unique()
        const base = {
          date: op.date,
          at: Number(op.at) || Date.now(),
          updatedAt: Number(op.updatedAt) || Date.now(),
          deleted: !!op.deleted,
        }
        const row = op.t === 'close'
          ? { ...base, counted: Number(op.counted) || 0, shut: !!op.shut }
          : { ...base, cash: Number(op.cash) || 0, online: Number(op.online) || 0 }
        if (!existing) await ctx.db.insert(table, row as any)
        else if (newer(existing, row.updatedAt)) await ctx.db.patch(existing._id, row as any)
        else { skipped++; continue }
        applied++
        continue
      }

      if (op?.t === 'log') {
        // The log is append-only: a replayed entry is dropped, never rewritten.
        const existing = await ctx.db
          .query('cashLog')
          .withIndex('by_log_id', (q) => q.eq('logId', op.logId))
          .unique()
        if (existing) { skipped++; continue }
        await ctx.db.insert('cashLog', {
          logId: op.logId,
          at: Number(op.at) || Date.now(),
          kind: String(op.kind || ''),
          date: String(op.date || ''),
          what: String(op.what || ''),
          changes: Array.isArray(op.changes) ? op.changes.map(String) : undefined,
          device: op.device,
        })
        applied++
      }
    }

    return { applied, skipped, serverTime: Date.now() }
  },
})

export const pull = query({
  args: { since: v.optional(v.number()) },
  handler: async (ctx, { since }) => {
    const from = since ?? 0
    const entries = await ctx.db
      .query('cashEntries')
      .withIndex('by_updated_at', (q) => q.gt('updatedAt', from))
      .collect()
    const closes = await ctx.db
      .query('cashCloses')
      .withIndex('by_updated_at', (q) => q.gt('updatedAt', from))
      .collect()
    const openings = await ctx.db
      .query('cashOpenings')
      .withIndex('by_updated_at', (q) => q.gt('updatedAt', from))
      .collect()
    const log = await ctx.db
      .query('cashLog')
      .withIndex('by_at', (q) => q.gt('at', from))
      .collect()

    // serverTime becomes the next cursor. Taken after the reads, so a row
    // written during them is picked up next time rather than skipped.
    return { entries, closes, openings, log, serverTime: Date.now() }
  },
})

import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { api } from './_generated/api'
import { round2, fyOf } from './lib/money'
import { findParty } from './lib/parties'
import { nextVoucherNo } from './lib/numbering'
import { writeLines, clearLines } from './lib/entries'
import { record, money, day } from './lib/history'

/**
 * The drawer, in the books.
 *
 * The cash page was a second set of accounts: money came in and out of it and
 * the ledger never heard, so Cash-in-Hand had to be left out of the trial
 * balance as "not maintained" — it only ever knew about money going out. Every
 * note the counter writes down is a Receipt or a Payment, so it is posted as
 * one, from here, when it syncs.
 *
 * Posting happens on the server rather than on the phone deliberately: the
 * cash page stays what it is — fast, offline, one line per note — and nothing
 * new is asked of whoever is standing at the counter.
 *
 * An entry whose name the books recognise posts itself. One they don't waits
 * in the review queue: a drawer note is not enough to open somebody an account
 * on, and half a voucher is worse than none.
 */

/** Which way the money went, in voucher terms. */
const CASH_KINDS = {
  in:  { type: 'Receipt', party: 'Cr' as const, drawer: 'Dr' as const },
  out: { type: 'Payment', party: 'Dr' as const, drawer: 'Cr' as const },
}

/** The business day as the books date it. */
const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`)

type CashRow = Doc<'cashEntries'>

/** Why an entry has not reached the books, or null when it has nothing to say. */
async function blockedBecause(ctx: QueryCtx, row: CashRow): Promise<string | null> {
  if (row.deleted) return null
  if (!(row.amount > 0)) return 'No amount'
  const party = row.ledgerId ? await ctx.db.get(row.ledgerId) : await findParty(ctx, row.name)
  if (!party) return row.name.trim() ? 'No account by that name' : 'No name'
  const drawer = row.mode === 'online' ? 'Bank' : 'Cash'
  const account = await ctx.db.query('ledgers').filter(q => q.eq(q.field('name'), drawer)).first()
  if (!account) return `No "${drawer}" account`
  const type = await ctx.db.query('voucherTypes')
    .withIndex('by_name', q => q.eq('name', CASH_KINDS[row.kind].type)).unique()
  if (!type) return `No ${CASH_KINDS[row.kind].type} voucher type`
  return null
}

/**
 * Put one drawer note into the books, or take it back out.
 *
 * Safe to run again on the same entry: the voucher it made is remembered on
 * the row, so a queue flushed twice rewrites one voucher rather than posting
 * a second. Nothing here throws — a sync from the counter must not fail
 * because an account has not been set up yet; the entry simply stays in the
 * review queue with the reason.
 */
async function postCashEntry(ctx: MutationCtx, entryId: string): Promise<void> {
  const row = await ctx.db
    .query('cashEntries')
    .withIndex('by_entry_id', (q) => q.eq('entryId', entryId))
    .unique()
  if (!row) return

  // Deleted at the counter, or edited down to nothing: the books follow. The
  // voucher goes to the trash rather than being destroyed, so a note deleted
  // by mistake can be put back with its accounting.
  if (row.deleted || !(row.amount > 0)) {
    if (row.voucherId) {
      await ctx.runMutation(api.vouchers.remove, { id: row.voucherId })
      await ctx.db.patch(row._id, { voucherId: undefined })
    }
    return
  }

  const party = row.ledgerId ? await ctx.db.get(row.ledgerId) : await findParty(ctx, row.name)
  if (!party) return

  const drawerName = row.mode === 'online' ? 'Bank' : 'Cash'
  const drawer = await ctx.db.query('ledgers').filter(q => q.eq(q.field('name'), drawerName)).first()
  if (!drawer) return

  const spec = CASH_KINDS[row.kind]
  const type = await ctx.db.query('voucherTypes')
    .withIndex('by_name', (q) => q.eq('name', spec.type)).unique()
  if (!type) return

  const date = dayOf(row.date)
  const amount = round2(row.amount)
  const now = Date.now()
  const existing = row.voucherId ? await ctx.db.get(row.voucherId) : null

  let voucherId: Id<'vouchers'>
  if (existing) {
    await ctx.db.patch(existing._id, {
      typeId: type._id, date, partyLedgerId: party._id, amount, status: 'final' as const, updatedAt: now,
    })
    voucherId = existing._id
    await clearLines(ctx, voucherId)
  } else {
    voucherId = await ctx.db.insert('vouchers', {
      typeId: type._id,
      voucherNo: await nextVoucherNo(ctx, type, fyOf(date)),
      fy: fyOf(date),
      date,
      partyLedgerId: party._id,
      // The drawer note it came from, so the two can always be matched up.
      refNo: `CASH-${row.entryId}`,
      narration: row.name || undefined,
      status: 'final' as const,
      amount,
      attachments: [],
      createdAt: now,
      updatedAt: now,
    })
  }

  await writeLines(ctx, voucherId, date, [
    { ledgerId: party._id, side: spec.party, amount },
    { ledgerId: drawer._id, side: spec.drawer, amount },
  ])
  if (row.voucherId !== voucherId) await ctx.db.patch(row._id, { voucherId, ledgerId: party._id })

  if (!existing) {
    await record(ctx, 'cash.post', `${spec.type} ${money(amount)} · ${party.name} · ${drawerName} on ${day(date)}`,
      { entity: 'voucher', entityId: voucherId })
  }
}

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
        // `ledgerId` and `voucherId` are the books' own columns and are not
        // sent by the phone; spreading only the note's fields leaves them be.
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
        // The books take the same note, in the same transaction as the drawer.
        await postCashEntry(ctx, row.entryId)
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


/**
 * Drawer notes the books could not take, with the reason.
 *
 * This is the small amount of work the counter cannot do: saying which account
 * a name belongs to. Everything else posts itself.
 */
export const unposted = query({
  args: {},
  handler: async (ctx) => {
    const rows = (await ctx.db.query('cashEntries').collect())
      .filter((row) => !row.deleted && !row.voucherId)
      .sort((a, b) => b.at - a.at)

    const out = []
    for (const row of rows) {
      const why = await blockedBecause(ctx, row)
      if (!why) continue
      out.push({
        _id: row._id,
        entryId: row.entryId,
        date: row.date,
        kind: row.kind,
        mode: row.mode,
        name: row.name,
        amount: row.amount,
        dealer: !!row.dealer,
        why,
      })
    }
    return out
  },
})

/**
 * Say whose a drawer note is, and post it.
 *
 * The account is remembered on the note, so a later correction at the counter
 * re-posts to the same party rather than falling back into the queue.
 */
export const assign = mutation({
  args: { entryId: v.string(), ledgerId: v.id('ledgers') },
  handler: async (ctx, { entryId, ledgerId }) => {
    const row = await ctx.db
      .query('cashEntries')
      .withIndex('by_entry_id', (q) => q.eq('entryId', entryId))
      .unique()
    if (!row) throw new Error('That drawer note is no longer here.')
    await ctx.db.patch(row._id, { ledgerId })
    await postCashEntry(ctx, entryId)

    const posted = await ctx.db
      .query('cashEntries')
      .withIndex('by_entry_id', (q) => q.eq('entryId', entryId))
      .unique()
    if (!posted?.voucherId) {
      throw new Error(await blockedBecause(ctx, posted ?? row) ?? 'The books did not take this note.')
    }
    return { voucherId: posted.voucherId }
  },
})

/**
 * Post every drawer note the books can take.
 *
 * For the notes already in the drawer before any of this existed, and for the
 * ones that were waiting on an account somebody has since opened.
 */
export const postBacklog = mutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = (await ctx.db.query('cashEntries').collect())
      .filter((row) => !row.deleted && !row.voucherId && row.amount > 0)
      .sort((a, b) => a.at - b.at)
      .slice(0, limit ?? 200)

    let posted = 0
    for (const row of rows) {
      await postCashEntry(ctx, row.entryId)
      const after = await ctx.db.get(row._id)
      if (after?.voucherId) posted++
    }
    return { looked: rows.length, posted, waiting: rows.length - posted }
  },
})

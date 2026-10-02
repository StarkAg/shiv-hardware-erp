import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { api } from './_generated/api'
import { round2, fyOf } from './lib/money'
import { findParty, findPartyIn } from './lib/parties'
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

/**
 * What blockedBecause checks against, read once per query.
 *
 * Asking the books afresh for every note read the whole account list twice a
 * note, and a queue of a few hundred notes took the query past Convex's read
 * limit — the cash page and Home then failed outright instead of listing them.
 */
type Books = { ledgers: Map<Id<'ledgers'>, Doc<'ledgers'>>; all: Doc<'ledgers'>[]; types: Set<string> }

async function readBooks(ctx: QueryCtx): Promise<Books> {
  const all = await ctx.db.query('ledgers').collect()
  const types = new Set<string>()
  for (const { type } of Object.values(CASH_KINDS)) {
    const found = await ctx.db.query('voucherTypes').withIndex('by_name', q => q.eq('name', type)).first()
    if (found) types.add(type)
  }
  return { ledgers: new Map(all.map((l) => [l._id, l])), all, types }
}

/** Why an entry has not reached the books, or null when it has nothing to say. */
function blockedBecause(books: Books, row: CashRow): string | null {
  if (row.deleted) return null
  if (!(row.amount > 0)) return 'No amount'
  const party = row.ledgerId ? books.ledgers.get(row.ledgerId) : findPartyIn(books.all, row.name)
  if (!party) return row.name.trim() ? 'No account by that name' : 'No name'
  const drawer = row.mode === 'online' ? 'Bank' : 'Cash'
  if (!books.all.some((l) => l.name === drawer)) return `No "${drawer}" account`
  if (!books.types.has(CASH_KINDS[row.kind].type)) return `No ${CASH_KINDS[row.kind].type} voucher type`
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
export async function postCashEntry(ctx: MutationCtx, entryId: string): Promise<void> {
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

function checkedBreakdown(value: unknown, total: number, bank = false): Record<string, number> | undefined {
  if (value == null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new ConvexError('Invalid count breakdown')
  const allowed = bank ? ['SBI CA', 'SBI CC', 'PNB', 'Union Bank'] : ['500', '200', '100', '50', '20', '10', '5', '2', '1']
  const counts: Record<string, number> = {}
  let sum = 0
  for (const [key, count] of Object.entries(value)) {
    if (!allowed.includes(key) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new ConvexError('Counts must be whole, non-negative numbers for the listed denominations or banks')
    }
    counts[key] = count
    sum += count * (bank ? 1 : Number(key))
  }
  if (!Number.isSafeInteger(sum) || sum !== total) throw new ConvexError('The count breakdown must match its saved total')
  return counts
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
        if (existing?.staffPaymentId) throw new Error('Manage this payment in Cashier → Staff Payments.')
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
        if (existing && !newer(existing, base.updatedAt)) { skipped++; continue }
        // Older clients may send only totals. Preserve a breakdown only while
        // its total still matches; explicit null means a manually entered total.
        const previous = existing as { counted?: number; cash?: number; online?: number; cashCounts?: Record<string, number>; bankBalances?: Record<string, number> } | null
        const cashTotal = Number(op.t === 'close' ? op.counted : op.cash) || 0
        const cashCounts = base.deleted || op.shut ? undefined : checkedBreakdown(
          op.cashCounts === undefined && cashTotal === (op.t === 'close' ? previous?.counted : previous?.cash)
            ? previous?.cashCounts : op.cashCounts,
          cashTotal,
        )
        const row = op.t === 'close'
          ? { ...base, counted: cashTotal, cashCounts, shut: !!op.shut }
          : { ...base, cash: cashTotal, cashCounts, online: Number(op.online) || 0,
              bankBalances: base.deleted ? undefined : checkedBreakdown(
                op.bankBalances === undefined && (Number(op.online) || 0) === previous?.online
                  ? previous?.bankBalances : op.bankBalances,
                Number(op.online) || 0, true,
              ) }
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
/**
 * Every note in the drawer, newest first, whatever became of it.
 *
 * The review screen only ever listed what it could not post, which answered
 * "what is stuck" and nothing else — not what came in today, not what has been
 * posted, not where the money went. A day's cash is a thing the shop reads
 * whole, so this returns the lot and lets the screen mark the few that are
 * still waiting.
 *
 * `days` bounds it, because the drawer is written every day for ever and a
 * screen does not need all of it to be useful.
 */
export const all = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const span = days ?? 30;
    const from = new Date(Date.now() - span * 86400000).toISOString().slice(0, 10);

    const rows = (await ctx.db.query('cashEntries').collect())
      .filter((row) => !row.deleted && row.date >= from)
      .sort((a, b) => (a.date === b.date ? b.at - a.at : b.date.localeCompare(a.date)))

    const books = await readBooks(ctx)
    const out = []
    for (const row of rows) {
      // Only asked of a note that has not posted — there is nothing it could
      // tell us about one that already has.
      const why = row.voucherId ? null : blockedBecause(books, row)
      const party = row.ledgerId ? books.ledgers.get(row.ledgerId) : null
      out.push({
        _id: row._id,
        entryId: row.entryId,
        date: row.date,
        kind: row.kind,
        mode: row.mode,
        name: row.name,
        amount: row.amount,
        dealer: !!row.dealer,
        posted: !!row.voucherId,
        party: party?.name ?? null,
        why,
      })
    }
    return out
  },
})

/**
 * One day in the drawer: what came in, what went out, and nothing else.
 *
 * A day at a time rather than a span, because that is how the cash register is
 * read and how the evening count is checked — the question is always "what
 * happened today", and yesterday is one step back, not a filter.
 *
 * `near` is what lets the arrows know when to stop: the first and last day the
 * drawer has anything written on, so paging cannot wander off into empty dates.
 */
/**
 * What the drawer and the bank hold at the START of a day.
 *
 * Mirrors the rule the cash book itself uses (cash-web's `anchorFor` /
 * `balanceOpen`), because the two are views of one drawer and must not
 * disagree: start from the most recent figure that is KNOWN rather than
 * inferred — an opening somebody typed, or, for cash, a drawer somebody
 * counted — then roll every entry since it forward.
 *
 * A counted drawer beats a typed opening on the same date, because the count
 * happened at the end of that day and the opening at the start of it. A day
 * the shop never opened still anchors: `shutDay` writes the book balance into
 * `counted`, so a shut Sunday carries Saturday's notes into Monday rather
 * than wiping them.
 *
 * Without this the panel opened every day at nothing, so a drawer still
 * holding yesterday's cash read as tens of thousands "more in the drawer than
 * there should be" every single morning.
 */
function openingFor(
  entries: { date: string; mode: string; kind: string; amount: number }[],
  closes: { date: string; counted: number }[],
  openings: { date: string; cash: number; online: number }[],
  date: string,
  mode: 'cash' | 'online'
): number {
  let anchor: { date: string; value: number; startOfDay: boolean } | null = null

  for (const o of openings) {
    if (o.date > date) continue
    if (!anchor || o.date > anchor.date) {
      anchor = { date: o.date, value: mode === 'cash' ? o.cash : o.online, startOfDay: true }
    }
  }
  // Only cash is ever counted; the bank has nothing to count against, so the
  // book stands for it.
  if (mode === 'cash') {
    for (const c of closes) {
      if (c.date >= date) continue
      if (!anchor || c.date >= anchor.date) {
        anchor = { date: c.date, value: c.counted, startOfDay: false }
      }
    }
  }

  let balance = anchor ? anchor.value : 0
  for (const e of entries) {
    if (e.mode !== mode || e.date >= date) continue
    // Entries already inside the anchor are not added twice: a typed opening
    // is the start of its day, so that day's own entries still count; a count
    // is the end of its day, so they do not.
    if (anchor && (anchor.startOfDay ? e.date < anchor.date : e.date <= anchor.date)) continue
    balance += e.kind === 'in' ? e.amount : -e.amount
  }
  return balance
}

export const forDay = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const live = (await ctx.db.query('cashEntries').collect()).filter((row) => !row.deleted)

    const rows = live.filter((row) => row.date === date).sort((a, b) => a.at - b.at)

    /**
     * Cash and bank are counted apart, because only one of them is in the
     * drawer. Adding a phone transfer to the notes in the till gives a figure
     * that matches nothing anybody can count at the end of the day, which is
     * the one thing this page exists to do.
     */
    const cash = { opening: 0, in: 0, out: 0, expected: 0 }
    const bank = { opening: 0, in: 0, out: 0, closing: 0 }
    for (const row of rows) {
      const side = row.mode === 'online' ? bank : cash
      if (row.kind === 'in') side.in += row.amount
      else side.out += row.amount
    }

    const opening = await ctx.db
      .query('cashOpenings')
      .withIndex('by_date', (q) => q.eq('date', date))
      .first()
    const setHere = opening && !opening.deleted ? opening : null

    // Yesterday's closing is today's opening. An opening typed against this
    // very day still wins — somebody counted the drawer and said so.
    const allOpenings = (await ctx.db.query('cashOpenings').collect()).filter((r) => !r.deleted)
    const allCloses = (await ctx.db.query('cashCloses').collect()).filter((r) => !r.deleted)
    cash.opening = setHere ? setHere.cash : openingFor(live, allCloses, allOpenings, date, 'cash')
    bank.opening = setHere ? setHere.online : openingFor(live, allCloses, allOpenings, date, 'online')
    cash.expected = cash.opening + cash.in - cash.out
    bank.closing = bank.opening + bank.in - bank.out

    const closeRow = await ctx.db
      .query('cashCloses')
      .withIndex('by_date', (q) => q.eq('date', date))
      .first()
    const close =
      closeRow && !closeRow.deleted
        ? { counted: closeRow.counted, shut: !!closeRow.shut, at: closeRow.at }
        : null

    const dates = live.map((row) => row.date).sort()

    return {
      date,
      rows: rows.map((row) => ({
        entryId: row.entryId,
        kind: row.kind,
        mode: row.mode,
        name: row.name,
        amount: row.amount,
        dealer: !!row.dealer,
        at: row.at,
      })),
      cash,
      bank,
      close,
      // What the drawer is over or short by. Null until somebody has counted:
      // an uncounted day is not a day that balanced.
      difference: close && !close.shut ? close.counted - cash.expected : null,
      // A figure carried from the last known drawer counts as an opening: the
      // dash is for a book with nothing behind it, not for a quiet morning.
      hasOpening: !!setHere || cash.opening !== 0 || bank.opening !== 0,
      count: rows.length,
      near: { first: dates[0] ?? null, last: dates[dates.length - 1] ?? null },
    }
  },
})

/** What the drawer did over the days on screen: in, out, and what is stuck. */
export const totals = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const span = days ?? 30;
    const from = new Date(Date.now() - span * 86400000).toISOString().slice(0, 10);
    const rows = (await ctx.db.query('cashEntries').collect())
      .filter((row) => !row.deleted && row.date >= from)

    let inn = 0, out = 0, waiting = 0
    for (const row of rows) {
      if (row.kind === 'in') inn += row.amount
      else out += row.amount
      if (!row.voucherId) waiting += 1
    }
    return { in: inn, out, net: inn - out, waiting, count: rows.length }
  },
})

export const unposted = query({
  args: {},
  handler: async (ctx) => {
    const rows = (await ctx.db.query('cashEntries').collect())
      .filter((row) => !row.deleted && !row.voucherId)
      .sort((a, b) => b.at - a.at)

    const books = await readBooks(ctx)
    const out = []
    for (const row of rows) {
      const why = blockedBecause(books, row)
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
    if (row.staffPaymentId) throw new Error('Manage this payment in Cashier → Staff Payments.')
    await ctx.db.patch(row._id, { ledgerId })
    await postCashEntry(ctx, entryId)

    const posted = await ctx.db
      .query('cashEntries')
      .withIndex('by_entry_id', (q) => q.eq('entryId', entryId))
      .unique()
    if (!posted?.voucherId) {
      throw new Error(blockedBecause(await readBooks(ctx), posted ?? row) ?? 'The books did not take this note.')
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

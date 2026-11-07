import { internalMutation } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import { mutation, query } from './lib/guarded'
import { v } from 'convex/values'
import { internal } from './_generated/api'
import { nextVoucherPhotoNo } from './lib/numbering'
import { deleteUnreferencedFiles } from './lib/attachmentFiles'

/**
 * How long after a photo lands before the AI reads its bill. A bill of three
 * sheets is shot as three photos a few seconds apart, and reading after the
 * first would read a bill with its total missing. Each page schedules its own
 * read; only the one after the last page finds the bill quiet and reads it.
 */
const READ_AFTER_MS = 15_000
const QUIET_MS = 12_000

/** What a tile and the bill form are told about a reading. */
function readOf(row: any) {
  if (!row) return undefined
  return { status: row.status, pages: row.pages, error: row.error, ...(row.draft ?? {}) }
}

/** Photos waiting for the voucher editor, separate from the sorting backlog. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('voucherInbox').withIndex('by_at').order('desc').collect()
    const reads = new Map((await ctx.db.query('voucherReads').collect()).map((r) => [r.groupId, r]))
    return Promise.all(rows.map(async (row) => ({
      _id: row._id,
      storageId: row.storageId,
      groupId: row.groupId,
      queueNo: row.queueNo,
      at: row.at,
      url: await ctx.storage.getUrl(row.storageId),
      read: readOf(reads.get(row.groupId)),
    })))
  },
})

async function groupRows(ctx: QueryCtx, groupId: string) {
  return (await ctx.db.query('voucherInbox').withIndex('by_group', (q) => q.eq('groupId', groupId)).collect())
    .sort((a, b) => a.at - b.at)
}

async function readRow(ctx: QueryCtx, groupId: string) {
  return ctx.db.query('voucherReads').withIndex('by_group', (q) => q.eq('groupId', groupId)).unique()
}

/** A bill whose photos have all gone (filed, split or thrown away) has no reading either. */
async function dropReadIfEmpty(ctx: MutationCtx, groupId: string) {
  if ((await groupRows(ctx, groupId)).length) return
  const read = await readRow(ctx, groupId)
  if (read) await ctx.db.delete(read._id)
}

export const add = mutation({
  args: { storageId: v.id('_storage'), groupId: v.string() },
  handler: async (ctx, { storageId, groupId }) => {
    if (!groupId.trim()) throw new Error('This bill photo needs a bill group.')
    const file = await ctx.db.system.get(storageId)
    if (!file) throw new Error('The uploaded bill photo was not found.')
    if (file.contentType && !file.contentType.startsWith('image/')) {
      throw new Error('Upload a bill photo as an image.')
    }
    const queueNo = await nextVoucherPhotoNo(ctx)
    const id = await ctx.db.insert('voucherInbox', { storageId, groupId, queueNo, at: Date.now() })
    await ctx.scheduler.runAfter(READ_AFTER_MS, internal.ai.readVoucher, { groupId })
    return id
  },
})

/** Assign numbers to photos that arrived before queue numbering was added. */
export const numberExisting = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('voucherInbox').withIndex('by_at').order('asc').collect()
    let numbered = 0
    for (const row of rows) {
      if (row.queueNo !== undefined) continue
      await ctx.db.patch(row._id, { queueNo: await nextVoucherPhotoNo(ctx) })
      numbered += 1
    }
    return numbered
  },
})

/** The bill now owns the stored file; remove only its waiting row. */
export const claim = mutation({
  args: { id: v.id('voucherInbox') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (!row) return
    await ctx.db.delete(id)
    await dropReadIfEmpty(ctx, row.groupId)
  },
})

/**
 * Every photo a saved bill took, off both queues in one go. One at a time,
 * each its own round trip, a bill of several pages left the last of them
 * under From the phone for seconds after Save. A row already gone (claimed
 * from another counter) is no failure: it is off the queue, which is the point.
 */
export const claimAll = mutation({
  args: { ids: v.array(v.id('voucherInbox')), legacyIds: v.optional(v.array(v.id('inbox'))) },
  handler: async (ctx, { ids, legacyIds = [] }) => {
    const groups = new Set<string>()
    for (const id of ids) {
      const row = await ctx.db.get(id)
      if (!row) continue
      groups.add(row.groupId)
      await ctx.db.delete(id)
    }
    for (const id of legacyIds) {
      if (await ctx.db.get(id)) await ctx.db.delete(id)
    }
    for (const groupId of groups) await dropReadIfEmpty(ctx, groupId)
  },
})

/**
 * Pages shot as one bill that are really separate bills: each gets a group of
 * its own, so each waits as its own photo to be filed against its own voucher.
 * Each is read again on its own; the reading of them together is dropped.
 */
export const split = mutation({
  args: { ids: v.array(v.id('voucherInbox')) },
  handler: async (ctx, { ids }) => {
    const old = new Set<string>()
    for (const id of ids) {
      const row = await ctx.db.get(id)
      if (!row) continue
      old.add(row.groupId)
      const groupId = `${row.groupId}~${id}`
      await ctx.db.patch(id, { groupId })
      await ctx.scheduler.runAfter(0, internal.ai.readVoucher, { groupId, force: true })
    }
    for (const groupId of old) {
      const read = await readRow(ctx, groupId)
      if (read) await ctx.db.delete(read._id)
      // Pages left behind in the old group are a bill of their own now.
      if ((await groupRows(ctx, groupId)).length) {
        await ctx.scheduler.runAfter(0, internal.ai.readVoucher, { groupId, force: true })
      }
    }
  },
})

export const discard = mutation({
  args: { id: v.id('voucherInbox') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (!row) return
    await ctx.db.delete(id)
    await deleteUnreferencedFiles(ctx, [row.storageId])
    await dropReadIfEmpty(ctx, row.groupId)
  },
})

/** "Read again" on a tile: a failed or wrong reading is put through once more. */
export const readAgain = mutation({
  args: { groupId: v.string() },
  handler: async (ctx, { groupId }) => {
    if (!(await groupRows(ctx, groupId)).length) return
    const read = await readRow(ctx, groupId)
    if (read) await ctx.db.patch(read._id, { status: 'reading', error: undefined, at: Date.now() })
    await ctx.scheduler.runAfter(0, internal.ai.readVoucher, { groupId, force: true })
  },
})

/**
 * Bills already waiting when the reader was switched on, or whose reading
 * failed: each is read, a few seconds apart so a long queue does not meet a
 * rate limit. Run once from the command line: npx convex run voucherInbox:readBacklog
 */
export const readBacklog = internalMutation({
  args: { failedToo: v.optional(v.boolean()) },
  handler: async (ctx, { failedToo }) => {
    const rows = await ctx.db.query('voucherInbox').collect()
    const reads = new Map((await ctx.db.query('voucherReads').collect()).map((r) => [r.groupId, r]))
    const groups = [...new Set(rows.map((r) => r.groupId))].filter((g) => {
      const read = reads.get(g)
      return !read || (failedToo && read.status === 'failed')
    })
    groups.forEach((groupId, i) => {
      void ctx.scheduler.runAfter(i * 4_000, internal.ai.readVoucher, { groupId, force: true })
    })
    return groups.length
  },
})

/* ------------------------------------------------------------------ */
/* the reading itself (convex/ai.ts readVoucher)                       */
/* ------------------------------------------------------------------ */

/**
 * Starts a reading: the page URLs, or null when there is nothing to do —
 * the bill is gone, a page landed too recently (that page's own read will
 * come), or it was already read with every page it has now.
 */
export const startRead = internalMutation({
  args: { groupId: v.string(), force: v.optional(v.boolean()) },
  handler: async (ctx, { groupId, force }) => {
    const rows = await groupRows(ctx, groupId)
    if (!rows.length) return null
    const now = Date.now()
    if (!force && now - rows[rows.length - 1].at < QUIET_MS) return null
    const read = await readRow(ctx, groupId)
    if (!force && read && read.pages === rows.length && read.status !== 'failed') return null
    const pages: string[] = []
    for (const row of rows) {
      const url = await ctx.storage.getUrl(row.storageId)
      if (url) pages.push(url)
    }
    if (!pages.length) return null
    const fields = { groupId, pages: rows.length, status: 'reading' as const, error: undefined, at: now }
    if (read) await ctx.db.patch(read._id, fields)
    else await ctx.db.insert('voucherReads', fields)
    return { pages }
  },
})

/** Lower case, no M/s, no jee, letters and digits only: how two spellings are compared. */
function fold(name: string) {
  return name
    .toLowerCase()
    .replace(/^\s*m\s*\/?\s*s\.?\s+/, '')
    .replace(/\b(jee|ji)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const MONEY = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null)

/**
 * Saves what the AI read, with the party put on an account of the books when
 * the name is one (the reader returns listed names as "Name (Place)").
 */
export const saveRead = internalMutation({
  args: { groupId: v.string(), pages: v.number(), draft: v.any() },
  handler: async (ctx, { groupId, pages, draft }) => {
    const read = await readRow(ctx, groupId)
    if (!read) return
    const d = draft ?? {}
    const groups = await ctx.db.query('groups').collect()
    const side = new Map<string, 'customer' | 'supplier'>()
    for (const g of groups) {
      if (g.name === 'Sundry Debtors') side.set(g._id as string, 'customer')
      if (g.name === 'Sundry Creditors') side.set(g._id as string, 'supplier')
    }
    const ledgers = (await ctx.db.query('ledgers').collect()).filter((l) => l.active && side.has(l.groupId as string))
    const said = String(d.party ?? '').trim()
    const want = fold(said)
    const wantBare = fold(said.replace(/\s*\([^)]*\)\s*$/, ''))
    const account = want
      ? ledgers.find((l) => fold(l.place ? `${l.name} (${l.place})` : l.name) === want)
        ?? ledgers.find((l) => fold(l.name) === want)
        ?? ledgers.find((l) => fold(l.name) === wantBare)
      : undefined
    const kinds = ['sale', 'purchase', 'receipt', 'payment']
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(d.date ?? '')) ? String(d.date) : ''
    await ctx.db.patch(read._id, {
      pages,
      status: 'ready',
      error: undefined,
      at: Date.now(),
      draft: {
        kind: kinds.includes(d.kind) ? d.kind : 'unclear',
        party: account ? account.name : said.replace(/\s*\([^)]*\)\s*$/, ''),
        account: account ? side.get(account.groupId as string) : undefined,
        date,
        refNo: String(d.refNo ?? '').trim(),
        total: MONEY(d.total),
        paid: MONEY(d.paid),
        goodsReturn: MONEY(d.goodsReturn),
        settlement: ['on_account', 'settled'].includes(d.settlement) ? d.settlement : 'unknown',
        continuation: !!d.isContinuation,
        notes: String(d.notes ?? '').slice(0, 200),
        confidence: typeof d.confidence === 'number' ? d.confidence : null,
      },
    })
  },
})

export const failRead = internalMutation({
  args: { groupId: v.string(), error: v.string() },
  handler: async (ctx, { groupId, error }) => {
    const read = await readRow(ctx, groupId)
    if (read) await ctx.db.patch(read._id, { status: 'failed', error: error.slice(0, 300), at: Date.now() })
  },
})

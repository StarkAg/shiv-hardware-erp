/**
 * The chain on the books' history: beginning it, and checking it.
 *
 * Every history line is sealed as it is written (lib/history.ts `record`,
 * lib/seal.ts). This file is the rest:
 *
 *   - `begin` seals what was there before the chain existed, oldest first,
 *     then writes down every voucher as it stands that day. Run once:
 *     `npx convex run chain:begin --prod`. It proves nothing about the past;
 *     the books are sealed as they stood on the day it ran.
 *   - `verify` walks the chain from the first line to the last, making each
 *     fingerprint again, then compares every voucher with the last line
 *     written about it. It runs every night, and from "Check the books" on
 *     the History screen (`check`). What it found is a row in `chainChecks`.
 *   - `accept` writes a new sealed line for vouchers the check found changed,
 *     once someone has looked and is satisfied. It needs the PIN.
 *
 * The chain tells where it was broken; it cannot stop someone able to rewrite
 * the whole table from writing a new one. The answer to that is a copy of the
 * latest fingerprint kept elsewhere: each check keeps it in `chainChecks`,
 * which the nightly backup carries out of this database.
 */
import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { mutation, query } from './lib/guarded'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { GENESIS, chainHead, nextSeal, sealOf, voucherState, type Sealed } from './lib/seal'
import { record } from './lib/history'
import { requirePin } from './lib/pin'

const OLD_BATCH = 200
const VOUCHER_BATCH = 100
/** How many changed vouchers a check names; it counts them all. */
const NAMED = 50

// ── Beginning the chain ─────────────────────────────────────────────────────
/** Seals the lines written before the chain existed, oldest first, a batch at a time. */
export const sealOld = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('history').withIndex('by_seq', (q) => q.eq('seq', undefined)).take(OLD_BATCH)
    for (const row of rows) {
      await ctx.db.patch(row._id, await nextSeal(ctx, {
        at: row.at, action: row.action, summary: row.summary,
        entity: row.entity, entityId: row.entityId, detail: row.detail, state: row.state,
      }))
    }
    if (rows.length === OLD_BATCH) await ctx.scheduler.runAfter(0, internal.chain.sealOld, {})
    else await ctx.scheduler.runAfter(0, internal.chain.sealVouchers, { cursor: null })
    return { sealed: rows.length, more: rows.length === OLD_BATCH }
  },
})

/** Writes down every voucher no sealed line speaks for yet, as it stands now. */
export const sealVouchers = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('vouchers').paginate({ cursor, numItems: VOUCHER_BATCH })
    let sealed = 0
    for (const voucher of page.page) {
      if (await lastSealedState(ctx, voucher._id)) continue
      await record(ctx, 'chain.seal', 'Sealed as it stood', { entity: 'voucher', entityId: voucher._id, quiet: true })
      sealed += 1
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.chain.sealVouchers, { cursor: page.continueCursor })
    return { sealed, done: page.isDone }
  },
})

/** Begins the chain on books that have a history already. Safe to run again: it only seals what is not. */
export const begin = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.scheduler.runAfter(0, internal.chain.sealOld, {})
    await record(ctx, 'chain.begin', 'The history was sealed into a chain')
  },
})

/** The fingerprint of a voucher in the last sealed line written about it, if any. */
async function lastSealedState(ctx: { db: any }, id: Id<'vouchers'>): Promise<string | null> {
  const lines = await ctx.db
    .query('history')
    .withIndex('by_entity', (q: any) => q.eq('entityId', String(id)))
    .order('desc')
    .take(8)
  return lines.find((line: any) => line.seq !== undefined && line.state)?.state ?? null
}

// ── Checking it ─────────────────────────────────────────────────────────────
/** Sealed lines after a place in the chain, in order. */
export const page = internalQuery({
  args: { after: v.number(), take: v.number() },
  handler: async (ctx, { after, take }) => {
    const rows = await ctx.db.query('history').withIndex('by_seq', (q) => q.gt('seq', after)).take(take)
    return rows.map((r) => ({
      seq: r.seq!, at: r.at, action: r.action, summary: r.summary,
      entity: r.entity ?? null, entityId: r.entityId ?? null, detail: r.detail ?? null, state: r.state ?? null,
      prev: r.prev ?? '', hash: r.hash ?? '',
    }))
  },
})

/** How many lines are not sealed yet (counted up to a few thousand). */
export const unsealed = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query('history').withIndex('by_seq', (q) => q.eq('seq', undefined)).take(4000)).length,
})

/** A page of vouchers: each as it stands now, beside what its last sealed line said. */
export const voucherPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const found = await ctx.db.query('vouchers').paginate({ cursor, numItems: VOUCHER_BATCH })
    const types = new Map((await ctx.db.query('voucherTypes').collect()).map((t) => [t._id, t.abbr]))
    const rows = []
    for (const voucher of found.page) {
      rows.push({
        voucherId: String(voucher._id),
        label: `${types.get(voucher.typeId) ?? 'VCH'}-${String(voucher.voucherNo).padStart(4, '0')}`,
        now: await voucherState(ctx, voucher._id),
        sealed: await lastSealedState(ctx, voucher._id),
      })
    }
    return { rows, cursor: found.continueCursor, done: found.isDone }
  },
})

const finding = {
  ok: v.boolean(),
  entries: v.number(),
  unsealed: v.number(),
  headSeq: v.number(),
  head: v.string(),
  brokenAt: v.optional(v.object({ seq: v.number(), at: v.number(), summary: v.string(), why: v.string() })),
  vouchers: v.number(),
  vouchersUnsealed: v.number(),
  changed: v.array(v.object({ voucherId: v.string(), label: v.string() })),
  changedCount: v.number(),
  tookMs: v.number(),
}

/** Writes down what a check found: onto its own row when begun by hand, a new one otherwise. */
export const saveCheck = internalMutation({
  args: {
    checkId: v.optional(v.id('chainChecks')),
    by: v.union(v.literal('hand'), v.literal('night')),
    found: v.optional(v.object(finding)),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { checkId, by, found, error }) => {
    const row = { at: Date.now(), by, running: false, ...(found ?? { ok: false }), ...(error ? { error } : {}) }
    if (checkId && (await ctx.db.get(checkId))) await ctx.db.patch(checkId, row)
    else await ctx.db.insert('chainChecks', row)
  },
})

/**
 * Walks the whole chain, then the vouchers.
 *
 * A line is right when it is the next in number, joins on to the fingerprint
 * of the line before it, and its own fingerprint is what its contents make.
 * The first line that is not is where the chain was broken: a line changed, a
 * line taken out, or one put in. Only the first is named: everything after a
 * break fails with it.
 */
export const verify = internalAction({
  args: { by: v.union(v.literal('hand'), v.literal('night')), checkId: v.optional(v.id('chainChecks')) },
  handler: async (ctx, { by, checkId }) => {
    const started = Date.now()
    try {
      let after = 0
      let expect = 1
      let prev = GENESIS
      let entries = 0
      let brokenAt: { seq: number; at: number; summary: string; why: string } | undefined
      for (;;) {
        const rows: (Sealed & { hash: string })[] = await ctx.runQuery(internal.chain.page, { after, take: 1000 })
        if (!rows.length) break
        for (const row of rows) {
          if (!brokenAt) {
            const why = row.seq !== expect
              ? (row.seq - expect === 1 ? `Line ${expect} is missing` : `Lines ${expect} to ${row.seq - 1} are missing`)
              : row.prev !== prev ? 'It does not join on to the line before it'
              : sealOf(row) !== row.hash ? 'It has been changed since it was sealed'
              : ''
            if (why) brokenAt = { seq: row.seq, at: row.at, summary: row.summary, why }
          }
          prev = row.hash
          expect = row.seq + 1
          entries += 1
        }
        after = rows[rows.length - 1].seq
      }

      let cursor: string | null = null
      let vouchers = 0
      let vouchersUnsealed = 0
      let changedCount = 0
      const changed: { voucherId: string; label: string }[] = []
      for (;;) {
        const found: { rows: { voucherId: string; label: string; now: string | null; sealed: string | null }[]; cursor: string; done: boolean } =
          await ctx.runQuery(internal.chain.voucherPage, { cursor })
        for (const row of found.rows) {
          if (!row.sealed) { vouchersUnsealed += 1; continue }
          vouchers += 1
          if (row.now !== row.sealed) {
            changedCount += 1
            if (changed.length < NAMED) changed.push({ voucherId: row.voucherId, label: row.label })
          }
        }
        if (found.done) break
        cursor = found.cursor
      }

      const unsealed: number = await ctx.runQuery(internal.chain.unsealed, {})
      await ctx.runMutation(internal.chain.saveCheck, {
        checkId, by,
        found: {
          ok: !brokenAt && changedCount === 0,
          entries, unsealed, headSeq: expect - 1, head: prev,
          ...(brokenAt ? { brokenAt } : {}),
          vouchers, vouchersUnsealed, changed, changedCount,
          tookMs: Date.now() - started,
        },
      })
    } catch (err) {
      await ctx.runMutation(internal.chain.saveCheck, { checkId, by, error: err instanceof Error ? err.message : String(err) })
    }
  },
})

/** "Check the books": begins a check and says which row its answer will be on. */
export const check = mutation({
  args: {},
  handler: async (ctx) => {
    const last = await ctx.db.query('chainChecks').withIndex('by_at').order('desc').first()
    // One already on its way answers for both.
    if (last?.running && Date.now() - last.at < 2 * 60_000) return last._id
    const checkId = await ctx.db.insert('chainChecks', { at: Date.now(), by: 'hand', running: true })
    await ctx.scheduler.runAfter(0, internal.chain.verify, { by: 'hand', checkId })
    return checkId
  },
})

/** What the History screen shows: the last check that finished, and whether one is running. */
export const latest = query({
  args: {},
  handler: async (ctx) => {
    const recent = await ctx.db.query('chainChecks').withIndex('by_at').order('desc').take(6)
    const head = await chainHead(ctx)
    return {
      running: !!recent[0]?.running && Date.now() - recent[0].at < 2 * 60_000,
      last: recent.find((row) => !row.running) ?? null,
      sealed: head?.seq ?? 0,
    }
  },
})

/**
 * Vouchers the check found changed, accepted as they stand: each gets a new
 * sealed line saying so, which is what the next check compares it with. For
 * when the change is known and right (accounts merged, a repair). The PIN is
 * asked, and the line stays in the history for good.
 */
export const accept = mutation({
  args: { pin: v.string(), voucherIds: v.array(v.string()) },
  handler: async (ctx, { pin, voucherIds }) => {
    requirePin(pin)
    let accepted = 0
    for (const raw of voucherIds.slice(0, 200)) {
      const id = ctx.db.normalizeId('vouchers', raw)
      const voucher = id ? await ctx.db.get(id) : null
      if (!voucher) continue
      const type = await ctx.db.get(voucher.typeId)
      const label = `${type?.abbr ?? 'VCH'}-${String(voucher.voucherNo).padStart(4, '0')}`
      await record(ctx, 'chain.accept', `${label} accepted as it stands after a check found it changed`, { entity: 'voucher', entityId: voucher._id })
      accepted += 1
    }
    return { accepted }
  },
})

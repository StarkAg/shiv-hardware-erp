/// <reference types="vite/client" />
/**
 * The drawer: what is kept, what each day opens with, and the counts.
 */
import { convexTest } from './trustedConvex'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

async function shop() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    const debtors = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const inHand = await ctx.db.insert('groups', { name: 'Cash-in-Hand', nature: 'asset', normalSide: 'Dr', sort: 1 })
    const base = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    const cashId = await ctx.db.insert('ledgers', { ...base, name: 'Cash', groupId: inHand })
    const bankId = await ctx.db.insert('ledgers', { ...base, name: 'Bank', groupId: inHand })
    const partyId = await ctx.db.insert('ledgers', { ...base, name: 'Ramesh Kumar', groupId: debtors })
    await ctx.db.insert('voucherTypes', { name: 'Receipt', abbr: 'RCT', sort: 0 })
    await ctx.db.insert('voucherTypes', { name: 'Payment', abbr: 'PAY', sort: 1 })
    return { cashId, bankId, partyId }
  })
  return { t, ...ids }
}

const note = (over: Record<string, unknown> = {}) => ({
  t: 'entry',
  entryId: 'e1',
  date: '2026-09-11',
  kind: 'in',
  mode: 'cash',
  name: 'Ramesh Kumar',
  amount: 4000,
  at: 1_000,
  // Fixed, and always increasing between writes: the sync settles conflicts by
  // this, so a later note has to carry a later stamp.
  updatedAt: 1_000,
  ...over,
})

const lines = (t: ReturnType<typeof convexTest>) =>
  t.run(ctx => ctx.db.query('voucherEntries').collect())
const vouchers = (t: ReturnType<typeof convexTest>) =>
  t.run(ctx => ctx.db.query('vouchers').collect())

/**
 * The cash book stays out of the books (the shop's call, 2026-10-04): a note
 * at the counter is a note in the cash book and nothing in the ledger.
 */
describe('drawer notes stay out of the books', () => {
  it('writes no voucher for a note, in or out, cash or online', async () => {
    const { t } = await shop()
    await t.mutation(api.cash.push, { ops: [
      note(),
      note({ entryId: 'e2', kind: 'out', amount: 700 }),
      note({ entryId: 'e3', mode: 'online', amount: 300 }),
    ] })
    expect(await vouchers(t)).toHaveLength(0)
    expect(await lines(t)).toHaveLength(0)
    expect(await t.run(ctx => ctx.db.query('cashEntries').collect())).toHaveLength(3)
  })

  it('takes a note posted before the separation back out when it is next touched', async () => {
    const { t, cashId, partyId } = await shop()
    await t.mutation(api.cash.push, { ops: [note()] })
    // A voucher from before 2026-10-04, still linked to its note.
    await t.run(async ctx => {
      const type = (await ctx.db.query('voucherTypes').first())!
      const voucherId = await ctx.db.insert('vouchers', {
        typeId: type._id, voucherNo: 1, fy: '2026-27', date: Date.parse('2026-09-11'), partyLedgerId: partyId,
        refNo: 'CASH-e1', status: 'final', amount: 4000, attachments: [], createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('voucherEntries', { voucherId, ledgerId: cashId, side: 'Dr', amount: 4000, date: 1 } as any)
      const row = (await ctx.db.query('cashEntries').first())!
      await ctx.db.patch(row._id, { voucherId })
    })
    await t.mutation(api.cash.push, { ops: [note({ amount: 4500, updatedAt: 2_000 })] })
    expect(await vouchers(t)).toHaveLength(0)
    expect(await t.run(ctx => ctx.db.query('trash').collect())).toHaveLength(1)
  })
})

/**
 * Yesterday's closing is today's opening.
 *
 * The panel used to open every day at nothing, so a drawer still holding
 * yesterday's notes read as tens of thousands over.
 */
describe('what the drawer opens with', () => {
  const entry = (date: string, kind: 'in' | 'out', amount: number, mode = 'cash') => ({
    entryId: `${date}-${kind}-${amount}-${mode}`,
    date, kind, mode, name: 'x', amount, at: 1, updatedAt: 1,
  })

  const day = (t: ReturnType<typeof convexTest>, date: string) =>
    t.query(api.cash.forDay, { date } as never)

  it('carries a counted drawer into the next day', async () => {
    const { t } = await shop()
    await t.run(async (ctx) => {
      await ctx.db.insert('cashEntries', entry('2026-09-18', 'in', 5000) as never)
      await ctx.db.insert('cashCloses', { date: '2026-09-18', counted: 5000, at: 1, updatedAt: 1 })
      await ctx.db.insert('cashEntries', entry('2026-09-19', 'in', 300) as never)
    })
    const d = await day(t, '2026-09-19')
    expect(d.cash.opening).toBe(5000)
    expect(d.cash.expected).toBe(5300)
    expect(d.hasOpening).toBe(true)
  })

  it('a count beats the book, so a short drawer is not carried twice', async () => {
    const { t } = await shop()
    await t.run(async (ctx) => {
      // The book says 5,000; only 4,000 was actually there.
      await ctx.db.insert('cashEntries', entry('2026-09-18', 'in', 5000) as never)
      await ctx.db.insert('cashCloses', { date: '2026-09-18', counted: 4000, at: 1, updatedAt: 1 })
    })
    expect((await day(t, '2026-09-19')).cash.opening).toBe(4000)
  })

  it('rolls entries forward across an uncounted day', async () => {
    const { t } = await shop()
    await t.run(async (ctx) => {
      await ctx.db.insert('cashOpenings', { date: '2026-09-17', cash: 1000, online: 0, at: 1, updatedAt: 1 })
      await ctx.db.insert('cashEntries', entry('2026-09-17', 'in', 500) as never)
      // Nobody counted the 18th.
      await ctx.db.insert('cashEntries', entry('2026-09-18', 'out', 200) as never)
    })
    expect((await day(t, '2026-09-19')).cash.opening).toBe(1300)
  })

  it('a shut day carries the drawer through, it does not wipe it', async () => {
    const { t } = await shop()
    await t.run(async (ctx) => {
      await ctx.db.insert('cashEntries', entry('2026-09-18', 'in', 5000) as never)
      // shutDay writes the book balance into counted, so it still anchors.
      await ctx.db.insert('cashCloses', { date: '2026-09-19', counted: 5000, at: 1, updatedAt: 1, shut: true })
    })
    expect((await day(t, '2026-09-20')).cash.opening).toBe(5000)
  })

  it('an opening typed for the day itself wins', async () => {
    const { t } = await shop()
    await t.run(async (ctx) => {
      await ctx.db.insert('cashCloses', { date: '2026-09-18', counted: 5000, at: 1, updatedAt: 1 })
      await ctx.db.insert('cashOpenings', { date: '2026-09-19', cash: 60, online: 0, at: 1, updatedAt: 1 })
    })
    expect((await day(t, '2026-09-19')).cash.opening).toBe(60)
  })

  it('the bank carries on the book, having nothing to count', async () => {
    const { t } = await shop()
    await t.run(async (ctx) => {
      await ctx.db.insert('cashEntries', entry('2026-09-18', 'in', 900, 'online') as never)
      // A counted drawer says nothing about the bank.
      await ctx.db.insert('cashCloses', { date: '2026-09-18', counted: 0, at: 1, updatedAt: 1 })
    })
    const d = await day(t, '2026-09-19')
    expect(d.bank.opening).toBe(900)
    expect(d.cash.opening).toBe(0)
  })

  it('still shows a dash for a book with nothing behind it', async () => {
    const { t } = await shop()
    expect((await day(t, '2026-09-19')).hasOpening).toBe(false)
  })
})

describe('saved cash counts', () => {
  const closing = { t: 'close', date: '2026-09-23', counted: 1205, cashCounts: { '500': 2, '200': 1, '5': 1, '1': 0 }, at: 1000, updatedAt: 1000 }

  it('syncs denomination and bank breakdowns to a fresh device and keeps retries idempotent', async () => {
    const { t } = await shop()
    const opening = { t: 'opening', date: closing.date, cash: 1205, online: 3000, cashCounts: closing.cashCounts, bankBalances: { 'SBI CA': 1000, PNB: 2000 }, at: 1000, updatedAt: 1000 }
    await t.mutation(api.cash.push, { ops: [closing, opening] })
    await t.mutation(api.cash.push, { ops: [closing, opening] })
    const pulled = await t.query(api.cash.pull, {})
    expect(pulled.closes).toHaveLength(1)
    expect(pulled.closes[0]).toMatchObject({ counted: 1205, cashCounts: closing.cashCounts })
    expect(pulled.openings[0]).toMatchObject({ cashCounts: closing.cashCounts, bankBalances: opening.bankBalances })
  })

  it('rejects totals that disagree with their counts without saving a partial batch', async () => {
    const { t } = await shop()
    await expect(t.mutation(api.cash.push, { ops: [closing, { ...closing, date: '2026-09-24', counted: 999 }] })).rejects.toThrow('match its saved total')
    expect((await t.query(api.cash.pull, {})).closes).toHaveLength(0)
    for (const cashCounts of [{ '500': -1 }, { '500': 1.5 }, { '999': 1 }, ['500']]) {
      await expect(t.mutation(api.cash.push, { ops: [{ ...closing, cashCounts }] })).rejects.toThrow()
    }
  })

  it('keeps breakdowns from older clients only while totals match, and clears manually replaced counts', async () => {
    const { t } = await shop()
    await t.mutation(api.cash.push, { ops: [closing] })
    const { cashCounts, ...legacy } = closing
    await t.mutation(api.cash.push, { ops: [{ ...legacy, updatedAt: 2000 }] })
    expect((await t.query(api.cash.pull, {})).closes[0].cashCounts).toEqual(cashCounts)
    await t.mutation(api.cash.push, { ops: [{ ...legacy, counted: 1500, updatedAt: 3000 }] })
    expect((await t.query(api.cash.pull, {})).closes[0].cashCounts).toBeUndefined()
    await t.mutation(api.cash.push, { ops: [{ ...closing, updatedAt: 4000 }] })
    await t.mutation(api.cash.push, { ops: [{ ...closing, cashCounts: null, updatedAt: 5000 }] })
    expect((await t.query(api.cash.pull, {})).closes[0].cashCounts).toBeUndefined()
  })

  it('does not let stale offline counts overwrite a newer correction', async () => {
    const { t } = await shop()
    await t.mutation(api.cash.push, { ops: [{ ...closing, counted: 1500, cashCounts: { '500': 3 }, updatedAt: 2000 }] })
    await t.mutation(api.cash.push, { ops: [closing] })
    expect((await t.query(api.cash.pull, {})).closes[0]).toMatchObject({ counted: 1500, cashCounts: { '500': 3 } })
  })
})

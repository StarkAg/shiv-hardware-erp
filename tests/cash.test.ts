/// <reference types="vite/client" />
/**
 * The drawer and the books, as one set of accounts.
 *
 * Cash notes used to live only in the cash page, which is why Cash-in-Hand had
 * to be hidden from the trial balance. These cover what posts by itself, what
 * waits for a person, and what happens when the counter corrects a note.
 */
import { convexTest } from 'convex-test'
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

describe('drawer notes in the books', () => {
  it('posts a receipt against the party and the drawer', async () => {
    const { t, cashId, partyId } = await shop()
    await t.mutation(api.cash.push, { ops: [note()] })

    const [voucher] = await vouchers(t)
    expect(voucher).toMatchObject({ amount: 4000, refNo: 'CASH-e1', voucherNo: 1, status: 'final' })

    const entries = await lines(t)
    expect(entries).toHaveLength(2)
    expect(entries.find(e => e.ledgerId === cashId)).toMatchObject({ side: 'Dr', amount: 4000 })
    expect(entries.find(e => e.ledgerId === partyId)).toMatchObject({ side: 'Cr', amount: 4000 })
  })

  it('sends money out the other way', async () => {
    const { t, cashId, partyId } = await shop()
    await t.mutation(api.cash.push, { ops: [note({ kind: 'out', amount: 700 })] })
    const entries = await lines(t)
    expect(entries.find(e => e.ledgerId === cashId)).toMatchObject({ side: 'Cr', amount: 700 })
    expect(entries.find(e => e.ledgerId === partyId)).toMatchObject({ side: 'Dr', amount: 700 })
  })

  it('puts online money through the bank', async () => {
    const { t, bankId } = await shop()
    await t.mutation(api.cash.push, { ops: [note({ mode: 'online' })] })
    expect((await lines(t)).some(e => e.ledgerId === bankId)).toBe(true)
  })

  it('does not post a second voucher when the queue is flushed twice', async () => {
    const { t } = await shop()
    await t.mutation(api.cash.push, { ops: [note()] })
    await t.mutation(api.cash.push, { ops: [note()] })
    expect(await vouchers(t)).toHaveLength(1)
    expect(await lines(t)).toHaveLength(2)
  })

  it('follows a correction made at the counter', async () => {
    const { t } = await shop()
    await t.mutation(api.cash.push, { ops: [note()] })
    await t.mutation(api.cash.push, { ops: [note({ amount: 4500, updatedAt: 2_000 })] })

    expect(await vouchers(t)).toHaveLength(1)
    expect((await vouchers(t))[0].amount).toBe(4500)
    expect((await lines(t)).every(l => l.amount === 4500)).toBe(true)
  })

  it('takes the voucher out of the balances when the note is deleted, and keeps it restorable', async () => {
    const { t } = await shop()
    await t.mutation(api.cash.push, { ops: [note()] })
    await t.mutation(api.cash.push, { ops: [note({ deleted: true, updatedAt: 2_000 })] })

    expect(await lines(t)).toHaveLength(0)
    expect(await vouchers(t)).toHaveLength(0)
    expect(await t.run(ctx => ctx.db.query('trash').collect())).toHaveLength(1)
  })

  it('waits for a person rather than opening an account from a drawer note', async () => {
    const { t } = await shop()
    await t.mutation(api.cash.push, { ops: [note({ entryId: 'e2', name: 'Walk-in' })] })

    expect(await vouchers(t)).toHaveLength(0)
    expect(await t.run(ctx => ctx.db.query('ledgers').collect())).toHaveLength(3)

    const waiting = await t.query(api.cash.unposted, {})
    expect(waiting).toHaveLength(1)
    expect(waiting[0]).toMatchObject({ entryId: 'e2', why: 'No account by that name', amount: 4000 })
  })

  it('posts it once somebody says whose it is, and remembers the account', async () => {
    const { t, partyId } = await shop()
    await t.mutation(api.cash.push, { ops: [note({ entryId: 'e2', name: 'Ramesh' })] })
    const res = await t.mutation(api.cash.assign, { entryId: 'e2', ledgerId: partyId })

    expect(res.voucherId).toBeTruthy()
    expect(await t.query(api.cash.unposted, {})).toHaveLength(0)

    // A later correction at the counter stays with the account that was chosen.
    await t.mutation(api.cash.push, { ops: [note({ entryId: 'e2', name: 'Ramesh', amount: 900, updatedAt: 2_000 })] })
    expect(await vouchers(t)).toHaveLength(1)
    expect((await vouchers(t))[0]).toMatchObject({ amount: 900, partyLedgerId: partyId })
  })

  it('matches a name however it was typed', async () => {
    const { t } = await shop()
    await t.mutation(api.cash.push, { ops: [note({ name: '  ramesh   KUMAR ' })] })
    expect(await vouchers(t)).toHaveLength(1)
  })

  it('posts the notes that were in the drawer before any of this existed', async () => {
    const { t } = await shop()
    await t.run(async ctx => {
      for (const [entryId, name] of [['old-1', 'Ramesh Kumar'], ['old-2', 'Nobody']] as const) {
        await ctx.db.insert('cashEntries', {
          entryId, date: '2026-08-01', kind: 'in', mode: 'cash', name, amount: 100,
          at: 1, updatedAt: 1,
        })
      }
    })

    expect(await t.mutation(api.cash.postBacklog, {})).toMatchObject({ looked: 2, posted: 1, waiting: 1 })
    expect(await vouchers(t)).toHaveLength(1)
    expect(await t.query(api.cash.unposted, {})).toHaveLength(1)
  })
})

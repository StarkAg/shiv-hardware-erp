import { convexTest } from './trustedConvex'
import { afterEach, describe, expect, it, vi } from 'vitest'
import schema from '../convex/schema'
import { api, internal } from '../convex/_generated/api'
import { GENESIS, sealOf, sha256 } from '../convex/lib/seal'

const modules = import.meta.glob('../convex/**/*.ts')

/**
 * The chain on the books' history (convex/lib/seal.ts, convex/chain.ts): each
 * line sealed onto the one before it, and what the check says when a line or
 * a voucher has been changed behind the app's back.
 */
describe('the sealed history', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

  const books = async (t: ReturnType<typeof convexTest>) => t.run(async ctx => {
    await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const sales = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 1 })
    await ctx.db.insert('ledgers', { name: 'Sales', groupId: sales, openingBalance: 0, openingSide: 'Cr', openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
  })
  const sale = (id: string, total: number, number = '') => ({
    id, number, kind: 'sale', date: '2026-10-12', customerName: 'Example Customer',
    items: [{ id: 'line-1', description: 'Goods', qty: 1, unit: 'Pc', amount: total }], total, paid: false, paymentMode: 'cash',
  })
  const lines = (t: ReturnType<typeof convexTest>) => t.run(async ctx =>
    (await ctx.db.query('history').withIndex('by_seq').collect()).filter((row) => row.seq !== undefined))
  const checked = async (t: ReturnType<typeof convexTest>) => {
    await t.action(internal.chain.verify, { by: 'night' })
    return (await t.query(api.chain.latest, {})).last!
  }

  it('makes the same fingerprint as any SHA-256', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('seals every line onto the one before it, and the check finds it whole', async () => {
    const t = convexTest(schema, modules)
    await books(t)
    await t.mutation(api.billLedger.postBill, { bill: sale('one', 100), keepAsBill: true })
    await t.mutation(api.billLedger.postBill, { bill: sale('two', 250), keepAsBill: true })

    const sealed = await lines(t)
    expect(sealed.length).toBeGreaterThanOrEqual(4)
    expect(sealed.map((row) => row.seq)).toEqual(sealed.map((_, i) => i + 1))
    expect(sealed[0].prev).toBe(GENESIS)
    for (const [i, row] of sealed.entries()) {
      if (i) expect(row.prev).toBe(sealed[i - 1].hash)
      expect(row.hash).toBe(sealOf({ ...row, seq: row.seq!, prev: row.prev! }))
    }
    // A line about a voucher carries the voucher's own fingerprint.
    expect(sealed.filter((row) => row.entity === 'voucher').every((row) => /^[0-9a-f]{64}$/.test(row.state ?? ''))).toBe(true)
    // The lines written for the seal alone stay off the History screen.
    expect((await t.query(api.history.list, {})).some((row: any) => row.action === 'voucher.lines')).toBe(false)

    const found = await checked(t)
    expect(found).toMatchObject({ ok: true, entries: sealed.length, headSeq: sealed.length, head: sealed.at(-1)!.hash, vouchers: 2, changedCount: 0 })
    expect(found.brokenAt).toBeUndefined()
  })

  it('stays whole through an honest edit', async () => {
    const t = convexTest(schema, modules)
    await books(t)
    const posted = await t.mutation(api.billLedger.postBill, { bill: sale('one', 100), keepAsBill: true })
    await t.mutation(api.billLedger.postBill, { bill: sale('one', 180, posted.number), keepAsBill: true })
    expect(await checked(t)).toMatchObject({ ok: true, vouchers: 1, changedCount: 0 })
  })

  it('says where a line was changed', async () => {
    const t = convexTest(schema, modules)
    await books(t)
    await t.mutation(api.billLedger.postBill, { bill: sale('one', 100), keepAsBill: true })
    await t.mutation(api.billLedger.postBill, { bill: sale('two', 250), keepAsBill: true })
    const sealed = await lines(t)
    const target = sealed[1]
    await t.run(ctx => ctx.db.patch(target._id, { summary: 'Sale 1 · Someone Else · 1.00' }))
    const found = await checked(t)
    expect(found.ok).toBe(false)
    expect(found.brokenAt).toMatchObject({ seq: target.seq, why: 'It has been changed since it was sealed' })
  })

  it('says where a line was taken out', async () => {
    const t = convexTest(schema, modules)
    await books(t)
    await t.mutation(api.billLedger.postBill, { bill: sale('one', 100), keepAsBill: true })
    await t.mutation(api.billLedger.postBill, { bill: sale('two', 250), keepAsBill: true })
    const sealed = await lines(t)
    await t.run(ctx => ctx.db.delete(sealed[2]._id))
    const found = await checked(t)
    expect(found.ok).toBe(false)
    expect(found.brokenAt).toMatchObject({ seq: sealed[3].seq, why: `Line ${sealed[2].seq} is missing` })
  })

  it('finds a voucher changed behind the app, and takes it back once accepted', async () => {
    const t = convexTest(schema, modules)
    await books(t)
    const posted = await t.mutation(api.billLedger.postBill, { bill: sale('one', 100), keepAsBill: true })
    await t.mutation(api.billLedger.postBill, { bill: sale('two', 250), keepAsBill: true })
    // Straight into the table: both sides, so the voucher still balances.
    await t.run(async ctx => {
      const entries = await ctx.db.query('voucherEntries').withIndex('by_voucher', q => q.eq('voucherId', posted.voucherId!)).collect()
      for (const entry of entries) await ctx.db.patch(entry._id, { amount: 40 })
    })
    const found = await checked(t)
    expect(found.ok).toBe(false)
    expect(found.brokenAt).toBeUndefined()
    expect(found).toMatchObject({ changedCount: 1, changed: [{ voucherId: String(posted.voucherId), label: 'SAL-0001' }] })

    vi.stubEnv('LEDGER_PIN', 'test-pin')
    await expect(t.mutation(api.chain.accept, { pin: 'wrong', voucherIds: [String(posted.voucherId)] })).rejects.toThrow()
    expect(await t.mutation(api.chain.accept, { pin: 'test-pin', voucherIds: [String(posted.voucherId)] })).toEqual({ accepted: 1 })
    expect(await checked(t)).toMatchObject({ ok: true, changedCount: 0 })
    // Accepting it is itself a line anyone can read.
    expect((await t.query(api.history.list, {})).some((row: any) => row.action === 'chain.accept')).toBe(true)
  })

  it('seals books that had a history before the chain', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    await books(t)
    // As the books were: lines with no seal, and a voucher no sealed line speaks for.
    await t.run(async ctx => {
      for (const [i, summary] of ['Sale 1 · A · 10.00', 'Sale 2 · B · 20.00', 'Sale 1 edited'].entries()) {
        await ctx.db.insert('history', { at: 1000 + i, action: 'voucher.create', summary })
      }
      const type = (await ctx.db.query('voucherTypes').first())!
      const party = (await ctx.db.query('ledgers').first())!
      await ctx.db.insert('vouchers', { typeId: type._id, voucherNo: 7, fy: '2026-27', date: 1, partyLedgerId: party._id, status: 'pending', attachments: [], createdAt: 1, updatedAt: 1 })
    })
    await t.mutation(internal.chain.begin, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    const sealed = await lines(t)
    expect(await t.run(ctx => ctx.db.query('history').withIndex('by_seq', q => q.eq('seq', undefined)).collect())).toEqual([])
    // The old lines keep their order, after the line that began the chain.
    expect(sealed.filter((row) => row.action === 'voucher.create').map((row) => row.summary))
      .toEqual(['Sale 1 · A · 10.00', 'Sale 2 · B · 20.00', 'Sale 1 edited'])
    expect(await checked(t)).toMatchObject({ ok: true, unsealed: 0, vouchers: 1, vouchersUnsealed: 0, changedCount: 0 })
  })

  it('answers Check the books from the screen', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    await books(t)
    await t.mutation(api.billLedger.postBill, { bill: sale('one', 100), keepAsBill: true })
    await t.mutation(api.chain.check, {})
    expect((await t.query(api.chain.latest, {})).running).toBe(true)
    await t.finishAllScheduledFunctions(vi.runAllTimers)
    const state = await t.query(api.chain.latest, {})
    expect(state.running).toBe(false)
    expect(state.last).toMatchObject({ ok: true, by: 'hand' })
    expect(state.sealed).toBe(state.last!.headSeq)
  })
})

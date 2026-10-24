/// <reference types="vite/client" />
import { convexTest } from './trustedConvex'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import schema from '../convex/schema'
import { api, internal } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

async function fixture() {
  const t = convexTest(schema, modules)
  const date = new Date('2026-09-11').getTime()
  const ids = await t.run(async ctx => {
    const groupId = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const ledger = { groupId, openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    const partyId = await ctx.db.insert('ledgers', { ...ledger, name: 'Test Customer' })
    const salesId = await ctx.db.insert('ledgers', { ...ledger, name: 'Sales' })
    const typeId = await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
    const voucherId = await ctx.db.insert('vouchers', { typeId, voucherNo: 7, fy: '2026-27', date, partyLedgerId: partyId, refNo: 'BILL-7', status: 'final', amount: 125, attachments: [], createdAt: 1, updatedAt: 1 })
    for (const [ledgerId, side] of [[partyId, 'Dr'], [salesId, 'Cr']] as const) {
      await ctx.db.insert('voucherEntries', { voucherId, ledgerId, side, amount: 125, date })
    }
    await ctx.db.insert('billsStore', { bills: [{ id: 'bill-7', number: '7', date: '2026-09-11', customerName: 'Test Customer', ledgerId: partyId, total: 125, items: [] }], billSeq: 7, savedAt: 1 })
    return { partyId, salesId, voucherId }
  })
  return { t, ...ids }
}

// The Trash opens only with the code (LEDGER_PIN).
const CODE = 'test-pin-only'
beforeEach(() => { vi.stubEnv('LEDGER_PIN', CODE) })
afterEach(() => { vi.unstubAllEnvs() })

describe('shared trash', () => {
  it('opens only with the code, every time', async () => {
    const { t } = await fixture()
    await expect(t.query(api.trash.all, { pin: 'wrong' })).rejects.toThrow('Wrong code')
    await expect(t.query(api.trash.all, { pin: '' })).rejects.toThrow('Wrong code')
    await expect(t.mutation(api.trash.unlock, { pin: 'wrong' })).rejects.toThrow('Wrong code')
    expect(await t.mutation(api.trash.unlock, { pin: CODE })).toBe(true)
    expect(await t.query(api.trash.all, { pin: CODE })).toEqual([])
  })

  it('shows a linked bill and voucher once, restores both with original balanced lines', async () => {
    const { t } = await fixture()
    await t.mutation(api.bills.remove, { id: 'bill-7' })
    const rows = await t.query(api.trash.all, { pin: CODE })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'bill', linkedVoucher: 'SAL-0007', amount: 125 })
    expect(await t.run(ctx => ctx.db.query('voucherEntries').collect())).toHaveLength(0)
    if (rows[0].source !== 'bill') throw new Error('Expected bill')
    await t.mutation(api.bills.restore, { id: rows[0]._id })
    expect(await t.query(api.trash.all, { pin: CODE })).toHaveLength(0)
    expect((await t.query(api.bills.get, {}))?.bills).toHaveLength(1)
    const vouchers = await t.run(ctx => ctx.db.query('vouchers').collect())
    expect(vouchers).toHaveLength(1)
    expect(vouchers[0]).toMatchObject({ voucherNo: 7, refNo: 'BILL-7' })
    const lines = await t.run(ctx => ctx.db.query('voucherEntries').collect())
    expect(lines).toHaveLength(2)
    expect(lines.reduce((n, l) => n + (l.side === 'Dr' ? l.amount : -l.amount), 0)).toBe(0)
    await t.mutation(api.bills.restore, { id: rows[0]._id })
    expect(await t.run(ctx => ctx.db.query('vouchers').collect())).toHaveLength(1)
  })

  it('deleting a bill\'s voucher from the ledger takes the bill too; restoring the voucher brings both', async () => {
    const { t, voucherId } = await fixture()
    await t.mutation(api.vouchers.remove, { id: voucherId })
    expect((await t.query(api.bills.get, {}))?.bills).toHaveLength(0)
    expect(await t.query(api.bills.deletedIds, {})).toEqual(['bill-7'])
    const rows = await t.query(api.trash.all, { pin: CODE })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'bill', linkedVoucher: 'SAL-0007' })
    const [bill] = await t.run(ctx => ctx.db.query('billsTrash').collect())
    await t.mutation(api.trash.restore, { id: bill.voucherTrashId! })
    expect(await t.query(api.trash.all, { pin: CODE })).toHaveLength(0)
    expect((await t.query(api.bills.get, {}))?.bills).toHaveLength(1)
    expect(await t.run(ctx => ctx.db.query('vouchers').collect())).toHaveLength(1)
    expect(await t.run(ctx => ctx.db.query('voucherEntries').collect())).toHaveLength(2)
  })

  it('keeps standalone vouchers visible and restorable', async () => {
    const { t, voucherId } = await fixture()
    // Not written from a bill: no bill names it or carries its reference.
    await t.run(ctx => ctx.db.patch(voucherId, { refNo: 'R-1' }))
    await t.mutation(api.vouchers.remove, { id: voucherId })
    expect((await t.query(api.bills.get, {}))?.bills).toHaveLength(1)
    const rows = await t.query(api.trash.all, { pin: CODE })
    expect(rows).toHaveLength(1)
    expect(rows[0].source).toBe('voucher')
    if (rows[0].source !== 'voucher') throw new Error('Expected voucher')
    await t.mutation(api.trash.restore, { id: rows[0]._id })
    expect(await t.query(api.trash.all, { pin: CODE })).toHaveLength(0)
  })

  it('pairs older bill deletions without an explicit trash ID', async () => {
    const { t } = await fixture()
    await t.mutation(api.bills.remove, { id: 'bill-7' })
    await t.run(async ctx => {
      const bill = (await ctx.db.query('billsTrash').collect())[0]
      await ctx.db.patch(bill._id, { voucherTrashId: undefined })
    })
    const rows = await t.query(api.trash.all, { pin: CODE })
    expect(rows).toHaveLength(1)
    if (rows[0].source !== 'bill') throw new Error('Expected bill')
    await t.mutation(api.bills.restore, { id: rows[0]._id })
    expect(await t.run(ctx => ctx.db.query('voucherEntries').collect())).toHaveLength(2)
  })

  it('refuses an ambiguous legacy link instead of restoring the wrong accounting entry', async () => {
    const { t } = await fixture()
    await t.mutation(api.bills.remove, { id: 'bill-7' })
    const billId = await t.run(async ctx => {
      const bill = (await ctx.db.query('billsTrash').collect())[0]
      await ctx.db.patch(bill._id, { voucherTrashId: undefined })
      const { _id, _creationTime, ...voucher } = (await ctx.db.query('trash').collect())[0]
      await ctx.db.insert('trash', { ...voucher, fy: '2025-26' })
      return bill._id
    })
    expect(await t.query(api.trash.all, { pin: CODE })).toHaveLength(3)
    await expect(t.mutation(api.bills.restore, { id: billId })).rejects.toThrow('missing or ambiguous')
    expect((await t.query(api.bills.get, {}))?.bills).toHaveLength(0)
    expect(await t.run(ctx => ctx.db.query('vouchers').collect())).toHaveLength(0)
  })

  it('does not recreate a voucher already restored through the old screen', async () => {
    const { t } = await fixture()
    await t.mutation(api.bills.remove, { id: 'bill-7' })
    const [bill] = await t.run(ctx => ctx.db.query('billsTrash').collect())
    await t.mutation(api.trash.restore, { id: bill.voucherTrashId! })
    await t.mutation(api.bills.restore, { id: bill._id })
    expect(await t.run(ctx => ctx.db.query('vouchers').collect())).toHaveLength(1)
    expect(await t.run(ctx => ctx.db.query('voucherEntries').collect())).toHaveLength(2)
  })

  it('points a restored bill at its voucher\'s new id, so deleting the voucher again takes the bill (bill 556)', async () => {
    const { t, voucherId } = await fixture()
    await t.run(async ctx => {
      const store = (await ctx.db.query('billsStore').collect())[0]
      await ctx.db.patch(store._id, { bills: store.bills!.map((b: any) => ({ ...b, voucherId })) })
    })
    await t.mutation(api.vouchers.remove, { id: voucherId })
    const [binned] = await t.run(ctx => ctx.db.query('billsTrash').collect())
    await t.mutation(api.bills.restore, { id: binned._id })
    const [back] = await t.run(ctx => ctx.db.query('vouchers').collect())
    expect(back._id).not.toBe(voucherId)
    expect((await t.query(api.bills.get, {}))?.bills[0].voucherId).toBe(back._id)
    await t.mutation(api.vouchers.remove, { id: back._id })
    expect((await t.query(api.bills.get, {}))?.bills).toHaveLength(0)
    expect(await t.query(api.trash.all, { pin: CODE })).toHaveLength(1)
  })

  it('tidies a bill left naming a deleted voucher into the Trash, linked to that voucher', async () => {
    const { t, voucherId } = await fixture()
    // As restores did before the fix: the bill names an id no voucher has.
    await t.run(async ctx => {
      const store = (await ctx.db.query('billsStore').collect())[0]
      await ctx.db.patch(store._id, { bills: store.bills!.map((b: any) => ({ ...b, voucherId: 'p970d197y9s70fa3417q1k3k6d8gvd87' })) })
    })
    await t.mutation(api.vouchers.remove, { id: voucherId })
    expect((await t.query(api.bills.get, {}))?.bills).toHaveLength(1)
    expect(await t.mutation(internal.bills.tidyOrphans, { dryRun: true })).toEqual({ relinked: [], removed: ['7 Test Customer 125 (with BILL-7 from the Trash)'] })
    await t.mutation(internal.bills.tidyOrphans, { dryRun: false })
    expect((await t.query(api.bills.get, {}))?.bills).toHaveLength(0)
    const rows = await t.query(api.trash.all, { pin: CODE })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'bill', linkedVoucher: 'SAL-0007' })
    await t.mutation(api.bills.restore, { id: rows[0]._id })
    const [back] = await t.run(ctx => ctx.db.query('vouchers').collect())
    expect((await t.query(api.bills.get, {}))?.bills[0].voucherId).toBe(back._id)
    expect(await t.run(ctx => ctx.db.query('voucherEntries').collect())).toHaveLength(2)
  })

  it('purges a linked pair only with the correct server-side PIN', async () => {
    const { t } = await fixture()
    await t.mutation(api.bills.remove, { id: 'bill-7' })
    const [bill] = await t.run(ctx => ctx.db.query('billsTrash').collect())
    await expect(t.mutation(api.bills.purge, { id: bill._id, pin: 'wrong' })).rejects.toThrow()
    expect(await t.query(api.trash.all, { pin: CODE })).toHaveLength(1)
    await t.mutation(api.bills.purge, { id: bill._id, pin: 'test-pin-only' })
    expect(await t.run(ctx => ctx.db.query('billsTrash').collect())).toHaveLength(0)
    expect(await t.run(ctx => ctx.db.query('trash').collect())).toHaveLength(0)
  })
})

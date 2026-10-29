/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { internal } from '../convex/_generated/api'
const modules = import.meta.glob('../convex/**/*.ts')

describe('swapping photos for smaller copies', () => {
  it('re-points vouchers, bills and the phone inbox, stamps the bill, and only deletes files no longer used', async () => {
    const t = convexTest(schema, modules)
    const [oldA, oldB, newA, newB] = await t.run(async (ctx) => Promise.all(
      ['a', 'b', 'a2', 'b2'].map((s) => ctx.storage.store(new Blob([s], { type: 'image/jpeg' }))),
    ))
    const { voucherId, billRow, flowId } = await t.run(async (ctx) => {
      const groupId = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 1 })
      const ledger = await ctx.db.insert('ledgers', { name: 'X', groupId, openingBalance: 0, openingSide: 'Dr', openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 })
      const typeId = await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 1 })
      const voucherId = await ctx.db.insert('vouchers', {
        typeId, voucherNo: 1, fy: '2026-27', date: 1, partyLedgerId: ledger, status: 'final', amount: 10,
        attachments: [{ storageId: oldA, kind: 'bill' }, oldB], createdAt: 1, updatedAt: 1,
      } as never)
      const billRow = await ctx.db.insert('bills', { billId: 'b1', number: '1', updatedAt: 5, bill: { id: 'b1', updatedAt: 5, attachments: [{ storageId: oldA, kind: 'bill' }] } })
      const flowId = await ctx.db.insert('voucherInbox', { storageId: oldB, at: 1, groupId: 'g' })
      return { voucherId, billRow, flowId }
    })

    // Not yet swapped: deleting the old files is refused.
    await expect(t.mutation(internal.photoSwap.remove, { ids: [oldA] })).rejects.toThrow(/still in use/)

    const pairs = [{ from: oldA, to: newA }, { from: oldB, to: newB }]
    for (const table of ['vouchers', 'bills', 'voucherInbox'] as const) {
      const r = await t.mutation(internal.photoSwap.apply, { table, pairs, cursor: null })
      expect(r.changed).toBe(1)
    }

    const after = await t.run(async (ctx) => ({
      voucher: await ctx.db.get(voucherId), bill: await ctx.db.get(billRow), flow: await ctx.db.get(flowId),
    }))
    expect(after.voucher!.attachments).toEqual([{ storageId: newA, kind: 'bill' }, newB])
    expect(after.bill!.bill.attachments[0].storageId).toBe(newA)
    expect(after.bill!.updatedAt).toBeGreaterThan(5)
    expect(after.bill!.bill.updatedAt).toBe(after.bill!.updatedAt)
    expect(after.flow!.storageId).toBe(newB)

    expect(await t.query(internal.photoSwap.references, { ids: [oldA, oldB], table: 'vouchers' })).toBe(0)
    expect(await t.query(internal.photoSwap.references, { ids: [newA, newB], table: 'vouchers' })).toBe(2)
    expect(await t.mutation(internal.photoSwap.remove, { ids: [oldA, oldB] })).toEqual({ deleted: 2 })
    await expect(t.mutation(internal.photoSwap.remove, { ids: [newA] })).rejects.toThrow(/still in use/)
  })
})

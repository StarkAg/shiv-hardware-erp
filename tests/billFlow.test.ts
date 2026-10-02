/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'
import { flowStage, requiredTasksDone } from '../convex/lib/billFlowStages'

const modules = import.meta.glob('../convex/**/*.ts')

async function shop() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    const debtors = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const creditors = await ctx.db.insert('groups', { name: 'Sundry Creditors', nature: 'liability', normalSide: 'Cr', sort: 1 })
    const income = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 2 })
    const expense = await ctx.db.insert('groups', { name: 'Purchase Accounts', nature: 'expense', normalSide: 'Dr', sort: 3 })
    const money = await ctx.db.insert('groups', { name: 'Cash-in-Hand', nature: 'asset', normalSide: 'Dr', sort: 4 })
    const base = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    await ctx.db.insert('ledgers', { ...base, name: 'Ramesh Kumar', groupId: debtors })
    await ctx.db.insert('ledgers', { ...base, name: 'M/s Supplier', groupId: creditors, openingSide: 'Cr' })
    await ctx.db.insert('ledgers', { ...base, name: 'Sales', groupId: income, openingSide: 'Cr' })
    await ctx.db.insert('ledgers', { ...base, name: 'Purchases', groupId: expense })
    await ctx.db.insert('ledgers', { ...base, name: 'Cash', groupId: money })
    await ctx.db.insert('ledgers', { ...base, name: 'Bank', groupId: money })
    for (const [name, abbr] of [['Sale', 'SAL'], ['Purchase', 'PUR'], ['Receipt', 'RCT'], ['Payment', 'PAY']] as const) {
      await ctx.db.insert('voucherTypes', { name, abbr, sort: 0 })
    }
  })
  return t
}

const cash = (over: Record<string, unknown> = {}) => ({
  t: 'entry', entryId: 'cash-1', date: '2026-10-02', kind: 'in', mode: 'cash',
  name: 'Ramesh Kumar', amount: 400, at: 1000, updatedAt: 1000, ...over,
})
const flows = (t: ReturnType<typeof convexTest>) => t.run(ctx => ctx.db.query('billFlows').collect())

describe('Bill Flow', () => {
  it('waits for every page and keeps one intake card on replay', async () => {
    const t = await shop()
    await t.mutation(api.cash.push, { ops: [cash()] })
    const [first, second] = await t.run(async ctx => [
      await ctx.storage.store(new Blob(['one'], { type: 'image/jpeg' })),
      await ctx.storage.store(new Blob(['two'], { type: 'image/jpeg' })),
    ])
    const a = await t.mutation(api.billFlow.attachCashPhoto, { entryId: 'cash-1', storageId: first, batchId: 'batch', pageCount: 2 })
    expect(a.ready).toBe(false)
    expect((await flows(t))[0]).toMatchObject({ intakeStatus: 'uploading', expectedPhotos: 2 })
    const b = await t.mutation(api.billFlow.attachCashPhoto, { entryId: 'cash-1', storageId: second, batchId: 'batch', pageCount: 2 })
    expect(b).toMatchObject({ id: a.id, ready: true })
    await t.mutation(api.billFlow.attachCashPhoto, { entryId: 'cash-1', storageId: second, batchId: 'batch', pageCount: 2 })
    expect(await flows(t)).toHaveLength(1)
    expect((await flows(t))[0]).toMatchObject({ photos: [first, second], intakeStatus: 'waiting' })
  })

  it('links a photographed sale to cash already posted and reuses its bill on retry', async () => {
    const t = await shop()
    await t.mutation(api.cash.push, { ops: [cash()] })
    const photo = await t.run(ctx => ctx.storage.store(new Blob(['bill'], { type: 'image/jpeg' })))
    const { id } = await t.mutation(api.billFlow.attachCashPhoto, { entryId: 'cash-1', storageId: photo, batchId: 'one', pageCount: 1 })
    const bill = { id: `flow-${id}`, number: '', kind: 'sale', date: '2026-10-02', customerName: 'Ramesh Kumar',
      items: [{ id: 'a', description: 'Door', qty: 1, unit: 'Pc', amount: 1000 }], total: 1000,
      paid: true, paidAmount: 400 }
    const args = { bill, attachments: [{ storageId: photo, kind: 'bill' as const }], keepAsBill: true,
      flowId: id, cashEntryId: 'cash-1' }
    const first = await t.mutation(api.billLedger.postBill, { ...args, attachments: args.attachments as never })
    const again = await t.mutation(api.billLedger.postBill, { ...args, attachments: args.attachments as never })
    expect(again.voucherId).toBe(first.voucherId)
    const vouchers = await t.run(ctx => ctx.db.query('vouchers').collect())
    expect(vouchers).toHaveLength(2)
    const cashVoucher = vouchers.find(row => row.refNo === 'CASH-cash-1')!
    const saleVoucher = vouchers.find(row => row.refNo?.startsWith('BILL-'))!
    const saleLines = await t.run(ctx => ctx.db.query('voucherEntries').withIndex('by_voucher', q => q.eq('voucherId', saleVoucher._id)).collect())
    expect(saleLines).toHaveLength(2)
    expect(saleLines.some(line => line.amount === 400)).toBe(false)
    expect((await flows(t))[0]).toMatchObject({ voucherId: saleVoucher._id, cashVoucherId: cashVoucher._id,
      cashEntryId: 'cash-1', billId: bill.id, intakeStatus: 'converted' })
  })

  it('confirms a cashier receipt by attaching evidence without posting another receipt', async () => {
    const t = await shop()
    await t.mutation(api.cash.push, { ops: [cash()] })
    const photo = await t.run(ctx => ctx.storage.store(new Blob(['receipt'], { type: 'image/jpeg' })))
    const { id } = await t.mutation(api.billFlow.attachCashPhoto, { entryId: 'cash-1', storageId: photo, batchId: 'one', pageCount: 1 })
    await t.mutation(api.billFlow.convertMoney, { id, kind: 'receipt', party: 'Ramesh Kumar' })
    const vouchers = await t.run(ctx => ctx.db.query('vouchers').collect())
    expect(vouchers).toHaveLength(1)
    expect(vouchers[0].attachments).toEqual([{ storageId: photo, kind: 'receipt' }])
    expect((await flows(t))[0].intakeStatus).toBe('converted')
  })

  it('links a cashier photo to a separately entered sale without posting again', async () => {
    const t = await shop()
    await t.mutation(api.cash.push, { ops: [cash()] })
    const photo = await t.run(ctx => ctx.storage.store(new Blob(['bill'], { type: 'image/jpeg' })))
    const source = await t.mutation(api.billFlow.attachCashPhoto, { entryId: 'cash-1', storageId: photo, batchId: 'one', pageCount: 1 })
    const sale = await t.mutation(api.billLedger.postBill, { bill: {
      id: 'entered-first', number: '', kind: 'sale', date: '2026-10-02', customerName: 'Ramesh Kumar',
      items: [{ id: 'a', description: 'Door', qty: 1, unit: 'Pc', amount: 1000 }], total: 1000, paid: false,
    } })
    const target = (await flows(t)).find(row => row.voucherId === sale.voucherId)!
    await t.mutation(api.billFlow.linkExisting, { cashFlowId: source.id, billFlowId: target._id })
    expect(await flows(t)).toHaveLength(1)
    expect((await flows(t))[0]).toMatchObject({ cashEntryId: 'cash-1', voucherId: sale.voucherId, photos: [photo] })
    expect(await t.run(ctx => ctx.db.query('vouchers').collect())).toHaveLength(2)
  })

  it('puts dealer payments on the dashboard with no goods work', async () => {
    const t = await shop()
    await t.mutation(api.cash.push, { ops: [cash({ kind: 'out', name: 'M/s Supplier', dealer: true })] })
    expect((await flows(t))[0]).toMatchObject({ documentKind: 'payment', stage: 'complete', cashEntryId: 'cash-1' })
  })

  it('continues a goods-received card when its purchase bill is entered', async () => {
    const t = await shop()
    const received = await t.mutation(api.billLedger.postBill, { bill: {
      id: 'grn-1', number: '', kind: 'grn', date: '2026-10-02', customerName: 'M/s Supplier',
      items: [{ id: 'a', description: 'Board', qty: 2, unit: 'Pc', amount: 0 }], total: 0, paid: false,
    } })
    const grnFlow = (await flows(t))[0]
    expect(grnFlow.stage).toBe('bill-to-come')
    const purchase = await t.mutation(api.billLedger.postBill, { bill: {
      id: 'pur-1', number: '', kind: 'purchase', date: '2026-10-02', customerName: 'M/s Supplier',
      items: [{ id: 'a', description: 'Board', qty: 2, unit: 'Pc', amount: 500 }], total: 500, paid: false,
      grnIds: [received.voucherId],
    } })
    expect(await flows(t)).toHaveLength(1)
    expect((await flows(t))[0]).toMatchObject({ _id: grnFlow._id, voucherId: purchase.voucherId,
      documentKind: 'purchase', stage: 'complete' })
  })

  it('requires both rack and mechanic work before delivery', async () => {
    const t = await shop()
    const posted = await t.mutation(api.billLedger.postBill, { bill: {
      id: 'mixed', number: '', kind: 'sale', date: '2026-10-02', customerName: 'Ramesh Kumar',
      items: [{ id: 'a', description: 'Door', qty: 1, unit: 'Pc', amount: 1000 }], total: 1000, paid: false,
    } })
    const flow = (await flows(t)).find(row => row.voucherId === posted.voucherId)!
    await t.mutation(api.billFlow.setRoute, { id: flow._id, route: 'mixed' })
    await expect(t.mutation(api.billFlow.mark, { id: flow._id, task: 'outForDelivery', done: true }))
      .rejects.toThrow('Finish ordering')
    for (const task of ['mechanicSent', 'measurementsReturned', 'materialsHanded', 'made', 'picked'] as const) {
      await t.mutation(api.billFlow.mark, { id: flow._id, task, done: true })
    }
    expect((await flows(t))[0].stage).toBe('ready-delivery')
    await t.mutation(api.billFlow.mark, { id: flow._id, task: 'outForDelivery', done: true })
    await t.mutation(api.billFlow.mark, { id: flow._id, task: 'delivered', done: true })
    expect((await flows(t))[0].stage).toBe('complete')
    await t.mutation(api.billFlow.mark, { id: flow._id, task: 'picked', done: false })
    expect((await flows(t))[0].stage).toBe('picking')
    expect(requiredTasksDone('mixed', { mechanicSent: true, measurementsReturned: true, materialsHanded: true, made: true })).toBe(false)
    expect(flowStage('sale', 'mixed', { mechanicSent: true, measurementsReturned: true, materialsHanded: true, made: true, picked: true })).toBe('ready-delivery')
  })
})

/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { convexTest as untrusted } from 'convex-test'
import { convexTest } from './trustedConvex'
import schema from '../convex/schema'
import { anyApi as api } from 'convex/server'
import { readBill, writeBills } from '../convex/lib/billRows'
import { workPieces } from '../convex/lib/workPieces'

const modules = import.meta.glob('../convex/**/*.ts')
const order = { id: 'work-1', kind: 'quotation', number: 'Q1', date: '2026-10-10', customerName: 'Test customer', customerPhone: '123', visitBy: 'Vijay', workOrder: true, updatedAt: 1, total: 999, items: [{ id: 'door', description: 'Door', qty: 2, rate: 500 }] }
const sizes = { billId: order.id, by: 'Vijay', baseAt: 0, unit: 'in' as const, pieces: [{ key: 'door#1', what: 'Door', w: '24 1/2', h: '72' }], measured: false }
async function setup() {
  const t = convexTest(schema, modules)
  await t.run((ctx) => writeBills(ctx, [order]))
  return t
}

describe('site measurements', () => {
  it('splits whole pieces, keeps fractional quantities and excludes charges', () => {
    expect(workPieces([...order.items, { id: 'area', description: 'Sheet', qty: 2.5 }, { description: 'Fare', qty: 1 }]))
      .toMatchObject([{ key: 'door#1', of: '1 of 2' }, { key: 'door#2', of: '2 of 2' }, { key: 'area#1', qty: 2.5 }])
  })
  it('requires a trusted device for both reading and writing', async () => {
    const t = untrusted(schema, modules)
    await expect(t.query(api.workOrders.open, {})).rejects.toMatchObject({ data: { code: 'untrusted' } })
    await expect(t.mutation(api.workOrders.saveSizes, sizes)).rejects.toMatchObject({ data: { code: 'untrusted' } })
  })
  it('returns open orders without prices, totals or line rates', async () => {
    const t = await setup()
    await t.run((ctx) => writeBills(ctx, [{ ...order, id: 'done', workDoneAt: 2 }, { ...order, id: 'purchase', kind: 'purchase' }]))
    const rows = await t.query(api.workOrders.open, {})
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: order.id, visitBy: 'Vijay' })
    expect(rows[0]).not.toHaveProperty('total')
    expect(rows[0].pieces[0]).not.toHaveProperty('rate')
  })
  it('saves partial sizes, completes a visit, and preserves the first completion time', async () => {
    const t = await setup()
    const first = await t.mutation(api.workOrders.saveSizes, sizes)
    expect(first.measuredAt).toBe(0)
    const second = await t.mutation(api.workOrders.saveSizes, { ...sizes, baseAt: first.at, measured: true })
    expect(second.measuredAt).toBeGreaterThan(0)
    const third = await t.mutation(api.workOrders.saveSizes, { ...sizes, baseAt: second.at, measured: true, notes: ' corrected ' })
    expect(third.measuredAt).toBe(second.measuredAt)
    const held = await t.run((ctx) => readBill(ctx, order.id))
    expect(held.siteSizes).toMatchObject({ notes: 'corrected', unit: 'in', by: 'Vijay', pieces: sizes.pieces })
    expect(held.total).toBe(999)
  })
  it('refuses a stale phone draft instead of overwriting newer sizes', async () => {
    const t = await setup()
    await t.mutation(api.workOrders.saveSizes, sizes)
    await expect(t.mutation(api.workOrders.saveSizes, { ...sizes, unit: 'mm' })).rejects.toMatchObject({ data: { code: 'conflict' } })
    expect((await t.run((ctx) => readBill(ctx, order.id))).siteSizes.unit).toBe('in')
  })
  it('retains site sizes when a counter saves an older copy of the whole bill', async () => {
    const t = await setup()
    await t.mutation(api.workOrders.saveSizes, { ...sizes, measured: true })
    await t.mutation(api.bills.save, { bills: [{ ...order, updatedAt: Date.now() + 1000, notes: 'Counter edit' }], billSeq: 1 })
    const held = await t.run((ctx) => readBill(ctx, order.id))
    expect(held.notes).toBe('Counter edit')
    expect(held.siteSizes.pieces).toEqual(sizes.pieces)
    expect(held.measuredAt).toBeGreaterThan(0)
  })
  it('refuses completed, removed and non-order bills', async () => {
    const t = await setup()
    await t.run((ctx) => writeBills(ctx, [{ ...order, workDoneAt: 2 }]))
    await expect(t.mutation(api.workOrders.saveSizes, sizes)).rejects.toMatchObject({ data: { code: 'billed' } })
    await expect(t.mutation(api.workOrders.saveSizes, { ...sizes, billId: 'missing' })).rejects.toMatchObject({ data: { code: 'gone' } })
    await t.run((ctx) => writeBills(ctx, [{ ...order, workOrder: false }]))
    await expect(t.mutation(api.workOrders.saveSizes, sizes)).rejects.toMatchObject({ data: { code: 'gone' } })
  })
  it('rejects duplicate piece keys and unnamed submissions', async () => {
    const t = await setup()
    await expect(t.mutation(api.workOrders.saveSizes, { ...sizes, pieces: [sizes.pieces[0], sizes.pieces[0]] })).rejects.toMatchObject({ data: { code: 'duplicate' } })
    await expect(t.mutation(api.workOrders.saveSizes, { ...sizes, by: ' ' })).rejects.toMatchObject({ data: { code: 'name' } })
  })
})

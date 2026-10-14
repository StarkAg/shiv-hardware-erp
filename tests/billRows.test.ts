/// <reference types="vite/client" />
/**
 * Bills in a row each, moved out of the old single row without losing one.
 */
import { convexTest } from './trustedConvex'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api, internal } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

// A posted bill: it names its voucher, or the books would refuse it as a new
// bill arriving without one (bills.save takes new bills only from posting).
const aBill = (id: string, number: string, updatedAt: number, name = 'Ramesh') =>
  ({ id, number, updatedAt, customerName: name, date: '2026-09-11', items: [], total: 0, voucherId: `v-${id}` })

async function legacy(bills: any[]) {
  const t = convexTest(schema, modules)
  await t.run((ctx) => ctx.db.insert('billsStore', { bills, billSeq: 9, savedAt: 1 }))
  return t
}

const listed = async (t: ReturnType<typeof convexTest>) =>
  ((await t.query(api.bills.get, {}))?.bills ?? []).map((b: any) => `${b.id}:${b.customerName}`).sort()

describe('bills in rows', () => {
  it('reads bills still in the old row before the move', async () => {
    const t = await legacy([aBill('a', '1', 1), aBill('b', '2', 1)])
    expect(await listed(t)).toEqual(['a:Ramesh', 'b:Ramesh'])
  })

  it('moves every bill, empties the old row, and changes nothing on a second run', async () => {
    const t = await legacy([aBill('a', '1', 1), aBill('b', '2', 1)])
    const first = await t.mutation(internal.bills.moveToRows, {})
    expect(first).toMatchObject({ legacy: 2, moved: 2, rows: 2 })
    const meta = await t.run((ctx) => ctx.db.query('billsStore').first())
    expect(meta).toMatchObject({ bills: [], billSeq: 9 })
    expect(await listed(t)).toEqual(['a:Ramesh', 'b:Ramesh'])
    const again = await t.mutation(internal.bills.moveToRows, {})
    expect(again).toMatchObject({ legacy: 0, moved: 0, rows: 2 })
  })

  it('keeps the newer copy whichever side it is on', async () => {
    // Quotations: a posted bill's party changes only by posting it again.
    const quote = (...a: Parameters<typeof aBill>) => ({ ...aBill(...a), kind: 'quotation' })
    const t = await legacy([quote('a', '1', 5, 'Old')])
    await t.mutation(api.bills.save, { bills: [quote('a', '1', 9, 'New')], billSeq: 1 })
    await t.mutation(internal.bills.moveToRows, {})
    expect(await listed(t)).toEqual(['a:New'])
    // A device with a stale copy cannot put it back.
    await t.mutation(api.bills.save, { bills: [quote('a', '1', 3, 'Stale')], billSeq: 1 })
    expect(await listed(t)).toEqual(['a:New'])
  })

  it('never deletes a bill a device simply did not mention', async () => {
    const t = await legacy([aBill('a', '1', 1)])
    await t.mutation(internal.bills.moveToRows, {})
    await t.mutation(api.bills.save, { bills: [], billSeq: 0 })
    expect(await listed(t)).toEqual(['a:Ramesh'])
  })

  it('deletes into the bin and restores from it', async () => {
    const t = await legacy([aBill('a', '1', 1)])
    await t.mutation(internal.bills.moveToRows, {})
    expect(await t.mutation(api.bills.remove, { id: 'a' })).toMatchObject({ removed: true })
    expect(await listed(t)).toEqual([])
    // Not brought back by a device that still has it.
    await t.mutation(api.bills.save, { bills: [aBill('a', '1', 99)], billSeq: 1 })
    expect(await listed(t)).toEqual([])
    const [row] = await t.query(api.bills.trashList, {})
    await t.mutation(api.bills.restore, { id: row._id })
    expect(await listed(t)).toEqual(['a:Ramesh'])
  })

  it('holds far more bills than the old single row could', async () => {
    const t = convexTest(schema, modules)
    const many = Array.from({ length: 3000 }, (_, i) => ({
      ...aBill(`b${i}`, String(i + 1), 1),
      items: Array.from({ length: 6 }, (_, n) => ({ id: `${i}-${n}`, description: '19mm Solid 8 X 4 Century', qty: 2, unit: 'Pc', amount: 3520 })),
    }))
    for (let i = 0; i < many.length; i += 500) {
      await t.mutation(api.bills.save, { bills: many.slice(i, i + 500), billSeq: i + 500 })
    }
    const got = await t.query(api.bills.get, {})
    expect(got?.bills).toHaveLength(3000)
    expect(JSON.stringify(got?.bills).length).toBeGreaterThan(1024 * 1024)
  }, 30_000)
})

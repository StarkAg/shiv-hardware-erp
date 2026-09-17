/// <reference types="vite/client" />
/**
 * Deliveries that come ahead of their bill.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api, internal } from '../convex/_generated/api'
import { deliveryChecks } from '../src/features/bills/Deliveries'
import { readNote } from '../src/features/receive/readNote'

const modules = import.meta.glob('../convex/**/*.ts')

async function shop() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert('groups', { name: 'Sundry Creditors', nature: 'liability', normalSide: 'Cr', sort: 0 })
    const buying = await ctx.db.insert('groups', { name: 'Purchase Accounts', nature: 'expense', normalSide: 'Dr', sort: 1 })
    const ledger = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    await ctx.db.insert('ledgers', { ...ledger, name: 'Purchases', groupId: buying })
    await ctx.db.insert('voucherTypes', { name: 'Purchase', abbr: 'PUR', sort: 0 })
  })
  return t
}

const bill = (over: Record<string, unknown>) => ({
  number: '',
  date: '2026-09-10',
  customerName: 'Shree Shyam Traders',
  items: [],
  total: 0,
  paid: false,
  ...over,
})

const sunmica = (qty: number, amount = 0) => ({ id: `l${qty}${amount}`, description: 'Sunmica', qty, unit: 'Sheet', amount })

const entries = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query('voucherEntries').collect())

describe('goods received', () => {
  it('files a delivery with no entries, in its own series', async () => {
    const t = await shop()
    const res = await t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'g1', kind: 'grn', items: [sunmica(15)], receivedBy: 'Vijay' }),
    })
    const grn = await t.run((ctx) => ctx.db.get(res.voucherId))
    expect(grn).toMatchObject({ status: 'received', receivedBy: 'Vijay', voucherNo: 1 })
    const type = await t.run((ctx) => ctx.db.get(grn!.typeId))
    expect(type).toMatchObject({ name: 'Goods Received', abbr: 'GRN' })
    expect(await entries(t)).toHaveLength(0)
  })

  it('prices a sheet by the sheet, not by its square-foot rate', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'p0', kind: 'purchase', date: '2026-09-01', total: 3520,
        items: [{ id: 'b', description: '19mm Solid 8 X 4', qty: 1, unit: 'Pc', amount: 3520, rateSqft: 110, sqft: 32 }] }),
    })
    await t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'g1', kind: 'grn', items: [{ id: 'c', description: '19mm Solid 8 X 4', qty: 2, unit: 'Pc', amount: 0 }] }),
    })
    const open = await t.query(api.receipts.open, {})
    expect(open.rows[0].items[0]).toMatchObject({ rate: 3520, value: 7040 })
  })

  it('waits on Bills to Come, estimated at the last rate paid', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'p0', kind: 'purchase', date: '2026-09-01', items: [sunmica(10, 4800)], total: 4800 }),
    })
    await t.mutation(api.billLedger.postBill, { bill: bill({ id: 'g1', kind: 'grn', items: [sunmica(15)] }) })
    const open = await t.query(api.receipts.open, {})
    expect(open.count).toBe(1)
    expect(open.rows[0].items[0]).toMatchObject({ description: 'Sunmica', qty: 15, rate: 480, value: 7200 })
    expect(open.total).toBe(7200)
  })

  it('is closed by the purchase that bills it, and opens again if that purchase is deleted', async () => {
    const t = await shop()
    const grn = await t.mutation(api.billLedger.postBill, { bill: bill({ id: 'g1', kind: 'grn', items: [sunmica(15)] }) })
    const pur = await t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'p1', kind: 'purchase', items: [sunmica(15, 7200)], total: 7200, grnIds: [grn.voucherId] }),
    })
    expect((await t.query(api.receipts.open, {})).count).toBe(0)
    expect(await t.run((ctx) => ctx.db.get(grn.voucherId))).toMatchObject({ billedIn: pur.voucherId })
    expect(await t.run((ctx) => ctx.db.get(pur.voucherId))).toMatchObject({ fromReceipts: [grn.voucherId] })

    // Editing the purchase still sees its own delivery.
    const mine = await t.query(api.receipts.open, { alsoFor: String(pur.voucherId) })
    expect(mine.rows.map((r) => r.billedHere)).toEqual([true])

    await t.mutation(api.vouchers.remove, { id: pur.voucherId })
    expect((await t.query(api.receipts.open, {})).count).toBe(1)
  })

  it('refuses a delivery already billed elsewhere, or another supplier\'s', async () => {
    const t = await shop()
    const grn = await t.mutation(api.billLedger.postBill, { bill: bill({ id: 'g1', kind: 'grn', items: [sunmica(15)] }) })
    await t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'p1', kind: 'purchase', items: [sunmica(15, 7200)], total: 7200, grnIds: [grn.voucherId] }),
    })
    await expect(t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'p2', kind: 'purchase', items: [sunmica(15, 7200)], total: 7200, grnIds: [grn.voucherId] }),
    })).rejects.toThrow(/already billed on PUR-0001/)
    await expect(t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'p3', customerName: 'Other Traders', kind: 'purchase', items: [sunmica(15, 7200)], total: 7200, grnIds: [grn.voucherId] }),
    })).rejects.toThrow(/another supplier/)
    // Refused saves leave nothing behind.
    const purchases = await t.run((ctx) => ctx.db.query('vouchers').collect())
    expect(purchases).toHaveLength(2)
  })

  it('turns every unpriced supplier bill into a delivery without moving a balance', async () => {
    const t = await shop()
    const pending = await t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'p9', number: '144', kind: 'purchase', items: [sunmica(20)] }),
    })
    expect(await t.run((ctx) => ctx.db.get(pending.voucherId))).toMatchObject({ status: 'pending' })

    const dry = await t.mutation(internal.receipts.convertPending, { dryRun: true })
    expect(dry.converted).toHaveLength(1)
    expect(await t.run((ctx) => ctx.db.get(pending.voucherId))).toMatchObject({ status: 'pending' })

    const done = await t.mutation(internal.receipts.convertPending, {})
    expect(done.converted).toEqual([expect.objectContaining({ from: 'PUR-0001', to: 'GRN-0001', lines: 1 })])
    expect(await t.run((ctx) => ctx.db.get(pending.voucherId))).toMatchObject({ status: 'received', voucherNo: 1 })
    const stored = (await t.query(api.bills.get, {}))?.bills ?? []
    expect(stored.find((b: any) => b.id === 'p9')).toMatchObject({ kind: 'grn' })
    expect(await entries(t)).toHaveLength(0)
    expect((await t.query(api.receipts.open, {})).count).toBe(1)
  })
})

describe('checking a bill against its delivery', () => {
  const rows = [{
    voucherId: 'g1', vchLabel: 'GRN-0001', date: 0, days: 0, partyLedgerId: 'x', party: 'S', receivedBy: '',
    billedHere: false, estimate: 0, unpricedLines: 0,
    items: [{ description: 'Sunmica', qty: 20, unit: 'Sheet', rate: 480, value: 9600, from: 'last paid, bill 7' }],
  }]
  const base = { id: 'b', number: '1', date: '', customerName: 'S', total: 0, paid: false, grnIds: ['g1'] }

  it('says nothing when the bill matches', () => {
    expect(deliveryChecks({ ...base, items: [sunmica(20, 9600)] } as any, rows)).toEqual([])
  })

  it('names a short quantity, a rate rise and an item never received', () => {
    const found = deliveryChecks({
      ...base,
      items: [sunmica(22, 11220), { id: 'h', description: 'Hinges', qty: 10, unit: 'Pc', amount: 500 }],
    } as any, rows)
    expect(found).toEqual([
      'Sunmica: billed 22 Sheet, received 20 Sheet',
      'Sunmica: ₹510 a Sheet, last paid ₹480 (+6%)',
      'Hinges is on the bill but was not received on GRN-0001',
    ])
  })
})

describe('a delivery written as a note', () => {
  const known = [{ name: 'Sunmica', unit: 'Sheet' }, { name: 'Door Hinges SS', unit: 'Pc' }]

  it('reads quantities, units and known items', () => {
    expect(readNote('15 Sunmica came, hinges 10 and 2 box screw', known).map(({ name, qty, unit }) => ({ name, qty, unit })))
      .toEqual([
        { name: 'Sunmica', qty: 15, unit: 'Sheet' },
        { name: 'Door Hinges SS', qty: 10, unit: 'Pc' },
        { name: 'Screw', qty: 2, unit: 'Box' },
      ])
  })
})

/// <reference types="vite/client" />
/**
 * Deliveries that come ahead of their bill.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api, internal } from '../convex/_generated/api'
import { dateForDeliveries, deliveryChecks, withDeliveryLines } from '../src/features/bills/Deliveries'
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
  it('files a zero-amount purchase as Goods Received immediately', async () => {
    const t = await shop()
    const res = await t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'p-empty', kind: 'purchase', items: [sunmica(20)] }),
    })
    const voucher = await t.run((ctx) => ctx.db.get(res.voucherId))
    const type = await t.run((ctx) => ctx.db.get(voucher!.typeId))
    expect(type?.name).toBe('Goods Received')
    expect(voucher).toMatchObject({ status: 'received' })
    expect(voucher?.amount).toBeUndefined()
    expect(res.bill).toMatchObject({ kind: 'grn', total: 0, items: [expect.objectContaining({ amount: 0 })] })
    expect((await t.query(api.receipts.open, {})).count).toBe(1)
    expect(await entries(t)).toHaveLength(0)
  })

  it('does not book a partial purchase as a purchase amount', async () => {
    const t = await shop()
    const res = await t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'p-partial', kind: 'purchase', total: 7200,
        items: [sunmica(15, 7200), { id: 'other', description: 'Door', qty: 1, unit: 'Pc', amount: 0 }] }),
    })
    expect(res.bill).toMatchObject({ kind: 'grn', total: 0 })
    expect(res.bill.items.map((item: any) => item.amount)).toEqual([0, 0])
    expect((await t.query(api.receipts.open, {})).count).toBe(1)
    expect(await entries(t)).toHaveLength(0)
  })

  it('routes an unpriced ledger-only purchase to Goods Received too', async () => {
    const t = await shop()
    const { partyLedgerId, purchaseLedgerId } = await t.run(async (ctx) => {
      const group = await ctx.db.query('groups').withIndex('by_name', q => q.eq('name', 'Sundry Creditors')).unique()
      const purchase = await ctx.db.query('ledgers').filter(q => q.eq(q.field('name'), 'Purchases')).first()
      const partyLedgerId = await ctx.db.insert('ledgers', {
        groupId: group!._id, name: 'M/s Shree Shyam Traders', openingBalance: 0,
        openingSide: 'Cr', openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1,
      })
      return { partyLedgerId, purchaseLedgerId: purchase!._id }
    })
    const id = await t.mutation(api.vouchers.createPurchase, {
      date: Date.parse('2026-09-10T00:00:00Z'), partyLedgerId, purchaseLedgerId,
    })
    const voucher = await t.run(ctx => ctx.db.get(id))
    const type = await t.run(ctx => ctx.db.get(voucher!.typeId))
    expect(type?.name).toBe('Goods Received')
    expect(voucher?.status).toBe('received')
    expect((await t.query(api.receipts.open, {})).count).toBe(1)
    expect(await entries(t)).toHaveLength(0)
  })

  it('reclassifies an edited purchase in place when its amount is removed', async () => {
    const t = await shop()
    const priced = await t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'p-edit', kind: 'purchase', total: 7200, items: [sunmica(15, 7200)] }),
    })
    expect(await entries(t)).toHaveLength(2)
    const received = await t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'p-edit', kind: 'purchase', total: 0, items: [sunmica(15)], voucherId: priced.voucherId }),
    })
    expect(received.voucherId).toBe(priced.voucherId)
    expect(received.bill.kind).toBe('grn')
    const voucher = await t.run(ctx => ctx.db.get(received.voucherId))
    expect(voucher?.status).toBe('received')
    expect((await t.run(ctx => ctx.db.get(voucher!.typeId)))?.name).toBe('Goods Received')
    expect((await t.run(ctx => ctx.db.query('vouchers').collect()))).toHaveLength(1)
    expect(await entries(t)).toHaveLength(0)
    expect((await t.query(api.receipts.open, {})).count).toBe(1)
  })

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
    // Seed the old form directly: new saves now become GRNs before posting.
    const partyLedgerId = await t.run(async (ctx) => {
      const group = await ctx.db.query('groups').withIndex('by_name', q => q.eq('name', 'Sundry Creditors')).unique()
      return ctx.db.insert('ledgers', {
        groupId: group!._id, name: 'M/s Shree Shyam Traders', openingBalance: 0,
        openingSide: 'Cr', openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1,
      })
    })
    const voucherId = await t.run(async (ctx) => {
      const type = await ctx.db.query('voucherTypes').withIndex('by_name', q => q.eq('name', 'Purchase')).unique()
      const date = Date.parse('2026-09-10T00:00:00Z')
      const id = await ctx.db.insert('vouchers', {
        typeId: type!._id, voucherNo: 1, fy: '2026-27', date, partyLedgerId,
        refNo: 'BILL-144', status: 'pending', attachments: [], createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('bills', {
        billId: 'p9', number: '144', updatedAt: 1,
        bill: bill({ id: 'p9', number: '144', kind: 'purchase', items: [sunmica(20)], voucherId: id }),
      })
      return id
    })
    expect(await t.run((ctx) => ctx.db.get(voucherId))).toMatchObject({ status: 'pending' })

    const dry = await t.mutation(internal.receipts.convertPending, { dryRun: true })
    expect(dry.converted).toHaveLength(1)
    expect(await t.run((ctx) => ctx.db.get(voucherId))).toMatchObject({ status: 'pending' })

    const done = await t.mutation(internal.receipts.convertPending, {})
    expect(done.converted).toEqual([expect.objectContaining({ from: 'PUR-0001', to: 'GRN-0001', lines: 1 })])
    expect(await t.run((ctx) => ctx.db.get(voucherId))).toMatchObject({ status: 'received', voucherNo: 1 })
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

/**
 * A delivery's lines, brought onto the bill that pays for it.
 *
 * A line the shop can name gets attached to its My Items entry, which is what
 * puts a rate box on it and remembers what is typed there. A line it cannot
 * name is still written — it just asks for a total.
 */
describe('delivery lines on the bill', () => {
  const entry = (id: string, name: string, alsoKnownAs?: string[]) =>
    ({ id, name, sizes: [], brands: [], ...(alsoKnownAs ? { alsoKnownAs } : {}) }) as never

  const delivery = (descriptions: string[]) =>
    ({
      voucherId: 'v1', vchLabel: 'GRN-0007', date: 1, days: 0, partyLedgerId: 'p1',
      party: 'M/s Orpet Laminates', receivedBy: 'Harsh', billedHere: false, estimate: 0, unpricedLines: 0,
      items: descriptions.map((description) => ({ description, qty: 2, unit: 'Sheet', rate: 0, value: 0, from: null })),
    }) as never

  const catalog = [
    entry('c1', 'Sunmica 0.8mm LW 8340'),
    entry('c2', 'Sunmica 0.8mm HG 8008', ['0.8 HG 8008 Orpet']),
  ]

  it('attaches a line the item list already knows', () => {
    const out = withDeliveryLines([], [delivery(['Sunmica 0.8mm LW 8340'])], catalog)
    expect(out).toHaveLength(1)
    expect(out[0].customEntryId).toBe('c1')
  })

  it('finds it by the supplier wording the shop has been taught', () => {
    const out = withDeliveryLines([], [delivery(['0.8 HG 8008 Orpet'])], catalog)
    expect(out[0].customEntryId).toBe('c2')
  })

  it('opens each line at the rate its estimate used, and leaves unknown ones empty', () => {
    const row = {
      voucherId: 'v1', vchLabel: 'GRN-0017', date: 1, days: 0, partyLedgerId: 'p1',
      party: 'SRT', receivedBy: 'Anup', billedHere: false, estimate: 0, unpricedLines: 1,
      items: [
        { description: '30mm Safari 78 X 38', qty: 2, unit: 'Pc', rate: 3700, value: 7400, from: 'last paid, bill 88' },
        { description: '30mm Safari 78 X 26', qty: 2, unit: 'Pc', rate: 0, value: 0, from: null },
      ],
    } as never
    const [known, fresh] = withDeliveryLines([], [row], [])
    expect(known).toMatchObject({ amount: 7400, rateSqft: 3700 })
    expect(fresh.amount).toBe(0)
    expect(fresh.rateSqft).toBeUndefined()
  })

  it('matches through case and spacing', () => {
    const out = withDeliveryLines([], [delivery(['SUNMICA 0.8MM  LW 8340'])], catalog)
    expect(out[0].customEntryId).toBe('c1')
  })

  /**
   * foldName deletes punctuation rather than spacing it, so "LW-8340" folds to
   * "lw8340" and "LW 8340" to "lw 8340". A supplier who hyphenates is not
   * matched, and should not be: teaching the entry that wording once, as an
   * alsoKnownAs, is the deliberate way in. Loosening the fold to close this
   * would start matching things that only look alike.
   */
  it('does not match a hyphenated wording it has not been taught', () => {
    const out = withDeliveryLines([], [delivery(['Sunmica 0.8mm LW-8340'])], catalog)
    expect(out[0].customEntryId).toBeUndefined()
  })

  it('leaves a line it cannot name attached to nothing, rather than guessing', () => {
    const out = withDeliveryLines([], [delivery(['Sunmica 0.8mm HG 8348'])], catalog)
    expect(out).toHaveLength(1)
    expect(out[0].customEntryId).toBeUndefined()
    expect(out[0].description).toBe('Sunmica 0.8mm HG 8348')
  })

  it('keeps what was counted, and prices nothing', () => {
    const out = withDeliveryLines([], [delivery(['Sunmica 0.8mm LW 8340'])], catalog)
    expect(out[0].qty).toBe(2)
    expect(out[0].unit).toBe('Sheet')
    expect(out[0].amount).toBe(0)
  })

  it('does not write a line the bill already carries twice', () => {
    const already = [{ id: 'x', description: 'Sunmica 0.8mm LW 8340', qty: 1, unit: 'Sheet', amount: 500 }] as never
    const out = withDeliveryLines(already, [delivery(['Sunmica 0.8mm LW 8340'])], catalog)
    expect(out).toHaveLength(1)
    expect(out[0].amount).toBe(500)
  })
})

/**
 * A supplier's bill is dated when the goods went out, not when somebody got
 * round to entering it. Before this, the form opened on today and nobody
 * thought to change it — so a Friday spent entering last week's bills dated
 * the lot Friday, and the supplier's statement then disagreed with the books
 * by a week.
 */
describe('the date a bill against deliveries carries', () => {
  const on = (y: number, m: number, d: number) => ({ date: Date.UTC(y, m, d) })

  it('takes the delivery\'s own day', () => {
    expect(dateForDeliveries([on(2026, 8, 14)])).toBe('2026-09-14')
  })

  it('takes the latest when one bill covers several deliveries', () => {
    // Goods cannot be billed before they have arrived, so the bill is dated
    // by the last of them rather than the first.
    expect(dateForDeliveries([on(2026, 8, 14), on(2026, 8, 18), on(2026, 8, 11)]))
      .toBe('2026-09-18')
  })

  it('gives nothing back when no delivery is ticked, so the typed date stands', () => {
    expect(dateForDeliveries([])).toBeNull()
  })

  it('ignores a row with no usable date rather than dating the bill 1970', () => {
    expect(dateForDeliveries([{ date: Number.NaN }, on(2026, 8, 14)])).toBe('2026-09-14')
    expect(dateForDeliveries([{ date: Number.NaN }])).toBeNull()
  })

  /**
   * GRN dates are stored as UTC day boundaries and the bill's date is read
   * back as YYYY-MM-DD, so the two have to agree at the edges of a day or a
   * delivery booked in the evening comes back dated the day before.
   */
  it('does not slip a day at either end of one', () => {
    expect(dateForDeliveries([{ date: Date.UTC(2026, 0, 1, 0, 0, 0) }])).toBe('2026-01-01')
    expect(dateForDeliveries([{ date: Date.UTC(2026, 0, 1, 23, 59, 59) }])).toBe('2026-01-01')
  })
})

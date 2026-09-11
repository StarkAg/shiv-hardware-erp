/// <reference types="vite/client" />
/**
 * The one posting path.
 *
 * These cover the three ways the old split path let the books drift: a bill
 * that saved while its voucher failed, two PCs handing out the same number,
 * and a deletion that only happened on one machine.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

/** A shop with its account masters set up, and nothing written yet. */
async function shop(opts: { sales?: boolean; cash?: boolean } = {}) {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    const debtors = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const income = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 1 })
    const cash = await ctx.db.insert('groups', { name: 'Cash-in-Hand', nature: 'asset', normalSide: 'Dr', sort: 2 })
    const ledger = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    if (opts.sales !== false) {
      await ctx.db.insert('ledgers', { ...ledger, name: 'Sales', groupId: income, openingSide: 'Cr' as const })
    }
    if (opts.cash !== false) {
      await ctx.db.insert('ledgers', { ...ledger, name: 'Cash', groupId: cash })
      await ctx.db.insert('ledgers', { ...ledger, name: 'Bank', groupId: cash })
    }
    await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
    await ctx.db.insert('voucherTypes', { name: 'Receipt', abbr: 'RCT', sort: 1 })
    // Referenced so the unused-group warning does not hide a real mistake.
    void debtors
  })
  return t
}

const aBill = (over: Record<string, unknown> = {}) => ({
  id: 'bill-a',
  number: '1',
  date: '2026-09-11',
  customerName: 'Ramesh Kumar',
  kind: 'sale',
  items: [],
  total: 1000,
  paid: false,
  ...over,
})

const lines = (t: ReturnType<typeof convexTest>) =>
  t.run(ctx => ctx.db.query('voucherEntries').collect())
const vouchers = (t: ReturnType<typeof convexTest>) =>
  t.run(ctx => ctx.db.query('vouchers').collect())
const stored = async (t: ReturnType<typeof convexTest>) =>
  (await t.query(api.bills.get, {}))?.bills ?? []

describe('posting a bill', () => {
  it('writes the bill, the voucher and its balanced lines together', async () => {
    const t = await shop()
    const res = await t.mutation(api.billLedger.postBill, { bill: aBill() })

    expect(res.voucherId).toBeTruthy()
    expect(res.number).toBe('1')
    const [voucher] = await vouchers(t)
    expect(voucher).toMatchObject({ voucherNo: 1, refNo: 'BILL-1', amount: 1000, status: 'final' })

    const entries = await lines(t)
    expect(entries).toHaveLength(2)
    expect(entries.reduce((n, l) => n + (l.side === 'Dr' ? l.amount : -l.amount), 0)).toBe(0)

    const [bill] = await stored(t)
    expect(bill).toMatchObject({ id: 'bill-a', number: '1', voucherId: res.voucherId, ledgerId: res.ledgerId })
    expect(bill.postedAt).toBeGreaterThan(0)
  })

  it('refuses the whole save when the Sales account is missing — no bill, no voucher', async () => {
    const t = await shop({ sales: false })
    await expect(t.mutation(api.billLedger.postBill, { bill: aBill() }))
      .rejects.toThrow('"Sales" account is missing')
    expect(await vouchers(t)).toHaveLength(0)
    expect(await stored(t)).toHaveLength(0)
  })

  it('names the missing piece rather than saving a bill with no amount or party', async () => {
    const t = await shop()
    await expect(t.mutation(api.billLedger.postBill, { bill: aBill({ customerName: '  ' }) }))
      .rejects.toThrow('no customer name')
    await expect(t.mutation(api.billLedger.postBill, { bill: aBill({ total: 0 }) }))
      .rejects.toThrow('no amount')
    expect(await stored(t)).toHaveLength(0)
  })

  it('retries onto the same voucher instead of posting a second one', async () => {
    const t = await shop()
    const first = await t.mutation(api.billLedger.postBill, { bill: aBill() })
    const again = await t.mutation(api.billLedger.postBill, { bill: { ...aBill(), ...first.bill } })

    expect(again.voucherId).toBe(first.voucherId)
    expect(await vouchers(t)).toHaveLength(1)
    expect(await lines(t)).toHaveLength(2)
    expect(await stored(t)).toHaveLength(1)
  })

  it('re-prices the voucher on an edit rather than adding the difference', async () => {
    const t = await shop()
    const first = await t.mutation(api.billLedger.postBill, { bill: aBill() })
    await t.mutation(api.billLedger.postBill, { bill: { ...first.bill, total: 250 } })

    const entries = await lines(t)
    expect(entries).toHaveLength(2)
    expect(entries.every(l => l.amount === 250)).toBe(true)
    expect((await vouchers(t))[0].amount).toBe(250)
  })

  it('opens one account for a party however the name is spaced or cased', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill({ customerName: 'M/S Vishal Prasad' }) })
    await t.mutation(api.billLedger.postBill, { bill: aBill({ id: 'bill-b', number: '2', customerName: 'M/s  vishal prasad' }) })

    const parties = await t.run(ctx => ctx.db.query('ledgers').collect())
    expect(parties.filter(l => l.name.toLowerCase().includes('vishal'))).toHaveLength(1)
  })

  it('gives two PCs saving at once different bill and voucher numbers', async () => {
    const t = await shop()
    // Both counters opened a new bill while each believed it was number 1.
    const a = await t.mutation(api.billLedger.postBill, { bill: aBill({ id: 'bill-a', number: '1' }) })
    const b = await t.mutation(api.billLedger.postBill, { bill: aBill({ id: 'bill-b', number: '1', customerName: 'Suresh' }) })

    expect(a.number).toBe('1')
    expect(b.number).toBe('2')
    const numbers = (await vouchers(t)).map(v => v.voucherNo).sort()
    expect(numbers).toEqual([1, 2])
  })

  it('does not reissue a number the ledger path already used, whichever counter it came from', async () => {
    const t = await shop()
    // A voucher numbered by the old builder counter, with `vno:` never touched.
    await t.run(async ctx => {
      const type = (await ctx.db.query('voucherTypes').collect())[0]
      const party = await ctx.db.insert('ledgers', {
        name: 'Older Customer', groupId: (await ctx.db.query('groups').collect())[0]._id,
        openingBalance: 0, openingSide: 'Dr', openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1,
      })
      await ctx.db.insert('vouchers', {
        typeId: type._id, voucherNo: 4, fy: '2026-27', date: Date.parse('2026-09-01'),
        partyLedgerId: party, status: 'final', amount: 10, attachments: [], createdAt: 1, updatedAt: 1,
      })
    })

    await t.mutation(api.billLedger.postBill, { bill: aBill() })
    const numbers = (await vouchers(t)).map(v => v.voucherNo).sort()
    expect(numbers).toEqual([4, 5])
  })

  it('will not reuse the number of a bill sitting in the trash', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill() })
    await t.mutation(api.bills.remove, { id: 'bill-a' })

    const next = await t.mutation(api.billLedger.postBill, { bill: aBill({ id: 'bill-b', number: '1' }) })
    expect(next.number).toBe('2')
  })

  it('refuses to write back a bill that was deleted on another device', async () => {
    const t = await shop()
    const first = await t.mutation(api.billLedger.postBill, { bill: aBill() })
    await t.mutation(api.bills.remove, { id: 'bill-a' })

    await expect(t.mutation(api.billLedger.postBill, { bill: { ...first.bill, total: 9999 } }))
      .rejects.toThrow('deleted on another device')
  })

  it('keeps BILL-n on the voucher even when the operator types a reference', async () => {
    const t = await shop()
    // "07" is the shop's own note on the bill — a site, a slip number. It used
    // to land on the voucher, which then matched no bill, and the day book
    // showed the one sale twice: once as SAL-0063, once as bill 15.
    const res = await t.mutation(api.billLedger.postBill, { bill: aBill({ number: '15', ref: '07' }) })

    const [voucher] = await vouchers(t)
    expect(voucher.refNo).toBe('BILL-15')
    const [bill] = await stored(t)
    expect(bill.ref).toBe('07')            // the bill keeps what was typed
    expect(bill.voucherId).toBe(res.voucherId)
  })

  it('takes the voucher to the trash with its bill, reference or no reference', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill({ number: '15', ref: '07' }) })
    // A voucher renamed from the ledger side is still this bill's voucher.
    await t.run(async ctx => {
      const [v] = await ctx.db.query('vouchers').collect()
      await ctx.db.patch(v._id, { refNo: 'SITE-07' })
    })

    await t.mutation(api.bills.remove, { id: 'bill-a' })
    expect(await vouchers(t)).toHaveLength(0)
    expect(await lines(t)).toHaveLength(0)
    expect(await t.run(ctx => ctx.db.query('trash').collect())).toHaveLength(1)
  })

  it('keeps a borrowed voucher out of the bill list', async () => {
    const t = await shop()
    const { voucherId } = await t.mutation(api.billLedger.postBill, { bill: aBill() })
    await t.mutation(api.billLedger.postBill, {
      bill: { ...aBill({ id: `vch-${voucherId}`, total: 500 }), voucherId },
      keepAsBill: false,
    })

    expect(await stored(t)).toHaveLength(1)
    expect((await vouchers(t))[0].amount).toBe(500)
  })
})

describe('deletions between devices', () => {
  it('tells other devices what was deleted, and keeps telling them after the bin is emptied', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill() })
    await t.mutation(api.bills.remove, { id: 'bill-a' })

    expect(await t.query(api.bills.deletedIds, {})).toEqual(['bill-a'])

    // The device that still holds a copy pushes it, as it does every few
    // seconds. It must not come back.
    await t.mutation(api.bills.save, { bills: [aBill()], billSeq: 1 })
    expect(await stored(t)).toHaveLength(0)

    const [row] = await t.run(ctx => ctx.db.query('billsTrash').collect())
    await t.run(async ctx => { await ctx.db.delete(row._id) })   // bin emptied
    await t.mutation(api.bills.save, { bills: [aBill()], billSeq: 1 })
    expect(await stored(t)).toHaveLength(0)
    expect(await t.query(api.bills.deletedIds, {})).toEqual(['bill-a'])
  })

  it('forgets the deletion when the bill is restored', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill() })
    await t.mutation(api.bills.remove, { id: 'bill-a' })
    const [row] = await t.run(ctx => ctx.db.query('billsTrash').collect())
    await t.mutation(api.bills.restore, { id: row._id })

    expect(await t.query(api.bills.deletedIds, {})).toEqual([])
    expect(await stored(t)).toHaveLength(1)
  })

  it('lets a newer copy win and an older one lose', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill() })
    const [current] = await stored(t)

    await t.mutation(api.bills.save, { bills: [{ ...current, customerName: 'Stale PC', updatedAt: 1 }], billSeq: 1 })
    expect((await stored(t))[0].customerName).toBe('Ramesh Kumar')

    await t.mutation(api.bills.save, { bills: [{ ...current, customerName: 'Newer PC', updatedAt: Date.now() + 1000 }], billSeq: 1 })
    expect((await stored(t))[0].customerName).toBe('Newer PC')
  })
})

describe('the catalogue', () => {
  it('does not let a device that has never synced wipe it', async () => {
    const t = await shop()
    await t.mutation(api.catalog.save, {
      hardwareCatalog: { Hinges: { sizes: ['4"'], brands: ['Ebco'] } }, customCatalog: [], sets: [],
    })
    const res = await t.mutation(api.catalog.save, { hardwareCatalog: {}, customCatalog: [], sets: [] })

    expect(res).toMatchObject({ ignored: true })
    const snapshot = await t.query(api.catalog.get, {})
    expect(Object.keys(snapshot?.hardwareCatalog ?? {})).toEqual(['Hinges'])
  })
})

describe('money taken against a bill', () => {
  /** The review's acceptance case, as one voucher. */
  it('splits a part-paid sale between the customer and the drawer', async () => {
    const t = await shop()
    const res = await t.mutation(api.billLedger.postBill, {
      bill: aBill({ total: 10000, paidAmount: 4000, paymentMode: 'cash' }),
    })

    const entries = await lines(t)
    const byLedger = new Map<string, number>()
    const names = await t.run(ctx => ctx.db.query('ledgers').collect())
    for (const e of entries) {
      const name = names.find(l => l._id === e.ledgerId)!.name
      byLedger.set(name, (byLedger.get(name) ?? 0) + (e.side === 'Dr' ? e.amount : -e.amount))
    }

    expect(byLedger.get('Ramesh Kumar')).toBe(6000)
    expect(byLedger.get('Cash')).toBe(4000)
    expect(byLedger.get('Sales')).toBe(-10000)
    expect([...byLedger.values()].reduce((a, b) => a + b, 0)).toBe(0)
    expect((await vouchers(t))[0].amount).toBe(10000)
    expect(res.voucherId).toBeTruthy()
  })

  it('leaves the customer owing nothing when the bill is paid in full', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill({ total: 500, paidAmount: 500 }) })
    const names = await t.run(ctx => ctx.db.query('ledgers').collect())
    const party = names.find(l => l.name === 'Ramesh Kumar')!
    expect((await lines(t)).filter(e => e.ledgerId === party._id)).toHaveLength(0)
  })

  it('sends online money to the bank and cash to the drawer', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill({ total: 800, paidAmount: 800, paymentMode: 'online' }) })
    const names = await t.run(ctx => ctx.db.query('ledgers').collect())
    const bank = names.find(l => l.name === 'Bank')!
    expect((await lines(t)).some(e => e.ledgerId === bank._id && e.side === 'Dr' && e.amount === 800)).toBe(true)
  })

  it('takes the part payment back out when the bill is edited to unpaid', async () => {
    const t = await shop()
    const first = await t.mutation(api.billLedger.postBill, { bill: aBill({ total: 1000, paidAmount: 400 }) })
    await t.mutation(api.billLedger.postBill, { bill: { ...first.bill, paidAmount: 0, paid: false } })

    const names = await t.run(ctx => ctx.db.query('ledgers').collect())
    const cash = names.find(l => l.name === 'Cash')!
    expect((await lines(t)).filter(e => e.ledgerId === cash._id)).toHaveLength(0)
    expect((await lines(t)).reduce((n, l) => n + (l.side === 'Dr' ? l.amount : -l.amount), 0)).toBe(0)
  })

  it('never takes more than the bill', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill({ total: 300, paidAmount: 5000 }) })
    const names = await t.run(ctx => ctx.db.query('ledgers').collect())
    const cash = names.find(l => l.name === 'Cash')!
    expect((await lines(t)).find(e => e.ledgerId === cash._id)?.amount).toBe(300)
  })

  it('says which account is missing rather than posting a one-sided entry', async () => {
    const t = await shop({ cash: false })
    await expect(t.mutation(api.billLedger.postBill, { bill: aBill({ paidAmount: 100 }) }))
      .rejects.toThrow('"Cash" account is missing')
    expect(await vouchers(t)).toHaveLength(0)
  })
})

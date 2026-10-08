/// <reference types="vite/client" />
/**
 * The one posting path.
 *
 * These cover the three ways the old split path let the books drift: a bill
 * that saved while its voucher failed, two PCs handing out the same number,
 * and a deletion that only happened on one machine.
 */
import { convexTest } from './trustedConvex'
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

/**
 * What the counter types, and what the books file it under.
 *
 * A firm is written "M/s" on every document, and both doors into the books now
 * add it — the account form always did, and a name typed onto a bill does too.
 * They disagreed before, which is how one firm ended up with two accounts and
 * its balance split between them.
 */
const TYPED = 'Ramesh Kumar'
const FILED = 'M/s Ramesh Kumar'

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

  it('requires a customer, but files an unpriced bill as pending', async () => {
    const t = await shop()
    await expect(t.mutation(api.billLedger.postBill, { bill: aBill({ customerName: '  ' }) }))
      .rejects.toThrow('no customer name')
    const pending = await t.mutation(api.billLedger.postBill, { bill: aBill({ total: 0 }) })
    expect((await vouchers(t))[0]).toMatchObject({ status: 'pending' })
    expect((await vouchers(t))[0].amount).toBeUndefined()
    expect(await lines(t)).toHaveLength(0)
    expect((await stored(t))[0]).toMatchObject({ id: 'bill-a', voucherId: pending.voucherId, total: 0 })
  })

  it('files a bill with a goods line still at zero as pending, even with a total', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, {
      bill: aBill({
        total: 100,
        items: [
          { id: 'i1', description: 'Mica HR 8224 SF', qty: 11, unit: 'Pc', amount: 0 },
          { id: 'i2', description: 'Fare', qty: 1, unit: 'Pc', amount: 100 },
        ],
      }),
    })
    expect((await vouchers(t))[0]).toMatchObject({ status: 'pending' })
  })

  it('posts a priced bill as final when a discount line is negative', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, {
      bill: aBill({
        total: 4250,
        items: [
          { id: 'i1', description: '4284 NGN', qty: 3, unit: 'Pc', amount: 2700, rateSqft: 900 },
          { id: 'i2', description: '240 HDG', qty: 1, unit: 'Pc', amount: 900, rateSqft: 900 },
          { id: 'i3', description: '111 HDG', qty: 1, unit: 'Pc', amount: 900, rateSqft: 900 },
          // Picked from My Items, so no isDiscount or isRoundup flag.
          { id: 'i4', description: 'Discount', qty: 1, unit: 'Pc', amount: -250, rateSqft: -250 },
        ],
      }),
    })
    expect((await vouchers(t))[0]).toMatchObject({ status: 'final', amount: 4250 })
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

    await t.mutation(api.bills.save, { bills: [{ ...current, notes: 'Stale PC', updatedAt: 1 }], billSeq: 1 })
    expect((await stored(t))[0].notes).not.toBe('Stale PC')

    await t.mutation(api.bills.save, { bills: [{ ...current, notes: 'Newer PC', updatedAt: Date.now() + 1000 }], billSeq: 1 })
    expect((await stored(t))[0].notes).toBe('Newer PC')
    // The party, like the money, changes only by posting: an upload cannot
    // move the bill off the account its voucher is on.
    await t.mutation(api.bills.save, { bills: [{ ...current, customerName: 'Newer PC', updatedAt: Date.now() + 2000 }], billSeq: 1 })
    expect((await stored(t))[0].customerName).toBe(TYPED)
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

    expect(byLedger.get(FILED)).toBe(6000)
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
    const party = names.find(l => l.name === FILED)!
    const mine = (await lines(t)).filter(e => e.ledgerId === party._id)
    const net = mine.reduce((n, e) => n + (e.side === 'Dr' ? e.amount : -e.amount), 0)
    expect(net).toBe(0)
  })

  /**
   * This used to assert the customer had no lines at all. The sale and the
   * money were netted, and a sale paid in full was worth zero on the account,
   * so it was dropped — which left a cash customer's ledger blank, and the
   * counter writing a receipt beside every sale by hand just to see on the
   * account what had been bought and that it was paid.
   */
  it('shows both the sale and the payment on the customer, from one voucher', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill({ total: 500, paidAmount: 500 }) })
    const names = await t.run(ctx => ctx.db.query('ledgers').collect())
    const party = names.find(l => l.name === FILED)!
    const mine = (await lines(t)).filter(e => e.ledgerId === party._id)
    expect(mine.map(e => [e.side, e.amount])).toEqual([['Dr', 500], ['Cr', 500]])
    expect(new Set(mine.map(e => e.voucherId)).size).toBe(1)
    // One voucher. No receipt was written beside it.
    const vouchers = await t.run(ctx => ctx.db.query('vouchers').collect())
    expect(vouchers).toHaveLength(1)
  })

  it('shows the whole bill and the part paid, owing the difference', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill({ total: 1000, paidAmount: 400 }) })
    const names = await t.run(ctx => ctx.db.query('ledgers').collect())
    const party = names.find(l => l.name === FILED)!
    const mine = (await lines(t)).filter(e => e.ledgerId === party._id)
    expect(mine.map(e => [e.side, e.amount])).toEqual([['Dr', 1000], ['Cr', 400]])
    const net = mine.reduce((n, e) => n + (e.side === 'Dr' ? e.amount : -e.amount), 0)
    expect(net).toBe(600)
  })

  it('writes nothing extra on a sale taken entirely on credit', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill({ total: 700, paidAmount: 0 }) })
    const names = await t.run(ctx => ctx.db.query('ledgers').collect())
    const party = names.find(l => l.name === FILED)!
    const mine = (await lines(t)).filter(e => e.ledgerId === party._id)
    expect(mine.map(e => [e.side, e.amount])).toEqual([['Dr', 700]])
  })

  it('reopens a ledger-only sale with its actual payment, including zero', async () => {
    const t = await shop()
    const credit = await t.mutation(api.billLedger.postBill, {
      bill: aBill({ id: 'credit', number: '1', total: 700, paidAmount: 0 }),
    })
    const paid = await t.mutation(api.billLedger.postBill, {
      bill: aBill({ id: 'paid', number: '2', total: 500, paidAmount: 500 }),
    })
    expect((await t.query(api.vouchers.detail, { id: credit.voucherId })).paidAmount).toBe(0)
    expect((await t.query(api.vouchers.detail, { id: paid.voucherId })).paidAmount).toBe(500)
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

describe('a discount given at settlement', () => {
  /** The counter's case: a ₹30,080 bill settled by ₹29,830 with ₹250 knocked off. */
  const settled = async (over: Record<string, unknown> = {}) => {
    const t = await shop()
    await t.run(async ctx => {
      const income = (await ctx.db.query('groups').collect())
        .find(g => g.name === 'Sales Accounts')!
      await ctx.db.insert('ledgers', {
        name: 'Discount Allowed', groupId: income._id,
        openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1,
        active: true, createdAt: 1, updatedAt: 1,
      })
    })
    await t.mutation(api.billLedger.postBill, {
      bill: aBill({ kind: 'receipt', total: 30080, discount: 250, paymentMode: 'cash', ...over }),
    })
    const names = await t.run(ctx => ctx.db.query('ledgers').collect())
    const byLedger = new Map<string, number>()
    for (const e of await lines(t)) {
      const name = names.find(l => l._id === e.ledgerId)!.name
      byLedger.set(name, (byLedger.get(name) ?? 0) + (e.side === 'Dr' ? e.amount : -e.amount))
    }
    return { t, byLedger }
  }

  it('clears the party for the money and the discount together', async () => {
    const { byLedger } = await settled()
    // Credited the whole 30,080, so the account is square rather than 250 short.
    expect(byLedger.get(FILED)).toBe(-30080)
  })

  it('puts only the money in the drawer', async () => {
    const { byLedger } = await settled()
    expect(byLedger.get('Cash')).toBe(29830)
  })

  it('puts the discount on its own account, not the drawer', async () => {
    const { byLedger } = await settled()
    expect(byLedger.get('Discount Allowed')).toBe(250)
  })

  it('balances', async () => {
    const { byLedger } = await settled()
    expect([...byLedger.values()].reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('sends the money to the bank when it was paid online, discount unchanged', async () => {
    const { byLedger } = await settled({ paymentMode: 'online' })
    expect(byLedger.get('Bank')).toBe(29830)
    expect(byLedger.get('Discount Allowed')).toBe(250)
    expect(byLedger.get('Cash') ?? 0).toBe(0)
  })

  it('writes no discount line when none was given', async () => {
    const { byLedger } = await settled({ discount: 0 })
    expect(byLedger.get('Discount Allowed') ?? 0).toBe(0)
    expect(byLedger.get('Cash')).toBe(30080)
    expect(byLedger.get(FILED)).toBe(-30080)
  })

  it('never discounts more than the voucher settles', async () => {
    const { byLedger } = await settled({ discount: 99999 })
    expect(byLedger.get('Discount Allowed')).toBe(30080)
    expect(byLedger.get('Cash') ?? 0).toBe(0)
    expect([...byLedger.values()].reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('says which account is missing rather than posting a one-sided entry', async () => {
    const t = await shop()
    await expect(t.mutation(api.billLedger.postBill, {
      bill: aBill({ kind: 'receipt', total: 30080, discount: 250 }),
    })).rejects.toThrow('"Discount Allowed" account is missing')
    expect(await vouchers(t)).toHaveLength(0)
  })

  it('leaves a sale alone — a discount there is a line on the bill, not a settlement', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, {
      bill: aBill({ total: 1000, paidAmount: 400, discount: 250 }),
    })
    const names = await t.run(ctx => ctx.db.query('ledgers').collect())
    const cash = names.find(l => l.name === 'Cash')!
    expect((await lines(t)).find(e => e.ledgerId === cash._id)?.amount).toBe(400)
    expect((await lines(t)).reduce((n, l) => n + (l.side === 'Dr' ? l.amount : -l.amount), 0)).toBe(0)
  })
})

describe('one party, one account', () => {
  /**
   * The bug this pins: the account form wrote "M/s" in front of a firm and a
   * name typed onto a bill did not, and neither recognised the other — so one
   * firm got two accounts with the balance split between them.
   */
  const partiesOf = async (t: ReturnType<typeof convexTest>) => {
    const groups = await t.run(ctx => ctx.db.query('groups').collect())
    const debtors = groups.find(g => g.name === 'Sundry Debtors')!
    const all = await t.run(ctx => ctx.db.query('ledgers').collect())
    return all.filter(l => l.groupId === debtors._id)
  }

  it('files a bill-opened account under the courtesy, like the account form', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill({ customerName: TYPED }) })
    expect((await partiesOf(t)).map(l => l.name)).toEqual([FILED])
  })

  it('does not open a second account when the courtesy is typed as well', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill({ id: 'b1', customerName: TYPED }) })
    await t.mutation(api.billLedger.postBill, { bill: aBill({ id: 'b2', customerName: FILED }) })
    expect(await partiesOf(t)).toHaveLength(1)
  })

  it('does not open a second account for a different spelling of the courtesy', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill({ id: 'b1', customerName: TYPED }) })
    for (const spelling of ['M/S Ramesh Kumar', 'm/s ramesh kumar', '  Ramesh   Kumar ']) {
      await t.mutation(api.billLedger.postBill, { bill: aBill({ id: `b-${spelling}`, customerName: spelling }) })
    }
    expect(await partiesOf(t)).toHaveLength(1)
  })

  it('keeps both bills on the one account, so the balance is not split', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill({ id: 'b1', customerName: TYPED, total: 1000 }) })
    await t.mutation(api.billLedger.postBill, { bill: aBill({ id: 'b2', customerName: FILED, total: 500 }) })
    const party = (await partiesOf(t))[0]
    const owed = (await lines(t))
      .filter(e => e.ledgerId === party._id)
      .reduce((n, e) => n + (e.side === 'Dr' ? e.amount : -e.amount), 0)
    expect(owed).toBe(1500)
  })

  it('leaves a woman\'s title alone — "Ms Priya" is not the firm courtesy', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill({ customerName: 'Ms Priya' }) })
    expect((await partiesOf(t)).map(l => l.name)).toEqual(['M/s Ms Priya'])
  })

  it('keeps two different parties apart', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aBill({ id: 'b1', customerName: 'Ramesh Kumar, Kundru' }) })
    await t.mutation(api.billLedger.postBill, { bill: aBill({ id: 'b2', customerName: 'Ramesh Kumar, Naisarai' }) })
    expect(await partiesOf(t)).toHaveLength(2)
  })
})


describe('a W/B sale', () => {
  const wbBill = (over: Record<string, unknown> = {}) => aBill({
    customerName: 'W/B', customerPhone: '9876543210', customerUid: '123456789012', paidAmount: 0,
    items: [{ id: 'goods', description: 'Plywood', qty: 2, unit: 'Pc', amount: 1000 }],
    ...over,
  })
  const receipts = async (t: ReturnType<typeof convexTest>) =>
    (await vouchers(t)).filter(v => v.paysFor === 'BILL-1')

  it('posts the sale on W/B and its cash as a receipt of its own', async () => {
    const t = await shop()
    const result = await t.mutation(api.billLedger.postBill, { bill: wbBill() })
    const entries = await lines(t)
    const partyEntries = entries.filter(e => String(e.ledgerId) === String(result.ledgerId))
    expect(partyEntries.reduce((sum, e) => sum + (e.side === 'Dr' ? e.amount : -e.amount), 0)).toBe(0)
    expect(partyEntries).toHaveLength(2)
    expect(result.bill.paidAmount).toBe(1000)
    // A walk-in's number is kept when it was typed, like anybody else's.
    expect(result.bill.customerPhone).toBe('9876543210')
    expect(result.bill.customerUid).toBe('123456789012')

    const sale = (await vouchers(t)).find(v => v._id === result.voucherId)!
    const saleLines = entries.filter(e => e.voucherId === sale._id)
    expect(saleLines.map(e => [e.side, e.amount])).toEqual([['Dr', 1000], ['Cr', 1000]])

    const [receipt] = await receipts(t)
    expect(receipt).toMatchObject({ amount: 1000, status: 'final', partyLedgerId: result.ledgerId, voucherNo: 1 })
    const cash = await t.run(ctx => ctx.db.query('ledgers').filter(q => q.eq(q.field('name'), 'Cash')).first())
    expect(entries.filter(e => e.voucherId === receipt._id).map(e => [String(e.ledgerId), e.side, e.amount]))
      .toEqual([[String(cash!._id), 'Dr', 1000], [String(result.ledgerId), 'Cr', 1000]])
  })

  it('rewrites the one receipt when the bill is saved again', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: wbBill() })
    await t.mutation(api.billLedger.postBill, { bill: wbBill({
      total: 1500, items: [{ id: 'goods', description: 'Plywood', qty: 3, unit: 'Pc', amount: 1500 }],
    }) })
    const all = await receipts(t)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ amount: 1500, voucherNo: 1 })
  })

  it('drops the receipt when the bill moves to a customer on credit', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: wbBill() })
    await t.mutation(api.billLedger.postBill, { bill: wbBill({ customerName: 'Ramesh Kumar' }) })
    expect(await receipts(t)).toHaveLength(0)
  })

  it('takes the receipt with the bill to the trash, and back', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: wbBill() })
    await t.mutation(api.bills.remove, { id: 'bill-a' })
    expect(await vouchers(t)).toHaveLength(0)
    expect(await lines(t)).toHaveLength(0)

    const [row] = await t.run(ctx => ctx.db.query('billsTrash').collect())
    await t.mutation(api.bills.restore, { id: row._id })
    expect(await receipts(t)).toHaveLength(1)
    expect(await vouchers(t)).toHaveLength(2)
  })
})

describe('taking the money off a paid sale', () => {
  it('leaves the sale on credit and the bill unpaid', async () => {
    const t = await shop()
    const res = await t.mutation(api.billLedger.postBill, { bill: aBill({ paidAmount: 1000, paid: true }) })
    expect(await lines(t)).toHaveLength(4)

    await t.mutation(api.vouchers.dropSettlement, { id: res.voucherId })
    const left = await lines(t)
    expect(left.map(l => [l.side, l.amount]).sort()).toEqual([['Cr', 1000], ['Dr', 1000]])
    expect(left.find(l => l.side === 'Dr')!.ledgerId).toBe(res.ledgerId)
    const [bill] = await stored(t)
    expect(bill).toMatchObject({ paidAmount: 0, paid: false })
  })
})

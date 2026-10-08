/// <reference types="vite/client" />
/**
 * Paper that has only been sorted is not yet a day's work.
 *
 * Naming a slip in the sorter opens the customer's account and writes a
 * pending voucher for the photographs to hang on. That voucher carries no
 * amount and no entries, so it never moved a balance — but it did show, and
 * two hundred-odd blank SAL- lines were sitting in the day book and on the
 * customers' own ledgers for bills nobody had read yet.
 *
 * These are the two halves of the rule: out of the books while unpriced, and
 * back in the moment somebody prices one.
 */
import { convexTest } from './trustedConvex'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

async function shop() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const debtors = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const income = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 1 })
    const ledger = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    await ctx.db.insert('ledgers', { ...ledger, name: 'Sales', groupId: income })
    await ctx.db.insert('ledgers', { ...ledger, name: 'Raj Kumar', groupId: debtors })
    await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
  })
  return t
}

const partyId = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const l = await ctx.db.query('ledgers').collect()
    return l.find((x) => x.name === 'Raj Kumar')!._id
  })

const salesId = (t: ReturnType<typeof convexTest>) =>
  t.run(async (ctx) => {
    const l = await ctx.db.query('ledgers').collect()
    return l.find((x) => x.name === 'Sales')!._id
  })

/** A slip named in the sorter: a pending voucher with a filing row on it. */
async function sortedSlip(t: ReturnType<typeof convexTest>) {
  const party = await partyId(t)
  const sales = await salesId(t)
  const voucherId = await t.mutation(api.vouchers.createSale, {
    date: Date.UTC(2026, 8, 20),
    partyLedgerId: party,
    salesLedgerId: sales,
  } as never)
  await t.run(async (ctx) => {
    await ctx.db.insert('filing', {
      voucherId,
      partyLedgerId: party,
      capturedAt: Date.UTC(2026, 8, 20),
      stage: 'named',
      at: Date.UTC(2026, 8, 20),
    } as never)
  })
  return { voucherId, party, sales }
}

describe('a slip that has only been sorted', () => {
  it('is kept out of the day book', async () => {
    const t = await shop()
    await sortedSlip(t)
    expect(await t.query(api.reports.dayBook, {})).toEqual([])
  })

  it('is kept off the customer\'s own ledger', async () => {
    const t = await shop()
    const { party } = await sortedSlip(t)
    const view = await t.query(api.reports.ledger, { ledgerId: party } as never)
    expect(view.pending).toEqual([])
    // The badge and the list have to agree, or the page reads as broken.
    expect(view.pendingCount).toBe(0)
  })

  /**
   * The queue is the list of exactly these bills. Filtering it would hide the
   * work from the person whose job is to do it.
   */
  it('still shows in the pricing queue, which is where it belongs', async () => {
    const t = await shop()
    await sortedSlip(t)
    expect(await t.query(api.reports.pendingBills, {})).toHaveLength(1)
  })

  it('opened the customer an account, which is the whole point', async () => {
    const t = await shop()
    await sortedSlip(t)
    const names = await t.run(async (ctx) =>
      (await ctx.db.query('ledgers').collect()).map((l) => l.name))
    expect(names).toContain('Raj Kumar')
  })

  it('moved no balance while it was unpriced', async () => {
    const t = await shop()
    await sortedSlip(t)
    expect(await t.run((ctx) => ctx.db.query('voucherEntries').collect())).toEqual([])
  })
})

describe('once it is priced', () => {
  it('appears in the day book like any other sale', async () => {
    const t = await shop()
    const { voucherId, sales } = await sortedSlip(t)
    expect(await t.query(api.reports.dayBook, {})).toEqual([])

    // The real pricing path, not a hand-patched row: this is the mutation the
    // counter actually runs, and it is what turns the slip into a sale.
    await t.mutation(api.vouchers.price, {
      id: voucherId, amount: 4500, accountLedgerId: sales,
    } as never)

    const book = await t.query(api.reports.dayBook, {})
    expect(book).toHaveLength(1)
    expect(book[0]).toMatchObject({ amount: 4500, party: 'Raj Kumar' })
  })

  it('posts to the customer\'s ledger once priced, and not before', async () => {
    const t = await shop()
    const { voucherId, party, sales } = await sortedSlip(t)
    expect((await t.query(api.reports.ledger, { ledgerId: party } as never)).rows).toEqual([])

    await t.mutation(api.vouchers.price, {
      id: voucherId, amount: 4500, accountLedgerId: sales,
    } as never)

    const view = await t.query(api.reports.ledger, { ledgerId: party } as never)
    expect(view.rows).toHaveLength(1)
    expect(view.closing).toBe(4500)
    expect(view.closingSide).toBe('Dr')
  })
})

describe('a voucher that never came from the sorter', () => {
  it('is untouched by any of this', async () => {
    const t = await shop()
    const party = await partyId(t)
    const sales = await salesId(t)
    await t.mutation(api.vouchers.createSale, {
      date: Date.UTC(2026, 8, 20),
      partyLedgerId: party,
      salesLedgerId: sales,
      amount: 1200,
    } as never)
    expect(await t.query(api.reports.dayBook, {})).toHaveLength(1)
  })

  /**
   * A pending voucher with no filing row is one somebody started by hand and
   * has not finished. It is not sorter output and must stay visible, or it
   * disappears with no way to find it again.
   */
  it('keeps a hand-written pending voucher in the day book', async () => {
    const t = await shop()
    const party = await partyId(t)
    const sales = await salesId(t)
    await t.mutation(api.vouchers.createSale, {
      date: Date.UTC(2026, 8, 20),
      partyLedgerId: party,
      salesLedgerId: sales,
    } as never)
    expect(await t.query(api.reports.dayBook, {})).toHaveLength(1)
  })
})

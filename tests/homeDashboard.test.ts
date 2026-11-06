/// <reference types="vite/client" />
import { convexTest } from './trustedConvex'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

/** A customer, a supplier, and a supplier's old history account. */
async function shop() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const g = (name: string, nature: 'asset' | 'liability' | 'income' | 'expense', normalSide: 'Dr' | 'Cr', sort: number) =>
      ctx.db.insert('groups', { name, nature, normalSide, sort })
    const debtors = await g('Sundry Debtors', 'asset', 'Dr', 1)
    const creditors = await g('Sundry Creditors', 'liability', 'Cr', 2)
    const sales = await g('Sales Accounts', 'income', 'Cr', 3)
    const purchases = await g('Purchase Accounts', 'expense', 'Dr', 4)
    const bank = await g('Bank Accounts', 'asset', 'Dr', 5)
    const deposits = await g('Deposits (Asset)', 'asset', 'Dr', 6)
    const base = { openingBalance: 0, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1, openingSide: 'Dr' as const }
    const ledger = (name: string, groupId: typeof debtors) => ctx.db.insert('ledgers', { ...base, name, groupId })
    for (const [name, abbr, sort] of [['Sale', 'SAL', 1], ['Purchase', 'PUR', 2], ['Receipt', 'RCT', 3], ['Payment', 'PAY', 4]] as const) {
      await ctx.db.insert('voucherTypes', { name, abbr, sort })
    }
    return {
      customer: await ledger('M/s Ramesh', debtors),
      supplier: await ledger('M/s SRT', creditors),
      salesAc: await ledger('Sales', sales),
      purchasesAc: await ledger('Purchases', purchases),
      bank: await ledger('Bank', bank),
      history: await ledger('SRT Old History', deposits),
    }
  })
  const at = (iso: string) => ({ date: day(iso), partyLedgerId: ids.customer })
  return {
    t, ids,
    sale: (iso: string, amount: number) => t.mutation(api.vouchers.createSale, { ...at(iso), salesLedgerId: ids.salesAc, amount }),
    receipt: (iso: string, amount: number) => t.mutation(api.vouchers.createReceipt, { ...at(iso), receivedIntoLedgerId: ids.bank, amount }),
    oldPurchase: (iso: string, amount: number) => t.mutation(api.vouchers.createPurchase, {
      date: day(iso), partyLedgerId: ids.supplier, purchaseLedgerId: ids.history, amount, refNo: 'SRT statement 1',
    }),
    purchase: (iso: string, amount: number) => t.mutation(api.vouchers.createPurchase, {
      date: day(iso), partyLedgerId: ids.supplier, purchaseLedgerId: ids.purchasesAc, amount,
    }),
  }
}

const ask = (to: string) => ({
  from: day(to), to: day(to) + 86_399_999, months: 6,
  monthFrom: Date.parse(`${to.slice(0, 7)}-01T00:00:00Z`),
})

describe('the home page', () => {
  it('says when sales were last written, and how far the month has come against the last', async () => {
    const s = await shop()
    await s.sale('2026-10-03', 1000)
    await s.sale('2026-10-20', 5000)
    await s.sale('2026-11-02', 1500)
    await s.receipt('2026-11-03', 700)
    const home = await s.t.query(api.reports.dashboard, {
      ...ask('2026-11-06'),
      lastMonthFrom: day('2026-10-01'), lastMonthTo: day('2026-10-06') + 86_399_999,
    })
    expect(home.last).toEqual({ sale: day('2026-11-02'), receipt: day('2026-11-03'), payment: null })
    expect(home.month).toEqual({ sales: 1500, received: 700, paid: 0 })
    expect(home.lastMonth).toEqual({ sales: 1000, received: 0, paid: 0 })
    expect(home.day.entries).toBe(0)
  })

  it('shows how long a balance has sat since the party last paid', async () => {
    const s = await shop()
    await s.sale('2026-10-01', 9000)
    await s.receipt('2026-10-10', 2000)
    const home = await s.t.query(api.reports.dashboard, ask('2026-11-06'))
    expect(home.topOwing).toMatchObject([{ name: 'M/s Ramesh', amount: 7000, lastMoney: day('2026-10-10') }])
  })

  it('leaves a supplier\'s copied-in old history out of the monthly chart', async () => {
    const s = await shop()
    await s.oldPurchase('2026-07-15', 80000)
    await s.purchase('2026-07-20', 3000)
    const home = await s.t.query(api.reports.dashboard, ask('2026-11-06'))
    expect(home.months.find((m) => m.ym === '2026-07')?.purchases).toBe(3000)
    // Still owed all the same: the balance is the books, the chart is the trade.
    expect(home.topOwed).toMatchObject([{ name: 'M/s SRT', amount: 83000 }])
  })
})

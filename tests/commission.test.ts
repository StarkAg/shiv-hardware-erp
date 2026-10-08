/// <reference types="vite/client" />
/**
 * The cut owed to whoever brought the customer in.
 */
import { convexTest } from './trustedConvex'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

async function shop() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const debtors = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const income = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 1 })
    const ledger = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    const sales = await ctx.db.insert('ledgers', { ...ledger, name: 'Sales', groupId: income, openingSide: 'Cr' as const })
    // Brought in by a carpenter, so his cut is owed on what they buy.
    const brought = await ctx.db.insert('ledgers', { ...ledger, name: 'M/s Raj Kumar', groupId: debtors, commissionTo: 'Ramesh Mistri' })
    // A walk-in. Owes nobody anything.
    const walkIn = await ctx.db.insert('ledgers', { ...ledger, name: 'M/s Anil Sah', groupId: debtors })
    await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
    return { sales, brought, walkIn, debtors }
  })
  return { t, ...ids }
}

const sell = (t: ReturnType<typeof convexTest>, partyLedgerId: string, salesLedgerId: string, amount: number) =>
  t.mutation(api.vouchers.createSale, { date: 1, partyLedgerId, salesLedgerId, amount } as never)

describe('commission', () => {
  it('starts unpaid, and the tick sticks', async () => {
    const { t, brought, sales } = await shop()
    await sell(t, brought, sales, 5000)

    let report = await t.query(api.reports.ledger, { ledgerId: brought } as never)
    expect(report!.account.commissionTo).toBe('Ramesh Mistri')
    expect(report!.rows).toHaveLength(1)
    expect(report!.rows[0].commissionPaid).toBe(false)

    await t.mutation(api.vouchers.setCommissionPaid, { id: report!.rows[0].voucherId, paid: true } as never)
    report = await t.query(api.reports.ledger, { ledgerId: brought } as never)
    expect(report!.rows[0].commissionPaid).toBe(true)

    // And it can be taken back off — a cut marked paid by mistake.
    await t.mutation(api.vouchers.setCommissionPaid, { id: report!.rows[0].voucherId, paid: false } as never)
    report = await t.query(api.reports.ledger, { ledgerId: brought } as never)
    expect(report!.rows[0].commissionPaid).toBe(false)
  })

  it('leaves an account that owes nobody alone', async () => {
    const { t, walkIn, sales } = await shop()
    await sell(t, walkIn, sales, 900)

    const report = await t.query(api.reports.ledger, { ledgerId: walkIn } as never)
    // Nobody named, so the ledger has nothing to say about commission and the
    // column is never drawn. The row still reports a plain false rather than
    // undefined, so the view never has to guess.
    expect(report!.account.commissionTo).toBeUndefined()
    expect(report!.rows[0].commissionPaid).toBe(false)
  })

  it('writes the tick to the history, naming who it was for', async () => {
    const { t, brought, sales } = await shop()
    await sell(t, brought, sales, 5000)
    const report = await t.query(api.reports.ledger, { ledgerId: brought } as never)
    await t.mutation(api.vouchers.setCommissionPaid, { id: report!.rows[0].voucherId, paid: true } as never)

    const history = await t.run((ctx) => ctx.db.query('history').collect())
    const line = history.find((h) => h.action === 'voucher.commission')
    expect(line?.summary).toContain('Ramesh Mistri')
    expect(line?.summary).toContain('marked paid')
  })

  it('clearing the carpenter takes him off the account', async () => {
    const { t, brought } = await shop()
    await t.mutation(api.masters.updateLedger, { id: brought, commissionTo: '   ' } as never)
    const report = await t.query(api.reports.ledger, { ledgerId: brought } as never)
    expect(report!.account.commissionTo).toBeUndefined()
  })
})

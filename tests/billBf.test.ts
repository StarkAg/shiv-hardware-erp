/// <reference types="vite/client" />
import { convexTest } from './trustedConvex'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

async function shop() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    const debtors = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const income = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 2 })
    const money = await ctx.db.insert('groups', { name: 'Cash-in-Hand', nature: 'asset', normalSide: 'Dr', sort: 4 })
    const base = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    await ctx.db.insert('ledgers', { ...base, name: 'Manoj Kumar', groupId: debtors, openingBalance: 370 })
    await ctx.db.insert('ledgers', { ...base, name: 'Sales', groupId: income, openingSide: 'Cr' })
    await ctx.db.insert('ledgers', { ...base, name: 'Cash', groupId: money })
    await ctx.db.insert('ledgers', { ...base, name: 'Bank', groupId: money })
    for (const [name, abbr] of [['Sale', 'SAL'], ['Receipt', 'RCT']] as const) {
      await ctx.db.insert('voucherTypes', { name, abbr, sort: 0 })
    }
  })
  return t
}

const sale = (over: Record<string, unknown> = {}) => ({
  id: 'bf-bill', number: '', kind: 'sale', date: '2026-10-20', customerName: 'Manoj Kumar',
  items: [{ id: 'a', description: 'Edge', qty: 1, unit: 'Pc', amount: 1000 }], total: 1000,
  paid: true, paidAmount: 1000, paymentMode: 'cash', bf: 370, ...over,
})

const vouchers = (t: ReturnType<typeof convexTest>) => t.run(async ctx => {
  const rows = await ctx.db.query('vouchers').collect()
  return Promise.all(rows.map(async v => ({
    ...v,
    lines: (await ctx.db.query('voucherEntries').collect()).filter(e => e.voucherId === v._id),
  })))
})

describe('Old dues brought forward on a bill', () => {
  it('posts money paid for the old dues as its own receipt, outside the sale', async () => {
    const t = await shop()
    const posted = await t.mutation(api.billLedger.postBill, { bill: sale({ bfPaid: 370 }) })
    const all = await vouchers(t)
    expect(all).toHaveLength(2)
    const saleVoucher = all.find(v => v._id === posted.voucherId)!
    expect(saleVoucher.amount).toBe(1000)
    const receipt = all.find(v => v._id !== posted.voucherId)!
    expect(receipt.paysFor).toBe(saleVoucher.refNo)
    expect(receipt.amount).toBe(370)
    expect(receipt.narration).toMatch(/Old dues/)
    expect(receipt.lines.map(l => [l.side, l.amount]).sort()).toEqual([['Cr', 370], ['Dr', 370]])
    expect(posted.bill).toMatchObject({ bf: 370, bfPaid: 370 })
  })

  it('writes no receipt when nothing was paid toward the old dues, and drops one taken off', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: sale({ bfPaid: 200 }) })
    expect(await vouchers(t)).toHaveLength(2)
    await t.mutation(api.billLedger.postBill, { bill: sale({ bfPaid: undefined }) })
    expect(await vouchers(t)).toHaveLength(1)
  })

  it('never lets more than the old dues go to them', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: sale({ bfPaid: 900 }) })
    const receipt = (await vouchers(t)).find(v => v.paysFor)!
    expect(receipt.amount).toBe(370)
  })
})

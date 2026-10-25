/**
 * A receipt, payment or refund is the money itself. A goods line left on one
 * (typed before the bill's kind was changed) is no part of it, and must not
 * park it as an unpriced bill waiting for rates: BILL-593, a 15,000 UPI
 * receipt with a stray "15000 x 1 Pc" line, went into the books as a pending
 * RCT with no amount and an "Enter rates" button.
 */
import { convexTest } from './trustedConvex'
import { describe, expect, test } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

async function shop() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    await ctx.db.insert('groups', { name: 'Sundry Creditors', nature: 'liability', normalSide: 'Cr', sort: 1 })
    const cash = await ctx.db.insert('groups', { name: 'Cash-in-Hand', nature: 'asset', normalSide: 'Dr', sort: 2 })
    const bank = await ctx.db.insert('groups', { name: 'Bank Accounts', nature: 'asset', normalSide: 'Dr', sort: 3 })
    const base = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    await ctx.db.insert('ledgers', { ...base, name: 'Cash', groupId: cash })
    await ctx.db.insert('ledgers', { ...base, name: 'Bank', groupId: bank })
    await ctx.db.insert('voucherTypes', { name: 'Receipt', abbr: 'RCT', sort: 1 })
    await ctx.db.insert('voucherTypes', { name: 'Payment', abbr: 'PMT', sort: 2 })
  })
  return t
}

const stray = [{ id: 'l1', description: '15000', qty: 1, unit: 'Pc', amount: 0 }]

describe('a money voucher with a goods line left on it', () => {
  test('a receipt posts its money, not as waiting for rates', async () => {
    const t = await shop()
    const out = await t.mutation(api.billLedger.postBill, {
      bill: {
        id: 'b593', number: '593', date: '2026-10-24', customerName: 'Pappu Jee', kind: 'receipt',
        items: stray, moneyAmount: 15000, total: 15000, paid: true, paidAmount: 0, paymentMode: 'upi',
      },
    } as any)
    const v = await t.run((ctx) => ctx.db.get(out.voucherId))
    expect(v?.status).toBe('final')
    expect(v?.amount).toBe(15000)
    expect(out.bill.items).toEqual([])
  })

  test('a payment does the same', async () => {
    const t = await shop()
    const out = await t.mutation(api.billLedger.postBill, {
      bill: {
        id: 'p1', number: '1', date: '2026-10-24', customerName: 'Some Supplier', kind: 'payment',
        items: stray, moneyAmount: 4000, total: 4000, paid: true, paymentMode: 'cash',
      },
    } as any)
    const v = await t.run((ctx) => ctx.db.get(out.voucherId))
    expect(v?.status).toBe('final')
    expect(v?.amount).toBe(4000)
  })
})

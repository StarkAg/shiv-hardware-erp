/// <reference types="vite/client" />
/**
 * Money handed back to a customer, and the months that fall due on staff and
 * premises.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api, internal } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

async function shop() {
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const income = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 1 })
    const cash = await ctx.db.insert('groups', { name: 'Cash-in-Hand', nature: 'asset', normalSide: 'Dr', sort: 2 })
    const ledger = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    await ctx.db.insert('ledgers', { ...ledger, name: 'Sales', groupId: income, openingSide: 'Cr' as const })
    await ctx.db.insert('ledgers', { ...ledger, name: 'Cash', groupId: cash })
    await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
    await ctx.db.insert('voucherTypes', { name: 'Payment', abbr: 'PAY', sort: 1 })
  })
  return t
}

const bill = (over: Record<string, unknown> = {}) => ({
  id: 'bill-r',
  number: '149',
  date: '2026-09-17',
  customerName: 'Manoj Kumar',
  kind: 'sale',
  items: [],
  total: 92,
  paid: false,
  ...over,
})

const sidesOf = async (t: ReturnType<typeof convexTest>) =>
  t.run(async ctx => {
    const out: Record<string, string> = {}
    for (const e of await ctx.db.query('voucherEntries').collect()) {
      const l = await ctx.db.get(e.ledgerId)
      out[l!.name] = `${e.side} ${e.amount}`
    }
    return out
  })

describe('a refund', () => {
  it('debits the customer and credits the drawer, in its own series', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, {
      bill: bill({ kind: 'refund', moneyAmount: 92, discount: 30 }),
    })
    const [voucher] = await t.run(ctx => ctx.db.query('vouchers').collect())
    const type = await t.run(ctx => ctx.db.get(voucher.typeId))
    expect(type).toMatchObject({ name: 'Refund', abbr: 'REF' })
    expect(voucher.voucherNo).toBe(1)
    // Nothing is let off a refund, even if a discount rode in on the draft.
    expect(await sidesOf(t)).toEqual({ 'M/s Manoj Kumar': 'Dr 92', Cash: 'Cr 92' })
  })

  it('takes the next refund number when a sale is saved again as one', async () => {
    const t = await shop()
    await t.mutation(api.billLedger.postBill, { bill: bill({ id: 'other', number: '1', total: 500 }) })
    await t.mutation(api.billLedger.postBill, { bill: bill() })
    const before = await t.run(ctx => ctx.db.query('vouchers').collect())
    expect(before.map(v => v.voucherNo).sort()).toEqual([1, 2])

    await t.mutation(api.billLedger.postBill, { bill: bill({ kind: 'refund', moneyAmount: 92 }) })
    const after = await t.run(async ctx => {
      const rows = []
      for (const v of await ctx.db.query('vouchers').collect()) {
        rows.push({ ref: v.refNo, abbr: (await ctx.db.get(v.typeId))!.abbr, no: v.voucherNo })
      }
      return rows
    })
    expect(after).toContainEqual({ ref: 'BILL-149', abbr: 'REF', no: 1 })
    expect(after).toContainEqual({ ref: 'BILL-1', abbr: 'SAL', no: 1 })
  })
})

describe('salary and rent', () => {
  it('loads the sheet once, with the rent owed since July', async () => {
    const t = await shop()
    const first = await t.mutation(internal.monthly.loadSheet, {})
    expect(first.made).toHaveLength(9)
    expect(first.posted).toHaveLength(8)
    const again = await t.mutation(internal.monthly.loadSheet, {})
    expect(again).toEqual({ made: [], posted: [] })

    const board = await t.query(api.monthly.board, {})
    const owed = Object.fromEntries(board.rent.map(r => [r.name, r.due]))
    expect(owed).toEqual({
      'Back Upper Godown': 121050,
      'Front Godown': 77400,
      'Shop + Back Down Godown': 88050,
    })
    expect(board.totals.rent.due).toBe(286500)
    expect(board.totals.staff).toEqual({ monthly: 121800, due: 0, paid: 0 })
  })

  it('charges a month to everyone once, and a payment comes off what is owed', async () => {
    const t = await shop()
    await t.mutation(internal.monthly.loadSheet, {})
    const charged = await t.mutation(api.monthly.chargeMonth, { kind: 'staff', month: '2026-09' })
    expect(charged.posted).toHaveLength(6)
    const twice = await t.mutation(api.monthly.chargeMonth, { kind: 'staff', month: '2026-09' })
    expect(twice.posted).toHaveLength(0)
    expect(twice.already).toHaveLength(6)

    // A wage handed over at the counter, on the same voucher screen as any payment.
    await t.mutation(api.billLedger.postBill, {
      bill: bill({ id: 'wage', number: '', customerName: 'Anup', kind: 'payment', total: 500, moneyAmount: 500 }),
    })
    const board = await t.query(api.monthly.board, {})
    const anup = board.staff.find(r => r.name === 'Anup')!
    expect(anup).toMatchObject({ charged: 19500, paid: 500, due: 19000 })
    expect(anup.months.map(m => m.label)).toEqual(['Sep 2026'])
  })

  it('refuses a month that is not one', async () => {
    const t = await shop()
    await expect(t.mutation(api.monthly.chargeMonth, { kind: 'rent', month: '2026-13' })).rejects.toThrow()
  })
})

/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

/** A shop with a customer, a supplier, and the two return accounts. */
async function shop() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const g = async (name: string, nature: string, normalSide: 'Dr' | 'Cr', sort: number) =>
      ctx.db.insert('groups', { name, nature: nature as never, normalSide, sort })
    const debtors = await g('Sundry Debtors', 'asset', 'Dr', 1)
    const creditors = await g('Sundry Creditors', 'liability', 'Cr', 2)
    const sales = await g('Sales Accounts', 'income', 'Cr', 3)
    const purchases = await g('Purchase Accounts', 'expense', 'Dr', 4)
    const base = { openingBalance: 0, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    const customer = await ctx.db.insert('ledgers', { ...base, name: 'M/s Ramesh Kumar', groupId: debtors, openingSide: 'Dr' as const })
    const supplier = await ctx.db.insert('ledgers', { ...base, name: 'M/s Shyam Traders', groupId: creditors, openingSide: 'Cr' as const })
    const salesReturn = await ctx.db.insert('ledgers', { ...base, name: 'Sales Return', groupId: sales, openingSide: 'Dr' as const })
    const purchaseReturn = await ctx.db.insert('ledgers', { ...base, name: 'Purchase Return', groupId: purchases, openingSide: 'Cr' as const })
    await ctx.db.insert('voucherTypes', { name: 'Goods Return', abbr: 'GR', sort: 5 })
    return { customer, supplier, salesReturn, purchaseReturn }
  })
  return { t, ids }
}

const aReturn = (customerName: string, over: Record<string, unknown> = {}) => ({
  id: 'gr-1',
  number: '1',
  date: '2026-09-15',
  customerName,
  kind: 'return',
  items: [{ id: 'i1', description: 'Abro Tape', qty: 2, unit: 'B/L', amount: 220 }],
  total: 220,
  paid: false,
  ...over,
})

const linesOf = (t: Awaited<ReturnType<typeof shop>>['t']) =>
  t.run((ctx) => ctx.db.query('voucherEntries').collect())

describe('a goods return', () => {
  it('from a customer credits the customer and debits Sales Return', async () => {
    const { t, ids } = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aReturn('Ramesh Kumar') })
    const lines = await linesOf(t)
    expect(lines).toHaveLength(2)
    expect(lines.find((l) => l.ledgerId === ids.customer)).toMatchObject({ side: 'Cr', amount: 220 })
    expect(lines.find((l) => l.ledgerId === ids.salesReturn)).toMatchObject({ side: 'Dr', amount: 220 })
  })

  it('to a supplier debits the supplier and credits Purchase Return', async () => {
    const { t, ids } = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aReturn('M/s Shyam Traders') })
    const lines = await linesOf(t)
    expect(lines.find((l) => l.ledgerId === ids.supplier)).toMatchObject({ side: 'Dr', amount: 220 })
    expect(lines.find((l) => l.ledgerId === ids.purchaseReturn)).toMatchObject({ side: 'Cr', amount: 220 })
  })

  it('numbers in the Goods Return series', async () => {
    const { t } = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aReturn('Ramesh Kumar') })
    const [voucher] = await t.run((ctx) => ctx.db.query('vouchers').collect())
    const type = await t.run((ctx) => ctx.db.get(voucher.typeId))
    expect(type?.name).toBe('Goods Return')
    expect(voucher).toMatchObject({ voucherNo: 1, status: 'final', amount: 220 })
  })

  it('takes no money, even if the bill says paid', async () => {
    const { t, ids } = await shop()
    await t.mutation(api.billLedger.postBill, { bill: aReturn('Ramesh Kumar', { paid: true, paidAmount: 220 }) })
    const lines = await linesOf(t)
    expect(lines).toHaveLength(2)
    expect(lines.find((l) => l.ledgerId === ids.customer)).toMatchObject({ side: 'Cr', amount: 220 })
  })

  it('refuses a name that is not an account, so it cannot guess the side', async () => {
    const { t } = await shop()
    await expect(t.mutation(api.billLedger.postBill, { bill: aReturn('Somebody New') }))
      .rejects.toThrow('not an account')
    expect(await t.run((ctx) => ctx.db.query('ledgers').collect())).toHaveLength(4)
  })
})

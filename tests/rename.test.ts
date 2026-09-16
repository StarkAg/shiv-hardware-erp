/// <reference types="vite/client" />
/**
 * A rename is only a rename if the old name goes wherever it was written.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

const bill = (over: Record<string, unknown>) => ({
  number: '1', date: '2026-09-11', kind: 'sale', items: [], total: 1000, paid: false, updatedAt: 5, ...over,
})

async function shop() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    const debtors = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const creditors = await ctx.db.insert('groups', { name: 'Sundry Creditors', nature: 'liability', normalSide: 'Cr', sort: 1 })
    const base = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    const customer = await ctx.db.insert('ledgers', { ...base, name: 'Ramesh', groupId: debtors, phone: '9800000000' })
    const other = await ctx.db.insert('ledgers', { ...base, name: 'Suresh', groupId: debtors })
    const supplier = await ctx.db.insert('ledgers', { ...base, name: 'Ramesh', groupId: creditors, openingSide: 'Cr' as const })
    await ctx.db.insert('billsStore', {
      billSeq: 5, savedAt: 1,
      bills: [
        bill({ id: 'by-id', customerName: 'Ramesh', ledgerId: customer }),
        // written before bills recorded their account, and spelled loosely
        bill({ id: 'by-name', customerName: 'M/s RAMESH' }),
        bill({ id: 'someone-else', customerName: 'Suresh', ledgerId: other }),
        // the supplier of the same name, on a purchase
        bill({ id: 'supplier', customerName: 'Ramesh', kind: 'purchase', ledgerId: supplier }),
      ],
    })
    await ctx.db.insert('billsTrash', {
      billId: 'binned', deletedAt: 2, bill: bill({ id: 'binned', customerName: 'Ramesh', ledgerId: customer }),
    })
    await ctx.db.insert('customers', { name: 'Ramesh', mobile: '9800000000', updatedAt: 1 })
    await ctx.db.insert('customers', { name: 'Ramesh', mobile: '9111111111', updatedAt: 1 })
    return { customer, supplier }
  })
  return { t, ...ids }
}

// The books write a party the way it goes on paper: "M/s" in front.
const NEW = 'M/s Ramesh Traders'

const bills = async (t: any) =>
  Object.fromEntries((await t.run((ctx: any) => ctx.db.query('billsStore').first())).bills.map((b: any) => [b.id, b]))

describe('renaming an account', () => {
  it('renames every bill that belongs to it, by id or by its old name', async () => {
    const { t, customer } = await shop()
    await t.mutation(api.masters.updateLedger, { id: customer, name: 'Ramesh Traders' })
    const b = await bills(t)
    expect(b['by-id'].customerName).toBe(NEW)
    expect(b['by-name'].customerName).toBe(NEW)
    // and the loosely spelled one is tied to the account now, so the next
    // rename finds it by id
    expect(b['by-name'].ledgerId).toBe(customer)
  })

  it('stamps each renamed bill newer, so a stale device cannot put the old name back', async () => {
    const { t, customer } = await shop()
    await t.mutation(api.masters.updateLedger, { id: customer, name: 'Ramesh Traders' })
    // a device that was off pushes the copy it had
    await t.mutation(api.bills.save, { billSeq: 5, bills: [bill({ id: 'by-id', customerName: 'Ramesh', ledgerId: customer })] })
    expect((await bills(t))['by-id'].customerName).toBe(NEW)
  })

  it('leaves other parties alone, including a supplier of the same name', async () => {
    const { t, customer } = await shop()
    await t.mutation(api.masters.updateLedger, { id: customer, name: 'Ramesh Traders' })
    const b = await bills(t)
    expect(b['someone-else'].customerName).toBe('Suresh')
    expect(b.supplier.customerName).toBe('Ramesh')
  })

  it('renames the copy in the bin, so a restore brings back the new name', async () => {
    const { t, customer } = await shop()
    await t.mutation(api.masters.updateLedger, { id: customer, name: 'Ramesh Traders' })
    const [row] = await t.run(ctx => ctx.db.query('billsTrash').collect())
    expect(row.bill.customerName).toBe(NEW)
  })

  it('renames the customer record with the same number, not a namesake with another', async () => {
    const { t, customer } = await shop()
    await t.mutation(api.masters.updateLedger, { id: customer, name: 'Ramesh Traders' })
    const rows = await t.run(ctx => ctx.db.query('customers').collect())
    expect(rows.find(r => r.mobile === '9800000000')!.name).toBe(NEW)
    expect(rows.find(r => r.mobile === '9111111111')!.name).toBe('Ramesh')
  })

  it('a supplier rename never touches a customer bill of the same name', async () => {
    const { t, supplier } = await shop()
    await t.mutation(api.masters.updateLedger, { id: supplier, name: 'Ramesh Suppliers' })
    const b = await bills(t)
    expect(b.supplier.customerName).toBe('M/s Ramesh Suppliers')
    expect(b['by-name'].customerName).toBe('M/s RAMESH')
    expect(b['by-id'].customerName).toBe('Ramesh')
  })
})

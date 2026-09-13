/// <reference types="vite/client" />
/**
 * Holes that only open when two safe-looking operations meet.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it, vi } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

async function shop() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    const debtors = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const income = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 1 })
    const base = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    await ctx.db.insert('ledgers', { ...base, name: 'Sales', groupId: income, openingSide: 'Cr' as const })
    const partyId = await ctx.db.insert('ledgers', { ...base, name: 'Ramesh Kumar', groupId: debtors })
    await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
    return { partyId }
  })
  return { t, ...ids }
}

const aBill = (over: Record<string, unknown> = {}) => ({
  id: 'bill-a', number: '1', date: '2026-09-11', customerName: 'Ramesh Kumar',
  kind: 'sale', items: [], total: 1000, paid: false, ...over,
})

describe('deleting an account', () => {
  it('refuses while a voucher of theirs is in the trash', async () => {
    vi.stubEnv('LEDGER_PIN', 'test-pin')
    try {
      const { t, partyId } = await shop()
      await t.mutation(api.billLedger.postBill, { bill: aBill() })
      await t.mutation(api.bills.remove, { id: 'bill-a' })

      // The books are now empty of them — but the trash is not, and restoring
      // it would put lines back against an account that no longer exists.
      await expect(t.mutation(api.masters.removeLedger, { id: partyId, pin: 'test-pin' }))
        .rejects.toThrow(/trash/i)

      // And once the trash is emptied for good, it can go.
      const [row] = await t.run(ctx => ctx.db.query('billsTrash').collect())
      await t.mutation(api.bills.purge, { id: row._id, pin: 'test-pin' })
      await t.mutation(api.masters.removeLedger, { id: partyId, pin: 'test-pin' })
      expect(await t.run(ctx => ctx.db.get(partyId))).toBeNull()
    } finally { vi.unstubAllEnvs() }
  })
})

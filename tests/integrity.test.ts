/// <reference types="vite/client" />
/**
 * Holes that only open when two safe-looking operations meet.
 */
import { convexTest } from './trustedConvex'
import { describe, expect, it, vi } from 'vitest'
import schema from '../convex/schema'
import { api, internal } from '../convex/_generated/api'

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
      await expect(t.mutation(internal.masters.removeLedger, { id: partyId }))
        .rejects.toThrow(/trash/i)

      // And once the trash is emptied for good, it can go.
      const [row] = await t.run(ctx => ctx.db.query('billsTrash').collect())
      await t.mutation(api.bills.purge, { id: row._id, pin: 'test-pin' })
      await t.mutation(internal.masters.removeLedger, { id: partyId })
      expect(await t.run(ctx => ctx.db.get(partyId))).toBeNull()
    } finally { vi.unstubAllEnvs() }
  })

  it('says what the bin holds, so the screen can offer the way through', async () => {
    vi.stubEnv('LEDGER_PIN', 'test-pin')
    try {
      const { t, partyId } = await shop()
      await t.mutation(api.billLedger.postBill, { bill: aBill() })
      await t.mutation(api.bills.remove, { id: 'bill-a' })

      await expect(t.mutation(internal.masters.removeLedger, { id: partyId }))
        .rejects.toMatchObject({ data: { kind: 'trash' } })
    } finally { vi.unstubAllEnvs() }
  })

  it('goes, with what the bin held, when that is asked for', async () => {
    vi.stubEnv('LEDGER_PIN', 'test-pin')
    try {
      const { t, partyId } = await shop()
      await t.mutation(api.billLedger.postBill, { bill: aBill() })
      await t.mutation(api.bills.remove, { id: 'bill-a' })

      await t.mutation(internal.masters.removeLedger, { id: partyId, purgeTrash: true })

      expect(await t.run(ctx => ctx.db.get(partyId))).toBeNull()
      // Nothing is left in either bin pointing at an account that has gone.
      const binned = await t.run(ctx => ctx.db.query('trash').collect())
      const binnedBills = await t.run(ctx => ctx.db.query('billsTrash').collect())
      expect(binned.filter(r => r.partyLedgerId === partyId)).toHaveLength(0)
      expect(binnedBills.filter(r => r.bill?.ledgerId === partyId)).toHaveLength(0)
    } finally { vi.unstubAllEnvs() }
  })

  it('still refuses while the books themselves hold a voucher, purge or not', async () => {
    vi.stubEnv('LEDGER_PIN', 'test-pin')
    try {
      const { t, partyId } = await shop()
      await t.mutation(api.billLedger.postBill, { bill: aBill() })

      // Live entries are not the bin's to clear: this one must not go.
      await expect(t.mutation(internal.masters.removeLedger, { id: partyId, purgeTrash: true }))
        .rejects.toThrow(/entries|vouchers/i)
      expect(await t.run(ctx => ctx.db.get(partyId))).not.toBeNull()
    } finally { vi.unstubAllEnvs() }
  })
})

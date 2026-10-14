/// <reference types="vite/client" />
/**
 * One writer, as Tally has it: a bill and its voucher change together or not
 * at all, and nothing goes into the books dated after today.
 */
import { convexTest } from './trustedConvex'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')
const CODE = 'test-pin-only'
beforeEach(() => { vi.stubEnv('LEDGER_PIN', CODE) })
afterEach(() => { vi.unstubAllEnvs() })

async function fixture() {
  const t = convexTest(schema, modules)
  const date = Date.UTC(2026, 8, 11)
  const ids = await t.run(async ctx => {
    const groupId = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const ledger = { groupId, openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    const partyId = await ctx.db.insert('ledgers', { ...ledger, name: 'Test Customer' })
    const salesId = await ctx.db.insert('ledgers', { ...ledger, name: 'Sales' })
    const typeId = await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
    const voucherId = await ctx.db.insert('vouchers', { typeId, voucherNo: 7, fy: '2026-27', date, partyLedgerId: partyId, refNo: 'R-1', status: 'final', amount: 125, attachments: [], createdAt: 1, updatedAt: 1 })
    for (const [ledgerId, side] of [[partyId, 'Dr'], [salesId, 'Cr']] as const) {
      await ctx.db.insert('voucherEntries', { voucherId, ledgerId, side, amount: 125, date })
    }
    return { partyId, salesId, voucherId }
  })
  return { t, ...ids }
}

describe('one writer', () => {
  it('will not delete an account while a bill still names it (bill 445)', async () => {
    const { t, partyId } = await fixture()
    const lonely = await t.run(async ctx => {
      const groupId = (await ctx.db.query('groups').first())!._id
      return ctx.db.insert('ledgers', { groupId, name: 'Harsh', openingBalance: 0, openingSide: 'Dr', openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 })
    })
    await t.run(ctx => ctx.db.insert('billsStore', { bills: [{ id: 'b445', number: '445', kind: 'receipt', ledgerId: lonely, total: 5555, items: [] }], billSeq: 445, savedAt: 1 }))
    await expect(t.mutation(api.masters.removeLedger, { id: lonely, pin: CODE })).rejects.toThrow(/Bill 445 is for this account/)
    expect(partyId).toBeTruthy()
  })

  it('takes no new bill except by posting it', async () => {
    const { t } = await fixture()
    const res = await t.mutation(api.bills.save, {
      billSeq: 1,
      bills: [
        { id: 'unposted', number: '9', kind: 'sale', total: 50, items: [], updatedAt: 1 },
        { id: 'quote', number: 'Q-1', kind: 'quotation', total: 50, items: [], updatedAt: 1 },
      ],
    })
    expect(res).toMatchObject({ written: 1, refused: 1 })
    expect((await t.query(api.bills.get, {}))?.bills.map((b: any) => b.id)).toEqual(['quote'])
  })

  it('refuses a voucher dated after today, by any way in', async () => {
    const { t, voucherId } = await fixture()
    const tomorrow = Date.now() + 2 * 86_400_000
    await expect(t.mutation(api.vouchers.update, { id: voucherId, date: tomorrow })).rejects.toThrow(/after today/)
  })

  it('moves a voucher into the new year\'s series when its date crosses 1 April', async () => {
    const { t, voucherId } = await fixture()
    await t.mutation(api.vouchers.update, { id: voucherId, date: Date.UTC(2026, 2, 20) })
    const v = await t.run(ctx => ctx.db.get(voucherId))
    expect(v).toMatchObject({ fy: '2025-26', voucherNo: 1 })
    const lines = await t.run(ctx => ctx.db.query('voucherEntries').collect())
    expect(lines.every(l => l.date === Date.UTC(2026, 2, 20))).toBe(true)
  })
})

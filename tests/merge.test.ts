/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api, internal } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

async function books() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const debtors = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const creditors = await ctx.db.insert('groups', { name: 'Sundry Creditors', nature: 'liability', normalSide: 'Cr', sort: 1 })
    const income = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 2 })
    const base = { openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    const keep = await ctx.db.insert('ledgers', { ...base, name: 'M/s WB', groupId: debtors, openingBalance: 100, openingSide: 'Dr' as const })
    const gone = await ctx.db.insert('ledgers', { ...base, name: 'M/s W/B', groupId: debtors, openingBalance: 40, openingSide: 'Cr' as const, phone: '9999999999' })
    const supplier = await ctx.db.insert('ledgers', { ...base, name: 'M/s WB Traders', groupId: creditors, openingBalance: 0, openingSide: 'Cr' as const })
    const sales = await ctx.db.insert('ledgers', { ...base, name: 'Sales', groupId: income, openingBalance: 0, openingSide: 'Cr' as const })
    const typeId = await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })

    const voucher = await ctx.db.insert('vouchers', {
      typeId, voucherNo: 1, fy: '2026-27', date: 1, partyLedgerId: gone, status: 'final', amount: 500, attachments: [], createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('voucherEntries', { voucherId: voucher, ledgerId: gone, side: 'Dr', amount: 500, date: 1 })
    await ctx.db.insert('voucherEntries', { voucherId: voucher, ledgerId: sales, side: 'Cr', amount: 500, date: 1 })
    await ctx.db.insert('trash', {
      typeId, voucherNo: 2, fy: '2026-27', date: 2, partyLedgerId: gone, status: 'final', amount: 70, attachments: [], createdAt: 2, updatedAt: 2,
      entries: [{ ledgerId: gone, side: 'Dr', amount: 70 }, { ledgerId: sales, side: 'Cr', amount: 70 }], deletedAt: 3,
    })
    await ctx.db.insert('billsStore', { bills: [{ id: 'b1', number: '1', ledgerId: gone, items: [], total: 500 }], billSeq: 1, savedAt: 1 })
    return { keep, gone, supplier, voucher }
  })
  return { t, ids }
}

describe('merging two accounts for one party', () => {
  it('a dry run changes nothing', async () => {
    const { t, ids } = await books()
    const res = await t.mutation(internal.merge.accounts, { pairs: [{ keep: 'M/s WB', absorb: 'M/s W/B' }], dryRun: true })
    expect(res.merged[0]).toMatchObject({ entries: 1, vouchers: 1, trash: 1, opening: '60 Dr' })
    expect(await t.run((ctx) => ctx.db.get(ids.gone))).not.toBeNull()
  })

  it('moves vouchers, lines, the bin and bills onto the kept account and adds the openings', async () => {
    const { t, ids } = await books()
    await t.mutation(internal.merge.accounts, { pairs: [{ keep: 'M/s WB', absorb: 'M/s W/B' }] })

    const state = await t.run(async (ctx) => ({
      gone: await ctx.db.get(ids.gone),
      keep: await ctx.db.get(ids.keep),
      voucher: await ctx.db.get(ids.voucher),
      entries: await ctx.db.query('voucherEntries').collect(),
      trash: await ctx.db.query('trash').collect(),
      store: await ctx.db.query('billsStore').first(),
    }))
    expect(state.gone).toBeNull()
    expect(state.keep).toMatchObject({ openingBalance: 60, openingSide: 'Dr', phone: '9999999999' })
    expect(state.voucher?.partyLedgerId).toBe(ids.keep)
    expect(state.entries.some((e) => e.ledgerId === ids.gone)).toBe(false)
    expect(state.trash[0].partyLedgerId).toBe(ids.keep)
    expect(state.trash[0].entries.every((e) => e.ledgerId !== ids.gone)).toBe(true)
    expect(state.store?.bills[0].ledgerId).toBe(ids.keep)
  })

  it('refuses a customer and a supplier', async () => {
    const { t } = await books()
    await expect(t.mutation(internal.merge.accounts, { pairs: [{ keep: 'M/s WB', absorb: 'M/s WB Traders' }] }))
      .rejects.toThrow('different sides')
  })

  it('will not open a second account for a name written with other punctuation', async () => {
    const { t, ids } = await books()
    const group = await t.run(async (ctx) => (await ctx.db.get(ids.keep))!.groupId)
    await expect(t.mutation(api.masters.createLedger, {
      name: 'W.B.', groupId: group, openingBalance: 0, openingSide: 'Dr', openingAsOf: 1,
    })).rejects.toThrow('already exists')
  })
})

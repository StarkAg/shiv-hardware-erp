/// <reference types="vite/client" />
import { convexTest } from './trustedConvex'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api, internal } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

async function shop() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const group = (name: string, nature: 'liability' | 'expense', normalSide: 'Cr' | 'Dr', sort: number) =>
      ctx.db.insert('groups', { name, nature, normalSide, sort })
    const creditors = await group('Sundry Creditors', 'liability', 'Cr', 1)
    const purchases = await group('Purchase Accounts', 'expense', 'Dr', 2)
    const base = { openingBalance: 0, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    const party = await ctx.db.insert('ledgers', { ...base, name: 'M/s SRT', groupId: creditors, openingSide: 'Cr' })
    const account = await ctx.db.insert('ledgers', { ...base, name: 'Old', groupId: purchases, openingSide: 'Dr' })
    await ctx.db.insert('voucherTypes', { name: 'Purchase', abbr: 'PUR', sort: 1 })
    return { party, account }
  })
  const buy = (date: string, refNo: string) => t.mutation(api.vouchers.createPurchase, {
    date: Date.parse(`${date}T00:00:00Z`), partyLedgerId: ids.party, purchaseLedgerId: ids.account, amount: 100, refNo,
  })
  const cards = () => t.run((ctx) => ctx.db.query('billFlows').collect())
  return { t, buy, cards }
}

describe('dropping the cards of old statement lines', () => {
  const args = { refPrefix: 'SRT statement ', before: '2026-08-01' }

  it('only counts until it is told to go ahead', async () => {
    const { t, buy, cards } = await shop()
    await buy('2025-05-01', 'SRT statement 1')
    expect(await t.mutation(internal.billFlow.dropOldLineCards, args)).toEqual({ found: 1, removed: 0 })
    expect(await cards()).toHaveLength(1)
  })

  it('takes the old lines off and leaves every other card and all the vouchers', async () => {
    const { t, buy, cards } = await shop()
    await buy('2025-05-01', 'SRT statement 1')
    await buy('2026-10-29', 'SRT statement 2')
    await buy('2025-05-02', 'BILL-7')
    expect(await t.mutation(internal.billFlow.dropOldLineCards, { ...args, confirm: true })).toEqual({ found: 1, removed: 1 })
    expect((await cards()).map((c) => c.date).sort()).toEqual(['2025-05-02', '2026-10-29'])
    expect(await t.run((ctx) => ctx.db.query('vouchers').collect())).toHaveLength(3)
  })

  it('leaves a card that holds a bill or a photo', async () => {
    const { t, buy, cards } = await shop()
    await buy('2025-05-01', 'SRT statement 1')
    const [card] = await cards()
    await t.run((ctx) => ctx.db.patch(card._id, { billId: 'x' }))
    expect(await t.mutation(internal.billFlow.dropOldLineCards, { ...args, confirm: true })).toEqual({ found: 0, removed: 0 })
  })
})

/// <reference types="vite/client" />
/**
 * A customer added by name on the sort app's Ledger screen, with no bill yet.
 *
 * They get a bookmark straight away, so the number can be written on a card
 * before their paper turns up. That number has to be the one their slips land
 * on later, must never be handed to anybody else meanwhile, and comes back
 * when their packet is filed or the hold is freed.
 */
import { convexTest } from './trustedConvex'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

async function shop() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const debtors = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const income = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 1 })
    const led = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    await ctx.db.insert('ledgers', { ...led, name: 'Sales', groupId: income, openingSide: 'Cr' as const })
    await ctx.db.insert('ledgers', { ...led, name: 'Raj Kumar', groupId: debtors })
    await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
  })
  return t
}

const shoot = (t: ReturnType<typeof convexTest>, at: number) =>
  t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([`slip-${at}`], { type: 'image/jpeg' }))
    return ctx.db.insert('inbox', { storageId, at })
  })

const ledgerNamed = (t: ReturnType<typeof convexTest>, name: string) =>
  t.run(async (ctx) => (await ctx.db.query('ledgers').collect()).find((l) => l.name === name)!._id)

describe('adding a customer by name, with no bill', () => {
  it('opens a new account and gives it the lowest free bookmark', async () => {
    const t = await shop()
    const res = await t.mutation(api.filing.addCustomer, { name: 'suresh traders' })
    expect(res).toMatchObject({ name: 'Suresh Traders', slot: 1, slotLabel: 'S01', already: false })

    const rows = await t.query(api.filing.folders, {})
    expect(rows.map((r) => [r.name, r.bills, r.slotLabel])).toEqual([['Suresh Traders', 0, 'S01']])
  })

  it('uses an existing account rather than opening a second one', async () => {
    const t = await shop()
    await t.mutation(api.filing.addCustomer, { name: 'RAJ KUMAR' })
    const named = await t.run(async (ctx) => (await ctx.db.query('ledgers').collect()).filter((l) => /raj kumar/i.test(l.name)))
    expect(named).toHaveLength(1)
  })

  it('never hands the same bookmark to the next customer', async () => {
    const t = await shop()
    await t.mutation(api.filing.addCustomer, { name: 'Suresh Traders' })
    const photo = await shoot(t, 1000)
    const res = await t.mutation(api.filing.nameIt, { inboxId: photo, partyName: 'Raj Kumar' })
    expect(res.slot).toBe(2)
  })

  it("puts the customer's first slip on the bookmark they were given", async () => {
    const t = await shop()
    const added = await t.mutation(api.filing.addCustomer, { name: 'Suresh Traders' })
    const photo = await shoot(t, 1000)
    const res = await t.mutation(api.filing.nameIt, { inboxId: photo, partyName: 'Suresh Traders' })
    expect(res.slot).toBe(added.slot)
  })

  it('keeps the bookmark a customer already holds', async () => {
    const t = await shop()
    const photo = await shoot(t, 1000)
    const named = await t.mutation(api.filing.nameIt, { inboxId: photo, partyName: 'Raj Kumar' })
    const again = await t.mutation(api.filing.addCustomer, { name: 'Raj Kumar' })
    expect(again).toMatchObject({ slot: named.slot, already: true })
  })

  it('shows the hold on the table of bookmarks', async () => {
    const t = await shop()
    await t.mutation(api.filing.addCustomer, { name: 'Suresh Traders' })
    const table = await t.query(api.filing.slots, {})
    expect(table.slots[0]).toMatchObject({ label: 'S01', party: 'Suresh Traders', bills: 0 })
  })

  it('gives the bookmark back when freed, and only then', async () => {
    const t = await shop()
    await t.mutation(api.filing.addCustomer, { name: 'Suresh Traders' })
    const id = await ledgerNamed(t, 'Suresh Traders')
    expect((await t.query(api.filing.partyBills, { partyLedgerId: id }))?.heldOnly).toBe(true)

    expect(await t.mutation(api.filing.freeHold, { partyLedgerId: id })).toEqual({ freed: true })
    const next = await t.mutation(api.filing.addCustomer, { name: 'Raj Kumar' })
    expect(next.slot).toBe(1)
  })

  it("gives the bookmark back when the customer's packet is filed", async () => {
    const t = await shop()
    await t.mutation(api.filing.addCustomer, { name: 'Suresh Traders' })
    const photo = await shoot(t, 1000)
    await t.mutation(api.filing.nameIt, { inboxId: photo, partyName: 'Suresh Traders' })
    await t.mutation(api.filing.placeNext, {})
    await t.mutation(api.filing.fileToFolder, { slot: 1, cabinet: 'A', drawer: '1', no: 1 })

    const holds = await t.run((ctx) => ctx.db.query('filingHolds').collect())
    expect(holds).toHaveLength(0)
    const next = await t.mutation(api.filing.addCustomer, { name: 'Raj Kumar' })
    expect(next.slot).toBe(1)
  })
})

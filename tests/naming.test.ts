/// <reference types="vite/client" />
/**
 * Naming a photographed slip, which is the whole of approving a backlog.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

async function shop() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const debtors = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const income = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 1 })
    const ledger = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    await ctx.db.insert('ledgers', { ...ledger, name: 'Sales', groupId: income, openingSide: 'Cr' as const })
    await ctx.db.insert('ledgers', { ...ledger, name: 'M/s Raj Kumar', groupId: debtors })
    await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
  })
  return t
}

/** A photograph in the inbox, as the phone files one. */
const shoot = async (t: ReturnType<typeof convexTest>, at: number, stack?: string, groupId?: string) =>
  t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([`slip-${at}`], { type: 'image/jpeg' }))
    return ctx.db.insert('inbox', { storageId, at, ...(stack ? { stack } : {}), ...(groupId ? { groupId } : {}) })
  })

describe('naming a slip', () => {
  it('files it as an unpriced sale that touches no balance', async () => {
    const t = await shop()
    const photo = await shoot(t, 1000, 'A')

    const res = await t.mutation(api.filing.nameIt, { inboxId: photo, partyName: 'M/s Raj Kumar' })
    expect(res.party).toBe('M/s Raj Kumar')

    const [voucher] = await t.run((ctx) => ctx.db.query('vouchers').collect())
    // No amount, and therefore no entries at all — the whole point of a
    // pending voucher, and what an unpriced slip is in these books.
    expect(voucher.status).toBe('pending')
    expect(voucher.amount).toBeUndefined()
    expect(await t.run((ctx) => ctx.db.query('voucherEntries').collect())).toHaveLength(0)
    // The photograph is now evidence on the voucher, not a loose picture.
    expect(voucher.attachments).toHaveLength(1)
    expect(await t.run((ctx) => ctx.db.query('inbox').collect())).toHaveLength(0)
  })

  it('dates the voucher when the slip was photographed', async () => {
    const t = await shop()
    const photo = await shoot(t, 4242, 'A')
    await t.mutation(api.filing.nameIt, { inboxId: photo, partyName: 'M/s Raj Kumar' })
    const [voucher] = await t.run((ctx) => ctx.db.query('vouchers').collect())
    expect(voucher.date).toBe(4242)
  })

  it('opens an account for a name the books have never seen', async () => {
    const t = await shop()
    const photo = await shoot(t, 1000)
    await t.mutation(api.filing.nameIt, { inboxId: photo, partyName: 'sharma traders' })
    const opened = await t.run((ctx) =>
      ctx.db.query('ledgers').withIndex('by_name', (q) => q.eq('name', 'Sharma Traders')).unique())
    // Written the shop's way, in proper case, as every other door into the books does.
    expect(opened).toBeTruthy()
  })

  it('leaves the slip on the stack with no slot — naming moves no paper', async () => {
    const t = await shop()
    const photo = await shoot(t, 1000, 'B')
    const res = await t.mutation(api.filing.nameIt, { inboxId: photo, partyName: 'M/s Raj Kumar' })
    expect(res.party).toBe('M/s Raj Kumar')

    const [row] = await t.run((ctx) => ctx.db.query('filing').collect())
    expect(row).toMatchObject({ stack: 'B', stage: 'named', capturedAt: 1000 })
    // The whole point of the two walks: forty slots can sort two thousand bills
    // only because naming a bill does not hold one.
    expect(row.slot).toBeUndefined()
    expect((await t.query(api.filing.slots, {})).used).toBe(0)
  })

  it('names a several-sheet bill once, and files every sheet on it', async () => {
    const t = await shop()
    await shoot(t, 1000, 'A', 'g1')
    const second = await shoot(t, 1001, 'A', 'g1')
    await t.mutation(api.filing.nameIt, { inboxId: second, partyName: 'M/s Raj Kumar' })

    const [voucher] = await t.run((ctx) => ctx.db.query('vouchers').collect())
    expect(voucher.attachments).toHaveLength(2)
    expect(await t.run((ctx) => ctx.db.query('inbox').collect())).toHaveLength(0)
    // One bill, so one row in the queue — and dated by the first sheet shot.
    const rows = await t.run((ctx) => ctx.db.query('filing').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0].capturedAt).toBe(1000)
  })

  it('hands out the oldest slip of the stack asked for, and counts bills not sheets', async () => {
    const t = await shop()
    await shoot(t, 3000, 'B')
    await shoot(t, 1000, 'A', 'g1')
    await shoot(t, 1001, 'A', 'g1')
    await shoot(t, 2000, 'A')

    const a = await t.query(api.filing.toName, { stack: 'A' })
    expect(a.photo?.at).toBe(1000)
    expect(a.photo?.pages).toHaveLength(2)
    expect(a.left).toBe(2)

    const b = await t.query(api.filing.toName, { stack: 'B' })
    expect(b.photo?.at).toBe(3000)
    expect(b.left).toBe(1)
  })

  it('numbers a slip by where it sits in the stack, and keeps saying so', async () => {
    const t = await shop()
    await shoot(t, 1000, 'A')
    await shoot(t, 2000, 'A', 'g1')
    await shoot(t, 2001, 'A', 'g1')
    await shoot(t, 3000, 'A')
    await shoot(t, 5000, 'B')

    // Three bills in stack A; the two sheets of g1 are one of them.
    const first = await t.query(api.filing.toName, { stack: 'A' })
    expect(first).toMatchObject({ index: 1, total: 3 })

    // Naming the first does not renumber the rest: the seventh slip of a pile
    // stays the seventh after the six before it have been filed.
    await t.mutation(api.filing.nameIt, { inboxId: first.photo!.id, partyName: 'M/s Raj Kumar' })
    const second = await t.query(api.filing.toName, { stack: 'A' })
    expect(second).toMatchObject({ index: 2, total: 3 })
    expect(second.photo?.pages).toHaveLength(2)

    await t.mutation(api.filing.nameIt, { inboxId: second.photo!.id, partyName: 'M/s Raj Kumar' })
    expect(await t.query(api.filing.toName, { stack: 'A' })).toMatchObject({ index: 3, total: 3 })

    // Another stack counts on its own.
    expect(await t.query(api.filing.toName, { stack: 'B' })).toMatchObject({ index: 1, total: 1 })
  })

  it('counts what is waiting, stack by stack', async () => {
    const t = await shop()
    await shoot(t, 1000, 'A', 'g1')
    await shoot(t, 1001, 'A', 'g1')
    await shoot(t, 2000, 'A')
    await shoot(t, 3000, 'B')
    await shoot(t, 4000)
    expect(await t.query(api.filing.waiting, {})).toEqual([
      { stack: '', bills: 1 },
      { stack: 'A', bills: 2 },
      { stack: 'B', bills: 1 },
    ])
  })

  it('refuses a slip with no name rather than filing it to nobody', async () => {
    const t = await shop()
    const photo = await shoot(t, 1000, 'A')
    await expect(t.mutation(api.filing.nameIt, { inboxId: photo, partyName: '  ' }))
      .rejects.toThrow(/whose bill/i)
    expect(await t.run((ctx) => ctx.db.query('vouchers').collect())).toHaveLength(0)
  })
})

/** Name a stack of slips in the order they were photographed. */
async function named(t: ReturnType<typeof convexTest>, slips: [number, string][], stack = 'A') {
  for (const [at, who] of slips) {
    await t.mutation(api.filing.nameIt, { inboxId: await shoot(t, at, stack), partyName: who })
  }
}

describe('placing the stack', () => {
  it('calls out each slip in the order it sits in the stack', async () => {
    const t = await shop()
    await named(t, [[1000, 'M/s Raj Kumar'], [2000, 'Sharma Traders'], [3000, 'Nilesh Store']])

    const first = await t.mutation(api.filing.placeNext, { stack: 'A' })
    expect(first.card).toMatchObject({ party: 'M/s Raj Kumar', slot: 1, slotLabel: 'S01', index: 1, total: 3 })
    expect(first.left).toBe(2)

    const second = await t.mutation(api.filing.placeNext, { stack: 'A' })
    expect(second.card).toMatchObject({ party: 'Sharma Traders', slot: 2, index: 2 })

    const third = await t.mutation(api.filing.placeNext, { stack: 'A' })
    expect(third.card).toMatchObject({ party: 'Nilesh Store', slot: 3, index: 3 })

    expect(await t.mutation(api.filing.placeNext, { stack: 'A' })).toMatchObject({ done: true, left: 0 })
  })

  it('sends a customer back to the bookmark they are already holding', async () => {
    const t = await shop()
    await named(t, [[1000, 'M/s Raj Kumar'], [2000, 'Sharma Traders'], [3000, 'M/s Raj Kumar']])

    const slots = []
    for (let i = 0; i < 3; i += 1) {
      slots.push((await t.mutation(api.filing.placeNext, { stack: 'A' })).card!.slot)
    }
    // Scattered through the tray; gathered behind one bookmark.
    expect(slots).toEqual([1, 2, 1])
    const table = await t.query(api.filing.slots, {})
    expect(table.used).toBe(2)
    expect(table.slots[0].bills).toBe(2)
  })

  it('says so when every bookmark is taken, rather than inventing one', async () => {
    const t = await shop()
    await t.mutation(api.filing.setSlotCount, { slotCount: 2 })
    await named(t, [[1000, 'M/s Raj Kumar'], [2000, 'Sharma Traders'], [3000, 'Nilesh Store']])

    await t.mutation(api.filing.placeNext, { stack: 'A' })
    await t.mutation(api.filing.placeNext, { stack: 'A' })
    const third = await t.mutation(api.filing.placeNext, { stack: 'A' })
    expect(third.card).toMatchObject({ party: 'Nilesh Store', slot: null, slotLabel: null })

    // Filing a packet frees a bookmark, and the stranded slip takes it.
    const res = await t.mutation(api.filing.fileToFolder, { slot: 1, cabinet: 'A', drawer: '2', no: 142 })
    expect(res.seated).toEqual([{ party: 'Nilesh Store', slot: 1 }])
    expect((await t.query(api.filing.slots, {})).waiting).toBe(0)

    // The customer's paper now has a permanent address.
    const raj = await t.run((ctx) =>
      ctx.db.query('ledgers').withIndex('by_name', (q) => q.eq('name', 'M/s Raj Kumar')).unique())
    expect(raj!.folder).toEqual({ cabinet: 'A', drawer: '2', no: 142 })
  })

  it('undoes the last slip back onto the stack, and hands it out again', async () => {
    const t = await shop()
    await named(t, [[1000, 'M/s Raj Kumar'], [2000, 'Sharma Traders']])

    const one = await t.mutation(api.filing.placeNext, { stack: 'A' })
    await t.mutation(api.filing.unplace, { id: one.card!.id })

    const state = await t.query(api.filing.placeState, { stack: 'A' })
    expect(state.left).toBe(2)
    expect(state.current).toBe(null)
    expect((await t.query(api.filing.slots, {})).used).toBe(0)

    // And it comes round again as the top of the stack, not the bottom.
    const again = await t.mutation(api.filing.placeNext, { stack: 'A' })
    expect(again.card).toMatchObject({ party: 'M/s Raj Kumar', index: 1 })
  })

  it('keeps the place on reload, so a half-done stack is not lost', async () => {
    const t = await shop()
    await named(t, [[1000, 'M/s Raj Kumar'], [2000, 'Sharma Traders']])
    await t.mutation(api.filing.placeNext, { stack: 'A' })

    const state = await t.query(api.filing.placeState, { stack: 'A' })
    expect(state.current).toMatchObject({ party: 'M/s Raj Kumar', slotLabel: 'S01', index: 1, total: 2 })
    expect(state.left).toBe(1)
    expect(state.stacks).toEqual([{ stack: 'A', left: 1, placed: 1, total: 2 }])
  })

  it('walks each stack on its own, so two people never collide', async () => {
    const t = await shop()
    await named(t, [[1000, 'M/s Raj Kumar']], 'A')
    await named(t, [[1500, 'Sharma Traders']], 'B')

    expect((await t.mutation(api.filing.placeNext, { stack: 'B' })).card)
      .toMatchObject({ party: 'Sharma Traders', stack: 'B', index: 1, total: 1 })
    // A is untouched by B's walk.
    expect((await t.query(api.filing.placeState, { stack: 'A' })).left).toBe(1)
  })
})

describe('correcting a ledger bill', () => {
  it('returns every page to its original stack, reverses postings, and can be named to another customer', async () => {
    const t = await shop()
    const first = await shoot(t, 1000, 'B', 'packet')
    await shoot(t, 1001, 'B', 'packet')
    await t.mutation(api.filing.nameIt, { inboxId: first, partyName: 'M/s Raj Kumar' })
    await t.mutation(api.filing.placeNext, { stack: 'B' })
    const [row] = await t.run(ctx => ctx.db.query('filing').collect())
    const original = await t.run(ctx => ctx.db.get(row.voucherId))
    const billIds = original!.attachments.map(a => typeof a === 'string' ? a : a.storageId)
    const receipt = await t.run(async ctx => {
      const storageId = await ctx.storage.store(new Blob(['receipt']))
      await ctx.db.patch(row.voucherId, {
        status: 'final', amount: 500,
        attachments: [...original!.attachments, { storageId, kind: 'receipt' }],
      })
      const sales = await ctx.db.query('ledgers').withIndex('by_name', q => q.eq('name', 'Sales')).unique()
      for (const [ledgerId, side] of [[row.partyLedgerId, 'Dr'], [sales!._id, 'Cr']] as const) {
        await ctx.db.insert('voucherEntries', { voucherId: row.voucherId, ledgerId, side, amount: 500, date: 1000 })
      }
      return storageId
    })

    expect(await t.mutation(api.filing.revertBill, { filingId: row._id })).toEqual({ reverted: true, pages: 2 })
    expect(await t.run(ctx => ctx.db.get(row.voucherId))).toBeNull()
    expect(await t.run(ctx => ctx.db.query('voucherEntries').collect())).toHaveLength(0)
    expect((await t.query(api.filing.partyBills, { partyLedgerId: row.partyLedgerId }))?.bills).toHaveLength(0)
    expect((await t.query(api.filing.slots, {})).used).toBe(0)
    const inbox = await t.run(ctx => ctx.db.query('inbox').collect())
    expect(inbox.map(p => p.storageId)).toEqual(billIds)
    expect(inbox.every(p => p.stack === 'B' && p.at === 1000)).toBe(true)
    expect(new Set(inbox.map(p => p.groupId)).size).toBe(1)
    expect(inbox[0].groupId).toBeTruthy()
    const [archived] = await t.run(ctx => ctx.db.query('trash').collect())
    expect(archived.attachments).toEqual([{ storageId: receipt, kind: 'receipt' }])
    expect(archived.entries).toHaveLength(2)
    for (const id of billIds) expect(await t.run(async ctx => (await ctx.storage.get(id)) !== null)).toBe(true)

    // Retrying an already completed revert must not duplicate photos.
    expect(await t.mutation(api.filing.revertBill, { filingId: row._id })).toEqual({ reverted: false, pages: 0 })
    expect(await t.run(ctx => ctx.db.query('inbox').collect())).toHaveLength(2)
    await t.mutation(api.filing.nameIt, { inboxId: inbox[0]._id, partyName: 'Correct Customer' })
    const [renamed] = await t.run(ctx => ctx.db.query('vouchers').collect())
    expect(renamed.partyLedgerId).not.toBe(row.partyLedgerId)
    expect(renamed.attachments.map(a => typeof a === 'string' ? a : a.storageId)).toEqual(billIds)
  })

  it('leaves the entry intact when there are no bill photos to return', async () => {
    const t = await shop()
    const first = await shoot(t, 1000, 'A')
    await t.mutation(api.filing.nameIt, { inboxId: first, partyName: 'M/s Raj Kumar' })
    const [row] = await t.run(ctx => ctx.db.query('filing').collect())
    await t.run(ctx => ctx.db.patch(row.voucherId, { attachments: [] }))
    await expect(t.mutation(api.filing.revertBill, { filingId: row._id })).rejects.toThrow('no photos')
    expect(await t.run(ctx => ctx.db.get(row.voucherId))).not.toBeNull()
    expect(await t.run(ctx => ctx.db.get(row._id))).not.toBeNull()
    expect(await t.run(ctx => ctx.db.query('trash').collect())).toHaveLength(0)
  })

  it('returns all bill pages in date order for the ledger gallery, excluding receipts', async () => {
    const t = await shop()
    const later = await shoot(t, 3000, 'A')
    await t.mutation(api.filing.nameIt, { inboxId: later, partyName: 'M/s Raj Kumar' })
    const first = await shoot(t, 1000, 'A', 'multi')
    await shoot(t, 1001, 'A', 'multi')
    await t.mutation(api.filing.nameIt, { inboxId: first, partyName: 'M/s Raj Kumar' })
    const rows = await t.run(ctx => ctx.db.query('filing').collect())
    const row = rows.find(r => r.capturedAt === 1000)!
    const urls = await t.run(async ctx => {
      const voucher = (await ctx.db.get(row.voucherId))!
      const storageId = await ctx.storage.store(new Blob(['receipt']))
      await ctx.db.patch(row.voucherId, { attachments: [{ storageId, kind: 'receipt' }, ...voucher.attachments] })
      return Promise.all(voucher.attachments.map(a => ctx.storage.getUrl(typeof a === 'string' ? a : a.storageId)))
    })
    const ledger = await t.query(api.filing.partyBills, { partyLedgerId: row.partyLedgerId })
    expect(ledger!.bills.map(b => b.date)).toEqual([1000, 3000])
    expect(ledger!.bills[0].photos).toEqual(urls)
    expect(ledger!.bills[0].photo).toBe(urls[0])
    expect(ledger!.bills[1].photos).toHaveLength(1)
  })
})

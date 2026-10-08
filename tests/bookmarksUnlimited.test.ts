/// <reference types="vite/client" />
/**
 * Bookmarks that do not run out.
 *
 * The table used to hold forty. Forty is what the two-walk design was built
 * around — naming and placing were split into separate passes precisely so a
 * bookmark was spent only when paper reached it, because spending one at
 * naming time emptied the table before the first hundred slips were placed.
 *
 * The split still earns its place: the app cannot call out a bookmark for a
 * slip whose customer it does not yet know. What has gone is the jam — being
 * told "every bookmark is taken, go and file a packet" halfway through a stack
 * of two thousand slips.
 *
 * Numbers are still handed out lowest-free-first and still come back when a
 * packet is filed, so they stay small and readable on an ordinary day. They
 * simply carry on past forty when a sort genuinely needs them to.
 */
import { convexTest } from './trustedConvex'
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')
const source = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'convex', 'filing.ts'),
  'utf8',
)

async function shop(customers: number) {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const debtors = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const income = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 1 })
    const led = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    await ctx.db.insert('ledgers', { ...led, name: 'Sales', groupId: income, openingSide: 'Cr' as const })
    for (let i = 1; i <= customers; i += 1) {
      await ctx.db.insert('ledgers', { ...led, name: `Customer ${i}`, groupId: debtors })
    }
    await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
  })
  return t
}

const shoot = (t: ReturnType<typeof convexTest>, at: number) =>
  t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([`slip-${at}`], { type: 'image/jpeg' }))
    return ctx.db.insert('inbox', { storageId, at })
  })

/** Name one slip for each customer, then walk the stack placing them all. */
async function sort(t: ReturnType<typeof convexTest>, customers: number) {
  for (let i = 1; i <= customers; i += 1) {
    const photo = await shoot(t, 1000 + i)
    await t.mutation(api.filing.nameIt, { inboxId: photo, partyName: `Customer ${i}` })
  }
  const placed: (number | null)[] = []
  for (;;) {
    const res = await t.mutation(api.filing.placeNext, {})
    if (res.done) break
    placed.push(res.card!.slot)
  }
  return placed
}

describe('a sort bigger than the old table', () => {
  it('gives every customer a bookmark, past forty', async () => {
    const t = await shop(60)
    const placed = await sort(t, 60)
    expect(placed).toHaveLength(60)
    expect(placed.every((s) => typeof s === 'number')).toBe(true)
    expect(Math.max(...(placed as number[]))).toBe(60)
  })

  it('leaves nothing stranded waiting for a bookmark', async () => {
    const t = await shop(60)
    await sort(t, 60)
    expect((await t.query(api.filing.slots, {})).waiting).toBe(0)
  })

  it('gives each customer a different bookmark', async () => {
    const t = await shop(60)
    const placed = await sort(t, 60)
    expect(new Set(placed).size).toBe(60)
  })

  it('hands them out from one end, so the table fills in order', async () => {
    const t = await shop(45)
    expect(await sort(t, 45)).toEqual(Array.from({ length: 45 }, (_, i) => i + 1))
  })
})

describe('the numbers stay small when packets are filed', () => {
  /**
   * The reason to reuse rather than always count upward: a shop filing as it
   * goes should never be reaching for bookmark 300 when nine are in use.
   */
  it('gives a freed number back to the next customer', async () => {
    const t = await shop(4)
    await sort(t, 3)
    const before = await t.query(api.filing.slots, {})
    expect(before.used).toBe(3)

    // Customer 2's packet goes into its folder, freeing bookmark 2.
    await t.mutation(api.filing.fileToFolder, { slot: 2, cabinet: 'A' })

    const photo = await shoot(t, 9000)
    await t.mutation(api.filing.nameIt, { inboxId: photo, partyName: 'Customer 4' })
    const res = await t.mutation(api.filing.placeNext, {})
    expect(res.card!.slot).toBe(2)
  })
})

describe('what the table reports', () => {
  it('says it is unlimited, and does not invent a number of free places', async () => {
    const t = await shop(3)
    await sort(t, 3)
    const table = await t.query(api.filing.slots, {})
    expect(table.unlimited).toBe(true)
    expect(table.slotCount).toBeNull()
    // Nothing is "free" on a table that cannot run out; 0 would read as full.
    expect(table.free).toBeNull()
    expect(table.used).toBe(3)
    expect(table.highest).toBe(3)
  })

  it('draws up to the highest bookmark in use, showing freed ones as gaps', async () => {
    const t = await shop(3)
    await sort(t, 3)
    await t.mutation(api.filing.fileToFolder, { slot: 2, cabinet: 'A' })
    const table = await t.query(api.filing.slots, {})
    expect(table.slots).toHaveLength(3)
    expect(table.slots[1]).toMatchObject({ slot: 2, partyLedgerId: null })
  })
})

describe('a table the shop has deliberately fixed', () => {
  /**
   * A fixed rack genuinely can run out, and then saying so is the only honest
   * thing to do. Lifting the limit everywhere must not take that away.
   */
  it('still fills up and still says so', async () => {
    const t = await shop(4)
    await t.mutation(api.filing.setSlotCount, { slotCount: 2 })
    const placed = await sort(t, 4)
    expect(placed.filter((s) => s === null)).toHaveLength(2)
    expect((await t.query(api.filing.slots, {})).waiting).toBe(2)
  })

  it('reports its free places as a number, not as unlimited', async () => {
    const t = await shop(4)
    await t.mutation(api.filing.setSlotCount, { slotCount: 5 })
    await sort(t, 2)
    const table = await t.query(api.filing.slots, {})
    expect(table.unlimited).toBe(false)
    expect(table.free).toBe(3)
  })

  it('lifts the limit again when no number is given', async () => {
    const t = await shop(4)
    await t.mutation(api.filing.setSlotCount, { slotCount: 2 })
    const out = await t.mutation(api.filing.setSlotCount, {})
    expect(out).toMatchObject({ unlimited: true, slotCount: null })
    expect((await t.query(api.filing.slots, {})).unlimited).toBe(true)
  })

  it('refuses a table of one, whichever way it is asked', async () => {
    const t = await shop(2)
    await expect(t.mutation(api.filing.setSlotCount, { slotCount: 1 })).rejects.toThrow(/at least two/i)
  })
})

describe('placing a bill by hand', () => {
  it('accepts a high number when there is no limit', async () => {
    const t = await shop(2)
    await sort(t, 1)
    const [row] = await t.run((ctx) => ctx.db.query('filing').collect())
    await t.mutation(api.filing.moveToSlot, { id: row._id, slot: 137 })
    expect((await t.run((ctx) => ctx.db.get(row._id)))!.slot).toBe(137)
  })

  it('still refuses a number that is not a bookmark at all', async () => {
    const t = await shop(2)
    await sort(t, 1)
    const [row] = await t.run((ctx) => ctx.db.query('filing').collect())
    await expect(t.mutation(api.filing.moveToSlot, { id: row._id, slot: 0 })).rejects.toThrow(/no S/i)
  })
})

/**
 * The bookmark is decided when the slip is named, not when it is placed.
 *
 * It used to be the other way round, and for a good reason: with forty
 * bookmarks, one given out at naming time was held for paper still sitting in
 * the stack, so naming two hundred slips before placing any emptied the table
 * with nothing on it. Unlimited bookmarks removed that cost, and deciding
 * early is better — the number is settled before anybody picks the stack up,
 * and the second walk only reads it out.
 */
describe('bookmarks given out in advance', () => {
  const nameOne = async (t: ReturnType<typeof convexTest>, at: number, party: string) => {
    const photo = await shoot(t, at)
    return t.mutation(api.filing.nameIt, { inboxId: photo, partyName: party })
  }

  it('hands the number back as the slip is named', async () => {
    const t = await shop(3)
    const res = await nameOne(t, 1001, 'Customer 1')
    expect(res.slot).toBe(1)
    expect(res.slotLabel).toBe('S01')
  })

  it('settles every number before the stack is picked up', async () => {
    const t = await shop(3)
    await nameOne(t, 1001, 'Customer 1')
    await nameOne(t, 1002, 'Customer 2')
    await nameOne(t, 1003, 'Customer 3')

    const rows = await t.run((ctx) => ctx.db.query('filing').collect())
    expect(rows.every((r) => r.stage === 'named')).toBe(true)
    expect(rows.map((r) => r.slot).sort()).toEqual([1, 2, 3])
  })

  it('gives one customer the same bookmark for every slip of theirs', async () => {
    const t = await shop(2)
    const a = await nameOne(t, 1001, 'Customer 1')
    const b = await nameOne(t, 1002, 'Customer 2')
    const c = await nameOne(t, 1003, 'Customer 1')
    expect(c.slot).toBe(a.slot)
    expect(b.slot).not.toBe(a.slot)
  })

  /** The whole point of deciding early: placing becomes reading, not choosing. */
  it('calls out the number that was already decided', async () => {
    const t = await shop(2)
    const named = await nameOne(t, 1001, 'Customer 1')
    const placed = await t.mutation(api.filing.placeNext, {})
    expect(placed.card!.slot).toBe(named.slot)
  })

  it('shows a reserved bookmark on the table before the paper reaches it', async () => {
    const t = await shop(2)
    await nameOne(t, 1001, 'Customer 1')
    const before = await t.query(api.filing.slots, {})
    // Spoken for, with nothing behind it yet.
    expect(before.slots[0]).toMatchObject({ slot: 1, bills: 0, named: 1 })
    expect(before.used).toBe(1)

    await t.mutation(api.filing.placeNext, {})
    const after = await t.query(api.filing.slots, {})
    expect(after.slots[0]).toMatchObject({ slot: 1, bills: 1, named: 0 })
  })

  it('does not hand a reserved number to the next customer', async () => {
    const t = await shop(3)
    await nameOne(t, 1001, 'Customer 1')   // holds 1, still in the stack
    const second = await nameOne(t, 1002, 'Customer 2')
    expect(second.slot).toBe(2)
  })

  it('gives the number back only when the packet is filed', async () => {
    const t = await shop(3)
    await nameOne(t, 1001, 'Customer 1')
    await t.mutation(api.filing.placeNext, {})
    await t.mutation(api.filing.fileToFolder, { slot: 1, cabinet: 'A' })

    const next = await nameOne(t, 1002, 'Customer 2')
    expect(next.slot).toBe(1)
  })
})

/**
 * The bookmark beside the name, on the screen somebody opens to find it.
 *
 * The customer list looked only for paper already placed, which was right
 * while numbers were handed out on the second walk. Now they are handed out
 * at naming, so a customer could hold bookmark 7 all morning and have nothing
 * beside their name until their slip reached the table.
 */
describe('the customer list', () => {
  const nameOne = async (t: ReturnType<typeof convexTest>, at: number, party: string) => {
    const photo = await shoot(t, at)
    return t.mutation(api.filing.nameIt, { inboxId: photo, partyName: party })
  }
  const rowFor = async (t: ReturnType<typeof convexTest>, name: string) =>
    (await t.query(api.filing.folders, {})).find((r) => r.name === name)

  it('shows the bookmark while the slip is still in the stack', async () => {
    const t = await shop(2)
    const named = await nameOne(t, 1001, 'Customer 1')
    const row = await rowFor(t, 'Customer 1')
    expect(row?.slot).toBe(named.slot)
    expect(row?.slotLabel).toBe('S01')
  })

  it('still shows it once the paper is on the table', async () => {
    const t = await shop(2)
    await nameOne(t, 1001, 'Customer 1')
    await t.mutation(api.filing.placeNext, {})
    expect((await rowFor(t, 'Customer 1'))?.slot).toBe(1)
  })

  it('drops it once the packet is in its folder', async () => {
    const t = await shop(2)
    await nameOne(t, 1001, 'Customer 1')
    await t.mutation(api.filing.placeNext, {})
    await t.mutation(api.filing.fileToFolder, { slot: 1, cabinet: 'A' })
    const row = await rowFor(t, 'Customer 1')
    expect(row?.slot).toBeNull()
    expect(row?.folder).toMatchObject({ cabinet: 'A' })
  })

  /**
   * A customer with one slip placed and another just named holds one number.
   * Showing the placed one keeps the answer pointing at where the pile is.
   */
  it('gives one answer for a customer mid-move', async () => {
    const t = await shop(2)
    await nameOne(t, 1001, 'Customer 1')
    await t.mutation(api.filing.placeNext, {})
    await nameOne(t, 1002, 'Customer 1')
    const row = await rowFor(t, 'Customer 1')
    expect(row?.slot).toBe(1)
    expect(row?.bills).toBe(2)
  })

  it('shows it on the customer’s own page too', async () => {
    const t = await shop(2)
    await nameOne(t, 1001, 'Customer 1')
    const id = (await rowFor(t, 'Customer 1'))!.partyLedgerId
    const one = await t.query(api.filing.partyBills, { partyLedgerId: id })
    expect(one?.slotLabel).toBe('S01')
    expect(one?.bills[0]).toMatchObject({ stage: 'named', slotLabel: 'S01' })
  })
})

/**
 * The backlog named before bookmarks were given out at naming time.
 *
 * Those rows carry no number at all, so a customer with four bills sitting in
 * the stack showed nothing beside their name — on the very screen somebody
 * opens to find out where their paper goes.
 */
describe('catching up the backlog', () => {
  /** A slip named the old way: on the stack, no number. */
  const oldNamed = (t: ReturnType<typeof convexTest>, at: number, party: string) =>
    t.run(async (ctx) => {
      const ledger = (await ctx.db.query('ledgers').collect()).find((l) => l.name === party)!
      const type = (await ctx.db.query('voucherTypes').collect())[0]
      const voucherId = await ctx.db.insert('vouchers', {
        typeId: type._id, voucherNo: at, fy: '2026-27', date: at,
        partyLedgerId: ledger._id, status: 'pending', attachments: [],
        createdAt: at, updatedAt: at,
      } as never)
      return ctx.db.insert('filing', {
        voucherId, partyLedgerId: ledger._id, capturedAt: at, stage: 'named', at,
      } as never)
    })

  const rowFor = async (t: ReturnType<typeof convexTest>, name: string) =>
    (await t.query(api.filing.folders, {})).find((r) => r.name === name)

  it('shows no bookmark before it is caught up — the bug as reported', async () => {
    const t = await shop(3)
    await oldNamed(t, 1001, 'Customer 1')
    expect((await rowFor(t, 'Customer 1'))?.slot).toBeNull()
  })

  it('gives the whole backlog a bookmark', async () => {
    const t = await shop(3)
    await oldNamed(t, 1001, 'Customer 1')
    await oldNamed(t, 1002, 'Customer 2')
    const out = await t.mutation(api.filing.seatWaitingNow, {})
    expect(out.seated).toBe(2)
    expect((await rowFor(t, 'Customer 1'))?.slotLabel).toBe('S01')
    expect((await rowFor(t, 'Customer 2'))?.slotLabel).toBe('S02')
  })

  it('leaves the paper in the stack — only the number is settled', async () => {
    const t = await shop(3)
    await oldNamed(t, 1001, 'Customer 1')
    await t.mutation(api.filing.seatWaitingNow, {})
    const [row] = await t.run((ctx) => ctx.db.query('filing').collect())
    expect(row.stage).toBe('named')
    expect(row.slot).toBe(1)
  })

  it('numbers them in stack order, not in the order they were entered', async () => {
    const t = await shop(3)
    await oldNamed(t, 3000, 'Customer 3')
    await oldNamed(t, 1000, 'Customer 1')
    await oldNamed(t, 2000, 'Customer 2')
    await t.mutation(api.filing.seatWaitingNow, {})
    expect((await rowFor(t, 'Customer 1'))?.slot).toBe(1)
    expect((await rowFor(t, 'Customer 2'))?.slot).toBe(2)
    expect((await rowFor(t, 'Customer 3'))?.slot).toBe(3)
  })

  it('gives one customer one number across all their old slips', async () => {
    const t = await shop(3)
    await oldNamed(t, 1001, 'Customer 1')
    await oldNamed(t, 1002, 'Customer 1')
    await oldNamed(t, 1003, 'Customer 2')
    await t.mutation(api.filing.seatWaitingNow, {})
    const rows = await t.run((ctx) => ctx.db.query('filing').collect())
    const mine = rows.filter((r) => r.capturedAt < 1003).map((r) => r.slot)
    expect(new Set(mine).size).toBe(1)
    expect((await rowFor(t, 'Customer 2'))?.slot).toBe(2)
  })

  it('leaves alone anything that already has one', async () => {
    const t = await shop(3)
    const photo = await shoot(t, 1001)
    const named = await t.mutation(api.filing.nameIt, { inboxId: photo, partyName: 'Customer 1' })
    const out = await t.mutation(api.filing.seatWaitingNow, {})
    expect(out.seated).toBe(0)
    expect((await rowFor(t, 'Customer 1'))?.slot).toBe(named.slot)
  })

  /**
   * The catch-up failed on the shop's real backlog and passed every test here,
   * because the tests used three slips and the shop had a hundred and forty.
   * `slotFor` re-read the whole filing table per row, so the reads were N × M
   * and Convex stops a function at thirty-two thousand documents.
   */
  it('catches up a backlog the size of a real one', async () => {
    const t = await shop(60)
    for (let i = 1; i <= 60; i += 1) await oldNamed(t, 1000 + i, `Customer ${i}`)

    const out = await t.mutation(api.filing.seatWaitingNow, {})
    expect(out.seated).toBe(60)

    const rows = await t.run((ctx) => ctx.db.query('filing').collect())
    const slots = rows.map((r) => r.slot)
    expect(slots.every((x) => typeof x === 'number')).toBe(true)
    // Sixty customers, sixty different numbers, none skipped.
    expect(new Set(slots).size).toBe(60)
    expect(Math.max(...(slots as number[]))).toBe(60)
  })

  it('reads the table once, not once per slip', () => {
    const body = source.slice(
      source.indexOf('async function seatWaiting'),
      source.indexOf('/** Puts a bill into a slot by hand'),
    )
    // The N x M shape: a fresh read of every held bookmark, inside the loop.
    expect(body).not.toMatch(/for\s*\([^)]*\)\s*\{[\s\S]*await\s+slotFor\(/)
    expect(body).toMatch(/await Promise\.all\(\[slotsHeld\(ctx\), slotCount\(ctx\)\]\)/)
  })

  it('runs twice without renumbering anybody', async () => {
    const t = await shop(3)
    await oldNamed(t, 1001, 'Customer 1')
    await oldNamed(t, 1002, 'Customer 2')
    await t.mutation(api.filing.seatWaitingNow, {})
    const before = (await t.query(api.filing.folders, {})).map((r) => [r.name, r.slot])
    await t.mutation(api.filing.seatWaitingNow, {})
    expect((await t.query(api.filing.folders, {})).map((r) => [r.name, r.slot])).toEqual(before)
  })
})

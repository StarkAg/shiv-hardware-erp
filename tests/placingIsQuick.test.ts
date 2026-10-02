/// <reference types="vite/client" />
/**
 * The wait between pressing Next and the bookmark reaching the screen.
 *
 * `placeState` is a reactive query, so it re-runs on every press — the
 * mutation has just touched a filing row, which invalidates it. It used to
 * walk the four upcoming slips in a loop, awaiting a voucher and then a URL
 * for each: eight server round trips, one after another, none depending on
 * any other, on every single slip of a two-thousand-slip stack.
 *
 * These tests hold the behaviour still. The shape checks below are what stop
 * the loop being written back in by hand later, since a sequential await
 * inside a loop reads perfectly innocent.
 */
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')
const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.join(here, '..', 'convex', 'filing.ts'), 'utf8')

async function shop() {
  const t = convexTest(schema, modules)
  await t.run(async (ctx) => {
    const debtors = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const income = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 1 })
    const led = { openingBalance: 0, openingSide: 'Dr' as const, openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 }
    await ctx.db.insert('ledgers', { ...led, name: 'Sales', groupId: income, openingSide: 'Cr' as const })
    for (let i = 1; i <= 8; i += 1) {
      await ctx.db.insert('ledgers', { ...led, name: `Customer ${i}`, groupId: debtors })
    }
    await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
  })
  return t
}

async function named(t: ReturnType<typeof convexTest>, n: number) {
  for (let i = 1; i <= n; i += 1) {
    const photo = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([`slip-${i}`], { type: 'image/jpeg' }))
      return ctx.db.insert('inbox', { storageId, at: 1000 + i })
    })
    await t.mutation(api.filing.nameIt, { inboxId: photo, partyName: `Customer ${i}` })
  }
}

describe('what the placing screen is given', () => {
  it('pulls the next few photographs down before Next is pressed', async () => {
    const t = await shop()
    await named(t, 6)
    const state = await t.query(api.filing.placeState, {})
    // Four ahead: about as far as a hand gets in front of the screen.
    expect(state.ahead).toHaveLength(4)
    expect(state.ahead.every((u) => typeof u === 'string' && u.length > 0)).toBe(true)
  })

  it('asks for no more photographs than there are slips left', async () => {
    const t = await shop()
    await named(t, 2)
    expect((await t.query(api.filing.placeState, {})).ahead).toHaveLength(2)
  })

  it('counts what is left and what has been placed', async () => {
    const t = await shop()
    await named(t, 5)
    expect((await t.query(api.filing.placeState, {})).left).toBe(5)
    await t.mutation(api.filing.placeNext, {})
    expect((await t.query(api.filing.placeState, {})).left).toBe(4)
  })

  it('remembers the slip called out, so reopening the phone keeps the place', async () => {
    const t = await shop()
    await named(t, 3)
    const res = await t.mutation(api.filing.placeNext, {})
    const state = await t.query(api.filing.placeState, {})
    expect(state.current?.id).toBe(res.card!.id)
    expect(state.current?.slot).toBe(res.card!.slot)
  })
})

describe('pressing Next', () => {
  it('hands back the whole card in one answer', async () => {
    const t = await shop()
    await named(t, 3)
    const res = await t.mutation(api.filing.placeNext, {})
    // Everything the screen draws, so nothing needs a second request.
    expect(res.card).toMatchObject({
      party: 'Customer 1',
      slot: 1,
      slotLabel: 'S01',
      index: 1,
      total: 3,
    })
    expect(res.card!.url).toBeTruthy()
  })

  it('walks the stack in the order it was photographed', async () => {
    const t = await shop()
    await named(t, 4)
    const seen: string[] = []
    for (let i = 0; i < 4; i += 1) {
      const res = await t.mutation(api.filing.placeNext, {})
      seen.push(res.card!.party)
    }
    expect(seen).toEqual(['Customer 1', 'Customer 2', 'Customer 3', 'Customer 4'])
  })
})

describe('the shape that keeps it quick', () => {
  const placeState = source.slice(
    source.indexOf('export const placeState'),
    source.indexOf('async function card('),
  )

  /**
   * The specific regression: `await` on a database read or a URL inside a
   * `for` loop. One slip's wait becomes four, on a query that runs on every
   * press.
   */
  it('does not await a read inside a loop when fetching the photographs ahead', () => {
    const loops = [...placeState.matchAll(/for\s*\([^)]*\)\s*\{([\s\S]*?)\n    \}/g)]
    for (const [, body] of loops) {
      expect(body).not.toMatch(/await\s+ctx\.(db|storage)\./)
    }
  })

  it('fetches the vouchers and the URLs as batches', () => {
    expect(placeState).toMatch(/Promise\.all\([\s\S]*ctx\.db\.get/)
    expect(placeState).toMatch(/Promise\.all\([\s\S]*getUrl/)
  })

  it('reads the party and the voucher of one card together', () => {
    const cardFn = source.slice(source.indexOf('async function card('))
    expect(cardFn.slice(0, 600)).toMatch(/Promise\.all\(\[[\s\S]*partyLedgerId[\s\S]*voucherId/)
  })

  /** The patched row is built, not read back — that read was a round trip. */
  it('does not read the row back after patching it', () => {
    const next = source.slice(
      source.indexOf('export const placeNext'),
      source.indexOf('export const unplace'),
    )
    expect(next).not.toMatch(/await ctx\.db\.get\(row\._id\)/)
  })
})

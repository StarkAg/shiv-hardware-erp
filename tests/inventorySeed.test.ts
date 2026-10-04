/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'
import { INVENTORY_SEED, seedRefForName } from '../convex/lib/inventorySeed'
import { themeFor } from '../inventory-web/src/theme'

const modules = import.meta.glob('../convex/**/*.ts')
const pin = '123456'
const plywoodRef = 'seed:ply:signature:6:7x4'
const oneSheetRef = 'seed:ply:signature:6:8x4'
beforeEach(() => vi.stubEnv('INVENTORY_PIN', pin))
afterEach(() => vi.unstubAllEnvs())

async function initialized() {
  const t = convexTest(schema, modules)
  await t.mutation(api.inventory.initializeSeed, { pin })
  return t
}

describe('supplied plywood and door inventory', () => {
  it('contains exactly the supplied 50 rows / 170 pieces, ignoring other catalogue items', async () => {
    const t = await initialized()
    await t.run(async ctx => {
      await ctx.db.insert('catalogStore', { hardwareCatalog: [], sets: [], customCatalog: [{ id: 'door', name: '30mm S 78 X 38' }, { id: 'other-ply', name: '19mm Amron 8 X 4' }], savedAt: 1 })
    })
    const rows = await t.query(api.inventory.seedList, {})
    expect(rows).toHaveLength(50)
    expect(rows.reduce((sum, r) => sum + r.stock, 0)).toBe(170)
    expect(rows.map(r => r.ref)).toEqual(INVENTORY_SEED.map(r => r.ref))
    expect(rows.filter(r => r.name.includes('Signature Gold')).reduce((s,r) => s+r.stock,0)).toBe(10)
  })

  it('protects all write paths and the editor unlock with the server PIN', async () => {
    const t = await initialized()
    const ref = plywoodRef
    await expect(t.query(api.inventory.checkPin, { pin: '000000' })).rejects.toThrow('correct PIN')
    await expect(t.mutation(api.inventory.adjustSeed, { pin: '000000', ref, delta: 1 })).rejects.toThrow('correct PIN')
    await expect(t.mutation(api.inventory.count, { ref, qty: 80 })).rejects.toThrow('correct PIN')
    await expect(t.mutation(api.inventory.setItem, { ref, min: 80 })).rejects.toThrow('correct PIN')
    await expect(t.mutation(api.inventory.initializeSeed, { pin: '000000' })).rejects.toThrow('correct PIN')
    expect(await t.query(api.inventory.checkPin, { pin })).toBe(true)
    expect((await t.query(api.inventory.seedList, {})).find(item => item.ref === ref)?.stock).toBe(5)
  })

  it('increments and decrements, rejects other items and preserves edits on reinitialization', async () => {
    const t = await initialized()
    const ref = plywoodRef
    await t.mutation(api.inventory.adjustSeed, { pin, ref, delta: 1 })
    await t.mutation(api.inventory.adjustSeed, { pin, ref, delta: 1 })
    await t.mutation(api.inventory.adjustSeed, { pin, ref, delta: -1 })
    expect((await t.query(api.inventory.seedList, {})).find(item => item.ref === ref)?.stock).toBe(6)
    expect(await t.mutation(api.inventory.initializeSeed, { pin })).toMatchObject({ inserted: 0 })
    expect((await t.query(api.inventory.seedList, {})).find(item => item.ref === ref)?.stock).toBe(6)
    await expect(t.mutation(api.inventory.adjustSeed, { pin, ref: 'id:door', delta: 1 })).rejects.toThrow('not in your stock list')
  })

  it('applies a retried device operation only once', async () => {
    const t = await initialized()
    const ref = plywoodRef
    const first = await t.mutation(api.inventory.adjustSeed, { pin, ref, delta: 1, operationId: 'phone-a-001' })
    const retry = await t.mutation(api.inventory.adjustSeed, { pin, ref, delta: 1, operationId: 'phone-a-001' })
    expect(first).toMatchObject({ qty: 6, duplicate: false })
    expect(retry).toMatchObject({ qty: 6, duplicate: true })
    expect((await t.query(api.inventory.seedList, {})).find(item => item.ref === ref)?.stock).toBe(6)
    await expect(t.mutation(api.inventory.adjustSeed, { pin, ref, delta: -1, operationId: 'phone-a-001' })).rejects.toThrow('does not match')
  })

  it('does not let a shelf count become negative', async () => {
    const t = await initialized()
    const ref = oneSheetRef
    await t.mutation(api.inventory.adjustSeed, { pin, ref, delta: -1 })
    await expect(t.mutation(api.inventory.adjustSeed, { pin, ref, delta: -1 })).rejects.toThrow('below zero')
    expect((await t.query(api.inventory.seedList, {})).find(item => item.ref === ref)?.stock).toBe(0)
  })

  it('applies matching bills after initialization, regardless of old catalogue IDs', async () => {
    const t = await initialized()
    const first = (await t.query(api.inventory.seedList, {})).find(item => item.ref === plywoodRef)!
    const at = first.counted!.at + 1000
    await t.run(async ctx => {
      for (const [id, date, description, qty] of [
        ['old', '2020-01-01', '6mm S 7 X 4', 90],
        ['new', first.counted!.day, '6mm S 7 X 4', 2],
        ['other', first.counted!.day, '6mm Amron 7 X 4', 30],
      ] as const) {
        await ctx.db.insert('bills', { billId: id, number: id, updatedAt: at, bill: {
          id, date, updatedAt: at, kind: 'sale', items: [{ description, customEntryId: `old-${id}`, qty, unit: 'Pc', amount: 100 }],
        } })
      }
    })
    expect((await t.query(api.inventory.seedList, {})).find(item => item.ref === plywoodRef)?.stock).toBe(3)
  })

  it('matches only supplied brands, sizes and thicknesses', () => {
    expect(seedRefForName('19mm B.Board S 7 X 4')).toBe('seed:ply:signature:19:7x4')
    expect(seedRefForName('19mm Solid SG 8 X 4')).toBe('seed:ply:signature-gold:19:8x4')
    expect(seedRefForName('6mm Milton 8x3.5 ft')).toBe('seed:ply:milton:6:8x3.5')
    expect(seedRefForName('30mm S 78 X 38')).toBe('seed:door:signature:30:78x38')
    for (const name of ['19mm Amron 8 X 4','18mm HDMR S 8 X 4','12mm S 5 X 3','Door Magnet']) expect(seedRefForName(name)).toBeUndefined()
  })
})

describe('Inventory day / night theme', () => {
  it('uses local day / night with URL overrides', () => {
    expect(themeFor('', 5)).toBe('dark')
    expect(themeFor('', 6)).toBe('light')
    expect(themeFor('', 17)).toBe('light')
    expect(themeFor('', 18)).toBe('dark')
    expect(themeFor('?light', 23)).toBe('light')
    expect(themeFor('?dark', 12)).toBe('dark')
  })
})

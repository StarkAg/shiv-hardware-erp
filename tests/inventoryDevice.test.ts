import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hydrateFromConvexOnce, loadDeviceInventory, queueAdjustment, queuedStock, rememberAddedItem } from '../inventory-web/src/localInventory'

beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('indexedDB', undefined)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('device inventory catalogue updates', () => {
  it('shows a queued decrement below zero before it syncs', () => {
    expect(queuedStock([{ ref: 'door', stock: 0 }], [{ ref: 'door', delta: -1 }]))
      .toEqual([{ ref: 'door', stock: -1 }])
  })

  it('discovers added products without replacing local quantities or pending taps', async () => {
    const existing = { ref: 'seed:door:signature:30:78x30', name: '30mm Signature 78 x 30', stock: 8 }
    const added = { ref: 'custom:door:signature-gold:35:81x32', name: '35mm Signature Gold 81 x 32', brand: 'Signature Gold', mm: 35, size: '81x32', category: 'door', stock: 7 }
    await hydrateFromConvexOnce([existing], 100)
    await queueAdjustment(existing.ref, 1)
    await hydrateFromConvexOnce([{ ...existing, stock: 2 }, added], 200)
    await rememberAddedItem(added)
    const state = await loadDeviceInventory()
    expect(state.items).toHaveLength(2)
    expect(state.queue).toHaveLength(1)
    expect(state.lastConvexSyncAt).toBe(100)
    expect(queuedStock(state.items, state.queue).find(item => item.ref === existing.ref))
      .toMatchObject({ stock: 9, brand: 'Signature Gold', name: '30mm Signature Gold 78 x 30' })
    expect(state.items.find(item => item.ref === added.ref)).toMatchObject({ stock: 7 })
  })

  it('refreshes a shelf when a bill adds a new stock movement', async () => {
    const item = { ref: 'seed:ply:signature:19:7x4', name: '19mm Signature 7 x 4', stock: 26, moves: 2, lastMove: '2026-10-13' }
    await hydrateFromConvexOnce([item], 100)
    await hydrateFromConvexOnce([{ ...item, stock: 41, moves: 3, lastMove: '2026-10-14' }], 200)
    expect((await loadDeviceInventory()).items).toMatchObject([{ ref: item.ref, stock: 41, moves: 3 }])
  })
})

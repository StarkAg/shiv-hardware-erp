/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { FALLBACK_ITEMS, hydrateStockItems, matchesStockSearch } from '../inventory-web/src/seed'

const namesFor = query => FALLBACK_ITEMS.filter(item => matchesStockSearch(item, query)).map(item => item.brand)

describe('Inventory shorthand search', () => {
  it('uses S, SG and MS as unambiguous brand shortcuts', () => {
    expect(new Set(namesFor('s'))).toEqual(new Set(['Signature']))
    expect(new Set(namesFor('SG'))).toEqual(new Set(['Signature Gold']))
    expect(new Set(namesFor('ms'))).toEqual(new Set(['Milton']))
  })

  it('keeps the supplied 30 mm Signature doors available locally', () => {
    const doors = FALLBACK_ITEMS.filter(item => item.category === 'door')
    expect(doors).toHaveLength(13)
    expect(doors.reduce((total, item) => total + item.stock, 0)).toBe(51)
  })

  it('keeps matching size and thickness after a brand shortcut', () => {
    expect(FALLBACK_ITEMS.filter(item => matchesStockSearch(item, 'sg 19 7x4')).map(item => item.ref))
      .toEqual(['seed:ply:signature-gold:19:7x4'])
    expect(FALLBACK_ITEMS.filter(item => matchesStockSearch(item, 'MS 8x3.5')).map(item => item.ref))
      .toEqual(['seed:ply:milton:6:8x3.5'])
  })

  it('keeps the brand headings when a live Convex row replaces the device copy', () => {
    const [live] = hydrateStockItems([{ ref: 'seed:ply:signature-gold:19:7x4', name: '19mm Signature Gold 7 x 4', stock: 9, min: null }])
    expect(live).toMatchObject({ brand: 'Signature Gold', mm: 19, size: '7x4', stock: 9, min: 2 })
  })
})

/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { FALLBACK_ITEMS, hydrateStockItems, matchesStockSearch, stockBrands, stockSubtitle, compareStock } from '../inventory-web/src/seed'

const namesFor = query => FALLBACK_ITEMS.filter(item => matchesStockSearch(item, query)).map(item => item.brand)

describe('Inventory shorthand search', () => {
  it('filters and displays packaged products and custom brands without a thickness', () => {
    const glue = { name: 'Fevicol SH 1 kg', brand: 'Fevicol', category: 'other', label: 'SH', size: '1 kg', stock: 4 }
    const screws = { ...glue, name: 'Local Brand Screws box of 100', label: 'Screws', brand: 'Local Brand' }
    expect(stockBrands([glue, screws])).toContain('Local Brand')
    expect(stockSubtitle(glue)).toBe('Fevicol · SH')
    expect(matchesStockSearch(glue, 'fevicol sh 1 kg')).toBe(true)
    expect(matchesStockSearch(glue, 'sg')).toBe(false)
    for (const sort of ['stock', 'thickness', 'brand']) expect(Number.isFinite(compareStock(glue, FALLBACK_ITEMS[0], sort))).toBe(true)
  })
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
    expect(FALLBACK_ITEMS.filter(item => matchesStockSearch(item, 'sg 21 7x4')).map(item => item.ref))
      .toEqual(['seed:ply:signature-gold:19:7x4'])
    expect(FALLBACK_ITEMS.filter(item => matchesStockSearch(item, 'MS 8x3.5')).map(item => item.ref))
      .toEqual(['seed:ply:milton:6:8x3.5'])
  })

  it('keeps the brand headings when a live Convex row replaces the device copy', () => {
    const [live] = hydrateStockItems([{ ref: 'seed:ply:signature-gold:19:7x4', name: '19mm Signature Gold 7 x 4', stock: 9, min: null }])
    expect(live).toMatchObject({ brand: 'Signature Gold', mm: 21, size: '7x4', stock: 9, min: 2 })
    expect(live.name).toBe('21mm Signature Gold 7 x 4')
  })

  it('corrects old device door labels without changing their reference or quantity', () => {
    const [item] = hydrateStockItems([{ ref: 'seed:door:signature:30:78x30', name: '30mm Signature 78 x 30', brand: 'Signature', stock: 11 }])
    expect(item).toMatchObject({ ref: 'seed:door:signature:30:78x30', name: '30mm Signature Gold 78 x 30', brand: 'Signature Gold', stock: 11 })
    expect(matchesStockSearch(item, 'sg 30 78x30')).toBe(true)
    expect(matchesStockSearch(item, 's 30 78x30')).toBe(false)
  })
})

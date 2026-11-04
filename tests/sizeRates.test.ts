/** Size Rates: a brand, its rate, and what each size comes to. */
import { describe, expect, test } from 'vitest'
import { buildBrandRows } from '../src/lib/pricing'
import { autoCost, buildSizeRates, findInPriceList, lastRatesFor, parseSize, priceList } from '../src/lib/sizeRates'
import type { Brand, BrandSet, Quotation } from '../src/lib/types'

const brand = (category: Brand['category'], name: string, rate: number): Brand => ({ id: `${category}-${name}`, category, name, rate, guaranteeYears: 0 })
const sets: BrandSet[] = [{
  id: 'c1',
  name: 'C1',
  brands: [brand('readymade-door', 'DDoor Sunmica', 288), brand('flush-door', 'Signature', 172), brand('block-board-19', 'Signature', 118)],
}]
const list = priceList(sets)
const noRate = { rate: 0, unit: 'ft' as const }

const quoted = (id: string, date: string, name: string, cost: number) => ({
  id, date, category: 'size-rates', sizeRates: { brand: name, rows: [{ size: '6x3', cost }] },
}) as unknown as Quotation

describe('the price list in the brand box', () => {
  test('tells apart a brand on several products, each with its own rate and unit', () => {
    expect(findInPriceList(list, 'signature · flush door')).toMatchObject({ rate: 172, unit: 'in', category: 'flush-door' })
    expect(findInPriceList(list, 'Signature · Block Board 19mm')).toMatchObject({ rate: 118, unit: 'ft', category: 'block-board-19' })
  })

  test('finds nothing for a brand typed by hand', () => {
    expect(findInPriceList(list, 'Anything')).toBeUndefined()
  })
})

describe('reading a size', () => {
  test.each([
    ['78 x 36', 78, 36],
    ['7 X 3 ft', 7, 3],
    ['78 4/8 x 36', 78.5, 36],
    ['78 4/8" × 36 2/8"', 78.5, 36.25],
    ['6.5*3', 6.5, 3],
  ])('%s', (text, height, width) => {
    expect(parseSize(text)).toEqual({ height, width })
  })

  test('leaves anything else alone', () => {
    expect(parseSize('Small')).toBeNull()
    expect(parseSize('78')).toBeNull()
  })
})

describe('working out the cost', () => {
  const door = findInPriceList(list, 'DDoor Sunmica · Readymade Door')!
  const flush = findInPriceList(list, 'Signature · Flush Door')!
  const board = findInPriceList(list, 'Signature · Block Board 19mm')!

  test('a door in inches: rate x height x width / 144', () => {
    expect(autoCost('78 x 36', door)).toBe(5616)
  })

  test('a readymade door bills on its next standard size, as on the rate card', () => {
    expect(autoCost('76 x 35', door)).toBe(5616)
  })

  test('a flush door bills on its exact size', () => {
    expect(autoCost('76 x 35', flush)).toBe(Math.round((172 * 76 * 35) / 144))
  })

  test('a board in feet: rate x height x width', () => {
    expect(autoCost('8 x 4', board)).toBe(3776)
  })

  test.each([
    ['Readymade', door, 76, 35],
    ['Flush', flush, 80, 32],
    ['Board', board, 8, 4],
  ])('comes to what the rate card says: %s', (_name, item, height, width) => {
    const [row] = buildBrandRows(
      [brand(item.category, 'x', item.rate)],
      { inches: height, soot: 0 },
      { inches: width, soot: 0 },
      1,
    )
    expect(autoCost(`${height} x ${width}`, item)).toBe(row.cost)
  })

  test('a brand typed by hand costs by the rate and unit given', () => {
    expect(autoCost('7 x 3', { rate: 100, unit: 'ft' })).toBe(2100)
    expect(autoCost('84 x 36', { rate: 100, unit: 'in' })).toBe(2100)
  })

  test('gives nothing without a rate or a size it can read', () => {
    expect(autoCost('7 x 3', noRate)).toBe(0)
    expect(autoCost('Small', { rate: 100, unit: 'ft' })).toBe(0)
  })
})

describe('building the quotation', () => {
  test('takes any words for a brand and a size, as typed', () => {
    expect(buildSizeRates('  Anything At All ', [{ size: ' 7 x 3 ft ', cost: '2500' }], noRate)).toMatchObject({
      brand: 'Anything At All',
      rows: [{ size: '7 x 3 ft', cost: 2500 }],
    })
  })

  test('works out a blank cost, and keeps one typed over it', () => {
    const { rows } = buildSizeRates('A', [{ size: '7 x 3', cost: '' }, { size: '8 x 3', cost: '9,999' }], { rate: 100, unit: 'ft' })
    expect(rows.map((r) => r.cost)).toEqual([2100, 9999])
  })

  test('reads a cost written with commas or paise', () => {
    const { rows } = buildSizeRates('A', [{ size: '1', cost: '1,250' }, { size: '2', cost: '99.50' }], noRate)
    expect(rows.map((r) => r.cost)).toEqual([1250, 99.5])
  })

  test('leaves out a row with no size or no cost, and keeps the order', () => {
    const { rows } = buildSizeRates('A', [
      { size: '8x4', cost: '900' },
      { size: '', cost: '100' },
      { size: '7x4', cost: '' },
      { size: '6x4', cost: 'soon' },
      { size: '6x3', cost: '500' },
    ], noRate)
    expect(rows.map((r) => r.size)).toEqual(['8x4', '6x3'])
  })
})

describe('a brand quoted before', () => {
  test('gives its newest quotation, whatever the case it is typed in', () => {
    const all = [quoted('a', '2026-11-01', 'Century', 100), quoted('b', '2026-11-03', 'century', 200), quoted('c', '2026-11-04', 'Other', 300)]
    expect(lastRatesFor(all, ' CENTURY ')?.rows[0].cost).toBe(200)
  })

  test('does not start a quotation from itself', () => {
    const all = [quoted('a', '2026-11-01', 'Century', 100), quoted('b', '2026-11-03', 'Century', 200)]
    expect(lastRatesFor(all, 'Century', 'b')?.rows[0].cost).toBe(100)
  })

  test('gives nothing for a new brand or an empty box', () => {
    const all = [quoted('a', '2026-11-01', 'Century', 100)]
    expect(lastRatesFor(all, 'New')).toBeNull()
    expect(lastRatesFor(all, '  ')).toBeNull()
  })
})

/** Size Rates: a brand, its rate, its size boxes, and what each size comes to. */
import { describe, expect, test } from 'vitest'
import { buildBrandRows } from '../src/lib/pricing'
import { autoCost, buildSizeRates, findInPriceList, lastRatesFor, priceList, sizeLabel } from '../src/lib/sizeRates'
import type { Brand, BrandSet, Dimension, Quotation } from '../src/lib/types'

const brand = (category: Brand['category'], name: string, rate: number, guaranteeYears: Brand['guaranteeYears'] = 0): Brand => ({ id: `${category}-${name}`, category, name, rate, guaranteeYears })
const sets: BrandSet[] = [{
  id: 'c1',
  name: 'C1',
  brands: [brand('readymade-door', 'DDoor Sunmica', 288, 7), brand('flush-door', 'Signature', 172), brand('block-board-19', 'Signature', 118)],
}]
const list = priceList(sets)
const noRate = { rate: 0, unit: 'ft' as const }
const dim = (inches: number, soot = 0): Dimension => ({ inches, soot })
const row = (h: Dimension | number, w: Dimension | number, cost = '') => ({
  height: typeof h === 'number' ? dim(h) : h,
  width: typeof w === 'number' ? dim(w) : w,
  cost,
})

const quoted = (id: string, date: string, name: string, cost: number) => ({
  id, date, category: 'size-rates', sizeRates: { brand: name, rows: [{ size: '6x3', cost }] },
}) as unknown as Quotation

describe('the price list in the brand box', () => {
  test('tells apart a brand on several products, and says how each is measured', () => {
    expect(findInPriceList(list, 'signature · flush door')).toMatchObject({ rate: 172, unit: 'in', category: 'flush-door', name: 'Signature' })
    expect(findInPriceList(list, 'Signature · Block Board 19mm')).toMatchObject({ rate: 118, unit: 'ft', category: 'block-board-19' })
  })

  test('finds nothing for a brand typed by hand', () => {
    expect(findInPriceList(list, 'Anything')).toBeUndefined()
  })
})

describe('a size in words', () => {
  test('inches and soot, or feet', () => {
    expect(sizeLabel(dim(78, 4), dim(36), 'in')).toBe('78 4/8" X 36"')
    expect(sizeLabel(dim(8), dim(4), 'ft')).toBe("8' X 4'")
  })
})

describe('working out the cost', () => {
  const door = findInPriceList(list, 'DDoor Sunmica · Readymade Door')!
  const flush = findInPriceList(list, 'Signature · Flush Door')!
  const board = findInPriceList(list, 'Signature · Block Board 19mm')!

  test('a door in inches: rate x height x width / 144', () => {
    expect(autoCost(dim(78), dim(36), door)).toBe(5616)
  })

  test('a readymade door bills on its next standard size, as on the rate card', () => {
    expect(autoCost(dim(76), dim(35), door)).toBe(5616)
  })

  test('soot counts on a size with no standard table', () => {
    expect(autoCost(dim(78, 4), dim(32, 2), flush)).toBe(Math.round((172 * 78.5 * 32.25) / 144))
  })

  test('a board in feet: rate x height x width', () => {
    expect(autoCost(dim(8), dim(4), board)).toBe(3776)
  })

  test.each([
    ['Readymade', door, dim(76, 4), dim(35, 2)],
    ['Flush', flush, dim(80, 4), dim(32)],
    ['Board', board, dim(8), dim(4)],
  ])('comes to what the rate card says: %s', (_name, item, height, width) => {
    const [card] = buildBrandRows([brand(item.category, 'x', item.rate)], height, width, 1)
    expect(autoCost(height, width, item)).toBe(card.cost)
  })

  test('a brand typed by hand costs by the rate and unit given', () => {
    expect(autoCost(dim(7), dim(3), { rate: 100, unit: 'ft' })).toBe(2100)
    expect(autoCost(dim(84), dim(36), { rate: 100, unit: 'in' })).toBe(2100)
  })

  test('gives nothing without a rate, or until both sides are in', () => {
    expect(autoCost(dim(7), dim(3), noRate)).toBe(0)
    expect(autoCost(dim(7), dim(0), { rate: 100, unit: 'ft' })).toBe(0)
  })
})

describe('building the quotation', () => {
  test('carries the brand for the sheet, and each size for the boxes', () => {
    const door = findInPriceList(list, 'DDoor Sunmica · Readymade Door')!
    const { rate, unit, category, name, guaranteeYears } = door
    expect(buildSizeRates(door.label, [row(dim(78, 4), 36)], { rate, unit, category, name, guaranteeYears })).toMatchObject({
      brand: 'DDoor Sunmica · Readymade Door',
      name: 'DDoor Sunmica',
      guaranteeYears: 7,
      rows: [{ size: '78 4/8" X 36"', height: dim(78, 4), width: dim(36) }],
    })
  })

  test('takes any words for a brand, and prints them as its name', () => {
    expect(buildSizeRates('  Anything At All ', [row(7, 3, '2500')], noRate)).toMatchObject({ brand: 'Anything At All', name: 'Anything At All' })
  })

  test('works out a blank cost, and keeps one typed over it', () => {
    const { rows } = buildSizeRates('A', [row(7, 3), row(8, 3, '9,999')], { rate: 100, unit: 'ft' })
    expect(rows.map((r) => r.cost)).toEqual([2100, 9999])
  })

  test('reads a cost written with commas or paise', () => {
    const { rows } = buildSizeRates('A', [row(1, 1, '1,250'), row(2, 2, '99.50')], noRate)
    expect(rows.map((r) => r.cost)).toEqual([1250, 99.5])
  })

  test('leaves out a row missing a side or a cost, and keeps the order', () => {
    const { rows } = buildSizeRates('A', [row(8, 4, '900'), row(0, 4, '100'), row(7, 0, '100'), row(7, 4), row(6, 4, 'soon'), row(6, 3, '500')], noRate)
    expect(rows.map((r) => r.size)).toEqual(["8' X 4'", "6' X 3'"])
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

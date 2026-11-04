/** Size Rates: a brand, and what each of its sizes costs, as typed. */
import { describe, expect, test } from 'vitest'
import { buildSizeRates, lastRatesFor } from '../src/lib/sizeRates'
import type { Quotation } from '../src/lib/types'

const quoted = (id: string, date: string, brand: string, cost: number) => ({
  id, date, category: 'size-rates', sizeRates: { brand, rows: [{ size: '6x3', cost }] },
}) as unknown as Quotation

describe('building the quotation', () => {
  test('takes any words for a brand and a size, as typed', () => {
    expect(buildSizeRates('  Anything At All ', [{ size: ' 7 x 3 ft ', cost: '2500' }])).toEqual({
      brand: 'Anything At All',
      rows: [{ size: '7 x 3 ft', cost: 2500 }],
    })
  })

  test('reads a cost written with commas or paise', () => {
    const { rows } = buildSizeRates('A', [{ size: '1', cost: '1,250' }, { size: '2', cost: '99.50' }])
    expect(rows.map((r) => r.cost)).toEqual([1250, 99.5])
  })

  test('leaves out a row missing its size or its cost, and keeps the order', () => {
    const { rows } = buildSizeRates('A', [
      { size: '8x4', cost: '900' },
      { size: '', cost: '100' },
      { size: '7x4', cost: '' },
      { size: '6x4', cost: 'soon' },
      { size: '6x3', cost: '500' },
    ])
    expect(rows.map((r) => r.size)).toEqual(['8x4', '6x3'])
  })
})

describe('a brand quoted before', () => {
  test('gives its newest sizes and costs, whatever the case it is typed in', () => {
    const list = [quoted('a', '2026-11-01', 'Century', 100), quoted('b', '2026-11-03', 'century', 200), quoted('c', '2026-11-04', 'Other', 300)]
    expect(lastRatesFor(list, ' CENTURY ')?.[0].cost).toBe(200)
  })

  test('does not start a quotation from itself', () => {
    const list = [quoted('a', '2026-11-01', 'Century', 100), quoted('b', '2026-11-03', 'Century', 200)]
    expect(lastRatesFor(list, 'Century', 'b')?.[0].cost).toBe(100)
  })

  test('gives nothing for a new brand or an empty box', () => {
    const list = [quoted('a', '2026-11-01', 'Century', 100)]
    expect(lastRatesFor(list, 'New')).toBeNull()
    expect(lastRatesFor(list, '  ')).toBeNull()
  })
})

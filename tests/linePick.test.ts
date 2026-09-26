import { describe, expect, test } from 'vitest'
import { keepTyped, rateForUnit, withUnitRate } from '../src/lib/linePick'

describe('picking an item onto a line keeps what was typed', () => {
  test('an amount already on the line stays, whatever the item remembers', () => {
    expect(keepTyped({ qty: 20, unit: 'Pc', amount: 40, rateSqft: 2 }, { rate: 5, unit: 'Pc' }))
      .toEqual({ amount: 40, rateSqft: 2, unit: 'Pc' })
  })

  test('an item with no saved rate does not wipe the amount', () => {
    expect(keepTyped({ qty: 20, unit: 'Pc', amount: 40 }, {}))
      .toEqual({ amount: 40, rateSqft: 2, unit: 'Pc' })
  })

  test('an empty line takes the remembered rate, times the quantity already typed', () => {
    expect(keepTyped({ qty: 20, unit: 'Pc', amount: 0 }, { rate: 2, unit: 'Set' }))
      .toEqual({ amount: 40, rateSqft: 2, unit: 'Set' })
  })

  test('a unit the counter changed is kept; the default gives way to the item', () => {
    expect(keepTyped({ qty: 2, unit: 'Kg', amount: 0 }, { rate: 120, unit: 'Pc' }).unit).toBe('Kg')
    expect(keepTyped({ qty: 2, unit: 'Pc', amount: 0 }, { rate: 120, unit: 'Kg' }).unit).toBe('Kg')
    expect(keepTyped({ qty: 2, amount: 0 }, {}).unit).toBe('Pc')
  })

  test('nothing typed and nothing remembered leaves the line empty, not broken', () => {
    expect(keepTyped({ qty: 0, amount: 0 }, {})).toEqual({ amount: 0, rateSqft: undefined, unit: 'Pc' })
  })
})

describe('an item sold in more than one unit keeps a rate for each', () => {
  const screw = { rate: 3, unit: 'Pkt', unitRates: withUnitRate(withUnitRate(undefined, 'Pkt', 250), 'pc', 3) }

  test('each unit brings back its own figure, however the unit is spelled', () => {
    expect(rateForUnit(screw, 'PKT')).toBe(250)
    expect(rateForUnit(screw, 'Pc')).toBe(3)
  })

  test('a unit with no figure of its own does not borrow another unit\'s', () => {
    expect(rateForUnit(screw, 'Box')).toBe(0)
  })

  test('an item saved before per-unit rates uses its one rate for any unit', () => {
    expect(rateForUnit({ rate: 40 }, 'Box')).toBe(40)
  })

  test('picking the item prices the line at the rate for the unit it lands in', () => {
    expect(keepTyped({ qty: 2, unit: 'Pc', amount: 0 }, screw))
      .toEqual({ amount: 500, rateSqft: 250, unit: 'Pkt' })
    expect(keepTyped({ qty: 10, unit: 'Nos', amount: 0 }, { ...screw, unitRates: { ...screw.unitRates, Nos: 3 } }))
      .toEqual({ amount: 30, rateSqft: 3, unit: 'Nos' })
  })
})

import { describe, expect, test } from 'vitest'
import { keepTyped } from '../src/lib/linePick'

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

import { describe, expect, test } from 'vitest'
import { rateFromAmount } from '../src/lib/guaranteeRate'

describe('guarantee card item rates', () => {
  test('derives the square-foot rate from a row total', () => {
    // 5 boards of 7 × 4 are 140 sq ft; ₹12,329 divided by that is ₹88.06.
    expect(rateFromAmount(12329, 140)).toBe(88.06)
    expect(rateFromAmount('', 140)).toBe('')
  })
})

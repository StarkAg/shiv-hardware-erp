import { describe, expect, it } from 'vitest'
import { amountFromRate, FIRST_SLIP, nextNumber, printedRows, slipFigure, slipTotal, stampedNumber, wobble } from '../src/features/slip/slip'

describe('the handwritten slip', () => {
  it('adds the items to the balance brought forward, as the real slip does', () => {
    expect(slipTotal(FIRST_SLIP)).toBe(31339)
  })

  it('writes figures with no commas and no needless paise', () => {
    expect(slipFigure(31339)).toBe('31339')
    expect(slipFigure(12.5)).toBe('12.5')
    expect(slipFigure(0.1 + 0.2)).toBe('0.3')
  })

  it('works out an amount from a rate only when both are there', () => {
    expect(amountFromRate('12', '6')).toBe('72')
    expect(amountFromRate('', '6')).toBe('')
    expect(amountFromRate('12', '')).toBe('')
  })

  it('stamps two digits and moves on to the next number', () => {
    expect(stampedNumber('9')).toBe('09')
    expect(stampedNumber('123')).toBe('123')
    expect(nextNumber('9')).toBe('10')
  })

  it('leaves blank rows off the paper', () => {
    const blank = { id: 'b', item: '  ', qty: '', unit: 'Pc', rate: '', amount: '' }
    expect(printedRows([blank])).toEqual([])
  })

  it('shakes the same way every time, so preview and picture match', () => {
    expect(wobble(7, 2)).toBe(wobble(7, 2))
    expect(Math.abs(wobble(7, 2))).toBeLessThanOrEqual(2)
  })
})

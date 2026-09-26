import { describe, expect, test } from 'vitest'
import { nextQuoteNumber } from '../src/lib/types'

describe('quotations number in a series of their own', () => {
  test('the first quotation is Q-1, whatever the bills are numbered', () => {
    expect(nextQuoteNumber([{ number: '412' }, { kind: 'sale', number: '413' }])).toBe('Q-1')
  })

  test('the next follows the highest quotation', () => {
    expect(nextQuoteNumber([{ kind: 'quotation', number: 'Q-2' }, { kind: 'quotation', number: 'Q-7' }, { number: '900' }])).toBe('Q-8')
  })

  test('a quotation already converted to a sale keeps its number spoken for', () => {
    expect(nextQuoteNumber([{ kind: 'quotation', number: 'Q-3' }, { number: '414', fromQuote: 'Q-5' }])).toBe('Q-6')
  })
})

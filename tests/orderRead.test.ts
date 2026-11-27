import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs module
import { isOrderText } from '../whatsapp-reminders/group-print.mjs'
// @ts-expect-error plain .mjs module
import { orderLines } from '../print-server/order-read.mjs'

describe('isOrderText', () => {
  it('finds the word order in a caption or message', () => {
    expect(isOrderText('order')).toBe(true)
    expect(isOrderText('Order bw')).toBe(true)
    expect(isOrderText('pls ORDER this')).toBe(true)
  })
  it('ignores other words and empty text', () => {
    expect(isOrderText('orders')).toBe(false)
    expect(isOrderText('border')).toBe(false)
    expect(isOrderText('')).toBe(false)
    expect(isOrderText(undefined)).toBe(false)
  })
})

describe('orderLines', () => {
  it('keeps item lines and strips bullets, numbering and markdown', () => {
    expect(orderLines('- 19mm S 7x4 - 1 pc\n2. Fevicol Marine - 4 kg\n\n**Polyfix - 1 pc**\n')).toEqual([
      '19mm S 7x4 - 1 pc',
      'Fevicol Marine - 4 kg',
      'Polyfix - 1 pc',
    ])
  })
  it('gives nothing for NONE', () => {
    expect(orderLines('NONE')).toEqual([])
    expect(orderLines('  \n')).toEqual([])
  })
})

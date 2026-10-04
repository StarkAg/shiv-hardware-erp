import { describe, expect, it } from 'vitest'
import { paidByDefault, withPaidDefault } from '../src/lib/paidDefault'

const amountOnly = { id: 'amount', description: 'On account', qty: 1, unit: 'Pc', amount: 500, amountOnly: true }
const goods = { id: 'goods', description: 'Plywood', qty: 1, unit: 'Pc', amount: 500 }

describe('sale payment default', () => {
  it('takes an amount-only sale as paid without a separate receipt', () => {
    const sale = { kind: 'sale' as const, items: [amountOnly], paidAmount: undefined, paid: false }
    expect(paidByDefault(sale, 500)).toBe(true)
    expect(withPaidDefault(sale, 500)).toEqual({ paidAmount: 500, paid: true })
  })

  it('settles W/B goods sales even when an old draft says credit', () => {
    for (const customerName of ['W/B', 'w/b', 'M/s WB']) {
      const sale = { customerName, kind: 'sale' as const, items: [goods], paidAmount: 0, paid: false }
      expect(withPaidDefault(sale, 500)).toEqual({ paidAmount: 500, paid: true })
    }
  })

  it('respects explicit credit and leaves goods sales on credit', () => {
    expect(paidByDefault({ kind: 'sale', items: [amountOnly], paidAmount: 0 }, 500)).toBe(false)
    expect(paidByDefault({ kind: 'sale', items: [goods], paidAmount: undefined }, 500)).toBe(false)
    expect(paidByDefault({ kind: 'purchase', items: [amountOnly], paidAmount: undefined }, 500)).toBe(false)
  })
})

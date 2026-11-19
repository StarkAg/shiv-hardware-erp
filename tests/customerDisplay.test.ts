import { describe, expect, it } from 'vitest'
import { customerLines } from '../src/lib/customerDisplay'
import { withCharges } from '../src/lib/billCharges'
import type { BillItem } from '../src/lib/types'

const line = (p: Partial<BillItem>): BillItem => ({ id: Math.random().toString(36), description: '', qty: 1, unit: 'Pc', amount: 0, ...p })

describe('customer screen lines', () => {
  it('shows each item with its rate, and leaves out empty lines', () => {
    const out = customerLines([
      line({ description: '19mm Solid 8 X 4', qty: 2, unit: 'Pc', amount: 5600 }),
      line({ description: '', amount: 0 }),
      line({ description: 'Fare', amountOnly: true, qty: 1, amount: 200 }),
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ qty: 2, rate: 2800, amount: 5600, worked: false })
    expect(out[1]).toMatchObject({ description: 'Fare', qty: 0, rate: undefined, amount: 200 })
  })

  it('marks discount, GST and round-off as worked out', () => {
    const bill = withCharges({
      items: [line({ description: 'Hinge', qty: 3, amount: 333.4 })],
      offValue: 10, offIsPercent: false, gst: 'none', round: 'auto',
    } as never) as { items: BillItem[] }
    const out = customerLines(bill.items)
    expect(out[0].worked).toBe(false)
    expect(out.slice(1).every((l) => l.worked && l.qty === 0 && l.rate === undefined)).toBe(true)
    expect(out.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(323, 2)
  })
})

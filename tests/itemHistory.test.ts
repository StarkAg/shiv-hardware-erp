import { describe, expect, test } from 'vitest'
import { itemHistory, recallList } from '../src/lib/itemHistory'
import type { Bill, BillItem } from '../src/lib/types'

const line = (description: string, unit: string, qty = 1, amount = 0, extra: Partial<BillItem> = {}): BillItem =>
  ({ id: description + unit + amount, description, unit, qty, amount, ...extra })
const bill = (updatedAt: number, items: BillItem[], kind?: Bill['kind']): Bill =>
  ({ id: String(updatedAt), number: String(updatedAt), date: '2026-09-26', customerName: 'X', customerPhone: '', ref: '', items, total: 0, paid: false, paymentMode: 'cash', upiRef: '', notes: '', updatedAt, ...(kind ? { kind } : {}) } as Bill)

describe('what the shop billed lately', () => {
  const bills = [
    bill(1, [line('Screw 1 Inch', 'Pc', 10, 30, { customEntryId: 'scr' })]),
    bill(2, [line('Screw 1 Inch', 'pkt', 2, 500, { customEntryId: 'scr' }), line('Fevicol 1kg', 'Pc', 1, 400)]),
    bill(3, [line('Plywood 19mm', 'Pc', 1, 3000)], 'purchase'),
  ]

  test('an item opens in the unit it last went out in', () => {
    const h = itemHistory(bills, false)
    expect(h.unitOf.get('screw 1 inch')).toBe('Pkt')
    expect(h.unitOfEntry.get('scr')).toBe('Pkt')
  })

  test('the last item entered comes first, each item once, with its rate', () => {
    const h = itemHistory(bills, false)
    expect(h.recent.map((r) => r.description)).toEqual(['Fevicol 1kg', 'Screw 1 Inch'])
    expect(h.recent[1].rate).toBe(250)
  })

  test('purchases and sales keep their own history', () => {
    expect(itemHistory(bills, true).recent.map((r) => r.description)).toEqual(['Plywood 19mm'])
    expect(itemHistory(bills, false).unitOf.has('plywood 19mm')).toBe(false)
  })

  test('Up offers the lines above first, nearest first, without repeats', () => {
    const h = itemHistory(bills, false)
    const above = [line('Hinge 4 Inch', 'Pc', 4, 80), line('Fevicol 1kg', 'Pc', 1, 420)]
    expect(recallList(above, h.recent).map((r) => r.description)).toEqual(['Fevicol 1kg', 'Hinge 4 Inch', 'Screw 1 Inch'])
  })
})

describe('a goods return', () => {
  test('is read on the side of the account it was on', () => {
    const ret = (ledgerId: string, description: string) => ({
      id: ledgerId, number: '9', date: '2026-10-01', customerName: 'X', kind: 'return' as const, ledgerId,
      items: [{ id: 'a', description, qty: 1, unit: 'Pc', amount: 100 }],
    })
    const bills = [ret('sup', 'Sent Back'), ret('cus', 'Came Back')] as never
    const suppliers = new Set(['sup'])
    expect(itemHistory(bills, true, suppliers).recent.map((r) => r.description)).toEqual(['Sent Back'])
    expect(itemHistory(bills, false, suppliers).recent.map((r) => r.description)).toEqual(['Came Back'])
  })
})

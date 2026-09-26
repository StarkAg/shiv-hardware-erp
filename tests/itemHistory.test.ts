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
    const h = itemHistory(bills, 'sale')
    expect(h.unitOf.get('screw 1 inch')).toBe('Pkt')
    expect(h.unitOfEntry.get('scr')).toBe('Pkt')
  })

  test('the last item entered comes first, each item once, with its rate', () => {
    const h = itemHistory(bills, 'sale')
    expect(h.recent.map((r) => r.description)).toEqual(['Fevicol 1kg', 'Screw 1 Inch'])
    expect(h.recent[1].rate).toBe(250)
  })

  test('purchases and sales keep their own history', () => {
    expect(itemHistory(bills, 'purchase').recent.map((r) => r.description)).toEqual(['Plywood 19mm'])
    expect(itemHistory(bills, 'sale').unitOf.has('plywood 19mm')).toBe(false)
  })

  test('Up offers the lines above first, nearest first, without repeats', () => {
    const h = itemHistory(bills, 'sale')
    const above = [line('Hinge 4 Inch', 'Pc', 4, 80), line('Fevicol 1kg', 'Pc', 1, 420)]
    expect(recallList(above, h.recent).map((r) => r.description)).toEqual(['Fevicol 1kg', 'Hinge 4 Inch', 'Screw 1 Inch'])
  })
})

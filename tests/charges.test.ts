import { describe, expect, test } from 'vitest'
import { billCharges, billLines, isAmountOnlyLine, isChargeName, type BillItem } from '../src/lib/types'

const line = (description: string, amount = 100): BillItem =>
  ({ id: description, description, qty: 1, unit: 'Pc', amount }) as BillItem

describe('charges on a bill are not goods', () => {
  test('fare, discount and tax are charges', () => {
    for (const name of ['Bill', ' bill ', 'BILL', 'Fare', 'Cartage', 'Freight', 'Labour', 'Transport', 'Discount', 'Less',
      'CGST 9%', 'SGST 9%', 'C GST 9%', 'S GST 9%', 'IGST 18%', 'GST', 'c.gst 9%', ' discount ']) {
      expect(isChargeName(name), name).toBe(true)
    }
  })

  test('goods that only mention tax or fare are still goods', () => {
    for (const name of ['Sanmica GST 589 G/In', '4284 NGN', 'Fevicol Marine', 'Fare 2 Times', 'Discounted Hinges', '19mm Solid 8 X 4']) {
      expect(isChargeName(name), name).toBe(false)
    }
  })

  test('a discount and GST sit with the charges, not the numbered lines', () => {
    const items = [line('4284 NGN', 2700), line('Discount', -250), line('CGST 9%', 488.9), line('Fare', 96)]
    expect(billLines(items).map((i) => i.description)).toEqual(['4284 NGN'])
    expect(billCharges(items).map((i) => i.description)).toEqual(['Discount', 'CGST 9%', 'Fare'])
    expect(isAmountOnlyLine(line('SGST 9%'))).toBe(true)
  })
})

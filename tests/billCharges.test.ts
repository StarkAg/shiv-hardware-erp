import { describe, expect, test } from 'vitest'
import { chargeLines, handLines, withCharges } from '../src/lib/billCharges'
import { billCharges, billLines, type BillItem } from '../src/lib/types'
import { buildBillHtml } from '../src/lib/billHtml'

const line = (description: string, amount: number): BillItem =>
  ({ id: description, description, qty: 1, unit: 'Pc', amount }) as BillItem
const sum = (items: BillItem[]) => Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100
const shown = (items: BillItem[]) => items.map((i) => [i.description, i.amount])

describe('discount, GST and round-off written from the goods', () => {
  const goods = [line('HR Lam 8207 ST', 3372), line('Fevicol Marine', 2060.23)]

  test('18% inside the state is CGST 9% and SGST 9% on the goods', () => {
    // Bill 40, which the counter worked out by hand: 5432.23 + 488.90 + 488.90.
    const lines = chargeLines(goods, { gst: 'local' })
    expect(shown(lines)).toEqual([['CGST 9%', 488.9], ['SGST 9%', 488.9]])
    expect(sum([...goods, ...lines])).toBe(6410.03)
  })

  test('across states it is IGST at the whole rate', () => {
    expect(shown(chargeLines(goods, { gst: 'igst', gstRate: 18 }))).toEqual([['IGST 18%', 977.8]])
    expect(shown(chargeLines(goods, { gst: 'local', gstRate: 5 }))).toEqual([['CGST 2.5%', 135.81], ['SGST 2.5%', 135.81]])
  })

  test('the discount comes off before tax', () => {
    const items = [line('Board', 1000)]
    expect(shown(chargeLines(items, { offValue: 100, gst: 'local' }))).toEqual([
      ['Discount', -100], ['CGST 9%', 81], ['SGST 9%', 81],
    ])
    expect(shown(chargeLines(items, { offValue: 5, offIsPercent: true }))).toEqual([['Discount 5%', -50]])
    // Never more than the goods.
    expect(shown(chargeLines(items, { offValue: 5000 }))).toEqual([['Discount', -1000]])
    expect(shown(chargeLines(items, { offValue: 150, offIsPercent: true }))).toEqual([['Discount 100%', -1000]])
  })

  test('auto round-off lands the total on a whole rupee, up or down', () => {
    const down = [...goods, ...chargeLines(goods, { gst: 'local', round: 'auto' })]
    expect(down.at(-1)).toMatchObject({ description: 'Roundup', amount: -0.03, isRoundup: true })
    expect(sum(down)).toBe(6410)
    const up = [line('Screw', 99.6)]
    expect(sum([...up, ...chargeLines(up, { round: 'auto' })])).toBe(100)
    // Already whole: nothing to add.
    expect(chargeLines([line('Board', 500)], { round: 'auto' })).toEqual([])
  })

  test('manual round-off takes the figure as typed', () => {
    const items = [line('Board', 43459)]
    expect(sum([...items, ...chargeLines(items, { round: 'manual', roundValue: -459 })])).toBe(43000)
    expect(chargeLines(items, { round: 'manual' })).toEqual([])
  })

  test('saved lines are written again, never added twice', () => {
    const once = withCharges({ items: goods, gst: 'local' as const, round: 'auto' as const })
    const twice = withCharges(once)
    expect(twice.items).toEqual(once.items)
    expect(handLines(twice.items)).toEqual(goods)
    // Turned off: the written lines go.
    expect(withCharges({ ...once, gst: 'none' as const, round: 'off' as const }).items).toEqual(goods)
  })

  test('nothing set leaves the bill as it was', () => {
    const bill = { items: goods }
    expect(withCharges(bill)).toBe(bill)
    expect(chargeLines([], { gst: 'local', offValue: 10, round: 'auto' })).toEqual([])
  })

  test('they print as charges, under a sub total', () => {
    const items = withCharges({ items: goods, gst: 'local' as const, offValue: 30, round: 'auto' as const }).items
    expect(billLines(items).map((i) => i.description)).toEqual(['HR Lam 8207 ST', 'Fevicol Marine'])
    expect(billCharges(items).map((i) => i.description)).toEqual(['Discount', 'CGST 9%', 'SGST 9%', 'Roundup'])
    const html = buildBillHtml({
      id: 'x', number: '1', date: '2026-09-17', customerName: 'Ramesh', items,
      total: sum(items), paid: false,
    } as never)
    expect(html).toContain('Sub Total')
    expect(html).toContain('CGST 9%')
  })
})

describe('a fare on a bill of several pages', () => {
  test('prints Sub Total, then the fare, then Total — in that order', () => {
    // Q-1's shape: sixteen lines of goods over two pages, then a fare.
    const goods = Array.from({ length: 16 }, (_, n) => line(`Item ${n + 1}`, 5000))
    const fare = { ...line('Fare', 900), amountOnly: true } as BillItem
    const items = [...goods, fare]
    const html = buildBillHtml({
      id: 'q', number: 'Q-1', kind: 'quotation', date: '2026-09-25', customerName: 'Satyendra Prasad', items,
      total: sum(items), paid: false,
    } as never)
    const lastPage = html.slice(html.lastIndexOf('Q-1'))
    const at = (text: string) => lastPage.indexOf(text)
    expect(at('Sub Total')).toBeGreaterThan(-1)
    expect(at('80,000')).toBeGreaterThan(at('Sub Total'))
    expect(at('Fare')).toBeGreaterThan(at('80,000'))
    expect(at('>Total<')).toBeGreaterThan(at('Fare'))
    expect(at('80,900')).toBeGreaterThan(at('>Total<'))
  })

  test('a bill with no charges prints no Sub Total', () => {
    const items = [line('Hinge', 100)]
    const html = buildBillHtml({ id: 'n', number: '5', date: '2026-09-25', customerName: 'A', items, total: 100, paid: false } as never)
    expect(html).not.toContain('Sub Total')
  })
})

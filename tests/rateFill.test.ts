import { describe, expect, test } from 'vitest'
import { lastSoldRates, openingRate, rateOnBill, readQty, type ScannedLine } from '../src/lib/rateFill'
import type { Bill, BillItem } from '../src/lib/types'

const line = (description: string, qty: number, amount: number, unit = 'Pc', extra: Partial<BillItem> = {}): BillItem =>
  ({ id: description + amount, description, qty, amount, unit, ...extra })
const bill = (date: string, items: BillItem[], kind?: Bill['kind']): Bill =>
  ({ id: date + (kind ?? ''), number: '1', date, customerName: 'X', customerPhone: '', ref: '', items, total: 0, paid: false, paymentMode: 'cash', upiRef: '', notes: '', ...(kind ? { kind } : {}) } as Bill)

describe('a line follows the rate this bill already gives', () => {
  const bill19 = [line('19mm S 8 X 4', 5, 18880), line('Fevicol Marine 10 Kg', 1, 3000)]

  test('a board of the same thickness gives its square-foot rate, worked to this size', () => {
    // ₹3,776 for 32 sqft is ₹118 a sqft; a 7 X 4 is 28 sqft.
    expect(rateOnBill('19mm S 7 X 4', 'Pc', bill19, 'new')).toEqual({ rate: 3304, unit: 'Pc' })
    expect(rateOnBill('19mm B.Board S 8 X 4', 'Pc', bill19, 'new')?.rate).toBe(3776)
  })

  test('the same kind of board is followed before another of the thickness', () => {
    const two = [line('19mm Mr 8 X 4', 1, 2080), line('19mm S 8 X 4', 1, 3776)]
    expect(rateOnBill('19mm S 7 X 4', 'Pc', two, 'new')?.rate).toBe(3304)
  })

  test('another thickness says nothing', () => {
    expect(rateOnBill('12mm S 8 X 4', 'Pc', bill19, 'new')).toBeNull()
  })

  test('any other item takes the rate of the same item on the bill, in the same unit', () => {
    expect(rateOnBill('Fevicol Marine 10 Kg', 'Pc', bill19, 'new')).toEqual({ rate: 3000, unit: 'Pc' })
    expect(rateOnBill('Fevicol Marine 10 Kg', 'Kg', bill19, 'new')).toBeNull()
  })

  test('the line being picked is not its own source', () => {
    const own = [line('Abro Tape', 3, 360, 'B/L')]
    expect(rateOnBill('Abro Tape', 'B/L', own, own[0].id)).toBeNull()
  })
})

describe('reading the quantity off a slip', () => {
  test('numbers, fractions and units', () => {
    expect(readQty('5pc')).toEqual({ qty: 5, unit: 'Pc' })
    expect(readQty('1/2kg')).toEqual({ qty: 0.5, unit: 'Kg' })
    expect(readQty('4 set')?.qty).toBe(4)
  })

  test('grams are kilos', () => {
    expect(readQty('250 gm')).toEqual({ qty: 0.25, unit: 'Kg' })
  })

  test('what cannot be read is not guessed', () => {
    expect(readQty('9 sft -3.6 6pc')).toBeNull()
    expect(readQty('2/c')).toBeNull()
    expect(readQty(undefined)).toBeNull()
  })
})

describe('what an item last sold at, as Shiv Rates shows it', () => {
  const customer = (id: string) => id === 'cust'
  const scanned: ScannedLine[] = [
    { desc: '12" Telescopic Indian', qty: '4 set', amount: 1824, date: Date.parse('2026-05-20'), partyLedgerId: 'cust' },
    { desc: '1.5" Gutka', qty: '1pkt', amount: 35, date: Date.parse('2026-05-13'), partyLedgerId: 'cust' },
    { desc: '1.5" Gutka', qty: '1pkt', amount: 20, date: Date.parse('2026-06-01'), partyLedgerId: 'supplier' },
    { desc: '2" Nail', qty: '250 gm', amount: 30, date: Date.parse('2026-07-27'), partyLedgerId: 'cust' },
    { desc: '20" Telescopic Godrej', qty: '1 Set', rate: 'MRP 599', amount: 419, date: Date.parse('2026-08-10'), partyLedgerId: 'cust' },
    { desc: 'Hinges', qty: '10 pc', rate: '48', amount: 480, date: Date.parse('2026-08-10'), partyLedgerId: 'cust' },
  ]
  const bills = [
    bill('2026-09-01', [line('12" Telescopic Indian', 2, 1000, 'Set')]),
    bill('2026-09-10', [line('1.5" Gutka', 1, 15, 'Pkt')], 'purchase'),
    bill('2026-09-11', [line('Abro Tape', 3, 360, 'B/L')], 'quotation'),
  ]
  const sold = lastSoldRates(bills, scanned, customer)

  test('the newer of the panel and the slips wins', () => {
    expect(sold.get('12 telescopic indian')?.rate).toBe(500)
  })

  test('a supplier\'s price, or a quotation, is never a sale', () => {
    expect(sold.get('15 gutka')?.rate).toBe(35)
    expect(sold.get('abro tape')).toBeUndefined()
  })

  test('grams are priced by the kilo', () => {
    expect(sold.get('2 nail')).toMatchObject({ rate: 120, unit: 'Kg' })
  })

  test('a written rate is taken when it agrees with the amount, not when it is an MRP', () => {
    expect(sold.get('hinges')?.rate).toBe(48)
    expect(sold.get('20 telescopic godrej')?.rate).toBe(419)
  })
})

describe('the rate a sale line opens at', () => {
  const sold = lastSoldRates(
    [bill('2026-09-13', [line('19mm S 8 X 4', 1, 3456), line('1.5" Gutka', 1, 35, 'Pkt')])],
    [],
    () => false,
  )

  test('this bill comes before the last sale', () => {
    const onBill = [line('19mm S 7 X 4', 1, 3304)]
    expect(openingRate('19mm S 8 X 4', 'Pc', onBill, 'new', sold)).toEqual({ rate: 3776, unit: 'Pc', from: 'bill' })
  })

  test('with nothing like it on the bill, the last sale fills it', () => {
    expect(openingRate('19mm S 8 X 4', 'Pc', [], 'new', sold)).toEqual({ rate: 3456, unit: 'Pc', from: 'sold' })
    expect(openingRate('1.5" Gutka', 'Pkt', [], 'new', sold)).toEqual({ rate: 35, unit: 'Pkt', from: 'sold' })
  })

  test('a last sale in another unit is not used', () => {
    expect(openingRate('1.5" Gutka', 'Pc', [], 'new', sold)).toBeNull()
  })

  test('nothing known leaves the item\'s own rate to fill it', () => {
    expect(openingRate('Something New', 'Pc', [], 'new', sold)).toBeNull()
  })
})

import { describe, expect, test } from 'vitest'
import {
  applyRowEdit,
  duplicateLastRow,
  priceListRate,
  quoteRate,
  rateFromAmount,
  repriceForBrand,
  rowRate,
  savedCardRates,
  type Rates,
  type SizeRow,
} from '../src/lib/guaranteeRate'
import type { Brand, GuaranteeDocument } from '../src/lib/types'

describe('guarantee card item rates', () => {
  test('derives the square-foot rate from a row total', () => {
    // 5 boards of 7 × 4 are 140 sq ft; ₹12,329 divided by that is ₹88.06.
    expect(rateFromAmount(12329, 140)).toBe(88.06)
    expect(rateFromAmount('', 140)).toBe('')
  })
})

// The quotation (default price set C1): DDoor Sunmica 30MM at ₹288/sq ft.
const quotation: Brand[] = [
  { id: 'b1', category: 'readymade-door', name: 'DDoor Sunmica', rate: 288, guaranteeYears: 10, thicknessMm: 30 },
]
// GC-2026-0092 as it was saved: each rate worked back from a typed amount.
const savedCard = {
  id: 'GC-2026-0092',
  number: 'GC-2026-0092',
  date: '2026-11-28T06:30:00.000Z',
  updatedAt: 1,
  items: [
    { brandName: 'DDSM 1119 CU', thickness: '30MM', sqftRate: 299.34, amount: 6156 },
    { brandName: 'DDSM 1119 FL', thickness: '30MM', sqftRate: 303.34, amount: 6804 },
  ],
} as unknown as GuaranteeDocument
const rates: Rates = {
  list: (type, thickness) => priceListRate(quotation, type, thickness),
  saved: savedCardRates([savedCard]),
}

let n = 0
const newId = () => `r${++n}`
const blank = (): SizeRow => ({ id: newId(), thickness: '', type: '', length: '', lengthSoot: '', height: '', heightSoot: '', qty: '', sqftRate: '', amount: '' })
const door = (patch: Partial<SizeRow>): SizeRow => ({ ...blank(), thickness: '30MM', type: 'DDSM 1119 CU', length: 79, lengthSoot: 4, height: 37, heightSoot: 2, qty: 1, ...patch })

describe('guarantee card rows stay at the quotation rate', () => {
  test('a rate worked back from an amount on a saved card is not reused', () => {
    expect(rates.saved('DDSM 1119 CU', '30MM')).toBe('')
    // A model number of the card brand takes the brand's quotation rate.
    expect(rowRate(rates, 'DDoor Sunmica')('DDSM 1119 CU', '30MM')).toBe(288)
    // A whole-rupee rate a saved card used still prices a name the quotation lacks.
    const typed = { ...savedCard, items: [{ brandName: 'Arya Teak', thickness: '30MM', sqftRate: 310, amount: 6375 }] } as unknown as GuaranteeDocument
    expect(savedCardRates([typed])('Arya Teak', '30MM')).toBe(310)
  })

  test('a duplicated row whose size is then changed keeps the default rate', () => {
    const quote = quoteRate(rates, 'DDoor Sunmica')
    const rateFor = rowRate(rates, 'DDoor Sunmica')
    // The first door's amount was typed by hand, so its rate shows 299.34.
    const typed = applyRowEdit(door({}), { amount: 6156 }, rateFor)
    expect(typed.sqftRate).toBe(299.34)

    const rows = duplicateLastRow([typed, blank()], quote, newId, blank)
    expect(rows).toHaveLength(3)
    const copy = rows[1]
    expect(copy.id).not.toBe(typed.id)
    expect(copy.amountManual).toBe(false)
    expect(copy.sqftRate).toBe(288)
    // 79 4/8 × 37 2/8 = 20.57 sq ft × 288
    expect(copy.amount).toBe(5923)
    expect(rows[2].type).toBe('')

    // The next door is narrower: 79 4/8 × 34 6/8 = 19.18 sq ft.
    const resized = applyRowEdit(applyRowEdit(copy, { height: 34 }, rateFor), { heightSoot: 6 }, rateFor)
    expect(resized.sqftRate).toBe(288)
    expect(resized.amount).toBe(Math.round(((79.5 * 34.75) / 144) * 288))
    expect(resized.amount).toBe(5525)
  })

  test('picking the brand puts every row on its quotation rate', () => {
    const rows = [
      door({ sqftRate: 299.34, amount: 6156 }),
      applyRowEdit(door({ type: 'DDSM 1119 FL', length: 80, lengthSoot: 0, height: 40, heightSoot: 3 }), { amount: 6804 }, rowRate(rates, '')),
      blank(),
    ]
    const priced = repriceForBrand(rows, rates, '', 'DDoor Sunmica')
    expect(priced.slice(0, 2).map((r) => r.sqftRate)).toEqual([288, 288])
    expect(priced[0].amount).toBe(5923)
    expect(priced[1].amountManual).toBe(false)
    expect(priced[2]).toBe(rows[2])
  })
})

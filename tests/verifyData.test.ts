import { describe, expect, it } from 'vitest'
import { findProblems, type Books } from '../convex/lib/integrity'

const DAY = 86_400_000
const date = Date.UTC(2026, 9, 10) - 19_800_000 // 10 Oct 2026, midnight in India
const now = Date.UTC(2026, 9, 14, 6)

function books(over: Partial<Books> = {}): Books {
  return {
    now,
    types: [{ _id: 't-sal', abbr: 'SAL' }, { _id: 't-rct', abbr: 'RCT' }],
    ledgers: [{ _id: 'cust', name: 'Harsh' }, { _id: 'sales', name: 'Sales' }, { _id: 'cash', name: 'Cash' }],
    vouchers: [{ _id: 'v1', typeId: 't-sal', voucherNo: 1, fy: '2026-27', date, partyLedgerId: 'cust', status: 'final', amount: 100, refNo: 'BILL-1' }],
    entries: [
      { voucherId: 'v1', ledgerId: 'cust', side: 'Dr', amount: 100, date },
      { voucherId: 'v1', ledgerId: 'sales', side: 'Cr', amount: 100, date },
    ],
    bills: [{ id: 'b1', number: 1, kind: 'sale', customerName: 'Harsh', ledgerId: 'cust', total: 100, voucherId: 'v1' }],
    ...over,
  }
}
const kinds = (b: Books) => findProblems(b).map((p) => p.kind)

describe('Verify Data', () => {
  it('finds nothing wrong with sound books', () => {
    expect(findProblems(books())).toEqual([])
  })

  it('accepts a part-paid sale: Cash and the customer debited, Sales credited', () => {
    const b = books({
      entries: [
        { voucherId: 'v1', ledgerId: 'sales', side: 'Cr', amount: 100, date },
        { voucherId: 'v1', ledgerId: 'cash', side: 'Dr', amount: 60, date },
        { voucherId: 'v1', ledgerId: 'cust', side: 'Dr', amount: 40, date },
      ],
    })
    expect(findProblems(b)).toEqual([])
  })

  it('accepts a paid sale in four lines', () => {
    const b = books({
      entries: [
        { voucherId: 'v1', ledgerId: 'cust', side: 'Dr', amount: 100, date },
        { voucherId: 'v1', ledgerId: 'sales', side: 'Cr', amount: 100, date },
        { voucherId: 'v1', ledgerId: 'cash', side: 'Dr', amount: 40, date },
        { voucherId: 'v1', ledgerId: 'cust', side: 'Cr', amount: 40, date },
      ],
    })
    expect(findProblems(b)).toEqual([])
  })

  it('catches a bill whose voucher was deleted (RCT-445)', () => {
    const b = books({ vouchers: [], entries: [] })
    expect(findProblems(b)).toEqual([expect.objectContaining({ kind: 'bill', link: '/bills/b1' })])
  })

  it('catches a voucher that does not balance, and one whose amount is not what it posts', () => {
    expect(kinds(books({ entries: [
      { voucherId: 'v1', ledgerId: 'cust', side: 'Dr', amount: 100, date },
      { voucherId: 'v1', ledgerId: 'sales', side: 'Cr', amount: 90, date },
    ] }))).toContain('balance')
    const priced = books()
    priced.vouchers[0].amount = 120
    expect(kinds(priced)).toEqual(expect.arrayContaining(['amount', 'bill']))
  })

  it('catches a number used twice in a series and year', () => {
    const b = books()
    b.vouchers.push({ ...b.vouchers[0], _id: 'v2', refNo: undefined })
    b.entries.push(...b.entries.map((e) => ({ ...e, voucherId: 'v2' })))
    expect(kinds(b)).toEqual(['number'])
  })

  it('catches a date after today and a year that does not match the date', () => {
    const future = books()
    future.vouchers[0].date = now + 2 * DAY
    future.entries.forEach((e) => { e.date = now + 2 * DAY })
    expect(kinds(future)).toEqual(['date'])
    const wrongYear = books()
    wrongYear.vouchers[0].fy = '2025-26'
    expect(kinds(wrongYear)).toEqual(['year'])
  })

  it('catches lines with no voucher, and lines or a voucher on an account that is gone', () => {
    const b = books()
    b.entries.push({ voucherId: 'gone', ledgerId: 'cust', side: 'Dr', amount: 5, date })
    b.ledgers = b.ledgers.filter((l) => l._id !== 'sales')
    expect(kinds(b)).toEqual(expect.arrayContaining(['lines', 'account']))
  })

  it('leaves a quotation alone, and finds a legacy bill by its BILL-n reference', () => {
    const b = books()
    b.bills = [
      { id: 'q', number: 2, kind: 'quotation', total: 50 },
      { id: 'b1', number: 1, kind: 'sale', customerName: 'Harsh', ledgerId: 'cust', total: 100 },
    ]
    expect(findProblems(b)).toEqual([])
  })
})

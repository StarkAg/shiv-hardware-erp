import { describe, expect, it } from 'vitest'
import { rowType } from '../src/features/ledger/lib/format'

/**
 * A sale paid on the spot is one voucher with two lines on the customer's
 * account. The money line is a receipt and reads as one (a payment, on a
 * purchase); every other line keeps the voucher's own name.
 */
describe('what a ledger line is called', () => {
  it('calls the money taken with a sale a receipt', () => {
    expect(rowType({ vchType: 'Sale', side: 'Dr', contra: ['Sales'] })).toBe('Sale')
    expect(rowType({ vchType: 'Sale', side: 'Cr', contra: ['Bank'] })).toBe('Receipt')
    expect(rowType({ vchType: 'Sale', side: 'Cr', contra: ['Cash'] })).toBe('Receipt')
  })

  it('calls the money paid with a purchase a payment', () => {
    expect(rowType({ vchType: 'Purchase', side: 'Cr', contra: ['Purchases'] })).toBe('Purchase')
    expect(rowType({ vchType: 'Purchase', side: 'Dr', contra: ['Cash'] })).toBe('Payment')
  })

  it('leaves the lines of other accounts and other vouchers alone', () => {
    // The Sales account's own line, and the bank's, on the same sale.
    expect(rowType({ vchType: 'Sale', side: 'Cr', contra: ['Rajesh Ram Ji'] })).toBe('Sale')
    expect(rowType({ vchType: 'Sale', side: 'Dr', contra: ['Rajesh Ram Ji'] })).toBe('Sale')
    expect(rowType({ vchType: 'Receipt', side: 'Cr', contra: ['Cash'] })).toBe('Receipt')
    expect(rowType({ vchType: 'Sale', side: 'Cr', contra: [] })).toBe('Sale')
    expect(rowType({ vchType: 'Sale', side: 'Cr' })).toBe('Sale')
  })
})

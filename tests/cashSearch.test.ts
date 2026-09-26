import { describe, expect, it } from 'vitest'
import { searchTransactions } from '../cash-web/src/search.js'

const entries = [
  { id: 'old', date: '2025-01-04', at: 1, name: 'Ramesh Kumar rent', amount: 5000, mode: 'cash', kind: 'out', dealer: true },
  { id: 'new', date: '2026-09-23', at: 3, name: 'Ramesh Kumar', amount: 1250, mode: 'online', kind: 'in' },
  { id: 'staff', date: '2026-09-23', at: 2, name: 'राम', amount: 500, mode: 'cash', kind: 'out', staffPaymentId: 'p1' },
  { id: 'deleted', date: '2026-09-23', at: 4, name: 'Removed', amount: 5000, mode: 'cash', kind: 'in', deleted: true },
]
const ids = (query: string, mode = 'all') => searchTransactions(entries, query, mode).map(e => e.id)

describe('cash transaction search across all dates', () => {
  it('finds old notes by case-insensitive words, amount and mode together', () => {
    expect(ids(' RAMESH  rent ₹5,000 cash ')).toEqual(['old'])
    expect(ids('ramesh', 'online')).toEqual(['new'])
    expect(ids('ramesh', 'cash')).toEqual(['old'])
  })
  it('finds dates in ISO, Indian numeric and written formats', () => {
    expect(ids('2025-01-04')).toEqual(['old'])
    expect(ids('04/01/2025')).toEqual(['old'])
    expect(ids('4 January 2025')).toEqual(['old'])
  })
  it('finds staff, dealer, payment and receipt transactions', () => {
    expect(ids('राम salary')).toEqual(['staff'])
    expect(ids('supplier paid')).toEqual(['old'])
    expect(ids('upi received')).toEqual(['new'])
  })
  it('sorts newest first, excludes deleted entries and handles empty results', () => {
    expect(ids('')).toEqual(['new', 'staff', 'old'])
    expect(ids('no such note')).toEqual([])
    expect(ids('Removed')).toEqual([])
  })
})

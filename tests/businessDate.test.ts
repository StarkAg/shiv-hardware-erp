import { describe, expect, test } from 'vitest'
import { indiaDate } from '../src/lib/businessDate'

describe("the shop's date", () => {
  test('02:00 in India is already the new day, though London is still on the old one', () => {
    expect(indiaDate(Date.parse('2026-10-08T02:00:00+05:30'))).toBe('2026-10-08')
  })

  test('midnight in India turns the day', () => {
    expect(indiaDate(Date.parse('2026-10-07T23:59:00+05:30'))).toBe('2026-10-07')
    expect(indiaDate(Date.parse('2026-10-08T00:00:00+05:30'))).toBe('2026-10-08')
  })

  test('1 April starts at midnight in India, not at 05:30', () => {
    expect(indiaDate(Date.parse('2026-04-01T00:30:00+05:30'))).toBe('2026-04-01')
  })
})

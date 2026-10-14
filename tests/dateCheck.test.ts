import { describe, expect, it } from 'vitest'
import { dateProblem } from '../src/lib/dateCheck'

// 14 Oct 2026, 11 pm in India — late, so "today" must still be the 14th there.
const now = Date.UTC(2026, 9, 14, 17, 30)

describe('a date for the books', () => {
  it('takes today and recent days', () => {
    expect(dateProblem('2026-10-14', now)).toEqual({})
    expect(dateProblem('2026-04-01', now)).toEqual({})
  })
  it('refuses tomorrow', () => {
    expect(dateProblem('2026-10-15', now).refuse).toMatch(/after today/)
  })
  it('asks about a date before this financial year', () => {
    expect(dateProblem('2026-03-31', now).ask).toMatch(/before this financial year/)
    expect(dateProblem('2016-05-14', now).ask).toMatch(/14 May 2016/)
  })
  it('counts the day in India: just after midnight there, the new day is today', () => {
    const justAfterMidnightIst = Date.UTC(2026, 9, 14, 18, 40) // 15 Oct, 00:10 in India
    expect(dateProblem('2026-10-15', justAfterMidnightIst)).toEqual({})
  })
})

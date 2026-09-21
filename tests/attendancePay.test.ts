/// <reference types="vite/client" />
/**
 * Tuesday pay: the two conditions, and what does and does not forfeit it.
 *
 * This is the only calculation in the shop that decides what a person is paid,
 * so the rule is pinned down here rather than left to be read off a screen.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain JS module shared with the attendance app
import { monthPay, ATTEND_THRESHOLD } from '../attendance-web/src/pay.js'

/** September 2026: 1st is a Tuesday, 30 days, five Tuesdays. */
const SEPT = 8
const days = (year = 2026, month = SEPT) => {
  const out: Date[] = []
  for (let d = 1; d <= new Date(year, month + 1, 0).getDate(); d += 1) out.push(new Date(year, month, d))
  return out
}

/**
 * A month where every day carries `fill`, then `overrides` applied by date.
 * Tuesdays default to closed, which is what the shop's own screen shows for an
 * unmarked Tuesday.
 */
const month = (fill: string, overrides: Record<number, string> = {}) =>
  days().map((date) => ({
    date,
    status: overrides[date.getDate()] ?? (date.getDay() === 2 ? 'C' : fill),
    future: false,
  }))

const rate = 500

describe('Tuesday pay', () => {
  it('pays every Tuesday in the month once both conditions are met', () => {
    const r = monthPay({ entries: month('P'), rate })
    expect(r.enough).toBe(true)
    expect(r.missed).toHaveLength(0)
    expect(r.unlocked).toBe(true)
    // Five Tuesdays in September 2026, paid whether the shop opened or not.
    expect(r.tuesdays).toBe(5)
    expect(r.tueBonus).toBe(5 * rate)
  })

  it('needs twenty days, counting a half day as half', () => {
    // 19 full days and two halves is exactly twenty.
    const entries = month('')
    let full = 0
    for (const e of entries) {
      if (e.date.getDay() === 2) continue
      if (full < 19) { e.status = 'P'; full += 1 }
      else if (full < 21) { e.status = 'H'; full += 1 }
    }
    const r = monthPay({ entries, rate })
    expect(r.attended).toBe(20)
    expect(r.enough).toBe(true)
  })

  it('refuses the bonus at nineteen and a half days', () => {
    const entries = month('')
    let counted = 0
    for (const e of entries) {
      if (e.date.getDay() === 2) continue
      if (counted < 19) { e.status = 'P'; counted += 1 }
      else if (counted === 19) { e.status = 'H'; counted += 1 }
    }
    const r = monthPay({ entries, rate })
    expect(r.attended).toBe(19.5)
    expect(r.enough).toBe(false)
    expect(r.unlocked).toBe(false)
    expect(r.tueBonus).toBe(0)
  })

  it('loses the whole month when a single Monday is missed', () => {
    // The 7th of September 2026 is a Monday.
    const seventh = days()[6]
    expect(seventh.getDay()).toBe(1)
    const r = monthPay({ entries: month('P', { 7: 'N' }), rate })
    expect(r.enough).toBe(true)          // still well past twenty days
    expect(r.missed.map((d: Date) => d.getDate())).toEqual([7])
    expect(r.unlocked).toBe(false)
    // Not one Tuesday docked — all five.
    expect(r.tueBonus).toBe(0)
  })

  it('loses it for a missed Wednesday too', () => {
    const ninth = days()[8]
    expect(ninth.getDay()).toBe(3)
    const r = monthPay({ entries: month('P', { 9: '' }), rate })
    expect(r.missed.map((d: Date) => d.getDate())).toEqual([9])
    expect(r.unlocked).toBe(false)
  })

  it('does not accept a half day on a Monday or Wednesday', () => {
    const r = monthPay({ entries: month('P', { 7: 'H' }), rate })
    // The half still counts towards the twenty …
    expect(r.attended).toBe(month('P').filter((e) => e.status === 'P').length - 0.5)
    // … but it does not satisfy the Monday.
    expect(r.missed.map((d: Date) => d.getDate())).toEqual([7])
    expect(r.unlocked).toBe(false)
  })

  it('does not hold a closed Monday against anybody', () => {
    const r = monthPay({ entries: month('P', { 7: 'C' }), rate })
    expect(r.missed).toHaveLength(0)
    expect(r.unlocked).toBe(true)
  })

  it('does not count a Monday that has not happened yet', () => {
    // Mid-month: everything from the 21st on is still to come and unmarked.
    const entries = month('P').map((e) => (e.date.getDate() >= 21
      ? { ...e, status: '', future: true }
      : e))
    const r = monthPay({ entries, rate })
    expect(r.missed).toHaveLength(0)
    // Attendance so far is short of twenty, so it is simply not unlocked yet —
    // not forfeited.
    expect(r.enough).toBe(r.attended >= ATTEND_THRESHOLD)
  })

  it('never pays a worked Tuesday twice', () => {
    const worked = monthPay({ entries: month('P', { 1: 'P' }), rate })
    const closed = monthPay({ entries: month('P'), rate })
    // Working the Tuesday adds to attendance but not to base pay.
    expect(worked.attended).toBe(closed.attended + 1)
    expect(worked.base).toBe(closed.base)
    expect(worked.tueBonus).toBe(closed.tueBonus)
  })

  it('takes advances off the total, after the bonus', () => {
    const r = monthPay({ entries: month('P'), rate, advances: 3000 })
    expect(r.net).toBe(r.base + r.tueBonus - 3000)
  })
})

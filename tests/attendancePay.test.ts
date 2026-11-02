/// <reference types="vite/client" />
/**
 * Tuesday pay and the bonus ladder: the steps, the Monday and Wednesday rule,
 * and what does and does not forfeit them.
 *
 * This is the only calculation in the shop that decides what a person is paid,
 * so the rule is pinned down here rather than left to be read off a screen.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain JS module shared with the attendance app
import { monthPay, ladderFor, ladderLine } from '../attendance-web/src/pay.js'

/** September 2026: 1st is a Tuesday, 30 days, five Tuesdays, 25 open days. */
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

/** Days off on Thursdays to Sundays only, so no Monday or Wednesday is touched. */
const OFF = [3, 4, 5, 6, 10, 11]
const off = (n: number) => Object.fromEntries(OFF.slice(0, n).map((d) => [d, 'N']))

const rate = 500

describe('the ladder', () => {
  it('rounds each step down to the half day, Tuesday pay never past 20', () => {
    expect(ladderFor(26)).toEqual({ tuesday: 20, bonus: [{ amount: 300, need: 21 }, { amount: 500, need: 22 }] })
    // 77% of 27 is 20.79: capped at the old twenty.
    expect(ladderFor(27)).toEqual({ tuesday: 20, bonus: [{ amount: 300, need: 21.5 }, { amount: 500, need: 22.5 }] })
    expect(ladderFor(25)).toEqual({ tuesday: 19, bonus: [{ amount: 300, need: 20 }, { amount: 500, need: 21 }] })
    expect(ladderFor(23)).toEqual({ tuesday: 17.5, bonus: [{ amount: 300, need: 18.5 }, { amount: 500, need: 19.5 }] })
  })

  it('counts open days without Tuesdays or closed days', () => {
    expect(monthPay({ entries: month('P'), rate }).open).toBe(25)
    expect(monthPay({ entries: month('P', { 3: 'C', 4: 'C' }), rate }).open).toBe(23)
  })

  it('pays every Tuesday and the top bonus for a full month', () => {
    const r = monthPay({ entries: month('P'), rate })
    expect(r.unlocked).toBe(true)
    expect(r.tuesdays).toBe(5)
    expect(r.tueBonus).toBe(5 * rate)
    expect(r.bonus).toBe(500)
  })

  it('gives ₹500 at 85%, ₹300 at 81%, Tuesday pay alone at 77%', () => {
    expect(monthPay({ entries: month('P', off(4)), rate }).bonus).toBe(500) // 21 of 25
    expect(monthPay({ entries: month('P', off(5)), rate }).bonus).toBe(300) // 20
    const r = monthPay({ entries: month('P', off(6)), rate })                // 19
    expect(r.attended).toBe(19)
    expect(r.unlocked).toBe(true)
    expect(r.tueBonus).toBe(5 * rate)
    expect(r.bonus).toBe(0)
  })

  it('refuses Tuesday pay half a day short', () => {
    const r = monthPay({ entries: month('P', { ...off(6), 12: 'H' }), rate })
    expect(r.attended).toBe(18.5)
    expect(r.enough).toBe(false)
    expect(r.tueBonus).toBe(0)
    expect(r.bonus).toBe(0)
  })

  it('asks fewer days when the shop shuts', () => {
    // Four days shut: 21 open days, 77% is 16.17, so 16.
    const r = monthPay({ entries: month('P', { 3: 'C', 4: 'C', 5: 'C', 6: 'C' }), rate })
    expect(r.open).toBe(21)
    expect(r.need).toBe(16)
  })
})

describe('every Monday and Wednesday', () => {
  it('loses the whole month, bonus too, when a single Monday is missed', () => {
    // The 7th of September 2026 is a Monday.
    expect(days()[6].getDay()).toBe(1)
    const r = monthPay({ entries: month('P', { 7: 'N' }), rate })
    expect(r.enough).toBe(true)          // still well past the days
    expect(r.missed.map((d: Date) => d.getDate())).toEqual([7])
    expect(r.unlocked).toBe(false)
    expect(r.tueBonus).toBe(0)
    expect(r.bonus).toBe(0)
  })

  it('loses it for a missed Wednesday too', () => {
    expect(days()[8].getDay()).toBe(3)
    const r = monthPay({ entries: month('P', { 9: '' }), rate })
    expect(r.missed.map((d: Date) => d.getDate())).toEqual([9])
    expect(r.unlocked).toBe(false)
  })

  it('does not accept a half day on a Monday or Wednesday', () => {
    const r = monthPay({ entries: month('P', { 7: 'H' }), rate })
    expect(r.attended).toBe(24.5)        // the half still counts towards the days
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
    const entries = month('P').map((e) => (e.date.getDate() >= 21 ? { ...e, status: '', future: true } : e))
    const r = monthPay({ entries, rate })
    expect(r.missed).toHaveLength(0)
    expect(r.open).toBe(25)              // days ahead are still open days
    expect(r.attended).toBe(17)
    expect(r.best).toBe(25)
    expect(r.enough).toBe(false)         // not there yet, not forfeited
    expect(ladderLine(r)).toBe('2 more days for Tuesday pay')
  })
})

describe('pay', () => {
  it('never pays a worked Tuesday twice', () => {
    const worked = monthPay({ entries: month('P', { 1: 'P' }), rate })
    const closed = monthPay({ entries: month('P'), rate })
    // Working the Tuesday adds to attendance but not to base pay.
    expect(worked.attended).toBe(closed.attended + 1)
    expect(worked.base).toBe(closed.base)
    expect(worked.tueBonus).toBe(closed.tueBonus)
  })

  it('takes advances off the total, after Tuesday pay and bonus', () => {
    const r = monthPay({ entries: month('P'), rate, advances: 3000 })
    expect(r.net).toBe(r.base + r.tueBonus + r.bonus - 3000)
  })

  it('says where somebody stands without a wage in it', () => {
    expect(ladderLine(monthPay({ entries: month('P', off(5)), rate }))).toBe('Tuesday pay ✓ · ₹300 ✓')
    expect(ladderLine(monthPay({ entries: month('P', { 7: 'N' }), rate }))).toBe('No Tuesday pay this month: Mon 7 not a full day')
  })
})

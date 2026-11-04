/**
 * Check a page: the sums on a page of the paper register, and the Cashier lines it
 * makes. The figures are the shop's own page of 4 Nov 2026.
 */
import { describe, expect, test } from 'vitest'
import { checkPage, cashierLines, cleanNote, fromReading } from '../cash-web/src/pageCheck.js'

type L = [number, string, ('online' | 'struck')?]
const line = ([amount, note, flag]: L) => ({
  amount, note, online: flag === 'online', mark: 'none', struck: flag === 'struck', unsure: false,
})
const LEFT: L[] = [
  [1440, 'Dharmendar'], [960, 'W/B Online', 'online'], [7470, '63'], [120, 'W/B'], [900, 'W/B Online', 'online'],
  [180, 'W/B Online', 'online'], [31000, '778 Online', 'online'], [830, '20'], [4500, '19'], [250, '19'], [500, '21'],
  [101, 'Online 779', 'online'], [11453, 'Online 779', 'online'], [1686, 'Online 23', 'online'], [50, 'W/B'], [350, '778'],
  [500, 'Advance (Vishnu Thakur)'], [2000, 'Advance (Sachin Kumar)'], [410, '65'], [180, 'Online 27', 'online'],
  [10000, 'Online 796 (Advance)', 'online'], [250, 'W/B'], [410, '28'], [22000, 'Online 785', 'online'], [300, '785'],
  [1000, 'Advance (Bill Pending)'],
]
const RIGHT: L[] = [
  [450, 'Sonu ji'], [960, 'W/B Online', 'online'], [710, 'Anil ji 2/11'], [710, 'Anil ji 3/11'], [530, 'Dharmendar 2/11'],
  [530, 'Dharmendar 3/11'], [2840, 'Anand ji Tuesday'], [1800, 'Anil ji Tuesday'], [1600, 'Anil ji'], [150, 'Rafiq'],
  [10, 'Vicky ji'], [900, 'W/B Online', 'online'], [10500, 'Tony'], [180, 'W/B Online', 'online'], [31000, 'Online 778', 'online'],
  [1000, '', 'struck'], [1500, 'Dharmendar Ji'], [95, 'Rajnigandha'], [101, 'Online 779', 'online'], [11453, 'Online 779', 'online'],
  [350, 'Suresh Tempo', 'struck'], [1686, 'Online 23', 'online'], [250, 'Chhotu Tempo'], [690, 'Cash Return (Refund) 26'], [500, 'Suresh Tempo'],
  [180, 'Online 27', 'online'], [10000, 'Online 796 (Advance)', 'online'], [100, 'Trekkar, 1 roll Sunmica'], [22000, 'Online 785', 'online'],
  [300, 'Suresh Tempo'], [5, 'Donation'],
]
const reading = (over: object = {}) => ({
  date: '2026-11-04',
  opening: 39604,
  in: LEFT.map(line),
  out: RIGHT.map(line),
  written: { inTotal: 138444, outTotal: 101730, balance: 36714, drawer: 36634, difference: 80, differenceWords: 'less in drawer' },
  ...over,
})
const page = (over?: object) => fromReading(reading(over))
const find = (p: any, side: 'in' | 'out', amount: number) => p[side].find((l: any) => l.amount === amount)

describe('the sums on the page', () => {
  test("the shop's page agrees all the way down", () => {
    const check = checkPage(page())
    expect(check.agrees).toBe(true)
    expect(check.problems).toEqual([])
    expect(check).toMatchObject({ inTotal: 138444, outTotal: 101730, balance: 36714, short: 80 })
    expect(check.rows.every((r: any) => r.ok)).toBe(true)
  })

  test('cash and online are told apart, and online pairs off', () => {
    expect(checkPage(page())).toMatchObject({ onlineIn: 78460, pairs: 10, cashIn: 20380, cashOut: 23270, expected: 36714 })
  })

  test('a figure read wrong shows as a total that disagrees', () => {
    const p = page()
    find(p, 'in', 7470).amount = 1470
    const check = checkPage(p)
    expect(check.agrees).toBe(false)
    expect(check.rows.find((r: any) => r.key === 'in')).toMatchObject({ ok: false, off: -6000, worked: 132444 })
  })

  test('a line wrongly marked crossed out is named, with the way to fix it', () => {
    const p = page()
    find(p, 'in', 300).struck = true
    const row = checkPage(p).rows.find((r: any) => r.key === 'in')
    expect(row.off).toBe(-300)
    expect(row.hints[0]).toMatchObject({ key: 'Count it', struck: false, line: find(p, 'in', 300).id })
  })

  test('a counted line that should be crossed out is named too', () => {
    const p = page()
    find(p, 'out', 350).struck = false
    expect(checkPage(p).rows.find((r: any) => r.key === 'out').hints[0]).toMatchObject({ key: 'Cross it out', struck: true })
  })

  test('swapped digits are suggested when the gap divides by 9', () => {
    const p = page()
    find(p, 'in', 7470).amount = 7740
    const hints = checkPage(p).rows.find((r: any) => r.key === 'in').hints
    expect(hints.some((h: any) => /swapped/.test(h.text))).toBe(true)
  })

  test('a total the page does not show is not called right or wrong, and says so', () => {
    const check = checkPage(page({ written: { inTotal: null, outTotal: 101730, balance: null, drawer: null, difference: null, differenceWords: '' } }))
    expect(check.rows.find((r: any) => r.key === 'in').ok).toBeNull()
    expect(check.agrees).toBe(false)
    expect(check.problems.join()).toMatch(/left side total/)
  })

  test('a figure that could not be read stops it agreeing', () => {
    const p = page()
    find(p, 'in', 7470).amount = null
    const check = checkPage(p)
    expect(check.unread).toBe(1)
    expect(check.agrees).toBe(false)
  })

  test('words that contradict the sum are reported', () => {
    const w = { inTotal: 138444, outTotal: 101730, balance: 36714, drawer: 36634, difference: 80, differenceWords: 'more in drawer' }
    expect(checkPage(page({ written: w })).problems.join()).toMatch(/makes the drawer short/)
  })

  test('online on the left with no repeat on the right is reported', () => {
    const p = page()
    p.out = p.out.filter((l: any) => l.amount !== 22000)
    expect(checkPage(p).problems.join()).toMatch(/not repeated on the right: 22000/)
  })
})

describe('the lines it makes for the Cashier', () => {
  const lines = cashierLines(page(), '2026-11-04', 1000)
  const sum = (kind: string, mode: string) => lines.filter((l: any) => l.kind === kind && l.mode === mode).reduce((t: number, l: any) => t + l.amount, 0)

  test("online's right-side copy is never added, so it does not count as paid out", () => {
    expect(sum('out', 'online')).toBe(0)
    expect(sum('in', 'online')).toBe(78460)
  })

  test('the drawer comes to what the page says', () => {
    expect(39604 + sum('in', 'cash') - sum('out', 'cash')).toBe(36714)
  })

  test('crossed-out lines stay out, and the rest are all there', () => {
    expect(lines.some((l: any) => l.amount === 350 && l.kind === 'out')).toBe(false)
    expect(lines.filter((l: any) => l.kind === 'in')).toHaveLength(26)
    expect(lines.filter((l: any) => l.kind === 'out')).toHaveLength(19)
  })

  test('online paid out with no receipt goes in as paid from the bank', () => {
    const p = page()
    p.in = p.in.filter((l: any) => l.amount !== 22000)
    const out = cashierLines(p, '2026-11-04', 1000).filter((l: any) => l.kind === 'out' && l.mode === 'online')
    expect(out.map((l: any) => l.amount)).toEqual([22000])
  })

  test('the same page makes the same ids, so adding it twice counts once', () => {
    const a = cashierLines(page(), '2026-11-04', 1000).map((l: any) => l.id)
    const b = cashierLines(page(), '2026-11-04', 99999).map((l: any) => l.id)
    expect(b).toEqual(a)
    expect(new Set(a).size).toBe(a.length)
  })

  test('a repeated line stays two lines, and another date makes other ids', () => {
    expect(lines.filter((l: any) => l.amount === 410)).toHaveLength(2)
    const other = cashierLines(page(), '2026-11-05', 1000).map((l: any) => l.id)
    expect(other.some((id: string) => lines.some((l: any) => l.id === id))).toBe(false)
  })

  test('names read the way the Cashier writes them', () => {
    expect(cleanNote('Online 779')).toBe('779')
    expect(cleanNote('778 Online')).toBe('778')
    expect(cleanNote('W/B Online')).toBe('W/B')
    expect(cleanNote('Online 796 (Advance)')).toBe('796 (Advance)')
    expect(lines.find((l: any) => l.amount === 31000)).toMatchObject({ name: '778', mode: 'online' })
    expect(lines.find((l: any) => l.amount === 500 && l.kind === 'in' && l.name.startsWith('Advance'))).toBeTruthy()
  })
})

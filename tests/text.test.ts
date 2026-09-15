import { describe, expect, test } from 'vitest'
import { canonicalUnit, foldName, properItem, properText, properTyping } from '../convex/lib/text'

describe('names are proper case', () => {
  test.each([
    ['M/s Bunty Sharma jee, Ramgarh', 'M/s Bunty Sharma Jee, Ramgarh'],
    ['M/S Vishal Prasad Ji, Chainpur', 'M/s Vishal Prasad Ji, Chainpur'],
    ['m/s. pappu jee, naisarai', 'M/s Pappu Jee, Naisarai'],
    ['Agarwal Enterprises ,Ranchi', 'Agarwal Enterprises, Ranchi'],
    ['Koda agarwal', 'Koda Agarwal'],
    ['Rajesh Kumar ji, hartad kander', 'Rajesh Kumar Ji, Hartad Kander'],
    ['  harsh   agarwal  ', 'Harsh Agarwal'],
    ['Ms Priya', 'Ms Priya'],
    ['dr gupta', 'Dr Gupta'],
  ])('%s → %s', (input, expected) => {
    expect(properText(input)).toBe(expected)
  })

  test('capitals written on purpose stay', () => {
    expect(properText('M/s SRT, Ratu, Ranchi')).toBe('M/s SRT, Ratu, Ranchi')
    expect(properText('M/s Lalan Singh jee, Ghato AIC')).toBe('M/s Lalan Singh Jee, Ghato AIC')
    expect(properText('M/s Rajeshwar Mahto Ji, MMT Ground')).toBe('M/s Rajeshwar Mahto Ji, MMT Ground')
    expect(properText('W/B')).toBe('W/B')
  })

  test('caps lock is set properly', () => {
    expect(properText("G PROFILE HANDLE BLACK 10'")).toBe("G Profile Handle Black 10'")
    expect(properText('SIMRAN PLY')).toBe('Simran Ply')
  })
})

describe('codes are capitals', () => {
  test.each([
    ['9441-shg', '9441-SHG'],
    ['4284 ngn', '4284 NGN'],
    ['240 hdg', '240 HDG'],
    ['111 Hdg', '111 HDG'],
    ['Mica 3419 su  centyry', 'Mica 3419 SU Centyry'],
    ['0.8 lw 8340', '0.8 LW 8340'],
    ['HR Lam 8207-st', 'HR Lam 8207-ST'],
    ['cgst 9%', 'CGST 9%'],
    ['Sgst 9%', 'SGST 9%'],
    ['c gst 9%', 'C GST 9%'],
    ["1'' pipe ss 12'", "1'' Pipe SS 12'"],
    ['mp lock godrej', 'MP Lock Godrej'],
    ['6mm Plywood Milton Super/hs', '6mm Plywood Milton Super/HS'],
    ['wpc door', 'WPC Door'],
  ])('%s → %s', (input, expected) => {
    expect(properText(input)).toBe(expected)
  })

  test('a word beside a model number is not always a code', () => {
    expect(properText('HR Lam 8207')).toBe('HR Lam 8207')
    expect(properText('Door 1200 Big')).toBe('Door 1200 Big')
  })
})

describe('what is left alone', () => {
  test.each([
    ['19mm B.Board S 8 X 4'],
    ['20No 3/4" HL Nail'],
    ["10''Talascopic Indian"],
    ['3D 133'],
    ['Fevicol HeatX'],
    ['Readymade Door DDoor Sunmica PM 72×44'],
    ['Flush Door Signature Gold 78×36 3Pc'],
    ["Louver's Panel"],
    ["O'Brien"],
  ])('%s', (input) => {
    expect(properText(input)).toBe(input)
  })

  test('units inside a name are words, not codes', () => {
    expect(properText('fevicol marine 5 kg')).toBe('Fevicol Marine 5 Kg')
    expect(properText('19 mm ply')).toBe('19 mm Ply')
    expect(properText('17 no 1" hl nail 2 pkt')).toBe('17 No 1" HL Nail 2 Pkt')
  })
})

describe('items', () => {
  test('board sizes are spaced', () => {
    expect(properItem('19mm solid black tiger 8x4')).toBe('19mm Solid Black Tiger 8 X 4')
    expect(properItem('Flush Door 78×36')).toBe('Flush Door 78 X 36')
    expect(properItem('Mica ')).toBe('Mica')
  })
})

describe('while typing', () => {
  test('only first letters rise, so the length never changes', () => {
    for (const s of ['bunty sharma jee', 'km ', "louver's", '240 hdg', 'a']) {
      expect(properTyping(s)).toHaveLength(s.length)
    }
    expect(properTyping('bunty sharma jee')).toBe('Bunty Sharma Jee')
    expect(properTyping('240 hdg')).toBe('240 Hdg')
    expect(properTyping("louver's")).toBe("Louver's")
    expect(properTyping('19mm ply')).toBe('19mm Ply')
  })
})

describe('units', () => {
  test.each([
    ['kg', 'Kg'], ['KG', 'Kg'], ['Kg', 'Kg'],
    ['set', 'Set'], ['sit', 'Sheet'], ['Sheet', 'Sheet'],
    ['Bl', 'B/L'], ['B/L', 'B/L'],
    ['cartun', 'C/s'], ['C/s', 'C/s'],
    ['g', 'Gm'], ['feet', 'Feet'], ['Pkt', 'Pkt'], ['PCS', 'Pc'], ['Pc', 'Pc'],
    ['bori', 'Bori'], ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(canonicalUnit(input)).toBe(expected)
  })
})

describe('the same name two ways', () => {
  test('case, spacing and M/s fold together', () => {
    expect(foldName('M/S Wb')).toBe(foldName('Wb'))
    expect(foldName('M/s  Vishal Prasad Ji')).toBe(foldName('vishal prasad ji'))
    expect(foldName('Harsh')).toBe(foldName('harsh'))
  })
})

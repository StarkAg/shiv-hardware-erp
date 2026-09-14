import { describe, expect, test } from 'vitest'
import { readBoardSize, sizeLabel, sqftFields } from '../src/lib/boardSize'

describe('reading a sheet size out of a bill line', () => {
  test('boards are in feet', () => {
    expect(readBoardSize('19mm Solid Black Tiger 8 X 4')).toMatchObject({ thicknessMm: 19, unit: 'ft', sqft: 32 })
    expect(readBoardSize('12mm SG 7x4')).toMatchObject({ unit: 'ft', sqft: 28 })
    expect(readBoardSize('6mm S 8 X 4 Pcs')).toMatchObject({ sqft: 32 })
    expect(readBoardSize('12mm Sg 6 X 3')).toMatchObject({ sqft: 18 })
  })

  test('doors are in inches', () => {
    expect(readBoardSize('30mm S 81 X 38')).toMatchObject({ thicknessMm: 30, unit: 'in', sqft: 21.38 })
    expect(readBoardSize('30mm F.Door Pf S 81 X 30')).toMatchObject({ unit: 'in', sqft: 16.88 })
    expect(readBoardSize("Block Board 12mm Signature 84'×48'")).toMatchObject({ unit: 'in', sqft: 28 })
  })

  test('eighths of an inch', () => {
    const size = readBoardSize('30mm DDsm 77 4/8 x 37 5/8')
    expect(size).toMatchObject({ height: 77.5, width: 37.625, unit: 'in' })
    expect(size?.sqft).toBe(20.25)
  })

  test('the thickness is never read as part of the size', () => {
    expect(readBoardSize('19mm x 8 x 4')).toMatchObject({ thicknessMm: 19, height: 8, width: 4 })
  })

  test('not a sheet', () => {
    expect(readBoardSize('0.8mm LW 8340 8x4')).toBeNull() // laminate
    expect(readBoardSize('35 X 10 Liping Teak')).toBeNull() // no thickness
    expect(readBoardSize('12mm T Bit R/G 8\'')).toBeNull() // no size
    expect(readBoardSize('19x6 SS Screw (+)')).toBeNull()
    expect(readBoardSize('')).toBeNull()
  })

  test('size label', () => {
    expect(sizeLabel(readBoardSize('19mm 8 X 4')!)).toBe('8×4 ft')
    expect(sizeLabel(readBoardSize('30mm S 81 X 38')!)).toBe('81×38 in')
  })

  test('rate per square foot comes from the amount', () => {
    expect(sqftFields({ description: '19mm Solid Black Tiger 8 X 4', qty: 5, amount: 17600 })).toEqual({ sqft: 32, sqftRate: 110 })
    expect(sqftFields({ description: '30mm S 81 X 38', qty: 6, amount: 20520 })).toEqual({ sqft: 21.38, sqftRate: 160 })
    expect(sqftFields({ description: '19mm Solid 8 X 4', qty: 2, amount: 0 })).toEqual({ sqft: 32, sqftRate: undefined })
    expect(sqftFields({ description: 'Fevicol Marine', qty: 1, amount: 290 })).toEqual({ sqft: undefined, sqftRate: undefined })
  })
})

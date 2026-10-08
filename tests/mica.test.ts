import { describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module from the Mica Match site
import { deltaE2000, distance, labToHex, linearToLab, nearest } from '../mica-web/src/color.js'

describe('Mica Match colour maths', () => {
  test('ΔE2000 agrees with the published test pairs', () => {
    // Sharma, Wu & Dalal (2005), pairs 1 and 17.
    expect(deltaE2000({ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 })).toBeCloseTo(2.0425, 3)
    expect(deltaE2000({ L: 50, a: 2.5, b: 0 }, { L: 73, a: 25, b: -18 })).toBeCloseTo(27.1492, 3)
  })

  test('white reads as white, and back', () => {
    const w = linearToLab(1, 1, 1)
    expect(w.L).toBeCloseTo(100, 1)
    expect(Math.abs(w.a) + Math.abs(w.b)).toBeLessThan(0.5)
    expect(labToHex(w)).toBe('#ffffff')
  })

  test('a chip is its own best match, and a grain beats a plain sheet of the same browns', () => {
    const teal = { shades: [{ L: 55, a: -22, b: -4, w: 1 }], texture: 1 }
    const grain = { shades: [{ L: 60, a: 8, b: 25, w: 0.6 }, { L: 40, a: 10, b: 22, w: 0.4 }], texture: 6 }
    const plain = { shades: [{ L: 52, a: 9, b: 24, w: 1 }], texture: 1 }
    expect(distance(teal, teal)).toBe(0)
    const customer = { shades: [{ L: 59, a: 8, b: 24, w: 0.55 }, { L: 41, a: 10, b: 21, w: 0.45 }], texture: 5.5 }
    const ranked = nearest(customer, [plain, teal, grain])
    expect(ranked[0].chip).toBe(grain)
    expect(ranked[2].chip).toBe(teal)
  })
})

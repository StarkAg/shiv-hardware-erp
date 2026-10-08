import { describe, expect, test } from 'vitest'
// @ts-expect-error plain JS module from the Mica Match site
import { deltaE2000, distance, labToHex, linearToLab, nearest, readSquare } from '../mica-web/src/color.js'

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

/** A fake photo: white paper with a square chip of two flat colours, the lighter one a third of it. */
function photo(dark: number[], light: number[]) {
  const W = 300, H = 300
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const chip = x >= 100 && x < 200 && y >= 100 && y < 200
    const c = !chip ? [240, 240, 240] : y < 133 ? light : dark
    data.set([...c, 255], (y * W + x) * 4)
  }
  const ctx = (d?: Uint8ClampedArray) => ({ getImageData: () => ({ data: d ?? new Uint8ClampedArray(192 * 192 * 4) }), drawImage() {}, putImageData() {} })
  ;(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx() }) }
  return { width: W, height: H, getContext: () => ctx(data) }
}

describe('reading a square', () => {
  test('keeps a lighter shade that is really there, not taking it for shine', () => {
    const r = readSquare(photo([20, 100, 0], [95, 255, 10]), { x: 105, y: 105, size: 90 })
    expect(r.corrected).toBe(true)
    expect(r.shades).toHaveLength(2)
    expect(r.shades[0].w).toBeGreaterThan(r.shades[1].w)
    expect(r.shades[1].w).toBeGreaterThan(0.2)
  })
})

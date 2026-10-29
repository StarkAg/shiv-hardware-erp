import { describe, expect, it } from 'vitest'
import { calcAllThicknessesCosted, costOut, defaultCosting, normaliseCosting, sizeOf } from '../src/lib/aluCosting'
import { defaultAddons } from '../src/lib/aluminium'

const dim = (inches: number) => ({ inches, soot: 0 })

describe('aluminium priced from its materials', () => {
  it('works the door out the way the Rate Tester does', () => {
    const c = defaultCosting()
    const [t12] = costOut('door', sizeOf(dim(78), dim(30)), c)
    // Sections: 13 ft x 1.1 + 5 ft x 1.2 + 2.5 ft x 3, each over a 16 ft piece.
    expect(t12.door!.door.kg).toBeCloseTo(1.7375, 4)
    // 1.7375 kg x 470 + ACP 455 + U rubber 23 ft x 4 + labour 488.
    expect(t12.door!.door.cost).toBeCloseTo(1851.625, 3)
    // 20% on top, rate rounded up to a whole rupee per sqft.
    expect(t12.door!.door.rate).toBe(137)
    expect(t12.door!.door.sell).toBe(Math.round(137 * 16.25))
    expect(t12.door!.acc.cost).toBe(190)
  })

  it('takes a margin in rupees per sqft', () => {
    const c = defaultCosting()
    c.win2.margin = { mode: 'rs', value: 50 }
    const s = sizeOf(dim(48), dim(48))
    const [t12] = costOut('win2', s, c)
    const cost = t12.window!.clear.cost
    expect(t12.window!.clear.rate).toBe(Math.ceil((cost + 50 * 16) / 16))
    expect(t12.window!.reflective.cost).toBeCloseTo(cost + 20 * 16, 6)
  })

  it('moves with the aluminium rate and a section weight', () => {
    const c = defaultCosting()
    const s = sizeOf(dim(48), dim(48))
    const before = costOut('win2', s, c)[0].window!.clear.cost
    c.alu[0] = 520
    c.win2.sections[0].kg[0] = 3
    const after = costOut('win2', s, c)[0].window!.clear.cost
    // 5.755 kg now at Rs 50 more, and 2 TTS (12 ft of a 16 ft piece) 0.22 kg heavier at 520.
    expect(after - before).toBeCloseTo(5.755 * 50 + ((12 * (3 - 2.78)) / 16) * 520, 1)
  })

  it('fills the quotation rows, add-ons only when chosen', () => {
    const c = defaultCosting()
    const addons = { ...defaultAddons(), decorFilm: false }
    const rows = calcAllThicknessesCosted('aluminium-door', dim(78), dim(30), addons, c)
    expect(rows).toHaveLength(3)
    expect(rows[0].total).toBe(rows[0].doorCost + rows[0].chaukhatCost + rows[0].accessories)
    expect(rows[0].decorFilm).toBe(0)
    expect(rows[0].brownCoated).toBe(Math.round(16.25 * 40))
  })

  it('reads a damaged copy back with starting values', () => {
    const c = normaliseCosting({ alu: [500, 'x', 500], door: { margin: { door: { mode: 'rs', value: 25 } } } })
    expect(c.alu).toEqual([500, 470, 500])
    expect(c.door.margin.door).toEqual({ mode: 'rs', value: 25 })
    expect(c.door.sections.length).toBe(4)
  })
})

describe('the Aluminium rates screen reaches the printed quotation', () => {
  const quoteFor = (category: 'aluminium-door' | 'window-2-track', c: ReturnType<typeof defaultCosting>, addons = defaultAddons()) => {
    const height = dim(category === 'aluminium-door' ? 78 : 48)
    const width = dim(category === 'aluminium-door' ? 30 : 48)
    const labels = category === 'aluminium-door' ? ['Chaukhat', 'Accessories', 'Brown Coated'] : ['SS Net', 'Brown Coated']
    return {
      id: 'q', number: 'Q-1', date: '2026-10-29', customer: { id: 'c', name: '', mobile: '' },
      category, height, width, qty: 1, sqft: 0,
      alu: { addons: labels, glassType: 'clear', thicknesses: calcAllThicknessesCosted(category, height, width, addons, c) },
    }
  }

  it('moves the door price with the aluminium rate, a section, a material and the margin', async () => {
    const { buildQuotationHtml } = await import('../print-server/template.mjs')
    const base = defaultCosting()
    const before = quoteFor('aluminium-door', base).alu.thicknesses[0]

    const c = defaultCosting()
    c.alu[0] = 600
    c.door.sections[0].kg[0] = 1.5
    c.door.parts[0].rate = 40
    c.door.margin.door = { mode: 'rs', value: 25 }
    const q = quoteFor('aluminium-door', c)
    const after = q.alu.thicknesses[0]

    const kg = (13 * 1.5 + 5 * 1.2 + 2.5 * 3) / 16
    const cost = kg * 600 + Math.ceil(16.25 * 40) + 23 * 4 + Math.ceil(16.25 * 30)
    expect(after.doorRate).toBe(Math.ceil((cost + 25 * 16.25) / 16.25))
    expect(after.doorRate).not.toBe(before.doorRate)

    const html = await buildQuotationHtml(q)
    expect(html).toContain(`@${after.doorRate}`)
    expect(html).toContain(`>${after.doorCost}<`)
    expect(html).toContain(`>${after.total}<`)
  })

  it('prints the window glass and add-on rates as set', async () => {
    const { buildQuotationHtml } = await import('../print-server/template.mjs')
    const c = defaultCosting()
    c.win2.addons.ssNet = 65
    c.win2.addons.brownCoated = 45
    c.win2.reflectiveExtra = 35
    const q = quoteFor('window-2-track', c)
    const t = q.alu.thicknesses[0]
    const html = await buildQuotationHtml(q)
    expect(html).toContain(`@${t.glassRate}`)
    expect(html).toContain(`@${t.reflectiveRate}`)
    expect(html).toContain('@65')
    expect(html).toContain('@45')
    expect(html).not.toContain('@50<')
    expect(t.accessories).toBe(Math.round(16 * 65))
  })
})

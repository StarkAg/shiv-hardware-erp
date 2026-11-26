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
    expect(t12.door!.acc.cost).toBe(190)
  })

  it('starts on the selling sheet: the 78 x 30 door at 150 / 200 / 190 and chaukhat at 90 / 100 / 100', () => {
    const rows = costOut('door', sizeOf(dim(78), dim(30)), defaultCosting())
    expect(rows.map((r) => r.door!.door.rate)).toEqual([150, 200, 190])
    expect(rows.map((r) => r.door!.chk.rate)).toEqual([90, 100, 100])
    expect(rows.map((r) => r.door!.acc.sell)).toEqual([160, 160, 160])
    expect(rows[0].door!.door.sell).toBe(Math.round(150 * 16.25))
  })

  it('starts windows within the sheet\'s rates-by-area at its middle sizes', () => {
    const c = defaultCosting()
    const rate = (p: 'win2' | 'win3', h: number, w: number) => costOut(p, sizeOf(dim(h), dim(w)), c).map((r) => r.window!.clear.rate)
    // 12.25 sqft: the sheet's 270 (2 track) and 360 (3 track), +60 for 1.6 MM, +50 for Hindalco.
    expect(rate('win2', 42, 42)).toEqual([270, 330, 320])
    expect(rate('win3', 42, 42)).toEqual([360, 420, 410])
  })

  it('has no minimum bill size: a door is billed at its own area and chaukhat feet', () => {
    const c = defaultCosting()
    const s = sizeOf(dim(78), dim(20))   // 10.83 sqft, 14.67 rft
    const [t] = costOut('door', s, c)
    expect(t.door!.door.sell).toBe(Math.round(t.door!.door.rate * s.area))
    expect(t.door!.chk.sell).toBe(Math.round(t.door!.chk.rate * s.rft))
  })

  it('takes a margin in rupees per sqft', () => {
    const c = defaultCosting()
    c.win2.margin = { mode: 'rs', value: [50, 50, 50] }
    const s = sizeOf(dim(48), dim(48))
    const [t12] = costOut('win2', s, c)
    const cost = t12.window!.clear.cost
    expect(t12.window!.clear.rate).toBe(Math.ceil((cost + 50 * 16) / 16))
    expect(t12.window!.reflective.cost).toBeCloseTo(cost + 20 * 16, 6)
  })

  it('moves with the aluminium rate and a section weight', () => {
    const c = defaultCosting()
    const s = sizeOf(dim(48), dim(48))
    const [before] = costOut('win2', s, c)
    c.alu[0] = 520
    c.win2.sections[0].kg[0] = 3     // 2 TTS runs 2 heights + 1 width = 12 ft of a 16 ft piece
    const [after] = costOut('win2', s, c)
    const kgBefore = before.window!.clear.kg
    expect(after.window!.clear.kg - kgBefore).toBeCloseTo((12 * (3 - 2.2)) / 16, 6)
    expect(after.window!.clear.cost - before.window!.clear.cost)
      .toBeCloseTo(after.window!.clear.kg * 520 - kgBefore * 470, 6)
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
    // A margin saved as one number, before margins were per thickness.
    const c = normaliseCosting({ alu: [500, 'x', 500], door: { margin: { door: { mode: 'rs', value: 25 } } } })
    expect(c.alu).toEqual([500, 470, 500])
    expect(c.door.margin.door).toEqual({ mode: 'rs', value: [25, 25, 25] })
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
    c.door.margin.door = { mode: 'rs', value: [25, 25, 25] }
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

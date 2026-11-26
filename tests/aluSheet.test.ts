import { describe, expect, it } from 'vitest'
import { calcAllThicknessesSheet, defaultSheet, normaliseSheet, slabRate } from '../src/lib/aluSheet'
import { calcAllThicknessesCosted, calcAluminiumQuote, defaultCosting, normaliseCosting } from '../src/lib/aluCosting'
import { defaultAddons } from '../src/lib/aluminium'

const dim = (inches: number, soot = 0) => ({ inches, soot })
const pick = <T, K extends keyof T>(rows: T[], k: K) => rows.map((r) => r[k])

describe('aluminium priced by the selling sheet', () => {
  it('quotes the 39 x 48 3-track window as the sheet does', () => {
    const rows = calcAllThicknessesSheet('window-3-track', dim(39), dim(48), defaultAddons(), defaultSheet())
    // 13 sqft: slab 12 -> 360; 1.6 mm +60, Hindalco +50; reflective +20 each.
    expect(pick(rows, 'glassRate')).toEqual([360, 420, 410])
    expect(pick(rows, 'glassCost')).toEqual([4680, 5460, 5330])
    expect(pick(rows, 'reflectiveRate')).toEqual([380, 440, 430])
    expect(pick(rows, 'reflectiveCost')).toEqual([4940, 5720, 5590])
    expect(pick(rows, 'brownCoated')).toEqual([520, 520, 520])
    expect(pick(rows, 'accessories')).toEqual([0, 0, 0])
  })

  it('quotes the 36 x 30 2-track window as the sheet does, with SS net', () => {
    const rows = calcAllThicknessesSheet('window-2-track', dim(36), dim(30), defaultAddons(), defaultSheet())
    // 7.5 sqft: slab 7.5 -> 310.
    expect(pick(rows, 'glassCost')).toEqual([2325, 2775, 2700])
    expect(pick(rows, 'reflectiveCost')).toEqual([2475, 2925, 2850])
    expect(pick(rows, 'accessories')).toEqual([375, 375, 375])
    expect(pick(rows, 'brownCoated')).toEqual([300, 300, 300])
  })

  it('quotes the 72 x 30 door as the sheet does', () => {
    const rows = calcAllThicknessesSheet('aluminium-door', dim(72), dim(30), defaultAddons(), defaultSheet())
    expect(pick(rows, 'doorCost')).toEqual([2250, 3000, 2850])
    expect(pick(rows, 'chaukhatCost')).toEqual([1305, 1450, 1450])
    expect(pick(rows, 'total')).toEqual([3715, 4610, 4460])
    expect(pick(rows, 'decorFilm')).toEqual([450, 450, 450])
    expect(pick(rows, 'brownCoated')).toEqual([600, 600, 600])
  })

  it('takes the biggest slab not over the area, and the first slab under it', () => {
    const slabs = defaultSheet().win3.slabs
    expect(slabRate(11.99, slabs)).toBe(390)
    expect(slabRate(12, slabs)).toBe(360)
    expect(slabRate(30, slabs)).toBe(290)
    expect(slabRate(4, slabs)).toBe(470)
  })

  it('rounds a size with soot up to the next inch', () => {
    const [t] = calcAllThicknessesSheet('window-3-track', dim(38, 4), dim(47, 1), defaultAddons(), defaultSheet())
    expect(t.glassCost).toBe(4680)
  })

  it('has no minimum bill size of its own', () => {
    const [t] = calcAllThicknessesSheet('aluminium-door', dim(78), dim(20), defaultAddons(), defaultSheet())
    expect(t.area).toBe(10.83)
    expect(t.doorCost).toBe(Math.round(150 * 10.83))
    expect(t.chaukhatCost).toBe(Math.round(90 * 14.67))
  })

  it('follows an edited rate', () => {
    const sheet = defaultSheet()
    sheet.win3.slabs.find((s) => s.area === 12)!.rate = 370
    sheet.win3.extra[1] = 70
    const rows = calcAllThicknessesSheet('window-3-track', dim(39), dim(48), defaultAddons(), sheet)
    expect(pick(rows, 'glassRate')).toEqual([370, 440, 420])
  })
})

describe('a door under 72 inches high is priced as 72 high', () => {
  const same = (h: number, soot = 0) => ['aluminium-door', dim(h, soot), dim(30), defaultAddons()] as const

  it.each(['sheet', 'costing'] as const)('by %s, at its real width, with no other minimum', (mode) => {
    const c = defaultCosting()
    c.priceBy.door = mode
    expect(calcAluminiumQuote(...same(60), c)).toEqual(calcAluminiumQuote(...same(72), c))
    expect(calcAluminiumQuote(...same(71, 4), c)).toEqual(calcAluminiumQuote(...same(72), c))
    // Taller doors are their own size.
    expect(calcAluminiumQuote(...same(78), c)).not.toEqual(calcAluminiumQuote(...same(72), c))
  })

  it('by the sheet: a 60 x 30 door is the 72 x 30 one, 15 sqft and 14.5 rft', () => {
    const c = defaultCosting()
    c.priceBy.door = 'sheet'
    const rows = calcAluminiumQuote(...same(60), c)
    expect(pick(rows, 'doorCost')).toEqual([2250, 3000, 2850])
    expect(pick(rows, 'chaukhatCost')).toEqual([1305, 1450, 1450])
    expect(rows[0].area).toBe(15)
    expect(rows[0].chaukhatRft).toBe(14.5)
  })

  it('leaves windows alone, and can be turned off', () => {
    const c = defaultCosting()
    c.priceBy.win3 = 'sheet'
    expect(calcAluminiumQuote('window-3-track', dim(39), dim(48), defaultAddons(), c)[0].glassCost).toBe(4680)
    c.priceBy.door = 'sheet'
    c.doorMinHeight = 0
    expect(calcAluminiumQuote(...same(60), c)[0].area).toBe(12.5)
  })

  it('keeps the setting through a save, and gives an older copy 72', () => {
    const c = defaultCosting()
    c.doorMinHeight = 75
    expect(normaliseCosting(JSON.parse(JSON.stringify(c))).doorMinHeight).toBe(75)
    const older = JSON.parse(JSON.stringify(c))
    delete older.doorMinHeight
    expect(normaliseCosting(older).doorMinHeight).toBe(72)
  })
})

describe('choosing costing or sheet per product', () => {
  it('starts every product on costing, so quotes are unchanged', () => {
    const c = defaultCosting()
    expect(c.priceBy).toEqual({ door: 'costing', win2: 'costing', win3: 'costing' })
    const args = ['window-3-track', dim(39), dim(48), defaultAddons()] as const
    expect(calcAluminiumQuote(...args, c)).toEqual(calcAllThicknessesCosted(...args, c))
  })

  it('prices only the product set to the sheet by the sheet', () => {
    const c = defaultCosting()
    c.priceBy.win3 = 'sheet'
    expect(calcAluminiumQuote('window-3-track', dim(39), dim(48), defaultAddons(), c)[0].glassCost).toBe(4680)
    const win2 = ['window-2-track', dim(39), dim(48), defaultAddons()] as const
    expect(calcAluminiumQuote(...win2, c)).toEqual(calcAllThicknessesCosted(...win2, c))
  })

  it('keeps the choice and the sheet rates through a save, and fills them into an older copy', () => {
    const c = defaultCosting()
    c.priceBy.door = 'sheet'
    c.sheet.door.door = [160, 210, 200]
    const back = normaliseCosting(JSON.parse(JSON.stringify(c)))
    expect(back.priceBy.door).toBe('sheet')
    expect(back.sheet.door.door).toEqual([160, 210, 200])

    const older = JSON.parse(JSON.stringify(c))
    delete older.priceBy
    delete older.sheet
    const filled = normaliseCosting(older)
    expect(filled.priceBy.door).toBe('costing')
    expect(filled.sheet).toEqual(defaultSheet())
    expect(normaliseSheet({ win3: { slabs: [] } }).win3.slabs).toEqual(defaultSheet().win3.slabs)
  })
})

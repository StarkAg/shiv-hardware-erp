// Aluminium priced from what it is made of.
//
// The fixed per-sqft tables in lib/aluminium.ts were a price list. This works a
// door or window out from its parts instead: each aluminium section's weight
// for the size, at the rate per kg, plus the raw materials and labour — and
// then the shop's own margin on top, as a percentage or as rupees per sqft.
// Same maths as the Aluminium Rate Tester (Downloads/Aluminium Rate Tester.html),
// which was checked against the shop's sheet.
//
// Every number here is a variable the counter edits (features/rates/
// AluminiumCosting.tsx); these are only the starting values.

import type { Dimension, ProductCategory } from './types'
import { ALU_THICKNESSES, toAluminiumExcelInches, type AluAddons } from './aluminium'
import { calcAllThicknessesSheet, defaultSheet, normaliseSheet, type AluSheet } from './aluSheet'

/** One value per thickness, in ALU_THICKNESSES order: 1.2 MM, 1.6 MM, 1.2 MM Hindalco. */
export type Thick3 = [number, number, number]

export interface AluSection {
  id: string
  name: string
  /** How many lengths of the height and of the width this section runs. */
  xh: number
  xw: number
  /** Length of one bought piece, in feet; its weight is given per piece. */
  piece: number
  kg: Thick3
  /** Door only: part of the door itself or of the chaukhat. */
  grp?: 'door' | 'chk'
}

export interface AluPart {
  id: string
  name: string
  /** area = per sqft of the opening (x factor); lin = a·H + b·W feet; fixed = n of them. */
  kind: 'area' | 'lin' | 'fixed'
  /** Area only: the share of the opening it covers. Half SS net is 0.5. */
  factor?: number
  a?: number
  b?: number
  n?: number
  unit: string
  rate: number
  /** Door only: goes into the door or into the accessories. */
  grp?: 'door' | 'acc'
}

/**
 * Added to the making cost: a percentage of it, or rupees per unit sold. One
 * value per thickness — Hindalco sells for more than plain 1.2 MM though it
 * weighs the same, so the margin is where that difference lives.
 */
export interface Margin {
  mode: 'pct' | 'rs'
  value: Thick3
}

export interface DoorCosting {
  sections: AluSection[]
  parts: AluPart[]
  /** Rs per sqft for the door, per rft for the chaukhat, flat for accessories. */
  margin: { door: Margin; chk: Margin; acc: Margin }
  /** Add-ons are charged per sqft at these rates. */
  addons: { decorFilm: number; brownCoated: number }
}

export interface WindowCosting {
  sections: AluSection[]
  parts: AluPart[]
  margin: Margin
  /** What reflective glass costs over clear, per sqft. */
  reflectiveExtra: number
  addons: { ssNet: number; decorFilm: number; brownCoated: number }
}

/** How a product is priced: worked out from its parts, or straight off the selling sheet. */
export type PriceMode = 'costing' | 'sheet'

export interface AluCosting {
  /** Per product: which of the two ways the quotation prices it. */
  priceBy: Record<AluProduct, PriceMode>
  /** The selling sheet's own rates, used when a product is priced by the sheet. */
  sheet: AluSheet
  /**
   * The sheet rates of the other price sets (C2, C3 ...), by set id, once one
   * is edited on the quotation screen. C1 is `sheet` (see sheetOfSet).
   */
  sheetBySet: Record<string, AluSheet>
  /** Inches: a door lower than this is priced as this high (see DOOR_MIN_HEIGHT). 0 = none. */
  doorMinHeight: number
  /** Rs per kg, per thickness. One rate for the door and both windows. */
  alu: Thick3
  door: DoorCosting
  win2: WindowCosting
  win3: WindowCosting
  savedAt: number
}

export type AluProduct = 'door' | 'win2' | 'win3'

export const productOf = (c: ProductCategory): AluProduct =>
  c === 'aluminium-door' ? 'door' : c === 'window-3-track' ? 'win3' : 'win2'

// ---------- starting values ----------

/** Until the real weights are entered: 1.6 MM is 1.2 MM x 1.6/1.2, Hindalco the same as 1.2. */
const est = (w: number): Thick3 => [w, Math.round((w * 1.6) / 1.2 * 1000) / 1000, w]

let seq = 0
export const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

const sec = (name: string, xh: number, xw: number, kg: number, grp?: AluSection['grp']): AluSection =>
  ({ id: newId(), name, xh, xw, piece: 16, kg: est(kg), ...(grp ? { grp } : {}) })

// From the shop's selling sheet (Aluminium Rates 2026-10-28.xlsm), which is
// what the counter quoted by until now.
const window2Sections = () => [
  sec('2 TTS', 2, 1, 2.2),
  sec('2 TB', 0, 1, 2.5),
  sec('OSO', 2, 0, 1.1),
  sec('BSO', 0, 2, 1.2),
  sec('Interlock', 2, 0, 1.4),
]

const window3Sections = () => [
  sec('3 TTS', 2, 1, 2.78),
  sec('3 TB', 0, 1, 3),
  sec('OSO / A Section / Lock Section', 2, 0, 1.1),
  sec('BSO / H Section / Palla Top & Bottom', 0, 3, 1.2),
  sec('Interlock', 4, 0, 1.4),
]

type PartSpec = Omit<AluPart, 'id'>
const parts = (list: PartSpec[]): AluPart[] => list.map((p) => ({ id: newId(), ...p }))

const window2Parts = () => parts([
  { name: 'U Rubber', kind: 'lin', a: 4, b: 2, unit: 'ft', rate: 1 },
  { name: 'T Brush', kind: 'lin', a: 8, b: 8, unit: 'ft', rate: 1 },
  { name: 'Glass (4 MM clear)', kind: 'area', unit: 'sqft', rate: 48 },
  { name: 'Star Lock', kind: 'fixed', n: 1, unit: 'set', rate: 40 },
  { name: 'Runner', kind: 'fixed', n: 4, unit: 'pcs', rate: 10 },
  { name: 'Angle 6"', kind: 'fixed', n: 1, unit: 'set', rate: 45 },
  { name: 'Screws', kind: 'fixed', n: 1, unit: 'lot', rate: 20 },
  { name: 'Labour', kind: 'area', unit: 'sqft', rate: 30 },
])

const window3Parts = () => parts([
  { name: 'U Rubber', kind: 'lin', a: 4, b: 2, unit: 'ft', rate: 1 },
  { name: 'T Brush', kind: 'lin', a: 12, b: 12, unit: 'ft', rate: 1 },
  { name: 'Glass (4 MM clear)', kind: 'area', unit: 'sqft', rate: 48 },
  { name: 'Star Lock', kind: 'fixed', n: 1, unit: 'set', rate: 40 },
  { name: 'Runner', kind: 'fixed', n: 6, unit: 'pcs', rate: 10 },
  { name: 'Angle 6"', kind: 'fixed', n: 1, unit: 'set', rate: 45 },
  { name: 'Screws', kind: 'fixed', n: 1, unit: 'lot', rate: 20 },
  { name: 'Labour', kind: 'area', unit: 'sqft', rate: 45 },
  { name: '3/8" U Channel', kind: 'lin', a: 2, b: 1, unit: 'ft', rate: 10 },
  { name: 'SS Net (half the window)', kind: 'area', factor: 0.5, unit: 'sqft', rate: 20 },
])

const rs = (...value: Thick3): Margin => ({ mode: 'rs', value })

/**
 * Starting margins, Rs per unit, per thickness: what makes the costed price
 * land on the selling sheet's rates (see tests/aluCosting.test.ts).
 */
const MARGINS: Record<'door' | 'chk' | 'acc' | 'win2' | 'win3', Thick3> = {
  // At the sheet's 78 x 30 door: 150 / 200 / 190 a sqft, chaukhat 90 / 100 / 100 a rft.
  door: [36, 69, 76],
  chk: [23, 11, 33],
  // The sheet charges 160 for accessories that cost 190 in parts.
  acc: [-30, -30, -30],
  // Windows: the closest fit to the sheet's rates-by-area table across sizes,
  // with 1.6 MM at +60 a sqft and Hindalco at +50.
  win2: [35, 49, 85],
  win3: [35, 31, 85],
}

export function defaultCosting(): AluCosting {
  return {
    priceBy: { door: 'costing', win2: 'costing', win3: 'costing' },
    sheet: defaultSheet(),
    sheetBySet: {},
    doorMinHeight: DOOR_MIN_HEIGHT,
    alu: [470, 470, 470],
    door: {
      sections: [
        sec('OSO / A Section / Lock Section', 2, 0, 1.1, 'door'),
        sec('BSO / H Section / Palla Top & Bottom', 0, 2, 1.2, 'door'),
        sec('3" x 3/4" Middle', 0, 1, 3, 'door'),
        sec('Chaukhat', 2, 1, 2.25, 'chk'),
      ],
      parts: [
        { id: newId(), name: 'ACP Sheet', kind: 'area', unit: 'sqft', rate: 28, grp: 'door' },
        { id: newId(), name: '1/2" U Rubber', kind: 'lin', a: 2, b: 4, unit: 'ft', rate: 4, grp: 'door' },
        { id: newId(), name: '3" Hinges', kind: 'fixed', n: 3, unit: 'pcs', rate: 18, grp: 'acc' },
        { id: newId(), name: '6" Alu Aldrop', kind: 'fixed', n: 1, unit: 'pc', rate: 40, grp: 'acc' },
        { id: newId(), name: '6" Alu Handle', kind: 'fixed', n: 2, unit: 'pc', rate: 24, grp: 'acc' },
        { id: newId(), name: '4" Alu Tower Bolt', kind: 'fixed', n: 1, unit: 'pc', rate: 28, grp: 'acc' },
        { id: newId(), name: 'Screws', kind: 'fixed', n: 1, unit: 'lot', rate: 20, grp: 'acc' },
        { id: newId(), name: 'Labour', kind: 'area', unit: 'sqft', rate: 30, grp: 'door' },
      ],
      margin: { door: rs(...MARGINS.door), chk: rs(...MARGINS.chk), acc: rs(...MARGINS.acc) },
      addons: { decorFilm: 30, brownCoated: 40 },
    },
    win2: {
      sections: window2Sections(),
      parts: window2Parts(),
      margin: rs(...MARGINS.win2),
      reflectiveExtra: 20,
      addons: { ssNet: 50, decorFilm: 30, brownCoated: 40 },
    },
    win3: {
      sections: window3Sections(),
      parts: window3Parts(),
      margin: rs(...MARGINS.win3),
      reflectiveExtra: 20,
      addons: { ssNet: 50, decorFilm: 30, brownCoated: 40 },
    },
    savedAt: 0,
  }
}

// ---------- the maths ----------

const up = (x: number) => Math.ceil(x - 1e-9)
const r2 = (n: number) => Math.round(n * 100) / 100
const num = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0)

export interface AluSize {
  hi: number
  wi: number
  /** Feet. */
  H: number
  W: number
  area: number
  /** Running feet of a chaukhat: both sides and the top. */
  rft: number
}

/** Any soot (eighths) rounds the size up to the next inch, as the sheet does. */
export function sizeOf(height: Dimension, width: Dimension): AluSize {
  const hi = toAluminiumExcelInches(height)
  const wi = toAluminiumExcelInches(width)
  return { hi, wi, H: hi / 12, W: wi / 12, area: r2((hi * wi) / 144), rft: r2((2 * hi + wi) / 12) }
}

export function partQty(part: AluPart, s: AluSize): number {
  if (part.kind === 'area') return r2(s.area * (part.factor ?? 1))
  if (part.kind === 'lin') return up(num(part.a) * s.H + num(part.b) * s.W)
  return num(part.n)
}

export const partAmount = (part: AluPart, s: AluSize) => up(partQty(part, s) * num(part.rate))

export const sectionFeet = (sc: AluSection, s: AluSize) => num(sc.xh) * s.H + num(sc.xw) * s.W

export const sectionKg = (sc: AluSection, s: AluSize, t: number) =>
  (sectionFeet(sc, s) * num(sc.kg[t])) / (num(sc.piece) || 16)

/** Making cost plus margin, for thickness `t`. `units` is what a Rs margin is counted per. */
export function withMargin(cost: number, m: Margin, units: number, t: number): number {
  const v = num(m.value[t])
  return m.mode === 'pct' ? cost * (1 + v / 100) : cost + v * units
}

/**
 * A door lower than this many inches is priced as this high, at its real
 * width, by costing and by the sheet alike. There is no minimum bill size
 * besides it (the owner, 2026-11-26). Editable: AluCosting.doorMinHeight.
 */
export const DOOR_MIN_HEIGHT = 72

/** The height a product is priced at: a door under the shortest height is charged as that height. */
export function chargedHeight(category: ProductCategory, height: Dimension, minHeight: number): Dimension {
  if (category !== 'aluminium-door') return height
  return toAluminiumExcelInches(height) < minHeight ? { inches: minHeight, soot: 0 } : height
}

/**
 * A priced line the way the quotation prints it: a whole-rupee rate per unit,
 * and the amount that rate makes — so "@142 x 16.25 sqft" adds up on paper.
 */
function priced(sell: number, units: number) {
  if (!(units > 0)) return { rate: 0, amount: 0 }
  const rate = up(sell / units)
  return { rate, amount: Math.round(rate * units) }
}

export interface ItemCost {
  kg: number
  cost: number
  sell: number
  rate: number
}

export interface ThicknessCosting {
  name: string
  door?: { door: ItemCost; chk: ItemCost; acc: ItemCost }
  window?: { clear: ItemCost; reflective: ItemCost }
}

const kgSum = (sections: AluSection[], s: AluSize, t: number, grp?: AluSection['grp']) =>
  sections.reduce((a, sc) => a + (!grp || sc.grp === grp ? sectionKg(sc, s, t) : 0), 0)

const partsSum = (parts: AluPart[], s: AluSize, grp?: AluPart['grp']) =>
  parts.reduce((a, p) => a + (!grp || (p.grp ?? 'door') === grp ? partAmount(p, s) : 0), 0)

/** Cost, margin and price, item by item, for each thickness. */
export function costOut(product: AluProduct, s: AluSize, c: AluCosting): ThicknessCosting[] {
  return ALU_THICKNESSES.map((name, t) => {
    const rate = num(c.alu[t])
    if (product === 'door') {
      const d = c.door
      const item = (kg: number, extra: number, m: Margin, units: number): ItemCost => {
        const cost = kg * rate + extra
        const p = priced(withMargin(cost, m, units, t), units)
        return { kg, cost, sell: p.amount, rate: p.rate }
      }
      const doorKg = kgSum(d.sections, s, t, 'door')
      const chkKg = kgSum(d.sections, s, t, 'chk')
      const accCost = partsSum(d.parts, s, 'acc')
      return {
        name,
        door: {
          door: item(doorKg, partsSum(d.parts, s, 'door'), d.margin.door, s.area),
          chk: item(chkKg, 0, d.margin.chk, s.rft),
          // A flat sum: a Rs margin is added once.
          acc: { kg: 0, cost: accCost, sell: Math.round(withMargin(accCost, d.margin.acc, 1, t)), rate: 0 },
        },
      }
    }
    const w = c[product]
    const kg = kgSum(w.sections, s, t)
    const clearCost = kg * rate + partsSum(w.parts, s)
    const reflCost = clearCost + num(w.reflectiveExtra) * s.area
    const clear = priced(withMargin(clearCost, w.margin, s.area, t), s.area)
    const refl = priced(withMargin(reflCost, w.margin, s.area, t), s.area)
    return {
      name,
      window: {
        clear: { kg, cost: clearCost, sell: clear.amount, rate: clear.rate },
        reflective: { kg, cost: reflCost, sell: refl.amount, rate: refl.rate },
      },
    }
  })
}

/**
 * The quotation's rows, in the shape lib/aluminium's calcAllThicknesses gave
 * them, so the quotation screen, its saved copy and the printed sheet read
 * them unchanged.
 */
export function calcAllThicknessesCosted(
  category: ProductCategory,
  height: Dimension,
  width: Dimension,
  addons: AluAddons,
  c: AluCosting,
) {
  const s = sizeOf(height, width)
  const product = productOf(category)
  const rows = costOut(product, s, c)
  const perSqft = (on: boolean, rate: number) => (on ? Math.round(s.area * rate) : 0)

  if (product === 'door') {
    const a = c.door.addons
    return rows.map(({ name, door }) => {
      const d = door!
      const chaukhatCost = addons.chaukhat ? d.chk.sell : 0
      const accessories = addons.accessories ? d.acc.sell : 0
      return {
        name,
        doorRate: d.door.rate, doorCost: d.door.sell,
        chaukhatRate: d.chk.rate, chaukhatCost,
        chaukhatRft: s.rft,
        area: s.area,
        accessories,
        total: d.door.sell + chaukhatCost + accessories,
        decorFilmRate: a.decorFilm, decorFilm: perSqft(addons.decorFilm, a.decorFilm),
        brownCoatedRate: a.brownCoated, brownCoated: perSqft(addons.brownCoated, a.brownCoated),
      }
    })
  }

  const a = c[product].addons
  const ssNet = product === 'win2' && addons.ssNet ? perSqft(true, a.ssNet) : 0
  return rows.map(({ name, window }) => {
    const w = window!
    // Both glasses are quoted side by side; the first row is always clear.
    return {
      name,
      doorRate: w.clear.rate, doorCost: w.clear.sell,
      glassRate: w.clear.rate, glassCost: w.clear.sell,
      reflectiveRate: w.reflective.rate, reflectiveCost: w.reflective.sell,
      chaukhatRate: 0, chaukhatCost: 0,
      accessories: ssNet,
      ssNetRate: a.ssNet,
      total: w.clear.sell,
      decorFilmRate: a.decorFilm, decorFilm: perSqft(addons.decorFilm, a.decorFilm),
      brownCoatedRate: a.brownCoated, brownCoated: perSqft(addons.brownCoated, a.brownCoated),
    }
  })
}

/** The quotation's rows, priced the way the Aluminium rates screen has this product set to. */
export function calcAluminiumQuote(
  category: ProductCategory,
  height: Dimension,
  width: Dimension,
  addons: AluAddons,
  c: AluCosting,
) {
  const h = chargedHeight(category, height, c.doorMinHeight)
  return c.priceBy[productOf(category)] === 'sheet'
    ? calcAllThicknessesSheet(category, h, width, addons, c.sheet)
    : calcAllThicknessesCosted(category, h, width, addons, c)
}

/**
 * The sheet rates a price set quotes by. The first set (C1) is `sheet`, the
 * one the Aluminium rates screen edits; another set has its own once its rates
 * are changed on the quotation screen, and C1's until then.
 */
export function sheetOfSet(c: AluCosting, setId: string | undefined, firstSetId: string | undefined): AluSheet {
  if (!setId || setId === firstSetId) return c.sheet
  return c.sheetBySet[setId] ?? c.sheet
}

/** The costing with one price set's sheet rates replaced. */
export function withSetSheet(c: AluCosting, setId: string | undefined, firstSetId: string | undefined, sheet: AluSheet): AluCosting {
  if (!setId || setId === firstSetId) return { ...c, sheet }
  return { ...c, sheetBySet: { ...c.sheetBySet, [setId]: sheet } }
}

/**
 * A saved copy read back. Anything missing or mistyped falls back to the
 * starting value, so an older copy (or a hand-edited one) can never leave a
 * quotation without a number.
 */
export function normaliseCosting(raw: unknown): AluCosting {
  const d = defaultCosting()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<AluCosting>
  const t3 = (x: unknown, f: Thick3): Thick3 =>
    Array.isArray(x) && x.length === 3 ? (x.map((v, i) => (Number.isFinite(Number(v)) ? Number(v) : f[i])) as Thick3) : f
  // A margin saved before it was per thickness is one number for all three.
  const margin = (x: unknown, f: Margin): Margin => {
    if (!x || typeof x !== 'object') return f
    const m = x as { mode?: unknown; value?: unknown }
    if (m.mode !== 'pct' && m.mode !== 'rs') return f
    const one = num(m.value)
    return { mode: m.mode, value: Array.isArray(m.value) ? t3(m.value, f.value) : [one, one, one] }
  }
  const list = <T,>(x: unknown, f: T[]) => (Array.isArray(x) ? (x as T[]) : f)
  const sections = (x: unknown, f: AluSection[]) =>
    list<AluSection>(x, f).map((sc) => ({ ...sc, id: sc.id || newId(), kg: t3(sc.kg, [0, 0, 0]) }))
  const parts = (x: unknown, f: AluPart[]) => list<AluPart>(x, f).map((p) => ({ ...p, id: p.id || newId() }))
  const win = (x: unknown, f: WindowCosting): WindowCosting => {
    const w = (x && typeof x === 'object' ? x : {}) as Partial<WindowCosting>
    return {
      sections: sections(w.sections, f.sections),
      parts: parts(w.parts, f.parts),
      margin: margin(w.margin, f.margin),
      reflectiveExtra: w.reflectiveExtra === undefined ? f.reflectiveExtra : num(w.reflectiveExtra),
      addons: { ...f.addons, ...(w.addons ?? {}) },
    }
  }
  const door = (r.door ?? {}) as Partial<DoorCosting>
  const by = (r.priceBy ?? {}) as Partial<Record<AluProduct, unknown>>
  const mode = (x: unknown): PriceMode => (x === 'sheet' ? 'sheet' : 'costing')
  return {
    priceBy: { door: mode(by.door), win2: mode(by.win2), win3: mode(by.win3) },
    sheet: normaliseSheet(r.sheet),
    sheetBySet: Object.fromEntries(
      Object.entries(r.sheetBySet && typeof r.sheetBySet === 'object' ? r.sheetBySet : {})
        .map(([id, sh]) => [id, normaliseSheet(sh)]),
    ),
    doorMinHeight: Number.isFinite(Number(r.doorMinHeight)) && r.doorMinHeight !== undefined ? Number(r.doorMinHeight) : DOOR_MIN_HEIGHT,
    alu: t3(r.alu, d.alu),
    door: {
      sections: sections(door.sections, d.door.sections),
      parts: parts(door.parts, d.door.parts),
      margin: {
        door: margin(door.margin?.door, d.door.margin.door),
        chk: margin(door.margin?.chk, d.door.margin.chk),
        acc: margin(door.margin?.acc, d.door.margin.acc),
      },
      addons: { ...d.door.addons, ...(door.addons ?? {}) },
    },
    win2: win(r.win2, d.win2),
    win3: win(r.win3, d.win3),
    savedAt: num(r.savedAt),
  }
}

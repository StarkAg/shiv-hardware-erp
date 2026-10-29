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
  /** area = per sqft of the opening; lin = a·H + b·W feet; fixed = n of them. */
  kind: 'area' | 'lin' | 'fixed'
  a?: number
  b?: number
  n?: number
  unit: string
  rate: number
  /** Door only: goes into the door or into the accessories. */
  grp?: 'door' | 'acc'
}

/** Added to the making cost: a percentage of it, or rupees per unit sold. */
export interface Margin {
  mode: 'pct' | 'rs'
  value: number
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

export interface AluCosting {
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

const windowSections = () => [
  sec('2 TTS', 2, 1, 2.78),
  sec('2 TB', 0, 1, 3),
  sec('OSO', 2, 0, 1.9),
  sec('BSO', 0, 2, 1.86),
  sec('Interlock', 2, 0, 2.08),
]

const windowParts = (): AluPart[] => [
  { id: newId(), name: 'U Rubber', kind: 'lin', a: 4, b: 2, unit: 'ft', rate: 1 },
  { id: newId(), name: 'T Rubber', kind: 'lin', a: 8, b: 8, unit: 'ft', rate: 1 },
  { id: newId(), name: 'Glass (4 MM clear)', kind: 'area', unit: 'sqft', rate: 48 },
  { id: newId(), name: 'Star Lock', kind: 'fixed', n: 1, unit: 'set', rate: 40 },
  { id: newId(), name: 'Runner', kind: 'fixed', n: 4, unit: 'pcs', rate: 10 },
  { id: newId(), name: 'Angle 6"', kind: 'fixed', n: 1, unit: 'set', rate: 45 },
  { id: newId(), name: 'Screws', kind: 'fixed', n: 1, unit: 'lot', rate: 20 },
  { id: newId(), name: 'Labour', kind: 'area', unit: 'sqft', rate: 30 },
]

const pct = (value: number): Margin => ({ mode: 'pct', value })

export function defaultCosting(): AluCosting {
  return {
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
      margin: { door: pct(20), chk: pct(20), acc: pct(20) },
      addons: { decorFilm: 30, brownCoated: 40 },
    },
    win2: {
      sections: windowSections(),
      parts: windowParts(),
      margin: pct(20),
      reflectiveExtra: 20,
      addons: { ssNet: 50, decorFilm: 30, brownCoated: 40 },
    },
    win3: {
      // The 2-track sections until the 3-track ones are entered.
      sections: windowSections(),
      parts: windowParts(),
      margin: pct(20),
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
  if (part.kind === 'area') return s.area
  if (part.kind === 'lin') return up(num(part.a) * s.H + num(part.b) * s.W)
  return num(part.n)
}

export const partAmount = (part: AluPart, s: AluSize) => up(partQty(part, s) * num(part.rate))

export const sectionFeet = (sc: AluSection, s: AluSize) => num(sc.xh) * s.H + num(sc.xw) * s.W

export const sectionKg = (sc: AluSection, s: AluSize, t: number) =>
  (sectionFeet(sc, s) * num(sc.kg[t])) / (num(sc.piece) || 16)

/** Making cost plus margin. `units` is what a Rs margin is counted per. */
export function withMargin(cost: number, m: Margin, units: number): number {
  return m.mode === 'pct' ? cost * (1 + num(m.value) / 100) : cost + num(m.value) * units
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
        const p = priced(withMargin(cost, m, units), units)
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
          acc: { kg: 0, cost: accCost, sell: Math.round(withMargin(accCost, d.margin.acc, 1)), rate: 0 },
        },
      }
    }
    const w = c[product]
    const kg = kgSum(w.sections, s, t)
    const clearCost = kg * rate + partsSum(w.parts, s)
    const reflCost = clearCost + num(w.reflectiveExtra) * s.area
    const clear = priced(withMargin(clearCost, w.margin, s.area), s.area)
    const refl = priced(withMargin(reflCost, w.margin, s.area), s.area)
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
    const chosen = addons.glassType === 'reflective' ? w.reflective : w.clear
    return {
      name,
      doorRate: chosen.rate, doorCost: chosen.sell,
      glassRate: w.clear.rate, glassCost: w.clear.sell,
      reflectiveRate: w.reflective.rate, reflectiveCost: w.reflective.sell,
      chaukhatRate: 0, chaukhatCost: 0,
      accessories: ssNet,
      total: chosen.sell,
      decorFilmRate: a.decorFilm, decorFilm: perSqft(addons.decorFilm, a.decorFilm),
      brownCoatedRate: a.brownCoated, brownCoated: perSqft(addons.brownCoated, a.brownCoated),
    }
  })
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
  const margin = (x: unknown, f: Margin): Margin =>
    x && typeof x === 'object' && ((x as Margin).mode === 'pct' || (x as Margin).mode === 'rs')
      ? { mode: (x as Margin).mode, value: num((x as Margin).value) }
      : f
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
  return {
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

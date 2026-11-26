// Aluminium priced straight off the shop's selling sheet.
//
// The other way to price aluminium (lib/aluCosting) works a door or window out
// from its sections, materials and margin. This one is the workbook the shop
// quoted by, Desktop\Aluminium Rates.xlsm, read formula by formula
// (docs/aluminium-sheet-price.md):
//
//   size     inches, plus 1 when any soot is filled in          J2 / K2
//   area     ROUND(height x width / 144, 2)                      L2
//   windows  the 1.2 mm clear rate is the "Rates According To Area" slab:
//            the biggest slab area not over the size's area     K5 / K6
//            1.6 mm = that + 60, 1.2 mm Hindalco = that + 50     Q3 / S3
//            reflective glass = each of those + 20               O5 / Q5 / S5
//            price = rate x area                                 C14 ...
//   door     door rate x area, chaukhat rate x (2H + W) / 12 feet, accessories
//            a flat sum; the three make the total                C15 ... B18
//   add-ons  rate x area (brown coated, decor film, SS net)
//
// Every number is editable on the Aluminium rates screen; these are the
// sheet's values as of 2026-11-25.

import type { Dimension, ProductCategory } from './types'
import { ALU_THICKNESSES, toAluminiumExcelInches, type AluAddons } from './aluminium'

/** One value per thickness, in ALU_THICKNESSES order: 1.2 MM, 1.6 MM, 1.2 MM Hindalco. */
type T3 = [number, number, number]

export interface Slab {
  /** From this many sqft up (to the next slab), the 1.2 mm clear rate. */
  area: number
  rate: number
}

export interface WindowSheet {
  slabs: Slab[]
  /** Added to the slab rate for each thickness: 0, +60, +50. */
  extra: T3
  /** Reflective glass over clear, per sqft. */
  reflective: number
  ssNet: T3
  brownCoated: T3
}

export interface DoorSheet {
  door: T3
  chaukhat: T3
  accessories: T3
  decorFilm: T3
  brownCoated: T3
  /** The sheet's "Minimum Bill Size": a smaller door is charged as this. 0 = none. */
  minSqft: number
  minRft: number
}

export interface AluSheet {
  door: DoorSheet
  win2: WindowSheet
  win3: WindowSheet
}

const slabs = (pairs: [number, number][]): Slab[] => pairs.map(([area, rate]) => ({ area, rate }))

export function defaultSheet(): AluSheet {
  return {
    door: {
      door: [150, 200, 190],
      chaukhat: [90, 100, 100],
      accessories: [160, 160, 160],
      decorFilm: [30, 30, 30],
      brownCoated: [40, 40, 40],
      minSqft: 15,
      minRft: 14.5,
    },
    win2: {
      slabs: slabs([[6, 350], [7.5, 310], [9, 290], [12, 260], [14, 260], [16, 240], [20, 240], [24, 230]]),
      extra: [0, 60, 50],
      reflective: 20,
      ssNet: [50, 50, 50],
      brownCoated: [40, 40, 40],
    },
    win3: {
      slabs: slabs([[6, 470], [7.5, 430], [9, 390], [12, 360], [14, 330], [16, 320], [20, 300], [24, 290]]),
      extra: [0, 60, 50],
      reflective: 20,
      // The 3-track window already has its half SS net in the price.
      ssNet: [0, 0, 0],
      brownCoated: [40, 40, 40],
    },
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : 0)

/**
 * The sheet's MATCH(area, slabs, 1): the slab with the biggest area not over
 * the size's. Under the smallest slab the sheet shows an error; this charges
 * the smallest slab's rate, the highest one.
 */
export function slabRate(area: number, list: Slab[]): number {
  const sorted = [...list].filter((s) => Number.isFinite(s.area)).sort((a, b) => a.area - b.area)
  if (!sorted.length) return 0
  let rate = sorted[0].rate
  for (const s of sorted) if (area >= s.area) rate = s.rate
  return num(rate)
}

export function sheetSize(height: Dimension, width: Dimension) {
  const hi = toAluminiumExcelInches(height)
  const wi = toAluminiumExcelInches(width)
  return { hi, wi, area: r2((hi * wi) / 144), rft: r2((2 * hi + wi) / 12) }
}

/** 1.2 mm clear, 1.6 mm, Hindalco: the per-sqft rates for clear and reflective glass. */
export function windowRates(area: number, w: WindowSheet) {
  const base = slabRate(area, w.slabs)
  return ALU_THICKNESSES.map((_, t) => {
    const clear = base + num(w.extra[t])
    return { clear, reflective: clear + num(w.reflective) }
  })
}

/**
 * The quotation's rows, in the same shape as calcAllThicknessesCosted, so the
 * quotation screen, its saved copy and the printed sheet read either the same.
 */
export function calcAllThicknessesSheet(
  category: ProductCategory,
  height: Dimension,
  width: Dimension,
  addons: AluAddons,
  sheet: AluSheet,
) {
  const s = sheetSize(height, width)
  const perSqft = (on: boolean, rate: number) => (on ? Math.round(s.area * rate) : 0)

  if (category === 'aluminium-door') {
    const d = sheet.door
    const area = Math.max(s.area, num(d.minSqft))
    const rft = Math.max(s.rft, num(d.minRft))
    return ALU_THICKNESSES.map((name, t) => {
      const doorCost = Math.round(area * num(d.door[t]))
      const chaukhatCost = addons.chaukhat ? Math.round(rft * num(d.chaukhat[t])) : 0
      const accessories = addons.accessories ? num(d.accessories[t]) : 0
      return {
        name,
        doorRate: num(d.door[t]), doorCost,
        chaukhatRate: num(d.chaukhat[t]), chaukhatCost,
        chaukhatRft: rft,
        accessories,
        total: doorCost + chaukhatCost + accessories,
        decorFilmRate: num(d.decorFilm[t]), decorFilm: perSqft(addons.decorFilm, num(d.decorFilm[t])),
        brownCoatedRate: num(d.brownCoated[t]), brownCoated: perSqft(addons.brownCoated, num(d.brownCoated[t])),
      }
    })
  }

  const w = category === 'window-3-track' ? sheet.win3 : sheet.win2
  const rates = windowRates(s.area, w)
  return ALU_THICKNESSES.map((name, t) => {
    const { clear, reflective } = rates[t]
    const clearCost = Math.round(s.area * clear)
    const ssNet = category === 'window-2-track' && addons.ssNet ? perSqft(true, num(w.ssNet[t])) : 0
    return {
      name,
      doorRate: clear, doorCost: clearCost,
      glassRate: clear, glassCost: clearCost,
      reflectiveRate: reflective, reflectiveCost: Math.round(s.area * reflective),
      chaukhatRate: 0, chaukhatCost: 0,
      accessories: ssNet,
      ssNetRate: num(w.ssNet[t]),
      total: clearCost,
      decorFilmRate: 0, decorFilm: 0,
      brownCoatedRate: num(w.brownCoated[t]), brownCoated: perSqft(addons.brownCoated, num(w.brownCoated[t])),
    }
  })
}

/** A saved copy read back; anything missing or mistyped is the sheet's value. */
export function normaliseSheet(raw: unknown): AluSheet {
  const d = defaultSheet()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Partial<Record<keyof AluSheet, Record<string, unknown>>>
  const t3 = (x: unknown, f: T3): T3 =>
    Array.isArray(x) && x.length === 3 ? (x.map((v, i) => (Number.isFinite(Number(v)) ? Number(v) : f[i])) as T3) : f
  const one = (x: unknown, f: number) => (x === undefined || !Number.isFinite(Number(x)) ? f : Number(x))
  const win = (x: Record<string, unknown> | undefined, f: WindowSheet): WindowSheet => {
    const list = Array.isArray(x?.slabs)
      ? (x!.slabs as unknown[])
          .filter((s): s is Slab => !!s && typeof s === 'object')
          .map((s) => ({ area: num(s.area), rate: num(s.rate) }))
      : f.slabs
    return {
      slabs: list.length ? list : f.slabs,
      extra: t3(x?.extra, f.extra),
      reflective: one(x?.reflective, f.reflective),
      ssNet: t3(x?.ssNet, f.ssNet),
      brownCoated: t3(x?.brownCoated, f.brownCoated),
    }
  }
  const dr = r.door
  return {
    door: {
      door: t3(dr?.door, d.door.door),
      chaukhat: t3(dr?.chaukhat, d.door.chaukhat),
      accessories: t3(dr?.accessories, d.door.accessories),
      decorFilm: t3(dr?.decorFilm, d.door.decorFilm),
      brownCoated: t3(dr?.brownCoated, d.door.brownCoated),
      minSqft: one(dr?.minSqft, d.door.minSqft),
      minRft: one(dr?.minRft, d.door.minRft),
    },
    win2: win(r.win2, d.win2),
    win3: win(r.win3, d.win3),
  }
}

// Aluminium pricing — ported verbatim from the Shiv Hardware site
// (Ramgarh/ShivHardware/lib/calculators.ts), the authoritative source.
//
// Covers Aluminium Door, 2-Track Window, 3-Track Window with:
//   - per-thickness rates (1.2 MM / 1.6 MM / 1.2 MM Hindalco)
//   - slab-based area rate lookup for windows
//   - chaukhat priced in running feet (door has a 14.5 rft minimum)
//   - glass type (clear / reflective) for windows
//   - add-ons: chaukhat, accessories, decor film, SS net, brown coated

import type { Dimension, ProductCategory } from './types'

export type AluThickness = '1.2 MM' | '1.6 MM' | '1.2 MM Hindalco'
export type GlassType = 'clear' | 'reflective'

export const ALU_THICKNESSES: AluThickness[] = ['1.2 MM', '1.6 MM', '1.2 MM Hindalco']

// ---------- Aluminium Door ----------
export const doorRates: Record<AluThickness, { door: number; chaukhat: number; accessories: number; decorFilm: number; brownCoated: number }> = {
  '1.2 MM': { door: 150, chaukhat: 90, accessories: 160, decorFilm: 30, brownCoated: 40 },
  '1.6 MM': { door: 200, chaukhat: 100, accessories: 160, decorFilm: 30, brownCoated: 40 },
  '1.2 MM Hindalco': { door: 190, chaukhat: 100, accessories: 160, decorFilm: 30, brownCoated: 40 },
}
const DOOR_MAX_H = 84
const DOOR_MAX_W = 36

// ---------- Window slab base rates (area >= slab.area → rate) ----------
export const window2TrackAreaRates = [
  { area: 6, rate: 350 }, { area: 7.5, rate: 310 }, { area: 9, rate: 290 },
  { area: 12, rate: 270 }, { area: 14, rate: 260 }, { area: 16, rate: 250 },
  { area: 20, rate: 240 }, { area: 24, rate: 230 },
]
export const window3TrackAreaRates = [
  { area: 6, rate: 470 }, { area: 7.5, rate: 430 }, { area: 9, rate: 390 },
  { area: 12, rate: 360 }, { area: 14, rate: 350 }, { area: 16, rate: 330 },
  { area: 20, rate: 320 }, { area: 24, rate: 310 },
]
// Thickness add-ons for windows (added to slab base rate)
export const windowThicknessRates: Record<AluThickness, { clear: number; reflective: number; chaukhat: number }> = {
  '1.2 MM': { clear: 0, reflective: 20, chaukhat: 75 },
  '1.6 MM': { clear: 60, reflective: 80, chaukhat: 85 },
  '1.2 MM Hindalco': { clear: 50, reflective: 70, chaukhat: 85 },
}

function slabRate(area: number, table: { area: number; rate: number }[]): number {
  const sorted = [...table].sort((a, b) => b.area - a.area)
  for (const r of sorted) if (area >= r.area) return r.rate
  return sorted[sorted.length - 1].rate
}

export function toAluminiumExcelInches(d: Dimension): number {
  return Number(d.inches || 0) + (Number(d.soot || 0) > 0 ? 1 : 0)
}

export interface AluAddons {
  chaukhat: boolean
  accessories: boolean // door only
  decorFilm: boolean
  ssNet: boolean // window only
  brownCoated: boolean
  glassType: GlassType // window only
}

export const defaultAddons = (): AluAddons => ({
  chaukhat: true,
  accessories: true,
  decorFilm: true,
  ssNet: true,
  brownCoated: true,
  glassType: 'clear',
})

export interface AluResult {
  area: number
  baseRate: number
  total: number
  breakdown: { label: string; amount: number }[]
}

/** Unified aluminium calculator for the three aluminium categories. */
export function calcAluminium(
  category: ProductCategory,
  thickness: AluThickness,
  height: Dimension,
  width: Dimension,
  addons: AluAddons,
): AluResult {
  let hIn = toAluminiumExcelInches(height)
  let wIn = toAluminiumExcelInches(width)

  if (category === 'aluminium-door') {
    hIn = Math.min(hIn || 65, DOOR_MAX_H)
    wIn = Math.min(wIn || 30, DOOR_MAX_W)
    const area = round2((hIn * wIn) / 144)
    const chaukhatRft = Math.max(round2((hIn * 2 + wIn) / 12), 14.5)
    const r = doorRates[thickness]
    const breakdown: { label: string; amount: number }[] = [
      { label: 'Door', amount: area * r.door },
    ]
    if (addons.chaukhat) breakdown.push({ label: `Chaukhat (${chaukhatRft} rft)`, amount: chaukhatRft * r.chaukhat })
    if (addons.accessories) breakdown.push({ label: 'Accessories', amount: r.accessories })
    if (addons.decorFilm) breakdown.push({ label: 'Decor Film', amount: area * r.decorFilm })
    if (addons.brownCoated) breakdown.push({ label: 'Brown Coated', amount: area * r.brownCoated })
    return { area, baseRate: r.door, total: sum(breakdown), breakdown }
  }

  // Windows (2 / 3 track)
  const area = round2((hIn * wIn) / 144)
  const table = category === 'window-3-track' ? window3TrackAreaRates : window2TrackAreaRates
  const base = slabRate(area, table)
  const tr = windowThicknessRates[thickness]
  const glassRate = base + (addons.glassType === 'clear' ? tr.clear : tr.reflective)
  const glassLabel = addons.glassType === 'clear' ? '4 MM Clear & Texture Glass' : '4 MM Reflective Glass'
  const breakdown: { label: string; amount: number }[] = [
    { label: `${glassLabel} @${glassRate}`, amount: area * glassRate },
  ]
  if (category === 'window-2-track' && addons.ssNet) breakdown.push({ label: 'SS Net', amount: area * 50 })
  if (addons.brownCoated) breakdown.push({ label: 'Brown Coated', amount: area * 40 })
  return { area, baseRate: glassRate, total: sum(breakdown), breakdown }
}

/** Compute costs for ALL 3 thicknesses at once (for the all-thickness display). */
export function calcAllThicknesses(
  category: ProductCategory,
  height: Dimension,
  width: Dimension,
  addons: AluAddons,
) {
  const hIn = toAluminiumExcelInches(height)
  const wIn = toAluminiumExcelInches(width)
  const area = round2((hIn * wIn) / 144)
  const isDoor = category === 'aluminium-door'
  const chaukhatRft = isDoor ? Math.max(round2((hIn * 2 + wIn) / 12), 14.5) : round2((hIn * 2 + wIn) / 12)
  const is2Track = category === 'window-2-track'

  return ALU_THICKNESSES.map((t) => {
    if (isDoor) {
      const r = doorRates[t]
      const doorCost = Math.round(area * r.door)
      const chaukhatCost = addons.chaukhat ? Math.round(chaukhatRft * r.chaukhat) : 0
      const accessories = addons.accessories ? r.accessories : 0
      const decorFilm = addons.decorFilm ? Math.round(area * r.decorFilm) : 0
      const brownCoated = addons.brownCoated ? Math.round(area * r.brownCoated) : 0
      return {
        name: t,
        doorRate: r.door, doorCost,
        chaukhatRate: r.chaukhat, chaukhatCost,
        accessories,
        total: doorCost + chaukhatCost + accessories,
        decorFilmRate: r.decorFilm, decorFilm,
        brownCoatedRate: r.brownCoated, brownCoated,
      }
    } else {
      const tr = windowThicknessRates[t]
      const table = is2Track ? window2TrackAreaRates : window3TrackAreaRates
      const base = slabRate(area, table)
      const glassRate = base + (addons.glassType === 'reflective' ? tr.reflective : tr.clear)
      const glassCost = Math.round(area * glassRate)
      const reflectiveRate = base + tr.reflective
      const reflectiveCost = Math.round(area * reflectiveRate)
      const chaukhatCost = addons.chaukhat ? Math.round(chaukhatRft * tr.chaukhat) : 0
      const decorFilm = addons.decorFilm ? Math.round(area * 30) : 0
      const ssNet = addons.ssNet && is2Track ? Math.round(area * 50) : 0
      const brownCoated = addons.brownCoated ? Math.round(area * 40) : 0
      return {
        name: t,
        doorRate: glassRate, doorCost: glassCost,
        reflectiveRate, reflectiveCost,
        chaukhatRate: tr.chaukhat, chaukhatCost,
        accessories: ssNet,
        total: glassCost,
        decorFilmRate: 30, decorFilm,
        brownCoatedRate: 40, brownCoated,
      }
    }
  })
}

export function isAluminium(c: ProductCategory): boolean {
  return c === 'aluminium-door' || c === 'window-2-track' || c === 'window-3-track'
}

const round2 = (n: number) => Math.round(n * 100) / 100
const sum = (b: { amount: number }[]) => Math.round(b.reduce((s, x) => s + x.amount, 0))

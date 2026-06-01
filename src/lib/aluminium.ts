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
import { toInches } from './pricing'

export type AluThickness = '1.2 MM' | '1.6 MM' | '1.2 MM Hindalco'
export type GlassType = 'clear' | 'reflective'

export const ALU_THICKNESSES: AluThickness[] = ['1.2 MM', '1.6 MM', '1.2 MM Hindalco']

// ---------- Aluminium Door ----------
export const doorRates: Record<AluThickness, { door: number; chaukhat: number; accessories: number; decorFilm: number; brownCoated: number }> = {
  '1.2 MM': { door: 130, chaukhat: 75, accessories: 160, decorFilm: 30, brownCoated: 60 },
  '1.6 MM': { door: 180, chaukhat: 95, accessories: 160, decorFilm: 30, brownCoated: 60 },
  '1.2 MM Hindalco': { door: 150, chaukhat: 85, accessories: 160, decorFilm: 30, brownCoated: 60 },
}
const DOOR_MAX_H = 84
const DOOR_MAX_W = 36

// ---------- Window slab base rates (area >= slab.area → rate) ----------
export const window2TrackAreaRates = [
  { area: 6, rate: 240 }, { area: 7.5, rate: 260 }, { area: 9, rate: 230 },
  { area: 12, rate: 210 }, { area: 16, rate: 190 }, { area: 20, rate: 180 }, { area: 24, rate: 170 },
]
export const window3TrackAreaRates = [
  { area: 6, rate: 360 }, { area: 7.5, rate: 320 }, { area: 9, rate: 300 },
  { area: 12, rate: 280 }, { area: 16, rate: 250 }, { area: 20, rate: 240 }, { area: 24, rate: 230 },
]
// Thickness add-ons for windows (added to slab base rate)
export const windowThicknessRates: Record<AluThickness, { clear: number; reflective: number; chaukhat: number }> = {
  '1.2 MM': { clear: 0, reflective: 20, chaukhat: 75 },
  '1.6 MM': { clear: 50, reflective: 50, chaukhat: 85 },
  '1.2 MM Hindalco': { clear: 40, reflective: 40, chaukhat: 85 },
}

function slabRate(area: number, table: { area: number; rate: number }[]): number {
  const sorted = [...table].sort((a, b) => b.area - a.area)
  for (const r of sorted) if (area >= r.area) return r.rate
  return sorted[sorted.length - 1].rate
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
  accessories: false,
  decorFilm: false,
  ssNet: false,
  brownCoated: false,
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
  let hIn = toInches(height)
  let wIn = toInches(width)

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
  const breakdown: { label: string; amount: number }[] = [
    { label: `Glass (${addons.glassType}) @${glassRate}`, amount: area * glassRate },
  ]
  if (addons.chaukhat) breakdown.push({ label: 'Chaukhat', amount: ((hIn * 2 + wIn) / 12) * tr.chaukhat })
  if (addons.decorFilm) breakdown.push({ label: 'Decor Film', amount: area * 30 })
  if (addons.ssNet) breakdown.push({ label: 'SS Net', amount: area * 50 })
  if (addons.brownCoated) breakdown.push({ label: 'Brown Coated', amount: area * 40 })
  return { area, baseRate: glassRate, total: sum(breakdown), breakdown }
}

export function isAluminium(c: ProductCategory): boolean {
  return c === 'aluminium-door' || c === 'window-2-track' || c === 'window-3-track'
}

const round2 = (n: number) => Math.round(n * 100) / 100
const sum = (b: { amount: number }[]) => Math.round(b.reduce((s, x) => s + x.amount, 0))

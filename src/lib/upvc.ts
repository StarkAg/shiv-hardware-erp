// UPVC pricing — ported from Latest/UPVC Rates.xlsm.
//
// Structurally identical to the aluminium engine, but keyed on BRAND
// (Prominance / DDoor / Simta) instead of thickness. Covers:
//   - UPVC 2 / 2.5 / 3 Track Sliding Windows (area-slab base rate + brand add-on)
//   - UPVC Door (per-sqft door+chaukhat rate + accessories, min area 15)
import type { Dimension, ProductCategory } from './types'
import { toAluminiumExcelInches, type AluAddons } from './aluminium'

export type UpvcBrand = 'Prominance' | 'DDoor' | 'Simta'
export const UPVC_BRANDS: UpvcBrand[] = ['Prominance', 'DDoor', 'Simta']

// Windows: same area→base-rate slab for all three track types (per the sheet).
const windowAreaRates = [
  { area: 6, rate: 400 }, { area: 7.5, rate: 360 }, { area: 9, rate: 320 },
  { area: 12, rate: 290 }, { area: 14, rate: 280 }, { area: 16, rate: 260 },
  { area: 20, rate: 250 }, { area: 24, rate: 240 },
]
// Brand add-on over the slab base rate (clear glass), + reflective extra, + chaukhat rft rate.
const windowBrandRates: Record<UpvcBrand, { add: number; reflective: number; chaukhat: number }> = {
  'Prominance': { add: 0, reflective: 20, chaukhat: 75 },
  'DDoor':      { add: 60, reflective: 20, chaukhat: 85 },
  'Simta':      { add: 50, reflective: 20, chaukhat: 85 },
}
// UPVC Door: per-sqft "Door With Chaukhat" rate + flat accessories.
const doorRates: Record<UpvcBrand, { door: number; accessories: number }> = {
  'Prominance': { door: 130, accessories: 160 },
  'DDoor':      { door: 180, accessories: 160 },
  'Simta':      { door: 170, accessories: 160 },
}
const DOOR_MIN_AREA = 15
const DOOR_MIN_CHAUKHAT = 14.5

const round2 = (n: number) => Math.round(n * 100) / 100
function slabRate(area: number, table: { area: number; rate: number }[]): number {
  const sorted = [...table].sort((a, b) => b.area - a.area)
  for (const r of sorted) if (area >= r.area) return r.rate
  return sorted[sorted.length - 1].rate
}

export function isUpvc(c: ProductCategory): boolean {
  return c === 'upvc-2-track' || c === 'upvc-2.5-track' || c === 'upvc-3-track' || c === 'upvc-door'
}

/**
 * Compute costs for ALL 3 UPVC brands at once — same return shape as the
 * aluminium calcAllThicknesses, so the aluminium print layout can render it.
 */
export function calcAllUpvcBrands(
  category: ProductCategory,
  height: Dimension,
  width: Dimension,
  addons: AluAddons,
) {
  const hIn = toAluminiumExcelInches(height)
  const wIn = toAluminiumExcelInches(width)
  const isDoor = category === 'upvc-door'
  const rawArea = round2((hIn * wIn) / 144)
  const area = isDoor ? Math.max(rawArea, DOOR_MIN_AREA) : rawArea
  const chaukhatRft = Math.max(round2((hIn * 2 + wIn) / 12), DOOR_MIN_CHAUKHAT)
  const base = slabRate(area, windowAreaRates)

  return UPVC_BRANDS.map((b) => {
    if (isDoor) {
      const r = doorRates[b]
      const doorCost = Math.round(area * r.door)
      const accessories = addons.accessories ? r.accessories : 0
      return {
        name: b,
        doorRate: r.door, doorCost,
        chaukhatRate: 0, chaukhatCost: 0,
        accessories,
        total: doorCost + accessories,
        decorFilmRate: 0, decorFilm: 0,
        brownCoatedRate: 0, brownCoated: 0,
      }
    }
    const br = windowBrandRates[b]
    const glassRate = base + br.add + (addons.glassType === 'reflective' ? br.reflective : 0)
    const glassCost = Math.round(area * glassRate)
    const reflectiveRate = base + br.add + br.reflective
    const reflectiveCost = Math.round(area * reflectiveRate)
    const chaukhatCost = addons.chaukhat ? Math.round(chaukhatRft * br.chaukhat) : 0
    const ssNet = addons.ssNet ? Math.round(area * 50) : 0
    const brownCoated = addons.brownCoated ? Math.round(area * 40) : 0
    return {
      name: b,
      doorRate: glassRate, doorCost: glassCost,
      reflectiveRate, reflectiveCost,
      chaukhatRate: br.chaukhat, chaukhatCost,
      accessories: ssNet,
      total: glassCost,
      decorFilmRate: 0, decorFilm: 0,
      brownCoatedRate: 40, brownCoated,
      glassRate, glassCost,
      chaukhatRft,
    }
  })
}

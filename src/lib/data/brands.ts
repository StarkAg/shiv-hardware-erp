// Seed rate tables, transcribed from the Excel sheets.
// These are EDITABLE in the Rate Manager — this is just the starting data.
//
// Door/board rates are ₹ per sqft (Excel column A). Guarantee years from column K/F.

import type { Brand, BrandSet } from '../types'

let n = 0
const id = () => `b${++n}`

export const SEED_BRANDS: Brand[] = [
  // ---- Readymade Door (Plywood and Door.xlsm > ReadyMade) ----
  { id: id(), category: 'readymade-door', name: 'Arya Membrane', rate: 160, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'Arya Lamination', rate: 170, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor Lamination', rate: 190, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor Laminated', rate: 240, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'Durian Melamine', rate: 248, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor Laminated PM', rate: 280, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'Pine Wooden Door', rate: 340, guaranteeYears: 10, thicknessMm: 30 },

  // ---- Flush Door / Plain (sheet: Plain) ----
  { id: id(), category: 'flush-door', name: 'Greenply', rate: 170, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Arch Pine', rate: 140, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Gattani', rate: 155, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Maharaja', rate: 160, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Signature', rate: 190, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Natural', rate: 105, guaranteeYears: 0, thicknessMm: 30 },

  // ---- Water Proof Block Board 12mm (sheet: 12 MM) ----
  { id: id(), category: 'block-board-12', name: 'Kitply', rate: 88, guaranteeYears: 10, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Greenply', rate: 82, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Gattani', rate: 63, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Arch Pine', rate: 63, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Black Touch', rate: 58, guaranteeYears: 7, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Oxford', rate: 65, guaranteeYears: 0, thicknessMm: 12 },

  // ---- Water Proof Block Board 19mm (sheet: 19 MM) ----
  { id: id(), category: 'block-board-19', name: 'Kitply', rate: 110, guaranteeYears: 10, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Greenply', rate: 115, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Gattani', rate: 102, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Arch Pine', rate: 100, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Black Touch', rate: 78, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Oxford', rate: 102, guaranteeYears: 0, thicknessMm: 19 },

  // Aluminium (door / 2-track / 3-track) is fully calculated in lib/aluminium.ts
  // — per-thickness rates, slab area rates, chaukhat & add-ons — not brand-based.
]

/** Default price sets — Set A holds the seed brands above. */
export const SEED_SETS: BrandSet[] = [{ id: 'set-a', name: 'Set A', brands: SEED_BRANDS }]

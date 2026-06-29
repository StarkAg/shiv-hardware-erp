// Seed rate tables, transcribed from the latest workbook in Downloads/Formats.
// Source: C:/Users/tonya/Downloads/Formats/Plywood and Door color.xlsm
// These are EDITABLE in the Rate Manager - this is just the starting data.
//
// Door/board rates are rupees per sqft. Guarantee years include the workbook's
// Guarantee/Warranty columns so new warranty-only rows still show their years.

import type { Brand, BrandSet } from '../types'

let n = 0
const id = () => `b${++n}`
const GREEN_TINT = '#ADDB7B'
const LIGHT_GREEN_TINT = '#CCFF99'
const PINK_TINT = '#FFCCFF'

export const SEED_BRANDS: Brand[] = [
  // ---- Readymade Door Water Proof (Formats/Plywood and Door color.xlsm > ReadyMade) ----
  { id: id(), category: 'readymade-door', name: 'Arya Membrane', rate: 170, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'Arya 3D Lamination', rate: 170, guaranteeYears: 0, accentColor: PINK_TINT, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'Arya Sunmica', rate: 248, guaranteeYears: 0, accentColor: LIGHT_GREEN_TINT, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor 3D Lamination', rate: 220, guaranteeYears: 7, accentColor: PINK_TINT, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor Sunmica', rate: 288, guaranteeYears: 10, accentColor: LIGHT_GREEN_TINT, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor Sunmica PM', rate: 329, guaranteeYears: 10, accentColor: LIGHT_GREEN_TINT, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor Melamine', rate: 245, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor Melamine PM', rate: 445, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor Wpc', rate: 320, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor Meranti Wooden', rate: 440, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'EkoTimber Wpc', rate: 280, guaranteeYears: 0, thicknessMm: 30 },

  // ---- Flush Door / Plain Water Proof (Formats/Plywood and Door color.xlsm > Plain) ----
  { id: id(), category: 'flush-door', name: 'Greenply', rate: 190, guaranteeYears: 0, accentColor: GREEN_TINT, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Arch Pine', rate: 140, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Gattani', rate: 165, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Signature Gold', rate: 195, guaranteeYears: 10, accentColor: GREEN_TINT, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Signature', rate: 172, guaranteeYears: 7, accentColor: GREEN_TINT, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Mayura Gold', rate: 148, guaranteeYears: 5, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Monark', rate: 90, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Abhiyan', rate: 145, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Natural', rate: 110, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Century Club Prime', rate: 199, guaranteeYears: 30, coverage: 'warranty', accentColor: GREEN_TINT, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Signature Gold Club', rate: 208, guaranteeYears: 20, accentColor: GREEN_TINT, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Addwell', rate: 115, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Geetanjali', rate: 120, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Century Sainik 710', rate: 158, guaranteeYears: 7, coverage: 'warranty', accentColor: GREEN_TINT, thicknessMm: 30 },

  // ---- Water Proof Plywood 6mm (Formats/Plywood and Door color.xlsm > 6 MM) ----
  { id: id(), category: 'plywood-6', name: 'Signature', rate: 81, guaranteeYears: 0, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Green OptimaG', rate: 52, guaranteeYears: 0, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Gattani', rate: 78, guaranteeYears: 0, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Archpine', rate: 48, guaranteeYears: 0, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Compact Gold', rate: 58, guaranteeYears: 0, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Milton Super/HS', rate: 68, guaranteeYears: 0, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Milton Super Gold', rate: 75, guaranteeYears: 7, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Signature Gold', rate: 96, guaranteeYears: 10, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Oxford', rate: 68, guaranteeYears: 0, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Century Club Prime', rate: 102, guaranteeYears: 15, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Signature Gold Club', rate: 106, guaranteeYears: 20, thicknessMm: 6 },

  // ---- Water Proof Ply / Block Board 12mm (Formats/Plywood and Door color.xlsm > 12 MM) ----
  { id: id(), category: 'block-board-12', name: 'Signature', rate: 88, guaranteeYears: 7, accentColor: LIGHT_GREEN_TINT, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Green OptimaG', rate: 91, guaranteeYears: 0, accentColor: LIGHT_GREEN_TINT, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Gattani', rate: 78, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Archpine', rate: 82, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Compact Gold', rate: 58, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Milton Super Pro', rate: 68, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Milton Super', rate: 75, guaranteeYears: 5, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Signature Gold', rate: 96, guaranteeYears: 10, accentColor: LIGHT_GREEN_TINT, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Geetanjali', rate: 65, guaranteeYears: 0, accentColor: LIGHT_GREEN_TINT, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Century Club Prime', rate: 107, guaranteeYears: 30, coverage: 'warranty', accentColor: LIGHT_GREEN_TINT, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Signature Gold Club', rate: 112, guaranteeYears: 20, accentColor: LIGHT_GREEN_TINT, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Century Sainik 710', rate: 77, guaranteeYears: 8, coverage: 'warranty', accentColor: LIGHT_GREEN_TINT, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Amron', rate: 48, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Grace Pro', rate: 54, guaranteeYears: 7, coverage: 'warranty', thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Assam Gold', rate: 36, guaranteeYears: 0, thicknessMm: 12 },

  // ---- Water Proof Block Board 19mm (Formats/Plywood and Door color.xlsm > 19 MM) ----
  { id: id(), category: 'block-board-19', name: 'Abhiyan', rate: 92, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Signature', rate: 118, guaranteeYears: 7, accentColor: GREEN_TINT, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Green OptimaG', rate: 119, guaranteeYears: 0, accentColor: GREEN_TINT, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Gattani', rate: 107, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Archpine', rate: 112, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Compact Gold', rate: 78, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Milton Super Pro', rate: 88, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Milton Super', rate: 98, guaranteeYears: 5, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Signature Gold', rate: 128, guaranteeYears: 10, accentColor: GREEN_TINT, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Silver Elite', rate: 112, guaranteeYears: 7, accentColor: GREEN_TINT, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Century Bond', rate: 138, guaranteeYears: 21, coverage: 'warranty', accentColor: GREEN_TINT, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Century Club Prime', rate: 153, guaranteeYears: 30, coverage: 'warranty', accentColor: GREEN_TINT, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Signature Gold Club', rate: 156, guaranteeYears: 20, accentColor: GREEN_TINT, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Geetanjali', rate: 90, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Gold Pine', rate: 80, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Century Sainik 710', rate: 115, guaranteeYears: 8, coverage: 'warranty', accentColor: GREEN_TINT, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'KPI', rate: 102, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'SSP Club', rate: 90, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Amron', rate: 63, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Grace Pro', rate: 68, guaranteeYears: 7, coverage: 'warranty', thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Assam Gold', rate: 49, guaranteeYears: 0, thicknessMm: 19 },

  // ---- Film Face Ply (Latest/12mm FF Ply Rate.xlsm) — sold by 8'x4' sheet ----
  { id: id(), category: 'film-face-ply', name: 'FF Red 24 Kg', rate: 41.25, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'film-face-ply', name: 'FF Red 30 Kg', rate: 52, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'film-face-ply', name: 'FF Red 32 Kg', rate: 67.5, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'film-face-ply', name: 'FF Signature Red 32 Kg', rate: 70, guaranteeYears: 0, accentColor: GREEN_TINT, thicknessMm: 12 },

  // Aluminium (door / 2-track / 3-track) is calculated in lib/aluminium.ts
  // UPVC (windows / door) is calculated in lib/upvc.ts
]

/** Default price sets - C1 holds the seed brands above. */
export const SEED_SETS: BrandSet[] = [{ id: 'set-a', name: 'C1', brands: SEED_BRANDS }]

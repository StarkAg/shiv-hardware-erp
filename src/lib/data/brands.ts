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
  { id: id(), category: 'readymade-door', name: 'Arya 3D Lamination', rate: 160, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'Arya Sunmica', rate: 248, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor 3D Lamination', rate: 190, guaranteeYears: 7, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor Sunmica', rate: 288, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor Sunmica PM', rate: 329, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor Melamine', rate: 245, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor Melamine PM', rate: 445, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor WPC Door', rate: 320, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'readymade-door', name: 'DDoor Meranti Wooden', rate: 440, guaranteeYears: 10, thicknessMm: 30 },

  // ---- Flush Door / Plain (sheet: Plain) ----
  { id: id(), category: 'flush-door', name: 'Greenply', rate: 190, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Arch Pine', rate: 140, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Gattani', rate: 165, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Signature Gold', rate: 195, guaranteeYears: 10, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Signature', rate: 172, guaranteeYears: 7, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Mayura Gold', rate: 148, guaranteeYears: 5, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Monark', rate: 90, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Abhiyan', rate: 145, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Natural', rate: 110, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Century Club Prime', rate: 199, guaranteeYears: 15, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Signature Gold Club', rate: 208, guaranteeYears: 20, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Addwell', rate: 115, guaranteeYears: 0, thicknessMm: 30 },
  { id: id(), category: 'flush-door', name: 'Geetanjali', rate: 120, guaranteeYears: 0, thicknessMm: 30 },

  // ---- Water Proof Plywood 6mm (sheet: 6 MM) ----
  { id: id(), category: 'plywood-6', name: 'Signature', rate: 88, guaranteeYears: 0, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Green OptimaG', rate: 91, guaranteeYears: 0, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Gattani', rate: 78, guaranteeYears: 0, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Archpine', rate: 80, guaranteeYears: 0, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Compact Gold', rate: 58, guaranteeYears: 0, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Milton Super/HS', rate: 68, guaranteeYears: 0, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Milton Super Gold', rate: 75, guaranteeYears: 7, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Signature Gold', rate: 96, guaranteeYears: 10, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Oxford', rate: 78, guaranteeYears: 0, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Century Club Prime', rate: 102, guaranteeYears: 15, thicknessMm: 6 },
  { id: id(), category: 'plywood-6', name: 'Signature Gold Club', rate: 106, guaranteeYears: 20, thicknessMm: 6 },

  // ---- Water Proof Block Board 12mm (sheet: 12 MM) ----
  { id: id(), category: 'block-board-12', name: 'Signature', rate: 88, guaranteeYears: 7, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Green OptimaG', rate: 91, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Gattani', rate: 78, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Archpine', rate: 80, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Compact Gold', rate: 58, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Milton Super/HS', rate: 68, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Milton Super Gold', rate: 75, guaranteeYears: 5, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Signature Gold', rate: 96, guaranteeYears: 10, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Oxford', rate: 78, guaranteeYears: 0, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Century Club Prime', rate: 102, guaranteeYears: 15, thicknessMm: 12 },
  { id: id(), category: 'block-board-12', name: 'Signature Gold Club', rate: 106, guaranteeYears: 20, thicknessMm: 12 },

  // ---- Water Proof Block Board 19mm (sheet: 19 MM) ----
  { id: id(), category: 'block-board-19', name: 'Abhiyan', rate: 92, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Signature', rate: 118, guaranteeYears: 7, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Green OptimaG', rate: 119, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Gattani', rate: 106, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Archpine', rate: 108, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Compact Gold', rate: 78, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Milton Super/HS', rate: 88, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Milton Super Gold', rate: 98, guaranteeYears: 5, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Signature Gold', rate: 128, guaranteeYears: 10, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Oxford', rate: 106, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Century Bond', rate: 132, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Century Club Prime', rate: 146, guaranteeYears: 15, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Signature Gold Club', rate: 149, guaranteeYears: 20, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Geetanjali', rate: 86, guaranteeYears: 0, thicknessMm: 19 },
  { id: id(), category: 'block-board-19', name: 'Gold Pine', rate: 85, guaranteeYears: 0, thicknessMm: 19 },

  // Aluminium (door / 2-track / 3-track) is fully calculated in lib/aluminium.ts
  // — per-thickness rates, slab area rates, chaukhat & add-ons — not brand-based.
]

/** Default price sets — C1 holds the seed brands above. */
export const SEED_SETS: BrandSet[] = [{ id: 'set-a', name: 'C1', brands: SEED_BRANDS }]

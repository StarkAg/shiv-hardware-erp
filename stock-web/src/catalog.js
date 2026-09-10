// The shape of the billing app's catalog, mirrored from src/lib/types.ts.
// This panel edits the same single-row snapshot the panel writes, so the labels
// and the key names have to agree with it exactly — a category renamed here
// would simply stop matching the items already on the bills.

/** Categories priced per sqft, whose brands live in the rate sets. */
export const RATE_CATS = [
  'readymade-door',
  'flush-door',
  'plywood-6',
  'block-board-12',
  'block-board-19',
]

/** Hardware categories: sizes and brands, billed by the piece. */
export const HARDWARE_CATS = [
  'hinge', 'screw', 'aldrop', 'handle', 'tb', 'fevicol', 'mica', 'tape',
]

export const LABEL = {
  'readymade-door': 'Readymade Door',
  'flush-door': 'Flush Door',
  'plywood-6': 'Plywood 6mm',
  'block-board-12': 'Block Board 12mm',
  'block-board-19': 'Block Board 19mm',
  'film-face-ply': 'Film Face Ply',
  'aluminium-door': 'Aluminium Door',
  'window-2-track': '2 Track Window',
  'window-3-track': '3 Track Window',
  'upvc-2-track': '2 Track UPVC',
  'upvc-2.5-track': '2.5 Track UPVC',
  'upvc-3-track': '3 Track UPVC',
  'upvc-door': 'UPVC Door',
  'wpc-door-frame': 'WPC Door Frame',
  hinge: 'Hinges',
  screw: 'Screw',
  aldrop: 'Aldrop',
  handle: 'Handle',
  tb: 'Tower Bolt',
  fevicol: 'Fevicol',
  mica: 'Mica',
  tape: 'Abro Tape',
}

/** Categories that are brands-only — a size chip would mean nothing on them. */
export const NO_SIZES = { fevicol: true }

/** The guarantee lengths the printed card can actually seal. */
export const GUARANTEE_YEARS = [0, 1, 3, 5, 7, 8, 10, 15, 20, 21, 25, 30]

export const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** Server rows carry Convex bookkeeping the save mutation will not take back. */
export function normalize(row) {
  return {
    hardwareCatalog: row?.hardwareCatalog ?? {},
    customCatalog: Array.isArray(row?.customCatalog) ? row.customCatalog : [],
    sets: Array.isArray(row?.sets) ? row.sets : [],
  }
}

/** Sets are named by position in the panel (C1, C2, …); keep that true here. */
export const codeSets = (sets) => sets.map((s, i) => ({ ...s, name: `C${i + 1}` }))

// A local opening copy of the supplied plywood and 30 mm door rows. It lets
// the inventory open and accept already-unlocked edits without a network.
const plywoodRows = [
  ['Signature', 6, '7x4', 5], ['Signature', 6, '8x4', 1],
  ['Signature', 12, '6x3', 3], ['Signature', 12, '6x4', 3], ['Signature Gold', 12, '6x4', 1],
  ['Signature', 12, '7x3', 5], ['Signature Gold', 12, '7x3', 1],
  ['Signature', 12, '7x4', 16], ['Signature Gold', 12, '7x4', 1], ['Signature', 12, '8x4', 5],
  ['Signature', 18, '7x3', 1], ['Signature', 18, '7x4', 1], ['Signature', 18, '8x4', 2],
  ['Signature', 19, '5x4', 1], ['Signature', 19, '6x3', 3], ['Signature Gold', 19, '6x3', 2],
  ['Signature', 19, '6x4', 1], ['Signature', 19, '7x4', 11], ['Signature Gold', 19, '7x4', 3],
  ['Signature', 19, '8x4', 6], ['Signature Gold', 19, '8x4', 2],
  ['Milton', 6, '6x4', 2], ['Milton', 6, '7x3', 2], ['Milton', 6, '7x4', 2], ['Milton', 6, '8x3.5', 1], ['Milton', 6, '8x4', 1],
  ['Milton', 12, '6x3', 7], ['Milton', 12, '7x4', 11], ['Milton', 12, '8x4', 4],
  ['Milton', 18, '5x4', 1], ['Milton', 18, '6x3', 1], ['Milton', 18, '7x4', 1], ['Milton', 18, '8x4', 1],
  ['Milton', 19, '6x3', 1], ['Milton', 19, '6x4', 5], ['Milton', 19, '7x4', 4], ['Milton', 19, '8x4', 1],
]

const rows = [
  ['door', 'Signature', 30, '78x28', 1], ['door', 'Signature Gold', 30, '78x30', 2],
  ['door', 'Signature', 30, '78x34', 4], ['door', 'Signature', 30, '78x36', 5],
  ['door', 'Signature', 30, '78x38', 14], ['door', 'Signature', 30, '78x40', 1],
  ['door', 'Signature', 30, '81x32', 1], ['door', 'Signature', 30, '81x34', 1],
  ['door', 'Signature', 30, '81x36', 7], ['door', 'Signature', 30, '81x38', 6],
  ['door', 'Signature', 30, '81x40', 4], ['door', 'Signature', 30, '81x42', 4],
  ['door', 'Signature', 30, '84x38', 1],
  ...plywoodRows.map(([brand, mm, size, stock]) => ['ply', brand, mm, size, stock]),
]

const key = brand => brand.toLowerCase().replace(' ', '-')

export const FALLBACK_ITEMS = rows.map(([category, brand, mm, size, stock]) => ({
  // This corrected row retains its original identity for saved counts and queued taps.
  ref: category === 'door' && brand === 'Signature Gold' && mm === 30 && size === '78x30'
    ? 'seed:door:signature:30:78x30' : `seed:${category}:${key(brand)}:${mm}:${size}`,
  name: `${mm}mm ${brand} ${size.replace('x', ' x ')}`,
  category,
  brand,
  mm,
  size,
  stock,
  min: 2,
  unit: 'Pc',
}))

export const BRAND_ORDER = ['Signature', 'Signature Gold', 'Milton', 'Fevicol']

export function stockBrands(items) {
  return [...new Set([...BRAND_ORDER, ...items.map(item => item.brand)])]
}

export function stockSubtitle(item) {
  return item.category === 'other' ? `${item.brand} · ${item.label || 'Pack'}` : `${item.brand} · ${item.mm}mm`
}

export function compareStock(a, b, sort) {
  const dimensions = (a.mm ?? 0) - (b.mm ?? 0)
  const name = a.name.localeCompare(b.name, undefined, { numeric: true })
  if (sort === 'stock') return a.stock - b.stock || name
  if (sort === 'thickness') return dimensions || name
  const rank = brand => { const index = BRAND_ORDER.indexOf(brand); return index < 0 ? BRAND_ORDER.length : index }
  return rank(a.brand) - rank(b.brand) || a.brand.localeCompare(b.brand) || dimensions || name
}
const seedByRef = new Map(FALLBACK_ITEMS.map(item => [item.ref, item]))

/** Convex owns the live quantities; this adds the fixed display identity back. */
export function hydrateStockItems(items) {
  return items.map(item => {
    const seed = seedByRef.get(item.ref)
    return seed ? { ...seed, ...item, name: seed.name, brand: seed.brand, mm: seed.mm, size: seed.size, min: item.min ?? seed.min } : item
  })
}

export function matchesStockSearch(item, input) {
  const query = input.trim().toLowerCase()
  if (!query) return true
  const words = query.split(/\s+/).filter(Boolean)
  const aliases = { s: 'Signature', sg: 'Signature Gold', ms: 'Milton' }
  const chosenBrand = aliases[words[0]]
  if (chosenBrand && item.brand !== chosenBrand) return false
  const rest = chosenBrand ? words.slice(1) : words
  const haystack = `${item.name} ${item.brand}`.toLowerCase().replace(/\s*x\s*/g, 'x')
  return rest.every(word => haystack.includes(word.replace(/\s*x\s*/g, 'x')))
}

/**
 * Reading a sheet's size out of the name it was billed under.
 *
 * Plywood, block board and flush doors are written at the counter the way the
 * shop says them — "19mm Solid Black Tiger 8 X 4", "30mm S 81 X 38" — and
 * priced by the piece. The shop thinks about them by the square foot, though,
 * and a per-piece figure on its own cannot be compared across sizes. So the
 * name is read for the two things that make it a sheet:
 *
 *   - a thickness in millimetres, 3mm or more (below that it is a laminate,
 *     which is sold by the sheet and never by area);
 *   - a size, height X width.
 *
 * A size of 12 or less on both sides is in feet — 8 X 4, 7 X 4, 6 X 3. Anything
 * larger is in inches — 78 X 36, 81 X 30 — and may carry eighths the way doors
 * are measured, 77 4/8 X 37 5/8. Feet multiply straight to square feet; inches
 * are divided by 144.
 */

export interface BoardSize {
  thicknessMm: number
  height: number
  width: number
  unit: 'ft' | 'in'
  /** Area of one piece in square feet, to 2 places. */
  sqft: number
  /** The same area unrounded, for dividing a price by. */
  exactSqft: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

// 19mm, 19 mm, 0.8mm — the thickness is filtered after matching.
const THICKNESS = /(\d+(?:\.\d+)?)\s*mm\b/i

// 8 X 4, 8x4, 8'×4', 81 X 38, 77 4/8 x 37 5/8, 84"*48"
const NUM = String.raw`(\d+(?:\.\d+)?)(?:\s+(\d+)\s*\/\s*(\d+))?`
const SIZE = new RegExp(String.raw`(?:^|[^\d.])${NUM}\s*['"]?\s*[x×*]\s*${NUM}\s*['"]?(?![\d])`, 'i')

function measure(whole?: string, num?: string, den?: string): number {
  const base = Number(whole)
  if (!num || !den || !Number(den)) return base
  return base + Number(num) / Number(den)
}

export function readBoardSize(description: string | undefined | null): BoardSize | null {
  const text = String(description ?? '')
  const thick = text.match(THICKNESS)
  if (!thick) return null
  const thicknessMm = Number(thick[1])
  if (!(thicknessMm >= 3)) return null

  // The size is looked for with the thickness taken out, so "19mm 8x4" never
  // reads the 19 as half of a size.
  const rest = text.slice(0, thick.index) + ' ' + text.slice((thick.index ?? 0) + thick[0].length)
  const m = rest.match(SIZE)
  if (!m) return null
  const height = measure(m[1], m[2], m[3])
  const width = measure(m[4], m[5], m[6])
  if (!(height > 0) || !(width > 0)) return null

  const unit = height <= 12 && width <= 12 ? 'ft' : 'in'
  const exactSqft = unit === 'ft' ? height * width : (height * width) / 144
  return { thicknessMm, height, width, unit, sqft: round2(exactSqft), exactSqft }
}

/** "8×4 ft", "81×38 in" — how the size is said back on the bill row. */
export function sizeLabel(size: BoardSize): string {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(round2(n)))
  return `${fmt(size.height)}×${fmt(size.width)} ${size.unit}`
}

/**
 * The per-square-foot figures a bill line should carry, or `undefined` for both
 * when the line is not a sheet or has nothing to divide.
 *
 * Worked from the amount rather than the typed rate, because a line can be
 * priced either way and the amount is the one figure every line has.
 */
export function sqftFields(item: { description?: string; qty?: number; amount?: number }): {
  sqft: number | undefined
  sqftRate: number | undefined
} {
  const size = readBoardSize(item.description)
  if (!size || !size.sqft) return { sqft: undefined, sqftRate: undefined }
  const qty = Number(item.qty) || 0
  const amount = Number(item.amount) || 0
  const sqftRate = qty > 0 && amount > 0 ? round2(amount / qty / size.exactSqft) : undefined
  return { sqft: size.sqft, sqftRate }
}

/**
 * The line with its square-foot figures brought up to date. They are dropped
 * outright, not left as `undefined`, when the line stops being a sheet — so a
 * renamed line does not keep an area it no longer has.
 */
export function withSqft<T extends { description?: string; qty?: number; amount?: number; sqft?: number; sqftRate?: number }>(item: T): T {
  const { sqft, sqftRate } = sqftFields(item)
  if (item.sqft === sqft && item.sqftRate === sqftRate) return item
  const next = { ...item }
  if (sqft === undefined) delete next.sqft
  else next.sqft = sqft
  if (sqftRate === undefined) delete next.sqftRate
  else next.sqftRate = sqftRate
  return next
}

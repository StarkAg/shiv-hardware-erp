import { ConvexError, v } from 'convex/values'
import { properItem } from './text'

/**
 * A work order made on the app (Workshop Counter), as the pink pad prints it:
 * the lines of the estimate, each with its pieces and cost and, for a piece
 * that is built, its size, which draws it in the bottom half. Kept on the
 * work order's message, so the workshop's phone draws its yellow copy itself
 * and the counter can print all three copies again.
 *
 * Sizes are inches and soot (eighths), as the shop writes them.
 */
const size = v.object({ inches: v.number(), soot: v.number() })

export const padLine = v.object({
  id: v.string(),
  // What is built (ventilator, 1 or 2 door window, aluminium door, ACP wall)
  // and what goes in it; or a loose item (`extra`) such as liping.
  form: v.string(),
  fill: v.optional(v.string()),
  extra: v.optional(v.boolean()),
  label: v.string(),
  unit: v.optional(v.string()),
  qty: v.number(),
  rate: v.number(),
  amount: v.number(),
  w: v.optional(size),
  h: v.optional(size),
})

export const workPad = v.object({
  orderDate: v.string(),
  deliveryDate: v.optional(v.string()),
  fare: v.number(),
  advance: v.number(),
  lines: v.array(padLine),
})

type Size = { inches: number; soot: number }
type Line = typeof padLine.type
export type WorkPad = typeof workPad.type

const MAX_LINES = 30
const money = (n: number) => Math.max(0, Math.min(10_000_000, Math.round(Number(n) || 0)))
const text = (s: string | undefined, max: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const day = (s: string | undefined) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '')) ? String(s) : '')
const sizeOf = (d: Size | undefined) => {
  if (!d) return undefined
  const inches = Math.max(0, Math.min(1200, Math.floor(Number(d.inches) || 0)))
  const soot = Math.max(0, Math.min(7, Math.floor(Number(d.soot) || 0)))
  return inches || soot ? { inches, soot } : undefined
}

/** The pad as it is kept: figures whole and in range, words trimmed, at least one line. */
export function cleanPad(pad: WorkPad): WorkPad {
  const lines: Line[] = pad.lines.slice(0, MAX_LINES).map((l, i) => {
    const qty = Math.max(0, Math.min(9999, Math.round((Number(l.qty) || 0) * 100) / 100))
    const w = l.extra ? undefined : sizeOf(l.w)
    const h = l.extra ? undefined : sizeOf(l.h)
    return {
      id: text(l.id, 40) || `l${i}`,
      form: text(l.form, 40),
      ...(l.fill ? { fill: text(l.fill, 40) } : {}),
      ...(l.extra ? { extra: true } : {}),
      label: text(l.label, 80),
      ...(l.unit ? { unit: text(l.unit, 8) } : {}),
      qty,
      rate: money(l.rate),
      amount: money(l.amount),
      ...(w && h ? { w, h } : {}),
    }
  }).filter((l) => l.label && l.qty > 0)
  if (!lines.length) throw new ConvexError('Add at least one item to the work order.')
  const orderDate = day(pad.orderDate)
  if (!orderDate) throw new ConvexError('Give the order date.')
  const deliveryDate = day(pad.deliveryDate)
  return { orderDate, ...(deliveryDate ? { deliveryDate } : {}), fare: money(pad.fare), advance: money(pad.advance), lines }
}

/** The pieces the workshop is to make: every built line's count, loose items left out. */
export const piecesOf = (pad: WorkPad) =>
  Math.round(pad.lines.filter((l) => !l.extra).reduce((t, l) => t + l.qty, 0))

/**
 * A visit order made on the app (Workshop Counter): the slip the counter
 * writes on the shop's letterhead, typed instead. The date, what the
 * customer wants (each item as the shop writes it, with how many) and the
 * advance taken, if any. The letterhead is printed with it on plain A4.
 * `id` is the phone's own, so a slip sent twice over a bad line is one job.
 */
export const slipLine = v.object({ id: v.string(), text: v.string(), qty: v.number(), unit: v.optional(v.string()) })
export const visitSlip = v.object({
  id: v.string(),
  date: v.string(),
  lines: v.array(slipLine),
  advance: v.number(),
})
export type VisitSlip = typeof visitSlip.type

/** The slip as it is kept: words trimmed, figures in range. */
export function cleanSlip(slip: VisitSlip): VisitSlip {
  const lines = slip.lines.slice(0, MAX_LINES).map((l, i) => ({
    id: text(l.id, 40) || `l${i}`,
    // Written to the shop's rule for goods: "flush door" is "Flush Door", "1 inch wpc" keeps WPC.
    text: text(properItem(l.text), 120),
    qty: Math.max(0, Math.min(9999, Math.round((Number(l.qty) || 0) * 100) / 100)),
    ...(l.unit ? { unit: text(l.unit, 8) } : {}),
  })).filter((l) => l.text)
  // No items is a slip too: a visit to measure, the advance taken (Amarjeet Kumar Jee, 13 Nov 2026).
  return { id: text(slip.id, 40), date: day(slip.date) || new Date().toISOString().slice(0, 10), lines, advance: money(slip.advance) }
}

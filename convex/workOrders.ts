import { ConvexError, v } from 'convex/values'
import { mutation, query } from './lib/guarded'
import { readBill, readBills, writeBills } from './lib/billRows'
import { record } from './lib/history'
import { workPieces } from './lib/workPieces'

/**
 * Work orders, as the mechanic's phone sees them (the Shiv Mechanic app).
 *
 * An order is a quotation or a sale with "Order" switched on, open until it
 * is billed. The mechanic gets who to go to and what to measure — never a
 * price, a total or what the customer owes — and sends back a width and a
 * height for each piece. That write is the one thing the app changes on a
 * bill: its sizes, and that it has been measured.
 *
 * Trusted devices only, like the panel: the shop PIN once on the phone.
 */

const isOpenOrder = (b: any) =>
  !!b?.workOrder && !b.workDoneAt && ((b.kind ?? 'sale') === 'sale' || b.kind === 'quotation')

/** Every open order, without its money. The phone shows the ones in its mechanic's name. */
export const open = query({
  args: {},
  handler: async (ctx) => {
    const bills = await readBills(ctx)
    return bills
      .filter(isOpenOrder)
      .map((b: any) => ({
        id: String(b.id),
        number: String(b.number ?? ''),
        quotation: b.kind === 'quotation',
        date: String(b.date ?? ''),
        customerName: String(b.customerName ?? ''),
        customerPhone: String(b.customerPhone ?? ''),
        site: String(b.ref ?? ''),
        notes: String(b.notes ?? ''),
        visitBy: String(b.visitBy ?? ''),
        measuredAt: Number(b.measuredAt) || 0,
        pieces: workPieces(b.items),
        sizes: b.siteSizes ?? null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  },
})

const piece = v.object({
  key: v.string(),
  what: v.string(),
  w: v.string(),
  h: v.string(),
  note: v.optional(v.string()),
})

/**
 * The sizes from the site. `measured` says the visit is done, which moves the
 * order to Measured on the shop's Work list; without it the sizes are kept
 * and the order stays To measure (half the pieces today, the rest tomorrow).
 */
export const saveSizes = mutation({
  args: {
    billId: v.string(),
    by: v.string(),
    unit: v.union(v.literal('in'), v.literal('mm'), v.literal('ft')),
    pieces: v.array(piece),
    notes: v.optional(v.string()),
    measured: v.boolean(),
    baseAt: v.number(),
  },
  handler: async (ctx, { billId, by, unit, pieces, notes, measured, baseAt }) => {
    const bill = await readBill(ctx, billId)
    if (!bill || !bill.workOrder) throw new ConvexError({ code: 'gone', message: 'This order is no longer on the work list.' })
    if (bill.workDoneAt) throw new ConvexError({ code: 'billed', message: 'This order has already been billed.' })
    if (!isOpenOrder(bill)) throw new ConvexError({ code: 'gone', message: 'This order is no longer on the work list.' })
    if (baseAt !== (bill.siteSizes?.at ?? 0)) throw new ConvexError({ code: 'conflict', message: 'Newer sizes were sent from another device. Load them before saving again.' })
    if (!by.trim()) throw new ConvexError({ code: 'name', message: 'Choose your name first.' })
    if (pieces.length > 200) throw new ConvexError({ code: 'long', message: 'Too many pieces for one order.' })
    const clip = (s: string, n: number) => s.trim().slice(0, n)
    const kept = pieces
      .map((p) => ({ key: clip(p.key, 80), what: clip(p.what, 160), w: clip(p.w, 24), h: clip(p.h, 24), note: clip(p.note ?? '', 160) }))
      .filter((p) => p.key && (p.w || p.h || p.note))
      .map(({ note, ...p }) => (note ? { ...p, note } : p))
    if (new Set(kept.map((p) => p.key)).size !== kept.length) throw new ConvexError({ code: 'duplicate', message: 'Each piece must have its own row.' })
    const now = Math.max(Date.now(), baseAt + 1)
    const updated = {
      ...bill,
      siteSizes: { at: now, by: clip(by, 60), unit, pieces: kept, ...(clip(notes ?? '', 600) ? { notes: clip(notes ?? '', 600) } : {}) },
      // Sent as measured: stamped once, so "how long ago" does not move when a size is corrected.
      ...(measured ? { measuredAt: bill.measuredAt || now } : {}),
      updatedAt: now,
    }
    await writeBills(ctx, [updated])
    if (measured && !bill.measuredAt) {
      await record(ctx, 'workorder.measured', `${clip(by, 60) || 'A mechanic'} sent the sizes for order ${bill.number} (${bill.customerName ?? ''})`,
        { entity: 'bill', entityId: billId })
    }
    return { pieces: kept.length, measuredAt: updated.measuredAt ?? 0, at: now }
  },
})

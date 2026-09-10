import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

/**
 * Soft locks on bills, so two counters don't type into the same one.
 *
 * A lock is a claim with a heartbeat, not a reservation: if a device closes the
 * tab, loses power or drops off the network, its lock simply stops being
 * refreshed and expires. Nothing can end up locked forever, which is the failure
 * mode that would actually stop the shop billing.
 */
const TTL = 30_000   // a lock older than this is treated as abandoned

export const claim = mutation({
  args: { billId: v.string(), deviceId: v.string(), deviceName: v.string() },
  handler: async (ctx, { billId, deviceId, deviceName }) => {
    const now = Date.now()
    const existing = await ctx.db
      .query('billLocks')
      .withIndex('by_bill', (q) => q.eq('billId', billId))
      .first()

    if (existing && existing.deviceId !== deviceId && now - existing.heldAt < TTL) {
      return { ok: false, heldBy: existing.deviceName }
    }
    if (existing) await ctx.db.patch(existing._id, { deviceId, deviceName, heldAt: now })
    else await ctx.db.insert('billLocks', { billId, deviceId, deviceName, heldAt: now })
    return { ok: true, heldBy: deviceName }
  },
})

export const release = mutation({
  args: { billId: v.string(), deviceId: v.string() },
  handler: async (ctx, { billId, deviceId }) => {
    const existing = await ctx.db
      .query('billLocks')
      .withIndex('by_bill', (q) => q.eq('billId', billId))
      .first()
    // Only the holder may release, so a second device can't steal a live lock.
    if (existing && existing.deviceId === deviceId) await ctx.db.delete(existing._id)
  },
})

/** Live view of who holds what, for the bill list and the editor. */
export const active = query({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - TTL
    const all = await ctx.db.query('billLocks').collect()
    return all.filter((l) => l.heldAt >= cutoff)
  },
})

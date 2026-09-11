import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

/**
 * Replace the single-row catalog snapshot. Creates the row if it doesn't exist yet.
 *
 * With one exception: an empty catalogue never replaces a full one. The panel
 * pushes whatever the device holds a few seconds after it loads, so a browser
 * that has never synced — a new PC, cleared site data, a phone opening the
 * panel for the first time — would hand over its empty list and take the
 * shop's rates and sets down with it. That is how the bills were lost twice.
 * The catalogue is edited as a whole, so this cannot merge; it can refuse.
 */
export const save = mutation({
  args: {
    hardwareCatalog: v.any(),
    customCatalog:   v.array(v.any()),
    sets:            v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('catalogStore').first()
    const size = (c: {
      hardwareCatalog?: unknown
      customCatalog?: unknown[]
      sets?: unknown[]
    }) => Object.keys((c.hardwareCatalog as object) ?? {}).length
      + (c.customCatalog?.length ?? 0)
      + (c.sets?.length ?? 0)

    if (existing && size(args) === 0 && size(existing) > 0) {
      return { ignored: true as const, reason: 'An empty catalogue does not replace a full one.' }
    }

    const data = { ...args, savedAt: Date.now() }
    if (existing) await ctx.db.patch(existing._id, data)
    else          await ctx.db.insert('catalogStore', data)
    return { ignored: false as const }
  },
})

/** Return the single catalog snapshot row (or null if nothing saved yet). */
export const get = query({
  args: {},
  handler: async (ctx) => ctx.db.query('catalogStore').first(),
})

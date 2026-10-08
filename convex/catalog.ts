import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { canonicalUnit, foldName, properItem } from './lib/text'

/**
 * My Items and the hardware catalogue in the shop's writing: item names in
 * the shop's spelling and proper case with codes in capitals, and one
 * spelling per unit. Applied on the way in, so a device holding an old copy
 * cannot push "set" back over "Set" or "Abbro" back over "Abro".
 *
 * Two entries that come out with the same name are one item — "Abro Tape"
 * and "Abbro Tape" — and are merged: the first keeps its id, rate and unit,
 * takes the other's sizes, brands and fields, and `remap` says which id went
 * where so bill lines pointing at the removed one can follow.
 */
const union = <T,>(a?: T[], b?: T[]) => Array.from(new Set([...(a ?? []), ...(b ?? [])]))

function mergeFields(a?: any[], b?: any[]) {
  const out = (a ?? []).map((f) => ({ ...f, values: [...(f.values ?? [])] }))
  for (const f of b ?? []) {
    const same = out.find((o) => foldName(o.label) === foldName(f.label))
    if (same) same.values = union(same.values, f.values)
    else out.push({ ...f, values: [...(f.values ?? [])] })
  }
  return out
}

export function tidyCatalog(args: { hardwareCatalog: any; customCatalog: any[]; sets: any[] }) {
  const renamed = (args.customCatalog ?? []).map((e: any) => {
    if (!e || typeof e !== 'object') return e
    const out = { ...e }
    if (typeof e.name === 'string') out.name = properItem(e.name)
    if (typeof e.unit === 'string' && e.unit) out.unit = canonicalUnit(e.unit)
    return out
  })

  const customCatalog: any[] = []
  const at = new Map<string, number>()
  const remap: Record<string, string> = {}
  for (const e of renamed) {
    const key = e && typeof e === 'object' && typeof e.name === 'string' ? foldName(e.name) : ''
    const i = key ? at.get(key) : undefined
    if (i === undefined) {
      if (key) at.set(key, customCatalog.length)
      customCatalog.push(e)
      continue
    }
    const into = customCatalog[i]
    customCatalog[i] = {
      ...into,
      sizes: union(into.sizes, e.sizes),
      brands: union(into.brands, e.brands),
      ...(into.fields || e.fields ? { fields: mergeFields(into.fields, e.fields) } : {}),
      ...(into.rates || e.rates ? { rates: union(into.rates, e.rates) } : {}),
      rate: into.rate ?? e.rate,
      unit: into.unit ?? e.unit,
    }
    if (customCatalog[i].rate === undefined) delete customCatalog[i].rate
    if (customCatalog[i].unit === undefined) delete customCatalog[i].unit
    if (e.id && into.id) remap[e.id] = into.id
  }

  const hardwareCatalog: Record<string, any> = {}
  for (const [key, entry] of Object.entries(args.hardwareCatalog ?? {})) {
    const e = entry as any
    hardwareCatalog[key] = e && typeof e === 'object' && typeof e.unit === 'string' && e.unit
      ? { ...e, unit: canonicalUnit(e.unit) }
      : e
  }
  return { hardwareCatalog, customCatalog, sets: args.sets, remap }
}

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
    /**
     * The version this list was edited from. If the server has moved on, the
     * save is refused and the device replays its own change onto the newer
     * list (src/lib/catalogMerge.ts) — rather than an old copy putting old
     * rates back and dropping items added on another counter. A device that
     * does not say which version it had is refused too.
     */
    baseVersion: v.optional(v.number()),
  },
  handler: async (ctx, { baseVersion, ...args }) => {
    const existing = await ctx.db.query('catalogStore').first()
    const version = existing?.version ?? 0
    if (existing && baseVersion !== version) {
      return { ignored: true as const, conflict: true as const, version, reason: 'The price list changed on another device.' }
    }
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

    const tidy = tidyCatalog(args)
    const data = {
      hardwareCatalog: tidy.hardwareCatalog,
      customCatalog: tidy.customCatalog,
      sets: tidy.sets,
      savedAt: Date.now(),
      version: version + 1,
    }
    if (existing) await ctx.db.patch(existing._id, data)
    else          await ctx.db.insert('catalogStore', data)
    return { ignored: false as const, version: version + 1 }
  },
})

/** Return the single catalog snapshot row (or null if nothing saved yet). */
export const get = query({
  args: {},
  handler: async (ctx) => ctx.db.query('catalogStore').first(),
})

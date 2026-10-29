import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import type { Id, TableNames } from './_generated/dataModel'

/**
 * Re-pointing stored photos at smaller copies of themselves.
 *
 * The bill photos were stored as camera JPEGs; the same pictures saved as
 * WebP at the same size are well under half as large and look the same. The
 * copies are made off the server (scripts/compress-photos.py) and uploaded,
 * then `apply` swaps every reference from the old file to its copy, table by
 * table, a page at a time. Only once `references` finds no old file still in
 * use does `remove` delete them — and it refuses any file still referenced.
 *
 * Internal only: run from the CLI with `npx convex run --prod`.
 */

/** Every table that holds a photo, found by scanning the data, not the schema. */
const TABLES = [
  'vouchers', 'bills', 'billFlows', 'trash', 'workshopJobs',
  'billsTrash', 'voucherInbox', 'guaranteeClaims',
] as const satisfies readonly TableNames[]

const pair = v.object({ from: v.id('_storage'), to: v.id('_storage') })

/** The value with every old file id replaced, and whether anything changed. */
function swapIn(value: unknown, map: Map<string, string>): [unknown, boolean] {
  if (typeof value === 'string') {
    const to = map.get(value)
    return to ? [to, true] : [value, false]
  }
  if (Array.isArray(value)) {
    let changed = false
    const out = value.map((x) => {
      const [y, c] = swapIn(x, map)
      changed ||= c
      return y
    })
    return [out, changed]
  }
  if (value && typeof value === 'object') {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(value)) {
      const [y, c] = swapIn(x, map)
      changed ||= c
      out[k] = y
    }
    return [out, changed]
  }
  return [value, false]
}

/** Upload links for the copies. */
export const uploadUrls = internalMutation({
  args: { count: v.number() },
  handler: async (ctx, { count }) => {
    const urls: string[] = []
    for (let i = 0; i < Math.min(count, 100); i++) urls.push(await ctx.storage.generateUploadUrl())
    return urls
  },
})

/**
 * One page of one table, swapped. A bill that changes is stamped as just
 * edited, so a counter holding an older copy of it takes the server's rather
 * than sending the old file ids back (bills.save keeps the newer copy).
 */
export const apply = internalMutation({
  args: {
    table: v.union(...TABLES.map((t) => v.literal(t))),
    pairs: v.array(pair),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { table, pairs, cursor }) => {
    const map = new Map(pairs.map((p) => [p.from as string, p.to as string]))
    const page = await ctx.db.query(table).paginate({ cursor, numItems: 100 })
    let changed = 0
    const now = Date.now()
    for (const doc of page.page) {
      const { _id, _creationTime, ...fields } = doc as Record<string, unknown> & { _id: Id<typeof table> }
      const [next, did] = swapIn(fields, map)
      if (!did) continue
      const patch = next as Record<string, unknown>
      if (table === 'bills') {
        patch.updatedAt = now
        patch.bill = { ...(patch.bill as object), updatedAt: now }
      }
      await ctx.db.replace(_id, patch as never)
      changed++
    }
    return { changed, cursor: page.continueCursor, done: page.isDone }
  },
})

/** How many references each of these files still has, across every photo table. */
export const references = internalQuery({
  args: { ids: v.array(v.id('_storage')), table: v.union(...TABLES.map((t) => v.literal(t))) },
  handler: async (ctx, { ids, table }) => {
    const want = new Set<string>(ids)
    let found = 0
    const walk = (x: unknown) => {
      if (typeof x === 'string') { if (want.has(x)) found++ }
      else if (Array.isArray(x)) x.forEach(walk)
      else if (x && typeof x === 'object') Object.values(x).forEach(walk)
    }
    for await (const doc of ctx.db.query(table)) walk(doc)
    return found
  },
})

/** Deletes old files, after checking every photo table holds none of them. */
export const remove = internalMutation({
  args: { ids: v.array(v.id('_storage')) },
  handler: async (ctx, { ids }) => {
    const want = new Set<string>(ids)
    const held = new Set<string>()
    const walk = (x: unknown) => {
      if (typeof x === 'string') { if (want.has(x)) held.add(x) }
      else if (Array.isArray(x)) x.forEach(walk)
      else if (x && typeof x === 'object') Object.values(x).forEach(walk)
    }
    for (const table of TABLES) for await (const doc of ctx.db.query(table)) walk(doc)
    if (held.size) throw new Error(`${held.size} of these files are still in use, e.g. ${[...held][0]}`)
    for (const id of ids) await ctx.storage.delete(id)
    return { deleted: ids.length }
  },
})

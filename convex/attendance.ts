import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

const DEFAULT_STAFF = ['Vijay', 'Anup', 'Sonu', 'Anand', 'Vicky', 'Dharmendra']

// ── Staff list ──────────────────────────────────────────────────────────────
export const getStaff = query({
  args: {},
  handler: async (ctx) => {
    const meta = await ctx.db.query('attendanceMeta').first()
    return meta?.staff ?? DEFAULT_STAFF
  },
})

export const setStaff = mutation({
  args: { staff: v.array(v.string()) },
  handler: async (ctx, { staff }) => {
    const meta = await ctx.db.query('attendanceMeta').first()
    if (meta) await ctx.db.patch(meta._id, { staff, updatedAt: Date.now() })
    else await ctx.db.insert('attendanceMeta', { staff, updatedAt: Date.now() })
  },
})

// ── Days ────────────────────────────────────────────────────────────────────
// Returns all day docs for a month, e.g. month = '2026-07'
export const getMonth = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const rows = await ctx.db
      .query('attendanceDays')
      .withIndex('by_date', (q) => q.gte('date', `${month}-01`).lte('date', `${month}-31`))
      .collect()
    return rows.map((r) => ({ date: r.date, marks: r.marks ?? {}, locked: r.locked === true }))
  },
})

// Lock a day (the "Save" action). Once locked, the UI requires the password to edit.
export const lockDay = mutation({
  args: { date: v.string(), marks: v.optional(v.any()) },
  handler: async (ctx, { date, marks }) => {
    const existing = await ctx.db
      .query('attendanceDays')
      .withIndex('by_date', (q) => q.eq('date', date))
      .unique()
    if (existing) {
      await ctx.db.patch(existing._id, {
        locked: true,
        ...(marks ? { marks } : {}),
        updatedAt: Date.now(),
      })
    } else {
      await ctx.db.insert('attendanceDays', { date, marks: marks ?? {}, locked: true, updatedAt: Date.now() })
    }
  },
})

// Set (or clear) one person's status for one day.
export const setMark = mutation({
  args: {
    date: v.string(),
    staff: v.string(),
    status: v.string(), // 'P' | 'N' | 'H' | 'C' | '' (empty clears)
  },
  handler: async (ctx, { date, staff, status }) => {
    const existing = await ctx.db
      .query('attendanceDays')
      .withIndex('by_date', (q) => q.eq('date', date))
      .unique()
    const marks = { ...(existing?.marks ?? {}) } as Record<string, string>
    if (status) marks[staff] = status
    else delete marks[staff]
    if (existing) await ctx.db.patch(existing._id, { marks, updatedAt: Date.now() })
    else await ctx.db.insert('attendanceDays', { date, marks, updatedAt: Date.now() })
  },
})

// Mark every staff member for a day at once (e.g. "all present").
export const setDay = mutation({
  args: { date: v.string(), marks: v.any() },
  handler: async (ctx, { date, marks }) => {
    const existing = await ctx.db
      .query('attendanceDays')
      .withIndex('by_date', (q) => q.eq('date', date))
      .unique()
    if (existing) await ctx.db.patch(existing._id, { marks, updatedAt: Date.now() })
    else await ctx.db.insert('attendanceDays', { date, marks, updatedAt: Date.now() })
  },
})

// ── One-time seed from the paper register (idempotent: skips if data exists) ──
const SEED_MONTHS: Record<string, Record<string, string>> = {
  '2026-05': {
    Vijay: 'PPPPCPNNNPPCNPPPPPCPNPPPPCPPNPN',
    Anup: 'PPPPCPPNNPPCNPPPPPCPNPPPPCPPPPN',
    Sonu: 'PPPPCPPPPPNCPPPNPPCPNPPPPCPPPPN',
    Anand: 'PPPPCPPPPPPCNNPPPPCPPPNNNCPPPPP',
    Vicky: 'PPPPCPPPPPPCNPPNPPCPPPPPPCPPPPP',
    Dharmendra: 'PPPPCPPPPNPCPPNPPPCPPPNPPCPNPPP',
  },
  '2026-06': {
    Vijay: 'PCPPNNNNCNPPPPPPPPPPPPCPPPPNNC',
    Anup: 'NCNNNNPPCPPPPPPPPPPPPPCPPPPPPC',
    Sonu: 'PCPPNPNPCNPPPHPPPPNNNNCPPPPNPC',
    Anand: 'PCPPNNPPCNPPPPPPPPPPPPCPPNPPPC',
    Vicky: 'PCPPPPPPCNNPPPPPPNPPPPCPPPPPNC',
    Dharmendra: 'PCPPPNPPCPPPPPPPPPNPPPCPPNPNNC',
  },
  '2026-07': {
    Vijay: 'NNNNN',
    Anup: 'PPPPP',
    Sonu: 'PNPPP',
    Anand: 'PPPPN',
    Vicky: 'NNNNP',
    Dharmendra: 'PPNPP',
  },
}

const pad = (n: number) => String(n).padStart(2, '0')

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const any = await ctx.db.query('attendanceDays').first()
    if (any) return { seeded: false } // already has data

    await ctx.db.insert('attendanceMeta', { staff: [...DEFAULT_STAFF], updatedAt: Date.now() })

    // Aggregate marks per date first, then insert one row per date.
    const byDate: Record<string, Record<string, string>> = {}
    for (const [mk, rows] of Object.entries(SEED_MONTHS)) {
      for (const [staff, str] of Object.entries(rows)) {
        const chars = str.replace(/\s/g, '')
        for (let day = 1; day <= chars.length; day++) {
          const ch = chars[day - 1]
          const st = ch === '½' || ch === 'H' ? 'H' : 'PNHC'.includes(ch) ? ch : null
          if (!st) continue
          const dk = `${mk}-${pad(day)}`
          ;(byDate[dk] ||= {})[staff] = st
        }
      }
    }
    for (const [date, marks] of Object.entries(byDate)) {
      await ctx.db.insert('attendanceDays', { date, marks, updatedAt: Date.now() })
    }
    return { seeded: true, days: Object.keys(byDate).length }
  },
})

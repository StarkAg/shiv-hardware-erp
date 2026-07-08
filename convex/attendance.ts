import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

const DEFAULT_STAFF = ['Vijay', 'Anup', 'Sonu', 'Anand', 'Vicky', 'Dharmendra']

type LogEntry = {
  date?: string
  action: string
  summary: string
  changes?: Array<{ staff: string; from: string; to: string }>
}
async function logChange(ctx: any, entry: LogEntry) {
  await ctx.db.insert('attendanceLog', { at: Date.now(), ...entry })
}
function diffMarks(before: Record<string, string>, after: Record<string, string>) {
  const changes: Array<{ staff: string; from: string; to: string }> = []
  const names = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const nm of names) {
    const f = before[nm] || ''
    const t = after[nm] || ''
    if (f !== t) changes.push({ staff: nm, from: f, to: t })
  }
  return changes
}

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
    const before = meta?.staff ?? DEFAULT_STAFF
    if (meta) await ctx.db.patch(meta._id, { staff, updatedAt: Date.now() })
    else await ctx.db.insert('attendanceMeta', { staff, updatedAt: Date.now() })
    const added = staff.filter((s) => !before.includes(s))
    const removed = before.filter((s) => !staff.includes(s))
    const parts: string[] = []
    if (added.length) parts.push(`Added ${added.join(', ')}`)
    if (removed.length) parts.push(`Removed ${removed.join(', ')}`)
    if (parts.length) await logChange(ctx, { action: 'staff', summary: parts.join(' · ') })
  },
})

// ── Per-staff daily wage rates ────────────────────────────────────────────────
export const getRates = query({
  args: {},
  handler: async (ctx) => {
    const meta = await ctx.db.query('attendanceMeta').first()
    return (meta?.rates ?? {}) as Record<string, number>
  },
})

export const setRate = mutation({
  args: { staff: v.string(), rate: v.number() },
  handler: async (ctx, { staff, rate }) => {
    const meta = await ctx.db.query('attendanceMeta').first()
    const rates = { ...((meta?.rates ?? {}) as Record<string, number>) }
    const prev = rates[staff] ?? 0
    rates[staff] = rate
    if (meta) await ctx.db.patch(meta._id, { rates, updatedAt: Date.now() })
    else await ctx.db.insert('attendanceMeta', { staff: [...DEFAULT_STAFF], rates, updatedAt: Date.now() })
    if (prev !== rate) {
      await logChange(ctx, { action: 'rate', summary: `${staff} daily rate: ₹${prev} → ₹${rate}` })
    }
  },
})

// ── Advances ──────────────────────────────────────────────────────────────────
export const getAdvances = query({
  args: { month: v.string() },
  handler: async (ctx, { month }) => {
    const rows = await ctx.db
      .query('attendanceAdvances')
      .withIndex('by_date', (q) => q.gte('date', `${month}-01`).lte('date', `${month}-31`))
      .collect()
    return rows.map((r) => ({ _id: r._id, staff: r.staff, date: r.date, amount: r.amount, note: r.note ?? '' }))
  },
})

export const addAdvance = mutation({
  args: { staff: v.string(), date: v.string(), amount: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, { staff, date, amount, note }) => {
    const id = await ctx.db.insert('attendanceAdvances', { staff, date, amount, note, at: Date.now() })
    await logChange(ctx, { date, action: 'advance', summary: `${staff}: advance ₹${amount}${note ? ` (${note})` : ''}` })
    return id
  },
})

export const removeAdvance = mutation({
  args: { id: v.id('attendanceAdvances') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    await ctx.db.delete(id)
    if (row) await logChange(ctx, { date: row.date, action: 'advance', summary: `${row.staff}: removed advance ₹${row.amount}` })
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
    const before = (existing?.marks ?? {}) as Record<string, string>
    if (existing) {
      await ctx.db.patch(existing._id, {
        locked: true,
        ...(marks ? { marks } : {}),
        updatedAt: Date.now(),
      })
    } else {
      await ctx.db.insert('attendanceDays', { date, marks: marks ?? {}, locked: true, updatedAt: Date.now() })
    }
    const changes = marks ? diffMarks(before, marks as Record<string, string>) : []
    await logChange(ctx, {
      date,
      action: 'lock',
      summary: 'Saved & locked the day',
      ...(changes.length ? { changes } : {}),
    })
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
    const prev = marks[staff] || ''
    if (status) marks[staff] = status
    else delete marks[staff]
    if (existing) await ctx.db.patch(existing._id, { marks, updatedAt: Date.now() })
    else await ctx.db.insert('attendanceDays', { date, marks, updatedAt: Date.now() })
    if (prev !== status) {
      await logChange(ctx, {
        date,
        action: 'mark',
        summary: `${staff}: ${prev || '—'} → ${status || '—'}`,
        changes: [{ staff, from: prev, to: status }],
      })
    }
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
    const before = (existing?.marks ?? {}) as Record<string, string>
    if (existing) await ctx.db.patch(existing._id, { marks, updatedAt: Date.now() })
    else await ctx.db.insert('attendanceDays', { date, marks, updatedAt: Date.now() })
    const changes = diffMarks(before, marks as Record<string, string>)
    if (changes.length) {
      await logChange(ctx, {
        date,
        action: 'bulk',
        summary: `Bulk update (${changes.length} ${changes.length === 1 ? 'change' : 'changes'})`,
        changes,
      })
    }
  },
})

// ── Change history (audit log) ────────────────────────────────────────────────
export const getLog = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query('attendanceLog')
      .withIndex('by_at')
      .order('desc')
      .take(limit ?? 100)
    return rows.map((r) => ({
      at: r.at,
      date: r.date ?? null,
      action: r.action,
      summary: r.summary,
      changes: r.changes ?? null,
    }))
  },
})

// ── Sample history seed (idempotent: skips if the log already has entries) ────
export const seedLog = mutation({
  args: {},
  handler: async (ctx) => {
    const any = await ctx.db.query('attendanceLog').first()
    if (any) return { seeded: false }

    const now = Date.now()
    const MIN = 60 * 1000
    const HR = 60 * MIN
    const today = new Date()
    const y = today.getFullYear()
    const m = today.getMonth() + 1
    const d = today.getDate()
    const dk = (day: number) => `${y}-${pad(m)}-${pad(day)}`

    const samples: Array<{ at: number; date?: string; action: string; summary: string; changes?: any }> = [
      { at: now - 5 * MIN, date: dk(d), action: 'mark', summary: 'Vijay: — → P', changes: [{ staff: 'Vijay', from: '', to: 'P' }] },
      { at: now - 22 * MIN, date: dk(d), action: 'bulk', summary: 'Bulk update (6 changes)', changes: [
        { staff: 'Vijay', from: '', to: 'P' }, { staff: 'Anup', from: '', to: 'P' }, { staff: 'Sonu', from: '', to: 'P' },
        { staff: 'Anand', from: '', to: 'P' }, { staff: 'Vicky', from: '', to: 'P' }, { staff: 'Dharmendra', from: '', to: 'P' },
      ] },
      { at: now - 3 * HR, date: dk(Math.max(1, d - 1)), action: 'lock', summary: 'Saved & locked the day' },
      { at: now - 26 * HR, date: dk(Math.max(1, d - 1)), action: 'mark', summary: 'Sonu: P → H', changes: [{ staff: 'Sonu', from: 'P', to: 'H' }] },
      { at: now - 50 * HR, action: 'staff', summary: 'Added Ramesh' },
    ]
    for (const s of samples) await ctx.db.insert('attendanceLog', s)
    return { seeded: true, entries: samples.length }
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

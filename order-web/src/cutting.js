// ── Cutting from 12 ft lengths ──────────────────────────────────────────────
//
// Aluminium does not arrive as windows. It arrives as 12 ft sections, and
// every frame on an order is cut out of those. The question the workshop
// actually has in the morning is not "what is on order 758" but "how many
// lengths do I pull off the rack, and where do I cut them".
//
// Nobody works that out on paper, because doing it properly means fitting
// forty-odd pieces into as few bars as possible, and by hand that turns into
// one piece per bar and a pile of offcuts. So it gets guessed, and the guess
// is always high — which is stock money sitting in a corner as two-foot ends.
//
// This does the fitting, and it spends the ends already in that corner before
// it opens anything new.

import { inchesOf } from './dims.js'
import { FORMS } from './rates.js'
import { availableFor } from './offcuts.js'

/** A section as it comes off the rack. */
export const BAR_FT = 12
export const BAR_INCHES = BAR_FT * 12
/** What the blade itself takes out, per cut. */
export const KERF = 0.125

const SETTINGS_KEY = 'shiv-workshop:cutting'

export const DEFAULT_CUTTING = {
  barInches: BAR_INCHES,
  kerf: KERF,
  // Left long on purpose: a frame is cut to the opening, not to the hole, and
  // every shop has its own allowance. Zero until somebody sets it.
  allowance: 0,
}

export function readCutting() {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null')
    return v ? { ...DEFAULT_CUTTING, ...v } : { ...DEFAULT_CUTTING }
  } catch { return { ...DEFAULT_CUTTING } }
}
export function writeCutting(c) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(c)) } catch { /* ignore */ }
}

/**
 * The pieces one opening has to be cut into.
 *
 * Two families, because they do not come off the same section: the outer
 * frame that sits in the wall, and the leaf that swings inside it. A flat ACP
 * wall has an outer frame and nothing else — there is no leaf to hang.
 *
 * Leaves divide the width between them and take the full height each.
 */
export function cutsFor(o, cfg = DEFAULT_CUTTING) {
  const add = Number(cfg.allowance) || 0
  const w = inchesOf(o.w) + add
  const h = inchesOf(o.h) + add
  if (!(w > 0 && h > 0)) return []

  const form = FORMS[o.form]
  const leaves = Math.max(1, o.leaves ?? form?.leaves ?? 1)
  const out = [
    { role: 'Outer frame', len: w, n: 2 },
    { role: 'Outer frame', len: h, n: 2 },
  ]

  if (form?.draw !== 'panel') {
    // Each leaf is its share of the width, full height, four sides.
    out.push({ role: 'Leaf', len: w / leaves, n: 2 * leaves })
    out.push({ role: 'Leaf', len: h, n: 2 * leaves })
  }
  return out
}

/** Every cut an order needs, as one flat list, tagged with what it is for. */
export function cutListFor(openings, cfg = DEFAULT_CUTTING) {
  const pieces = []
  for (const o of openings || []) {
    for (const c of cutsFor(o, cfg)) {
      for (let i = 0; i < c.n; i++) {
        pieces.push({ role: c.role, len: c.len, from: o.id, form: o.form })
      }
    }
  }
  return pieces
}

/**
 * Fit the pieces, longest first, spending the rack before opening new stock.
 *
 * Two rules, and their order is the whole point:
 *
 *   - an end already on the rack is tried first, and among those the SHORTEST
 *     one the piece fits in. Dropping a 14" cut into a 90" end while a 16" end
 *     sits there is how a rack fills up with lengths too short to use.
 *   - only when nothing on the rack will take it is a new 12 ft section opened.
 *
 * Within that it is first-fit-decreasing, which is not the perfect packing —
 * that problem is NP hard and nobody needs the last half inch — but it lands
 * within a few percent and, more to the point, it is a plan a person can
 * follow straight down a bar.
 */
export function packBars(pieces, cfg = DEFAULT_CUTTING, stock = []) {
  const bar = Number(cfg.barInches) || BAR_INCHES
  const kerf = Number(cfg.kerf) || 0
  const sorted = [...pieces].sort((a, b) => b.len - a.len)

  // Shortest end first, so the awkward ones get spent.
  const bars = [...stock]
    .sort((a, b) => a.len - b.len)
    .map((o) => ({
      cuts: [], used: 0, left: o.len, source: 'offcut',
      offcutId: o.id, stockLen: o.len, fromJob: o.fromJob,
    }))

  for (const p of sorted) {
    if (p.len > bar) {
      // Longer than the stock itself — it cannot be cut, and saying so is
      // better than quietly dropping it.
      bars.push({ cuts: [p], used: p.len, left: 0, oversize: true, source: 'new', stockLen: bar })
      continue
    }

    let home = null
    let best = Infinity
    for (const b of bars) {
      if (b.oversize) continue
      const cost = p.len + (b.cuts.length ? kerf : 0)
      if (b.left < cost) continue
      // Among the ends, the tightest fit. A new bar is only reached for when
      // no end will have it, so its rank is pushed beyond every offcut's.
      const rank = b.source === 'offcut' ? b.left : b.left + 10000
      if (rank < best) { best = rank; home = b }
    }

    if (!home) {
      home = { cuts: [], used: 0, left: bar, source: 'new', stockLen: bar }
      bars.push(home)
    }
    const cost = p.len + (home.cuts.length ? kerf : 0)
    home.cuts.push(p)
    home.used += cost
    home.left -= cost
  }

  // An end nothing was cut from was never touched, so it stays on the rack.
  return bars.filter((b) => b.cuts.length > 0)
}

/**
 * The whole order, by section family: what comes off the rack, how many new
 * lengths are needed, how each is cut, and what is left at the end.
 */
export function cuttingPlan(openings, cfg = DEFAULT_CUTTING) {
  const pieces = cutListFor(openings, cfg)
  const byRole = new Map()
  for (const p of pieces) {
    if (!byRole.has(p.role)) byRole.set(p.role, [])
    byRole.get(p.role).push(p)
  }

  const groups = []
  for (const [role, list] of byRole) {
    const bars = packBars(list, cfg, availableFor(role))
    const fresh = bars.filter((b) => b.source === 'new')
    const fromRack = bars.filter((b) => b.source === 'offcut')
    const newStock = fresh.reduce((t, b) => t + b.stockLen, 0)
    const rackStock = fromRack.reduce((t, b) => t + b.stockLen, 0)
    const cut = list.reduce((t, p) => t + p.len, 0)
    const all = newStock + rackStock
    groups.push({
      role,
      bars,
      pieces: list.length,
      barsNeeded: fresh.length,
      offcutsUsed: fromRack.length,
      cutInches: cut,
      newInches: newStock,
      rackInches: rackStock,
      wastePct: all > 0 ? ((all - cut) / all) * 100 : 0,
    })
  }

  groups.sort((a, b) => b.barsNeeded - a.barsNeeded)
  const totalBars = groups.reduce((t, g) => t + g.barsNeeded, 0)
  const totalCut = groups.reduce((t, g) => t + g.cutInches, 0)
  const newInches = groups.reduce((t, g) => t + g.newInches, 0)
  const rackInches = groups.reduce((t, g) => t + g.rackInches, 0)
  const all = newInches + rackInches

  return {
    groups,
    totalBars,
    fromRack: groups.reduce((t, g) => t + g.offcutsUsed, 0),
    rackFt: Math.round((rackInches / 12) * 10) / 10,
    newFt: Math.round((newInches / 12) * 10) / 10,
    totalFt: Math.round((all / 12) * 10) / 10,
    wastePct: all > 0 ? Math.round(((all - totalCut) / all) * 1000) / 10 : 0,
  }
}

/** What the run would do to the rack: which ends get spent, which get made. */
export function rackEffect(plan, keepOver) {
  const consumedIds = []
  const newEnds = []
  for (const g of plan.groups) {
    for (const b of g.bars) {
      if (b.oversize) continue
      if (b.source === 'offcut') consumedIds.push(b.offcutId)
      newEnds.push({ role: g.role, len: b.left })
    }
  }
  return {
    consumedIds,
    newEnds,
    keep: newEnds.filter((e) => e.len >= keepOver),
    scrap: newEnds.filter((e) => e.len > 0.01 && e.len < keepOver),
  }
}

/** Decimal inches back to the way the shop reads a tape: 40 6/8". */
export function fmtInches(x) {
  const n = Number(x) || 0
  const whole = Math.floor(n)
  const eighths = Math.round((n - whole) * 8)
  if (eighths === 8) return `${whole + 1}″`
  return eighths ? `${whole} ${eighths}/8″` : `${whole}″`
}

/** A length in feet and inches, for talking about stock. */
export function fmtFeet(x) {
  const n = Number(x) || 0
  const ft = Math.floor(n / 12)
  const inch = n - ft * 12
  if (!ft) return fmtInches(inch)
  return inch >= 0.0625 ? `${ft}′ ${fmtInches(inch)}` : `${ft}′`
}

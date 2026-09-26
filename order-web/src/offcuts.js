// ── The rack of ends ────────────────────────────────────────────────────────
//
// Every bar that gets cut leaves a tail. Some of those tails are the next
// ventilator's frame and some are scrap, and the difference is one number —
// how short is too short to bother keeping.
//
// Today that decision is made at the saw and then forgotten: the good ends go
// in the corner, nobody writes them down, and the next order gets cut out of
// fresh 12 ft lengths standing three feet away from a rack that could have
// done half of it. So the ends are kept here as real stock, and the cutting
// plan spends them before it opens anything new.

const KEY = 'shiv-workshop:offcuts'
const SETTINGS = 'shiv-workshop:offcut-rule'

/** Anything shorter than this is not worth walking to the rack for. */
export const DEFAULT_KEEP_INCHES = 18

export function readRule() {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS) || 'null')
    return { keepOver: DEFAULT_KEEP_INCHES, ...(v || {}) }
  } catch { return { keepOver: DEFAULT_KEEP_INCHES } }
}
export function writeRule(r) {
  try { localStorage.setItem(SETTINGS, JSON.stringify(r)) } catch { /* ignore */ }
}

export function readOffcuts() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch { return [] }
}
export function writeOffcuts(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* ignore */ }
}

/** What is on the rack right now, for a given section family. */
export const availableFor = (role) =>
  readOffcuts().filter((o) => !o.usedAt && !o.scrappedAt && o.role === role)

const uid = () => `oc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

/**
 * Write down what a cutting run did to the rack.
 *
 * Both halves in one go, because they are one event: the ends that were spent
 * are marked spent, and the new ends long enough to keep are added. Anything
 * shorter than the rule is counted as scrap rather than quietly vanishing —
 * a shop that cannot see its waste cannot argue about it.
 */
export function recordRun({ jobNumber, consumedIds = [], newEnds = [] }) {
  const rule = readRule()
  const now = Date.now()
  const list = readOffcuts().map((o) => (
    consumedIds.includes(o.id) ? { ...o, usedAt: now, usedOn: jobNumber } : o
  ))

  let kept = 0
  let scrapped = 0
  let scrappedInches = 0
  for (const end of newEnds) {
    if (end.len >= rule.keepOver) {
      list.push({
        id: uid(),
        role: end.role,
        len: Math.round(end.len * 1000) / 1000,
        fromJob: jobNumber,
        at: now,
      })
      kept++
    } else if (end.len > 0.01) {
      scrapped++
      scrappedInches += end.len
    }
  }

  writeOffcuts(list)
  return { kept, scrapped, scrappedInches, consumed: consumedIds.length }
}

/** Take one end off the rack by hand — cut wrong, bent, or finally used up. */
export function scrapOffcut(id) {
  writeOffcuts(readOffcuts().map((o) => (o.id === id ? { ...o, scrappedAt: Date.now() } : o)))
}

/** Put a length on the rack that did not come from a plan — a delivery end,
 *  or a piece somebody found in the corner and measured. */
export function addOffcut(role, len) {
  const list = readOffcuts()
  list.push({ id: uid(), role, len: Number(len) || 0, at: Date.now(), byHand: true })
  writeOffcuts(list)
}

/** What the rack holds, grouped the way it is stacked. */
export function rackSummary() {
  const live = readOffcuts().filter((o) => !o.usedAt && !o.scrappedAt)
  const byRole = new Map()
  for (const o of live) {
    if (!byRole.has(o.role)) byRole.set(o.role, [])
    byRole.get(o.role).push(o)
  }
  const groups = [...byRole.entries()].map(([role, items]) => ({
    role,
    items: items.sort((a, b) => b.len - a.len),
    inches: items.reduce((t, o) => t + o.len, 0),
  })).sort((a, b) => b.inches - a.inches)

  return {
    groups,
    pieces: live.length,
    inches: live.reduce((t, o) => t + o.len, 0),
  }
}

/** What has been spent or thrown, for the month's view of waste. */
export function rackHistory() {
  const all = readOffcuts()
  return {
    used: all.filter((o) => o.usedAt).length,
    usedInches: all.filter((o) => o.usedAt).reduce((t, o) => t + o.len, 0),
    scrapped: all.filter((o) => o.scrappedAt).length,
    scrappedInches: all.filter((o) => o.scrappedAt).reduce((t, o) => t + o.len, 0),
  }
}

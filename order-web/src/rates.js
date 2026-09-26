// ── What things cost, and what the assumption costs ─────────────────────────
//
// A unit is two choices, not one: the FORM is what gets built — a ventilator,
// a two-door window, an aluminium door, a flat ACP wall — and the FILL is what
// goes in it: SS net, ACP, glass, ACP with film. The shop has always spoken
// this way ("ventilator with net ss", "openable window with net ss") and the
// mechanic picks them as two taps, which is also how the drawing gets made:
// the form decides the leaves and the hinges, the fill decides the label.
//
// Two separate ideas about money live here and must not be confused.
//
// The RATE CARD is what the customer is told. Those figures come off the
// staff's own working — a 12″×20″ ventilator with net priced out in sections
// and net comes to ₹857 — and that figure then goes on the pad for every
// ventilator on the job whatever size it turned out to be. The app keeps that
// behaviour, because it is a real choice: a stable per-piece price is easier
// to quote and easier to argue.
//
// The MATERIAL MODEL is what the shop actually spends. It exists only to
// answer the question nobody can answer today — what is the nominal size
// costing us — and never touches what the customer is told.

import { dim, sqftOf, perimeterFt } from './dims.js'

/** What gets built. Leaves and the way it is drawn follow from this. */
export const FORMS = {
  ventilator: {
    label: 'Ventilator',
    leaves: 1,
    draw: 'plain',
    // A ventilator sits above a door or a window, so it is wide and short —
    // every one on the mechanic's sheet measures that way (21 × 13⅞, 23 × 10,
    // 20 × 11). The estimate writes the pair as 12×20; the long side is the
    // width. Perimeter and area do not care which way round it is, so the
    // price is unchanged either way — the drawing very much does.
    nominal: { w: dim(20), h: dim(12) },
  },
  'window-1': {
    label: '1 door window',
    leaves: 1,
    draw: 'openable',
    nominal: { w: dim(13, 7), h: dim(41, 5) },
  },
  'window-2': {
    label: '2 door window',
    leaves: 2,
    draw: 'openable',
    nominal: { w: dim(26), h: dim(40, 6) },
  },
  'alu-door': {
    label: 'Aluminium door',
    leaves: 1,
    draw: 'door',
    nominal: { w: dim(36), h: dim(84) },
  },
  'acp-wall': {
    label: 'ACP wall',
    leaves: 0,
    draw: 'panel',
    nominal: null,        // a wall is whatever it measures; there is no usual one
  },
}
export const FORM_IDS = Object.keys(FORMS)

/** What goes in it. */
export const FILLS = {
  net: { label: 'SS Net', short: 'Net SS', sqft: 50 },
  acp: { label: 'ACP', short: 'ACP', sqft: 50 },
  glass: { label: 'Glass', short: 'Glass', sqft: 48 },
  'acp-film': { label: 'ACP with film', short: 'ACP + film', sqft: 65 },
}
export const FILL_IDS = Object.keys(FILLS)

/** Which fills make sense in which form — a wall is never netted. */
export const FILLS_FOR = {
  ventilator: ['net', 'acp', 'glass'],
  'window-1': ['net', 'glass', 'acp'],
  'window-2': ['net', 'glass', 'acp'],
  'alu-door': ['glass', 'acp', 'acp-film'],
  'acp-wall': ['acp', 'acp-film'],
}

export const productKey = (form, fill) => `${form}:${fill}`

export const productLabel = (form, fill) => {
  const f = FORMS[form]
  const g = FILLS[fill]
  if (!f) return form
  if (form === 'acp-wall') return `Alu. ACP wall${fill === 'acp-film' ? ' with film' : ''}`
  return `Alu. ${f.label} with ${g?.short || fill}`
}

export const productShort = (form, fill) =>
  `${FORMS[form]?.label || form} · ${FILLS[fill]?.short || fill}`

/**
 * The rates the shop has actually used, read off the pad.
 *
 * Only four combinations are known from the papers. Everything else the app
 * asks for once and then remembers, rather than inventing a number — a made-up
 * rate on a work order is worse than a blank one.
 */
export const KNOWN_RATES = {
  'ventilator:net': 857,
  'ventilator:acp': 833,
  'window-2:net': 1648,
  'window-1:net': 922,
}

const LEARNED_KEY = 'shiv-orders:rates'

export function readLearned() {
  try { return JSON.parse(localStorage.getItem(LEARNED_KEY) || '{}') || {} } catch { return {} }
}
export function learnRate(form, fill, rate) {
  const all = readLearned()
  all[productKey(form, fill)] = Math.round(Number(rate) || 0)
  try { localStorage.setItem(LEARNED_KEY, JSON.stringify(all)) } catch { /* ignore */ }
}
export function allRates() {
  return { ...KNOWN_RATES, ...readLearned() }
}
/** null when the shop has never priced this combination. */
export function rateFor(form, fill) {
  const r = allRates()[productKey(form, fill)]
  return Number.isFinite(r) && r > 0 ? r : null
}

export const nominalFor = (form) => FORMS[form]?.nominal || null

/**
 * Work on an opening that already exists in the customer's house. No frame to
 * build, so it is priced on area alone — and this one IS a per-sqft rate, read
 * straight off the estimate: 18 sqft came to ₹504 and 16 sqft to ₹448, which
 * is ₹28 both times.
 */
export const NET_FITTING_PER_SQFT = 28

/** Loose material and charges that get added by hand at the counter. */
export const EXTRAS = [
  { id: 'liping', label: 'Liping teak 35×10', unit: 'ft', rate: 9.5 },
  { id: 'shaddle', label: 'Shaddle 1″ No.7 250gm', unit: 'pkt', rate: 30 },
  { id: 'shaddle-labour', label: 'Shaddle labour', unit: 'pc', rate: 25 },
  { id: 'leaf-making', label: 'Net leaf making', unit: 'pc', rate: 200 },
  { id: 'fare', label: 'Fare', unit: 'job', rate: 100 },
]

/**
 * What a piece costs the shop in material. Rough until the Rates screen is
 * filled in from the section list — the 2-Track sheet in Aluminium Rates.xlsm
 * does this properly, section by section, and this is the same shape flattened
 * to one average until those numbers exist for a ventilator.
 */
export const DEFAULT_MATERIAL = {
  rupeesPerKg: 280,      // the figure on the 2-Track sheet, June
  kgPerFt: 0.175,        // averaged across 2 TTS / 2 TB / OSO / BSO / Interlock
  framesPerPiece: 2,     // outer frame, plus the leaf's own frame
  measured: false,       // flips true once somebody enters real section figures
}

const MATERIAL_KEY = 'shiv-orders:material'

export function readMaterial() {
  try {
    const v = JSON.parse(localStorage.getItem(MATERIAL_KEY) || 'null')
    return v ? { ...DEFAULT_MATERIAL, ...v } : { ...DEFAULT_MATERIAL }
  } catch { return { ...DEFAULT_MATERIAL } }
}
export function writeMaterial(m) {
  try { localStorage.setItem(MATERIAL_KEY, JSON.stringify(m)) } catch { /* ignore */ }
}

/** Section feet and fill area one piece of this size needs. */
export function materialFor(form, fill, w, h, mat) {
  const f = FORMS[form]
  if (!f) return { sectionFt: 0, panelSqft: 0, rupees: 0 }
  // A flat wall has no frame round every panel and no leaf, so it is its fill
  // and nothing else.
  const frames = f.draw === 'panel' ? 0 : (mat.framesPerPiece || 1)
  const sectionFt = perimeterFt(w, h) * frames
  const panelSqft = sqftOf(w, h)
  const fillRate = FILLS[fill]?.sqft ?? 50
  const rupees = sectionFt * mat.kgPerFt * mat.rupeesPerKg + panelSqft * fillRate
  return { sectionFt, panelSqft, rupees }
}

/**
 * What a piece of this size should be quoted at.
 *
 * The shop knows one figure per product — ₹857 for a ventilator with net —
 * and it knows what size that figure was worked out at. Everything else
 * follows from holding the margin over material steady and letting the
 * material move with the size. So a bigger ventilator costs more than ₹857
 * without anybody re-deriving anything, and at the usual size it comes back
 * to ₹857 exactly.
 *
 * `anchor` lets a job override the rate card with what this customer was
 * actually quoted, which is what the delta screen needs.
 */
export function priceFor(form, fill, w, h, mat, anchor) {
  const baseRate = anchor?.rate ?? rateFor(form, fill)
  if (baseRate == null) return null
  const at = anchor?.size || nominalFor(form)
  const actual = materialFor(form, fill, w, h, mat)
  if (!at || !(sqftOf(at.w, at.h) > 0)) return Math.round(actual.rupees)
  const quoted = materialFor(form, fill, at.w, at.h, mat)
  return Math.round(actual.rupees + (baseRate - quoted.rupees))
}

/** The working behind that figure, for showing it rather than asserting it. */
export function priceBreakdown(form, fill, w, h, mat, anchor) {
  const m = materialFor(form, fill, w, h, mat)
  const total = priceFor(form, fill, w, h, mat, anchor)
  const kg = m.sectionFt * mat.kgPerFt
  return {
    sectionFt: Math.round(m.sectionFt * 10) / 10,
    kg: Math.round(kg * 100) / 100,
    sectionRs: Math.round(kg * mat.rupeesPerKg),
    fillSqft: Math.round(m.panelSqft * 100) / 100,
    fillRs: Math.round(m.panelSqft * (FILLS[fill]?.sqft ?? 50)),
    margin: total == null ? null : Math.round(total - m.rupees),
    total,
  }
}

/**
 * A rate typed at some size has to be stored against the usual size, or the
 * next quote at a different size would compound the difference.
 */
export function learnRateAtSize(form, fill, rate, w, h, mat) {
  const nom = nominalFor(form)
  if (!nom) { learnRate(form, fill, rate); return }
  const typed = materialFor(form, fill, w, h, mat)
  const atNominal = materialFor(form, fill, nom.w, nom.h, mat)
  learnRate(form, fill, Math.round(rate - typed.rupees + atNominal.rupees))
}

/**
 * The size and rate this job's estimate quoted a product at.
 *
 * One estimate can carry the same product at several sizes — ten ventilators
 * are rarely all one size, and each row keeps its own. The row with the most
 * pieces on it is the one the job is anchored to: it is the size most of the
 * work was quoted at, and taking whichever row happened to be typed first
 * would make the variance depend on data entry order.
 */
export function quotedFor(estimate, form, fill) {
  const rows = (estimate?.lines || []).filter(
    (x) => x.kind === 'product' && x.form === form && x.fill === fill && x.nominal,
  )
  if (!rows.length) return null
  const main = rows.reduce((a, b) => ((b.qty || 0) > (a.qty || 0) ? b : a))
  return { size: main.nominal, rate: main.rate, rows: rows.length }
}

const round = (n, places) => {
  const f = 10 ** places
  return Math.round(n * f) / f
}

/**
 * What the nominal size is costing on this job.
 *
 * Every opening is costed twice — once at the size it was quoted at, once at
 * the size it measured — and the difference is reported in material, never in
 * price. The physical quantities are certain; the rupees are only as good as
 * the Rates screen, which is why they are labelled as an estimate until
 * somebody puts the real section figures in.
 *
 * Openings whose form has no usual size — an ACP wall — are left out: there
 * was never an assumption to be wrong about.
 */
export function varianceFor(openings, mat, estimate) {
  let sectionFt = 0
  let panelSqft = 0
  let rupees = 0
  let pieces = 0
  let nominalSqft = 0
  let measuredSqft = 0
  let mixed = 0

  for (const o of openings) {
    const q = quotedFor(estimate, o.form, o.fill)
    const at = q?.size || nominalFor(o.form)
    if (!at || !(sqftOf(at.w, at.h) > 0)) continue
    if ((q?.rows || 0) > 1) mixed++
    const quoted = materialFor(o.form, o.fill, at.w, at.h, mat)
    const actual = materialFor(o.form, o.fill, o.w, o.h, mat)
    sectionFt += actual.sectionFt - quoted.sectionFt
    panelSqft += actual.panelSqft - quoted.panelSqft
    rupees += actual.rupees - quoted.rupees
    nominalSqft += quoted.panelSqft
    measuredSqft += actual.panelSqft
    pieces++
  }

  const pct = nominalSqft > 0 ? ((measuredSqft - nominalSqft) / nominalSqft) * 100 : 0
  return {
    pieces,
    mixed,
    sectionFt: round(sectionFt, 1),
    panelSqft: round(panelSqft, 1),
    rupees: Math.round(rupees),
    pct: round(pct, 1),
    estimated: !mat.measured,
  }
}

/**
 * Turn a list of measured openings into the lines the pad carries.
 *
 * The pad does not list fifteen openings; it lists four products with counts,
 * because that is what the workshop is being asked to make. Grouping is by
 * form and fill together — the sketches underneath carry the sizes.
 *
 * `priceBy` is the fork the delta screen settles: 'nominal' keeps the figure
 * the estimate was quoted at, which is what the shop does today; 'measured'
 * re-prices each piece from its own size.
 */
export function linesFromOpenings(openings, priceBy = 'nominal', mat = DEFAULT_MATERIAL, estimate) {
  const groups = new Map()

  for (const o of openings) {
    const key = productKey(o.form, o.fill)
    const anchor = quotedFor(estimate, o.form, o.fill)
    const rate = o.rate ?? anchor?.rate ?? rateFor(o.form, o.fill)
    const g = groups.get(key) || {
      key, form: o.form, fill: o.fill,
      label: productLabel(o.form, o.fill),
      qty: 0, amount: 0, unpriced: false,
    }
    g.qty += 1

    if (rate == null) {
      g.unpriced = true
    } else if (priceBy === 'measured') {
      // The same margin, worked out on the size that was actually measured.
      g.amount += priceFor(o.form, o.fill, o.w, o.h, mat, anchor ?? { rate }) ?? rate
    } else {
      g.amount += rate
    }
    groups.set(key, g)
  }

  return [...groups.values()].map((g) => ({
    id: `l-${g.key}`,
    kind: 'product',
    form: g.form,
    fill: g.fill,
    label: g.label,
    qty: g.qty,
    unpriced: g.unpriced,
    rate: g.unpriced ? null : Math.round(g.amount / g.qty),
    amount: Math.round(g.amount),
  }))
}

export const lineTotal = (lines) => (lines || []).reduce((t, l) => t + (Number(l.amount) || 0), 0)

/** Counts by form-and-fill, for saying what changed between estimate and order. */
export function countsByProduct(lines) {
  const out = {}
  for (const l of lines || []) {
    if (l.kind !== 'product') continue
    const key = productKey(l.form, l.fill)
    out[key] = (out[key] || 0) + (Number(l.qty) || 0)
  }
  return out
}

/**
 * Why the total moved. Counts and scope only — this is what gets read to the
 * customer on the phone, so a size assumption must never leak into it.
 */
export function explainDelta(estimate, orderLines) {
  const before = countsByProduct(estimate?.lines)
  const after = countsByProduct(orderLines)
  const rates = allRates()
  const reasons = []

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const from = before[key] || 0
    const to = after[key] || 0
    if (from === to) continue
    const [form, fill] = key.split(':')
    reasons.push({
      label: productShort(form, fill),
      from, to,
      amount: (to - from) * (rates[key] || 0),
    })
  }

  // Lines that were on the estimate and are not products any more — net
  // fitting that turned into new windows, consumables that fell away.
  const dropped = (estimate?.lines || []).filter((l) => l.kind !== 'product')
  const droppedTotal = dropped.reduce((t, l) => t + (Number(l.amount) || 0), 0)
  if (droppedTotal) {
    reasons.push({ label: 'estimate extras not carried forward', from: null, to: null, amount: -droppedTotal })
  }

  return reasons.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}

export const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
export const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-IN')

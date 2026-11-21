// ── What goes on a work order made on the app ───────────────────────────────
//
// Taken from the Orders app (order-web/src/rates.js), which this replaces. A
// piece is two choices: the FORM is what gets built (a ventilator, a two-door
// window, an aluminium door, a flat ACP wall), the FILL is what goes in it.
// The form decides how it is drawn on the pad; the fill only what is written
// inside. Loose items (liping, shaddle) go on the estimate with no drawing.

import { dim } from './dims.js'

/** What gets built. Leaves and the way it is drawn follow from this. */
export const FORMS = {
  ventilator: { label: 'Ventilator', leaves: 1, draw: 'plain', nominal: { w: dim(20), h: dim(12) } },
  // Sliding windows, as the shop makes them beside the openable ones (Tony, 21 Nov 2026).
  'slide-2': { label: '2 track window', leaves: 2, draw: 'sliding', nominal: { w: dim(48), h: dim(48) } },
  'slide-3': { label: '3 track window', leaves: 3, draw: 'sliding', nominal: { w: dim(60), h: dim(48) } },
  // The ids stay as they were, so work orders already made still read.
  'window-1': { label: '1 door openable', leaves: 1, draw: 'openable', nominal: { w: dim(13, 7), h: dim(41, 5) } },
  'window-2': { label: '2 door openable', leaves: 2, draw: 'openable', nominal: { w: dim(26), h: dim(40, 6) } },
  'alu-door': { label: 'Aluminium door', leaves: 1, draw: 'door', nominal: { w: dim(36), h: dim(84) } },
  'acp-wall': { label: 'ACP wall', leaves: 0, draw: 'panel', nominal: null },
}
export const FORM_IDS = Object.keys(FORMS)

/** What goes in it. */
export const FILLS = {
  net: { label: 'SS Net', short: 'Net SS' },
  acp: { label: 'ACP', short: 'ACP' },
  glass: { label: 'Glass', short: 'Glass' },
  'acp-film': { label: 'ACP with film', short: 'ACP + film' },
  // A 3 track window as it is usually fitted: two glass shutters and one of net.
  'glass-net': { label: 'Glass + Net', short: 'Glass + Net' },
}

/** Which fills make sense in which form: a wall is never netted. */
export const FILLS_FOR = {
  ventilator: ['net', 'acp', 'glass'],
  'slide-2': ['glass', 'net'],
  'slide-3': ['glass-net', 'glass'],
  'window-1': ['net', 'glass', 'acp'],
  'window-2': ['net', 'glass', 'acp'],
  // No glass in an aluminium door (Tony, 21 Nov 2026).
  'alu-door': ['acp', 'acp-film'],
  'acp-wall': ['acp', 'acp-film'],
}

/** A piece as the pad writes it. */
export const productLabel = (form, fill) => {
  const f = FORMS[form]
  const g = FILLS[fill]
  if (!f) return form
  if (form === 'acp-wall') return `Alu. ACP wall${fill === 'acp-film' ? ' with film' : ''}`
  return `Alu. ${f.label} with ${g?.short || fill}`
}

/** Loose material and charges, put on by hand at the counter. Fare has its own box. */
export const EXTRAS = {
  liping: { label: 'Liping teak 35×10', unit: 'ft', rate: 9.5 },
  shaddle: { label: 'Shaddle 1″ No.7 250gm', unit: 'pkt', rate: 30 },
  'shaddle-labour': { label: 'Shaddle labour', unit: 'pc', rate: 25 },
  'leaf-making': { label: 'Net leaf making', unit: 'pc', rate: 200 },
}
export const FARE = 100

/**
 * The rates the shop has used, read off the pad; and what this phone has
 * been told since, remembered, so a ventilator with net costs the same the
 * next time without typing.
 */
const KNOWN = { 'ventilator:net': 857, 'ventilator:acp': 833, 'window-2:net': 1648, 'window-1:net': 922 }
const KEY = 'workshop:pad-rates'
const learned = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { return {} } }
const keyOf = (line) => (line.extra ? `extra:${line.form}` : `${line.form}:${line.fill}`)
export function rateFor(line) {
  const r = { ...KNOWN, ...learned() }[keyOf(line)] ?? (line.extra ? EXTRAS[line.form]?.rate : null)
  return Number.isFinite(r) && r > 0 ? r : null
}
export function learnRate(line) {
  if (!(line.rate > 0)) return
  try { localStorage.setItem(KEY, JSON.stringify({ ...learned(), [keyOf(line)]: line.rate })) } catch { /* a phone that keeps nothing asks again */ }
}

/** Rupees, as the screen shows them. */
export const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
/** A line's money: its pieces at its rate, to the rupee. */
export const amountOf = (line) => Math.round((Number(line.qty) || 0) * (Number(line.rate) || 0))
export const totalOf = (pad) => pad.lines.reduce((t, l) => t + (Number(l.amount) || 0), 0) + (Number(pad.fare) || 0)
/** Today as the date box writes it. */
export const todayKey = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }

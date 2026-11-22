// ── What goes on a work order made on the app ───────────────────────────────
//
// Taken from the Orders app (order-web/src/rates.js), which this replaces. A
// piece is two choices: the FORM is what gets built (a ventilator, a two-door
// window, an aluminium door, a flat ACP wall), the FILL is what goes in it.
// The form decides how it is drawn on the pad; the fill only what is written
// inside. Loose items (liping, shaddle) go on the estimate with no drawing.

import { dim, parseDim } from './dims.js'

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
  // A home job (Tony, 22 Nov 2026): a plain flush door the customer buys here,
  // sunmica stuck on it, and our mechanic fits it at the home.
  'flush-door': { label: 'Flush door', leaves: 1, draw: 'flush', nominal: { w: dim(32), h: dim(81) } },
}
/** The aluminium pieces, and the home jobs, each a group of tiles of its own. */
export const HOME_IDS = ['flush-door']
export const FORM_IDS = Object.keys(FORMS).filter((id) => !HOME_IDS.includes(id))

/** What goes in it. */
export const FILLS = {
  net: { label: 'SS Net', short: 'Net SS' },
  acp: { label: 'ACP', short: 'ACP' },
  glass: { label: 'Glass', short: 'Glass' },
  'acp-film': { label: 'ACP with film', short: 'ACP + film' },
  // A 3 track window as it is usually fitted: two glass shutters and one of net.
  'glass-net': { label: 'Glass + Net', short: 'Glass + Net' },
  // On a flush door: the customer's sunmica on the front and Mica Liner Teak, always,
  // on the back (Tony, 22 Nov 2026); or plain, no mica.
  sunmica: { label: 'Sunmica front + liner back', short: 'Sunmica', sides: 1 },
  plain: { label: 'Plain', short: 'Plain', sides: 0 },
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
  'flush-door': ['sunmica', 'plain'],
}

/**
 * The thickness of the aluminium, asked on every framed piece (Tony, 22 Nov
 * 2026): the three columns of the rate sheet. 1.2 MM is what the shop
 * usually makes. A flat ACP wall has no sections, so it is not asked.
 */
export const THICKS = {
  '1.2': { label: '1.2 MM', short: '1.2mm' },
  '1.6': { label: '1.6 MM', short: '1.6mm' },
  '1.2h': { label: '1.2 MM Hindalco', short: '1.2mm Hindalco' },
}
export const THICK_IDS = Object.keys(THICKS)
export const THICK = '1.2'
export const hasThick = (form) => !!FORMS[form] && !['panel', 'flush'].includes(FORMS[form].draw)

/**
 * A piece as the pad writes it (Tony, 22 Nov 2026): the piece, its
 * thickness, then what goes in it, "Aluminium Door 1.2mm/ACP",
 * "2 Track Window 1.2mm/Glass", "ACP Wall/ACP + film".
 */
const titled = (s) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase())
export const productLabel = (form, fill, thick) => {
  const f = FORMS[form]
  const g = FILLS[fill]
  if (!f) return form
  const name = form === 'acp-wall' ? 'ACP Wall' : titled(f.label)
  const t = thick && hasThick(form) ? ` ${THICKS[thick]?.short || thick}` : ''
  return `${name}${t}/${g?.short || fill}`
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

/**
 * The shop's rate sheet (Aluminium Rates.xlsm, beside the repo), worked out
 * from the size the way the sheet does it (Tony, 22 Nov 2026), in the column
 * of the thickness asked for. A size with any eighths counts as the next whole
 * inch, and the area is rounded to two places, as on the sheet.
 *
 *   Aluminium door (bathroom door with chaukhat): door ₹150 a sqft (1.6 MM
 *   ₹200, Hindalco ₹190), chaukhat ₹90 a running ft (1.6 MM and Hindalco
 *   ₹100; two heights and a width), accessories ₹160; a height under 72″ is
 *   priced as 72″; décor film ₹30 a sqft
 *   more. The door is its area, 13.00 sqft at ₹150 (Tony, 22 Nov 2026),
 *   and the chaukhat its own running feet, no bottom, with no least: 72 + 72
 *   + 26 is billed 14.17 rft (Tony, 22 Nov 2026; the sheet and the panel's
 *   calculator have a least of 14.5, not used here).
 *   2 and 3 track windows: one rate a sqft for the whole window, falling as
 *   the window grows (the sheet's "Rates According To Area"), ₹60 a sqft more
 *   in 1.6 MM and ₹50 more in Hindalco. The 3 track sheet is the window with
 *   half SS net. Under 6 sqft takes the 6 sqft rate.
 *
 * Returns null for a piece the sheet does not price or one with no size yet;
 * the remembered rate stands for those.
 */
const SHEET = {
  door: { sqft: { '1.2': 150, '1.6': 200, '1.2h': 190 }, rft: { '1.2': 90, '1.6': 100, '1.2h': 100 }, accessories: 160, film: 30, minH: 72 },
  windowMore: { '1.2': 0, '1.6': 60, '1.2h': 50 },
  'slide-2': [[6, 350], [7.5, 310], [9, 290], [12, 270], [14, 260], [16, 250], [20, 240], [24, 230]],
  'slide-3': [[6, 470], [7.5, 430], [9, 390], [12, 360], [14, 350], [16, 330], [20, 320], [24, 310]],
}
const SHEET_FILLS = { 'alu-door': ['acp', 'acp-film'], 'slide-2': ['glass'], 'slide-3': ['glass-net'] }
const wholeIn = (d) => (Number(d?.inches) || 0) + ((Number(d?.soot) || 0) > 0 ? 1 : 0)
const r2 = (n) => Math.round(n * 100) / 100
export function sheetPrice(line) {
  if (line.form === 'flush-door') return flushPrice(line)
  if (line.extra || !SHEET_FILLS[line.form]?.includes(line.fill)) return null
  const W = wholeIn(parseDim(line.wText))
  const H = wholeIn(parseDim(line.hText))
  if (!(W > 0 && H > 0)) return null
  const area = r2((W * H) / 144)
  const t = THICKS[line.thick] ? line.thick : THICK
  if (line.form === 'alu-door') {
    const d = SHEET.door
    // A door under 72″ high is priced as 72″ (Tony, 22 Nov 2026): 25 2/8 × 63 is
    // billed as 26 × 72, 13.00 sqft. The drawing keeps the real size.
    const area = r2((W * Math.max(H, d.minH)) / 144)
    const Hp = Math.max(H, d.minH)
    const perSqft = d.sqft[t]
    const perRft = d.rft[t]
    const sqft = area
    const rft = r2((Hp * 2 + W) / 12)
    const film = line.fill === 'acp-film'
    // Each part to the rupee, and the rate their sum, so the pad's lines add up (Tony, 22 Nov 2026).
    // On the pad each is an item line of its own, its feet after the Pc: "× Aluminium Chaukhat  1 Pc 14.17'  1275".
    const parts = [
      { key: 'door', text: `Door ${sqft} sqft @ ${perSqft}`, amount: Math.round(sqft * perSqft) },
      // The film is billed on its own line, straight under the door it goes on (Tony, 22 Nov 2026).
      ...(film ? [{ key: 'film', name: 'Décor Film', feet: sqft, text: `Décor film ${sqft} sqft @ ${d.film}`, amount: Math.round(sqft * d.film) }] : []),
      // The chaukhat and the fitting items go with a door unless switched off for it (`chaukhat: false`, `fitting: false`; Tony, 22 Nov 2026).
      ...(line.chaukhat === false ? [] : [{ key: 'chaukhat', name: `Aluminium Chaukhat ${THICKS[t].short}`, feet: rft, text: `Chaukhat ${rft} rft @ ${perRft}`, amount: Math.round(rft * perRft) }]),
      ...(line.fitting === false ? [] : [{ key: 'accessories', name: 'Fitting Items', unit: 'Set', text: 'Fitting items', amount: d.accessories }]),
    ]
    const rate = parts.reduce((t, p) => t + p.amount, 0)
    const working = parts.map((p) => (p.key === 'accessories' ? `Fitting items ${p.amount}` : p.text)).join(' + ')
    return { rate, working, sqft: area, parts }
  }
  const bands = SHEET[line.form]
  const per = (bands.filter(([a]) => a <= area).pop() || bands[0])[1] + SHEET.windowMore[t]
  return { rate: Math.round(area * per), working: `${area} sqft @ ${per}`, sqft: area }
}

/* ── The flush door home job (Tony, 22 Nov 2026) ───────────────────────────
   Rates from the shop's "Plywood and Door color.xlsm" (Plain sheet: flush
   door, water proof, 30 mm, a rate a sqft by brand) and the WPC chaukhat
   price card (src/lib/data/fixedCards.ts, installation Rs 200 extra). The
   door is billed at the stock size it is cut from: the next height of 72, 75,
   78, 81, 84 and the next even width from 24 to 46 at or above the size. */
export const FLUSH_BRANDS = [
  ['Greenply', 190], ['Century Club Prime', 199], ['Signature Gold Club', 208], ['Signature Gold', 195],
  ['Signature', 172], ['Gattani', 165], ['Century Sainik 710', 158], ['Mayura Gold', 148],
  ['Abhiyan', 145], ['Arch Pine', 140], ['Geetanjali', 120], ['Addwell', 115], ['Natural', 110], ['Monark', 90],
]
const FLUSH_H = [72, 75, 78, 81, 84]
const FLUSH_W = [24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46]
const stockOf = (sizes, v) => sizes.find((x) => x >= v) ?? v
/** The chaukhat a flush door can go in, a set each, as the shop's price card has them (Tony, 22 Nov 2026). */
export const CHAUKHATS = {
  'sakhuwa-4x3': { label: 'Sakhuwa 4″ × 3″', name: 'Wooden Imported Sakhuwa 4″ × 3″', sets: { 'Wooden Imported': 2600 } },
  'wpc-3x2': { label: 'WPC 3″ × 2″', sets: { Ekotimber: 2057, Signature: 2320, 'Signature Gold': 2845 } },
  'wpc-4x2.5': { label: 'WPC 4″ × 2.5″', sets: { Ekotimber: 3020, Signature: 3282, 'Signature Gold': 3895 } },
  'wpc-5x2.5': { label: 'WPC 5″ × 2.5″', sets: { Signature: 3895 } },
}
export const CHAUKHAT_INSTALL = 200
export const HOME = { sticking: 400, paneling: 1500 }
/** Rates the counter types once for a home job, kept on this device: a sunmica sheet, a liner teak sheet, the fitting. */
const HOME_KEY = 'workshop:home-rates'
// Mica Liner Teak is Rs 580 a sheet unless the counter types another (Tony, 22 Nov 2026).
const HOME_DEFAULTS = { linerRate: 580 }
export const homeRates = () => { try { return { ...HOME_DEFAULTS, ...(JSON.parse(localStorage.getItem(HOME_KEY) || '{}') || {}) } } catch { return { ...HOME_DEFAULTS } } }
export function learnHome(rates) {
  const keep = Object.fromEntries(Object.entries(rates).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]))
  if (!Object.keys(keep).length) return
  try { localStorage.setItem(HOME_KEY, JSON.stringify({ ...homeRates(), ...keep })) } catch { /* asked again next time */ }
}
/** A typed rate on the line, else the one this device remembers. */
export const homeRateOf = (line, key) => Number(line[key]) || Number(homeRates()[key]) || 0
/** A flush door's name on the pad: "Flush Door Greenply/Sunmica 2 sides". */
export const flushLabel = (line) => `Flush Door ${line.brand || FLUSH_BRANDS[0][0]}/${FILLS[line.fill]?.short || 'Plain'}`

function flushPrice(line) {
  const W = wholeIn(parseDim(line.wText))
  const H = wholeIn(parseDim(line.hText))
  if (!(W > 0 && H > 0)) return null
  const brand = FLUSH_BRANDS.find(([b]) => b === line.brand) ?? FLUSH_BRANDS[0]
  const sw = stockOf(FLUSH_W, W)
  const sh = stockOf(FLUSH_H, H)
  const sqft = r2((sw * sh) / 144)
  const sides = FILLS[line.fill]?.sides ?? 0
  const sheet = homeRateOf(line, 'sunRate')
  const ch = CHAUKHATS[line.wpc]
  const parts = [
    { key: 'door', text: `Door ${sw}″ × ${sh}″ ${sqft} sqft @ ${brand[1]}`, amount: Math.round(sqft * brand[1]) },
    ...(sides ? [
      // The front: the mica the customer chose, by its design number when given. The back: liner teak, always.
      { key: 'sunmica', name: line.micaNo ? `Sunmica ${line.micaNo}` : 'Sunmica', unit: 'Sheet', text: `Sunmica @ ${sheet || '?'}`, amount: Math.round(sheet) },
      { key: 'liner', name: 'Mica Liner Teak', unit: 'Sheet', text: `Liner teak @ ${homeRateOf(line, 'linerRate') || '?'}`, amount: Math.round(homeRateOf(line, 'linerRate')) },
      { key: 'sticking', name: 'Sunmica Sticking & Mounting', unit: 'Pc', text: `Sticking ${HOME.sticking}`, amount: HOME.sticking },
    ] : []),
    ...(line.paneling ? [{ key: 'paneling', name: 'Door Paneling', unit: 'Pc', text: `Paneling ${HOME.paneling}`, amount: HOME.paneling }] : []),
    ...(ch ? [(() => {
      const brand = ch.sets[line.wpcBrand] ? line.wpcBrand : Object.keys(ch.sets)[0]
      return { key: 'chaukhat', name: ch.name ? `${ch.name} Chaukhat` : `${ch.label} Chaukhat ${brand}`, unit: 'Set', text: `Chaukhat ${ch.sets[brand]}`, amount: ch.sets[brand] }
    })()] : []),
    ...(ch ? [{ key: 'install', name: 'Chaukhat Installation', unit: 'Pc', text: `Installation ${CHAUKHAT_INSTALL}`, amount: CHAUKHAT_INSTALL }] : []),
    // The fitting labour; the fittings themselves (handles, hinges, aldrop) are added one
    // by one from the shop's catalog as loose items (Tony, 22 Nov 2026).
    ...(line.fitting !== false ? [
      { key: 'fitlabour', name: 'Door Fitting', unit: 'Pc', text: `Fitting ${homeRateOf(line, 'fitRate') || '?'}`, amount: homeRateOf(line, 'fitRate') },
    ] : []),
  ]
  const rate = parts.reduce((t, p) => t + p.amount, 0)
  return { rate, working: parts.map((p) => p.text).join(' + '), sqft, parts }
}

/** Rupees, as the screen shows them. */
export const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
/** A line's money: its pieces at its rate, to the rupee. */
export const amountOf = (line) => Math.round((Number(line.qty) || 0) * (Number(line.rate) || 0))
export const totalOf = (pad) => pad.lines.reduce((t, l) => t + (Number(l.amount) || 0), 0) + (Number(pad.fare) || 0)
/** Today as the date box writes it. */
export const todayKey = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }

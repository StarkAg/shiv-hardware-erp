// ── The pink pad, generated ─────────────────────────────────────────────────
//
// The shop's carbon work order book, drawn from a work order made on the app:
// pink for the customer, white kept at the shop, yellow for the workshop. The
// top half is the shop's letterhead, who it is for and the estimate; the
// bottom half draws every piece that has a size. Taken from the Orders app
// (order-web/src/WorkOrder.jsx), where it was measured off a real pad.
//
// On the screen one copy is shown zoomed to the width it has. Printing gives
// all three, one A4 each, with no colour of their own: the paper is loaded
// pink, white, yellow, in that order.

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SketchGrid } from './sketch.jsx'
import { totalOf } from './forms.js'
import { fmtDim } from './dims.js'
import { Letterhead, addressed, sheetDate } from './Letterhead.jsx'
import { sheetBlob } from '../sendOut.jsx'
import './pad.css'

export const COPIES = [
  { key: 'customer', label: 'Customer copy', colour: 'pink' },
  { key: 'shop', label: 'Shop copy', colour: 'white' },
  { key: 'workshop', label: 'Workshop copy', colour: 'yellow' },
]
export const copyOf = (key) => COPIES.find((c) => c.key === key) ?? COPIES[0]

/**
 * The pad, measured (2026-11-20) from a photo of order 814 laid flat beside
 * a 23 mm coin: 230.8 x 270.8 mm. Every position is in mm from its top-left
 * corner. The Epson takes paper 216 mm wide at most, so the sheet goes on A4
 * at PRINT_SCALE, every proportion kept.
 */
const SHEET_W = 210 // mm, A4
const SHEET_H = 296 // a hair under A4, so it never spills a blank second page
const PAD_W = 230.8
// A4 in shape (Tony, 21 Nov 2026): the pad's own width, as tall as A4 is for it, so a
// printed copy fills the page; the extra height goes to the drawings. (The
// carbon pad itself is 270.8mm tall.)
const PAD_H = (PAD_W * 297) / 210
const PRINT_SCALE = 204 / PAD_W
// The same margin, 13mm, on both sides (21 Nov 2026); the divider half way between.
const MARGIN = 9 // equal both sides; 13mm left the estimate short of the edge (21 Nov 2026)
const DIVIDER_X = 115.4
// The top half closed up (21 Nov 2026): it ended at 130mm, with loose gaps.
const SPLIT_Y = 106
const EST_X0 = 115.8
const EST_X1 = 230.8 - MARGIN
const RULE_FIRST = 27.5
const RULE_STEP = 8.8
const RULES = 9
const FIELDS = [
  { label: 'Name', y: 55.5, from: 29, key: 'name' },
  { label: '', y: 63.5, from: 29, key: 'address' },
  { label: 'Contact No.', y: 72.0, from: 41, key: 'mobile' },
  { label: 'Order Date', y: 80.5, from: 40, key: 'orderDate' },
  { label: 'Delivery Date', y: 89.0, from: 44.5, key: 'deliveryDate' },
]
const FIELD_END = 112.6
const LOGO_TOP = 29.6
const LOGO_H = 45.8 - LOGO_TOP
const LOGO_X = 31 - 2.6 - LOGO_H * 154 / 174

/** A rate keeps its paise: 9.5 a foot. Figures only, no Rs.: the column heads say what they are (Tony, 21 Nov). */
const rateOf = (n) => `${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
/** Amounts as the work order writes them: 1,250. */
const rupees = (n) => `${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
/** Amounts as the old pad wrote them: whole rupees, no sign, no commas. */
const plain = (n) => String(Math.round(Number(n) || 0))
/** Pieces as the pad writes them: 3 Pc, 12.5 ft. */
// A piece priced by the square foot carries its area after the count: "1 Pc 11.38'".
/**
 * A door's parts each on a line of their own (Tony, 22 Nov 2026): the door
 * line carries the door's own amount, then the chaukhat, the accessories and
 * any film under it. Their sum is the line's amount, the first taking any
 * rupee left over.
 */
function partsOf(l) {
  if (!l.parts?.length) return null
  const q = Number(l.qty) || 0
  const amts = l.parts.map((p) => Math.round(p.amount * q))
  amts[0] = (Number(l.amount) || 0) - amts.slice(1).reduce((t, a) => t + a, 0)
  return l.parts.map((p, i) => ({ ...p, amount: amts[i], text: p.key === 'door' ? null : p.text }))
}
// A part's count is the door's, its feet after it: "1 Pc 14.50'" (Tony, 22 Nov 2026).
const partQty = (l, p) => `${Math.round((Number(l.qty) || 0) * 100) / 100} ${p.unit || 'Pc'}${p.feet > 0 ? ` ${Number(p.feet).toFixed(2)}'` : ''}`
const partName = (p) => p.name || p.text
/**
 * The film and the fitting items of every door, each gathered into one line at
 * the foot of the items (Tony, 22 Nov 2026): "× Décor Film  2 Pc  25.50'  765",
 * "× Fitting Items  2 Set  320". A door's chaukhat stays under it.
 */
const GATHER = ['film', 'accessories']
function gatheredOf(pad) {
  return GATHER.map((key) => {
    let qty = 0
    let feet = 0
    let amount = 0
    let p0 = null
    for (const l of pad.lines) {
      const p = partsOf(l)?.find((x) => x.key === key)
      if (!p) continue
      const q = Number(l.qty) || 0
      qty += q * (p.per || 1)
      feet += (Number(p.feet) || 0) * q
      amount += p.amount
      p0 = p0 || p
    }
    return qty > 0 ? { key, qty: Math.round(qty * 100) / 100, feet: Math.round(feet * 100) / 100, amount, unit: p0.unit, name: partName(p0) } : null
  }).filter(Boolean)
}
// The Qty in two: the count ("1 Pc", "1 Set", "10 ft") and the feet ("11.38'"), so each lines up down the pad.
const countOf = (q, unit) => `${Math.round((Number(q) || 0) * 100) / 100} ${unit && unit !== 'pc' ? unit : 'Pc'}`
const feetOf = (n) => (n > 0 ? `${Number(n).toFixed(2)}'` : '')

const qtyOf = (l) => `${Math.round((Number(l.qty) || 0) * 100) / 100} ${l.unit && l.unit !== 'pc' ? l.unit : 'Pc'}${l.sqft > 0 ? ` ${Number(l.sqft).toFixed(2)}'` : ''}`

/** dd/mm/yy, as the pad is dated. */
function padDate(key) {
  if (!key) return ''
  const [y, m, d] = String(key).split('-')
  return d && m && y ? `${d}/${m}/${y.slice(-2)}` : ''
}

const mm = (n) => `${n}mm`

let ruler = null
/** How wide `text` runs in mm at `size` mm, in the lettering the pad is filled in with. */
function textMm(text, size, weight = 600) {
  ruler = ruler || document.createElement('canvas').getContext('2d')
  ruler.font = `${weight} 100px "Barlow Semi Condensed", Arial, sans-serif`
  return (ruler.measureText(String(text ?? '')).width / 100) * size
}

/** The size a line is written at to fit `width` mm whole: a little smaller first, then on two lines. */
function fitText(text, size, width, weight) {
  const full = textMm(text, size, weight)
  if (full <= width) return { size, lines: 1 }
  const shrunk = size * (width / full)
  if (shrunk >= size * 0.72) return { size: shrunk, lines: 1 }
  return { size: Math.min(size * 0.82, (size * width * 1.9) / full), lines: 2 }
}

/** A line of text placed by its baseline, where it sits on the pad. With `fit`, kept whole inside that many mm. */
function At({ x, base, size, right, centre, fit, weight = 600, className = '', children }) {
  let fs = size
  let lines = 1
  if (fit) ({ size: fs, lines } = fitText(children, size, fit, weight))
  const place = right != null
    ? { right: mm(PAD_W - right) }
    : centre != null ? { left: mm(centre), transform: 'translateX(-50%)' } : { left: mm(x) }
  const two = lines === 2
  return (
    <div
      className={`padt ${className}`}
      style={{
        top: mm(base - fs * 0.86 - (two ? fs * 1.05 : 0)), fontSize: mm(fs), ...place,
        ...(fit ? { width: mm(fit), textAlign: centre != null ? 'center' : undefined } : {}),
        ...(two ? { whiteSpace: 'normal', lineHeight: 1.05 } : {}),
      }}
    >
      {children}
    </div>
  )
}

/**
 * A ruled line. Lines are snapped to whole screen pixels at the pad's scale
 * (Tony, 22 Nov 2026): a line 0.3mm thick on a pad shown small came out 0 or 1
 * pixel, a heavier one 1 or 2, so they stepped and swapped weights. Each line is
 * centred on its rule's pixel row; a heavy line is at least a pixel thicker than
 * a rule; a double is two heavy lines, one either side of the rule, the rule
 * between them covered in the paper's colour.
 */
const PadScale = createContext({ zoom: 1, frac: 0 })
const MM_PX = 96 / 25.4
function HLine({ y, x0, x1, w = 0.3, double, gap = 0.6, pen, heavy }) {
  // `frac`: how far into a screen pixel the pad's top edge falls; lines are snapped from the screen's own pixel rows.
  const { zoom: z = 1, frac = 0 } = useContext(PadScale) || {}
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  const unit = 1 / (MM_PX * z * dpr) // mm in one screen pixel
  const px = (v) => Math.round(v / unit)
  const row = (v) => Math.round(v / unit + frac) - frac // a screen pixel row, counted from the pad's top
  const ruleN = Math.max(1, px(0.3))
  const n = Math.max(1, px(w), heavy ? ruleN + 1 : 0)
  const cy = row(y)
  const base = { left: mm(x0), width: mm(x1 - x0) }
  if (!double) return <div className={`padl${pen ? ' pen' : ''}`} style={{ ...base, top: mm((cy - Math.floor(n / 2)) * unit), height: mm(n * unit) }} />
  const g = Math.max(ruleN + 2, px(gap))
  const total = 2 * n + g
  return (
    <div className="padl" style={{ ...base, top: mm((cy - Math.floor(total / 2)) * unit), height: mm(total * unit), background: 'var(--pad)' }}>
      <div className="padl pen" style={{ left: 0, right: 0, top: 0, height: mm(n * unit) }} />
      <div className="padl pen" style={{ left: 0, right: 0, bottom: 0, height: mm(n * unit) }} />
    </div>
  )
}

const SKETCH_ZOOM_MAX = 3.2

/**
 * The bottom half: every piece with a size, drawn. As large as the pad's hand
 * drawings when there is room, coming down together until all of them fit;
 * many go onto two rows rather than becoming specks.
 */
function PadSketch({ openings, style }) {
  const box = useRef(null)
  const [fit, setFit] = useState({ wrap: false, row: 0, ready: false })
  const key = openings.map((o) => `${o.id}:${o.form}:${o.fill}:${o.qty}:${o.w?.inches}/${o.w?.soot}x${o.h?.inches}/${o.h?.soot}`).join('|')
  useLayoutEffect(() => { setFit({ wrap: false, row: 0, ready: false }) }, [key])
  // The room there is, followed as it changes: the sheet settles its own size
  // after the drawings are first laid out, and a scale taken from that first
  // instant drew them as specks.
  const [room, setRoom] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return undefined
    const look = () => setRoom((r) => (r.w === el.clientWidth && r.h === el.clientHeight ? r : { w: el.clientWidth, h: el.clientHeight }))
    look()
    const ro = new ResizeObserver(look)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const scaleFor = (w, h) => (w && h && room.w && room.h ? Math.min(SKETCH_ZOOM_MAX, room.w / w, room.h / h) * 0.98 : 0)
  // The drawings' own size, measured once a layout: all on one row, then (with
  // enough pieces) on two rows and on three; whichever lets them be biggest in
  // the room there is is kept. A big order fills the bottom of the pad.
  const maxRows = Math.min(3, Math.max(1, openings.length - 1))
  useLayoutEffect(() => {
    if (fit.ready || !room.w || !room.h) return
    const grid = box.current?.querySelector('.sketchgrid')
    if (!grid) return
    // The drawings' own extent, not the row they are laid in (a wrapped row is
    // set wider than what sits in it).
    const kids = [...grid.children]
    if (!kids.length) return
    const w = Math.max(...kids.map((k) => k.offsetLeft + k.offsetWidth)) - Math.min(...kids.map((k) => k.offsetLeft))
    const h = grid.offsetHeight
    if (!w || !h) return
    const rows = fit.rows ?? 1
    const tried = [...(fit.tried ?? []), { rows, row: fit.row, w, h }]
    // The row widths to try after the one long row: for two rows and for three,
    // a few widths each, since a tight one lays out a row more than meant.
    const oneW = tried[0].w
    const plan = []
    for (let k = 2; k <= maxRows; k += 1) for (const f of [1.08, 1.25, 1.45]) plan.push({ rows: k, row: Math.ceil((oneW / k) * f) })
    const next = plan[tried.length - 1]
    if (next) {
      setFit({ wrap: true, rows: next.rows, row: next.row, ready: false, tried })
      return
    }
    const best = tried.reduce((a, b) => (scaleFor(b.w, b.h) > scaleFor(a.w, a.h) ? b : a))
    setFit({ wrap: best.rows > 1, rows: best.rows, row: best.row, w: best.w, h: best.h, ready: true })
  }, [fit, maxRows, room])
  // Once settled, the layout as it is actually drawn is measured again, and
  // the scale and centring taken from that, not from a trial on the way.
  // Watched as well: the lettering loads after the first layout and the
  // drawings settle smaller, which nothing else would notice.
  useLayoutEffect(() => {
    if (!fit.ready) return undefined
    const grid = box.current?.querySelector('.sketchgrid')
    if (!grid) return undefined
    const look = () => {
      const kids = [...grid.children]
      if (!kids.length) return
      const w = Math.max(...kids.map((k) => k.offsetLeft + k.offsetWidth)) - Math.min(...kids.map((k) => k.offsetLeft))
      const h = grid.offsetHeight
      setFit((f) => (f.ready && (Math.abs(w - f.w) > 2 || Math.abs(h - f.h) > 2) ? { ...f, w, h } : f))
    }
    look()
    const ro = new ResizeObserver(look)
    ro.observe(grid)
    return () => ro.disconnect()
  }, [fit.ready, fit.rows, fit.row])
  const zoom = fit.ready ? scaleFor(fit.w, fit.h) : 1
  return (
    <div ref={box} className="padsketch ink" style={style}>
      {/* Scaled as one picture from the top centre, not with `zoom`: inside a
          sheet that is itself zoomed to fit the screen, a second zoom measured
          against the first and drew the pieces as specks. */}
      <div
        className={`padsketchin${fit.wrap ? ' rows2' : ''}`}
        style={{
          // Centred up and down in the room too, so what is left over is shared above and below.
          position: 'absolute', left: '50%', top: fit.ready ? Math.max(0, (room.h - fit.h * zoom) / 2) : 0,
          width: fit.wrap ? fit.row : 'max-content',
          transform: `translateX(-50%) scale(${zoom})`, transformOrigin: 'top center',
          visibility: fit.ready ? 'visible' : 'hidden',
        }}
      >
        <SketchGrid openings={openings} />
      </div>
    </div>
  )
}

/** The pieces drawn in the bottom half: every built line with a size, once, its count beside it. */
export const openingsOf = (pad) => pad.lines
  // Each drawing keeps its line's number in the table above it.
  .map((l, i) => ({ ...l, n: i + 1 }))
  .filter((l) => !l.extra && l.w && l.h && (l.w.inches || l.w.soot) && (l.h.inches || l.h.soot))
  .map((l) => ({ id: l.id, n: l.n, form: l.form, fill: l.fill, w: l.w, h: l.h, qty: l.qty, ...(l.fitting === false ? { fitting: false } : {}), ...(l.hinge === 'right' ? { hinge: 'right' } : {}), ...(l.chaukhat === false ? { chaukhat: false } : {}),
    ...(l.form === 'flush-door' ? { paneling: !!l.paneling, brand: l.brand, ...(l.wpc ? { wpc: l.wpc } : {}) } : {}),
    ...(l.sqft > 0 ? { sqft: l.sqft } : {}), ...(l.parts?.find((x) => x.key === 'chaukhat')?.feet > 0 ? { rft: l.parts.find((x) => x.key === 'chaukhat').feet } : {}) }))

/**
 * The two looks a work order is printed in (Tony, 21 Nov 2026):
 *
 *   pad      the shop's own pink carbon pad, as the photo of order 814 has it:
 *            letterhead and customer at the left, the estimate on ruled lines
 *            at the right, the pieces drawn below. The usual one.
 *   format1  on A4 in the visit order's look: the full letterhead, who it is
 *            for, the estimate as a table, the pieces drawn below.
 *
 * Which one this counter uses is kept on the device; the pad until changed.
 */
export const FORMATS = [{ key: 'pad', label: 'Pad' }, { key: 'format1', label: 'Format 1' }]
const FORMAT_KEY = 'workshop:work-order-format'
// Format 1 is kept here but not offered (Tony, 21 Nov 2026): the pad is the
// only look, whatever a device chose before. Return the stored choice again
// to bring the choice back.
export const padFormat = () => 'pad'
// eslint-disable-next-line no-unused-vars
const storedFormat = () => { try { return localStorage.getItem(FORMAT_KEY) === 'format1' ? 'format1' : 'pad' } catch { return 'pad' } }
export const setPadFormat = (f) => { try { localStorage.setItem(FORMAT_KEY, f) } catch { /* this visit only */ } }
const sizeOf = (format) => (format === 'format1' ? { w: SHEET_W, h: SHEET_H, print: 1, margin: 0 } : { w: PAD_W, h: PAD_H, print: PRINT_SCALE, margin: 3 })

/**
 * One copy of the work order. `who` is the customer: name, address, mobile;
 * `number` the work order's; `format` the look, else this counter's.
 */
export function PadSheet({ copy, number, who, pad, fixedZoom, thumb = false, fitHeight = false, format, below = null, banded = false, page = 0 }) {
  const fmt = format ?? padFormat()
  const size = sizeOf(fmt)
  const box = useRef(null)
  const under = useRef(null)
  const sheet = useRef(null)
  // Where the pad's inside top edge (inside its border, where its lines are measured
  // from) falls inside a screen pixel, for the ruled lines (HLine).
  const [frac, setFrac] = useState(0)
  useLayoutEffect(() => {
    const el = sheet.current?.querySelector(':scope > .padorigin')
    if (!el) return
    const d = window.devicePixelRatio || 1
    const f = (((el.getBoundingClientRect().top * d) % 1) + 1) % 1
    if (Math.abs(f - frac) > 0.02) setFrac(f)
  })
  const [zoom, setZoom] = useState(fixedZoom ?? 1)
  useLayoutEffect(() => {
    if (fixedZoom) return undefined
    const el = box.current
    if (!el) return undefined
    // To the width it has; with `fitHeight`, the whole sheet within the height too, nothing to scroll.
    const fitTo = () => {
      const padPx = (size.w / 25.4) * 96
      const room = el.clientHeight - (under.current?.offsetHeight ?? 0) - (under.current ? 6 : 0)
      // Only where the screen gives it a fixed height (the counter, 900px and up); on a phone its height is its own.
      const byHeight = fitHeight && room > 0 && window.matchMedia('(min-width: 900px)').matches ? room / ((size.h / 25.4) * 96 + 2) : Infinity
      if (el.clientWidth) setZoom(Math.min(1.2, el.clientWidth / padPx, byHeight))
    }
    fitTo()
    const ro = new ResizeObserver(fitTo)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fixedZoom, fitHeight, size.w, size.h])

  return (
    <div ref={box} className={`padfit${fitHeight ? ' tall' : ''}${below ? ' withbelow' : ''}`} style={thumb ? { height: mm(size.h * zoom) } : undefined}>
      {/* A thumbnail is shrunk as one picture: a phone will not draw letters that small. */}
      <div
        ref={sheet}
        className={`pad ${fmt === 'format1' ? 'worksheet ' : ''}copy-${copy.key}${banded ? ' banded' : ''}`}
        style={{
          width: mm(size.w), height: mm(size.h), '--print-zoom': size.print,
          ...(thumb ? { '--zoom': 1, transform: `scale(${zoom})`, transformOrigin: 'top left' } : { '--zoom': zoom }),
        }}
      >
        <div className="padorigin" style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0 }} />
        {/* The scale it is shown at, so its ruled lines land on whole screen pixels. */}
        <PadScale.Provider value={{ zoom, frac }}>
          {fmt === 'format1'
            ? <Format1 copy={copy} number={number} who={who} pad={pad} />
            : <PinkPad copy={copy} number={number} who={who} pad={pad} page={page} />}
        </PadScale.Provider>
      </div>
      {/* What goes under the sheet (Print), exactly as wide as the sheet, its edges in line. */}
      {below && <div ref={under} className="padbelow" style={{ width: `calc(${mm(size.w)} * ${zoom})` }}>{below}</div>}
    </div>
  )
}

/** The shop's pink carbon pad, drawn where its printed parts are. */
/**
 * The pad over as many pages as it needs (Tony, 22 Nov 2026). A page holds
 * PAGE_ROWS lines of the estimate and PAGE_DRAWINGS drawings. An estimate too
 * long for one page is cut as accounts are: the page's foot carries its sum
 * forward ("Carried forward"), the next page's head brings it ("Brought
 * forward"), and the totals close the last. Drawings run on in their order.
 * Every page but the last says P.T.O. at its foot.
 */
const PAGE_ROWS = 13
const PAGE_DRAWINGS = 6
export function padPages(pad) {
  const total = totalOf(pad)
  const adv = Math.round(Number(pad.advance) || 0)
  const gathered = gatheredOf(pad)
  // Every line and every door's own parts, then like with like made one row
  // (Tony, 22 Nov 2026): all the Aluminium Door 1.2mm/ACP together, all the
  // Aluminium Chaukhat 1.2mm together, their pieces, feet and money added up, in
  // the order each first comes. The Ft column is the row's whole area or length.
  // Each piece keeps its own drawing below.
  const each = pad.lines.flatMap((l) => {
    const q = Number(l.qty) || 0
    const parts = partsOf(l)
    if (!parts) return [{ key: l.id, label: l.label, q, unit: l.unit, ft: (Number(l.sqft) || 0) * q, val: Number(l.amount) || 0, loose: !!l.extra }]
    return [
      { key: l.id, label: l.label, q, unit: l.unit, ft: (Number(l.sqft) || 0) * q, val: parts[0].amount },
      ...parts.slice(1).filter((p) => !GATHER.includes(p.key)).map((p) => ({ key: `${l.id}-${p.key}`, label: partName(p), q: q * (p.per || 1), unit: p.unit, ft: (Number(p.feet) || 0) * q, val: p.amount, part: true })),
    ]
  })
  const alike = new Map()
  for (const r of each) {
    const id = `${r.label}|${r.unit || ''}`
    const had = alike.get(id)
    if (had) { had.q += r.q; had.ft += r.ft; had.val += r.val } else alike.set(id, { ...r })
  }
  const row = (r) => ({ key: r.key, label: `× ${r.label}`, qn: countOf(Math.round(r.q * 100) / 100, r.unit), qf: feetOf(Math.round(r.ft * 100) / 100), amt: r.val ? plain(r.val) : '', val: r.val })
  const items = [
    // The pieces first, then their parts (the chaukhats together), then loose items and door
    // fittings, then the film and fitting items gathered.
    ...[...alike.values()].filter((r) => !r.part && !r.loose).map(row),
    ...[...alike.values()].filter((r) => r.part).map(row),
    ...[...alike.values()].filter((r) => r.loose).map(row),
    ...gathered.map((g) => ({ key: `all-${g.key}`, label: `× ${g.name}`, qn: countOf(g.qty, g.unit), qf: feetOf(g.feet), amt: plain(g.amount), val: g.amount })),
  ]
  const totals = [
    ...(pad.fare ? [{ key: 'fare', word: 'Fare', amt: plain(pad.fare) }] : []),
    // As accounts are ruled (Tony, 22 Nov 2026): a single line over a sum, a double
    // line under the last figure, the one to be paid: the Total when no advance was taken.
    { key: 'total', word: 'Total', amt: plain(total), strong: true, over: 'single', ...(adv > 0 ? {} : { under: 'double' }) },
    ...(adv > 0
      ? [
          { key: 'adv', word: 'Advance', amt: `− ${plain(adv)}` },
          { key: 'bal', word: 'Balance', amt: plain(total - adv), strong: true, over: 'single', under: 'double' },
        ]
      : []),
  ]
  const est = []
  let left = items
  let carried = 0
  for (;;) {
    const top = est.length ? [{ key: `bf-${est.length}`, word: 'Brought forward', amt: plain(carried) }] : []
    const room = PAGE_ROWS - top.length
    if (left.length + totals.length <= room) { est.push([...top, ...left, ...totals]); break }
    const take = Math.max(1, Math.min(left.length, room - 1))
    const chunk = left.slice(0, take)
    left = left.slice(take)
    carried += chunk.reduce((t, r) => t + (r.val || 0), 0)
    est.push([...top, ...chunk, { key: `cf-${est.length}`, word: 'Carried forward', amt: plain(carried), over: 'single' }])
  }
  const drawings = openingsOf(pad)
  const drawPages = Math.max(1, Math.ceil(drawings.length / PAGE_DRAWINGS))
  const count = Math.max(est.length, drawPages)
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    count,
    rows: est[i] ?? [],
    openings: drawings.slice(i * PAGE_DRAWINGS, (i + 1) * PAGE_DRAWINGS),
  }))
}
/** How many pages the pad runs to in this look (Format 1 is always one). */
export const padPageCount = (pad, format = padFormat()) => (format === 'format1' ? 1 : padPages(pad).length)

function PinkPad({ copy, number, who, pad, page = 0 }) {
  // Measured again once the lettering has loaded, or the columns are spaced by a stand-in font.
  const [, setFontsIn] = useState(false)
  useEffect(() => { let on = true; document.fonts?.ready.then(() => { if (on) setFontsIn(true) }); return () => { on = false } }, [])
  const pages = padPages(pad)
  const sheet = pages[Math.min(page, pages.length - 1)]
  const rows = sheet.rows
  const last = sheet.index === sheet.count - 1
  // Up to the pad's own ten lines they keep its spacing; a fuller page closes them up.
  const step = rows.length > RULES ? (RULE_STEP * RULES) / rows.length : RULE_STEP
  const ruleCount = Math.max(RULES, rows.length)
  // Bigger writing, set in the middle between two rules (Tony, 22 Nov 2026).
  const size = Math.min(5.6, step * 0.62)
  // The three columns share the line's width evenly (Tony, 22 Nov 2026): the
  // gap from the longest name to the Qty is the gap from the Qty to the Amount.
  // The Qty is two columns of its own, the count lined up on the left and the
  // feet on the right. Every item line at one size, the longest name fitting
  // with a gap of 3mm at least, so they all match.
  const LEFT = 117.4
  const RIGHT = EST_X1 - 1
  const wide = (list) => Math.max(0, ...list)
  // As the ink is written: its lettering, plus the .1mm the pad puts between letters (pad.css).
  const inkMm = (text, sz, weight) => textMm(text, sz, weight) + 0.1 * String(text ?? '').length
  // One size for every word and figure in the estimate (Tony, 22 Nov 2026): the
  // largest at which the longest name, the Qty and the Amount fit with their gaps.
  const full = {
    count: wide(rows.map((r) => (r.qn ? inkMm(r.qn, size, 700) : 0))),
    feet: wide(rows.map((r) => (r.qf ? inkMm(r.qf, size, 700) : 0))),
    amt: wide(rows.map((r) => inkMm(r.amt || '', size, r.strong ? 800 : 700))),
    name: wide(rows.filter((r) => r.label).map((r) => inkMm(r.label, size, 700))),
  }
  // At least 5mm between the columns, so the name never runs into the Qty.
  const fits = (RIGHT - LEFT - 10 - (full.feet ? 3 : 0)) / (full.count + full.feet + full.amt + full.name)
  const fsz = Math.max(2.4, size * Math.min(1, fits))
  const k = fsz / size
  const countW = full.count * k
  const feetW = full.feet * k
  const qtyW = countW + (feetW ? 3 + feetW : 0)
  // The amounts as wide as they are written, so the gaps look equal on the paper.
  const amtW = full.amt * k
  const nameW = full.name * k
  const gap = Math.max(5, (RIGHT - LEFT - nameW - qtyW - amtW) / 2)
  const QTY_R = RIGHT - amtW - gap
  const QTY_L = QTY_R - qtyW
  // The amounts' own width, a hair either side: where the sum lines run.
  const SUM_X0 = RIGHT - amtW - 1
  const SUM_X1 = RIGHT + 0.5
  const values = {
    name: who.name || '',
    address: who.address || '',
    mobile: who.mobile || '',
    orderDate: padDate(pad.orderDate),
    deliveryDate: padDate(pad.deliveryDate),
  }
  return (
    <>
      <At x={MARGIN + 1} base={7} size={4.1} className="pi">Order No. -</At>
      <At x={37} base={7.4} size={5.2} className="ink">{number}</At>
      <At x={24.5} base={18.6} size={8.6} className="pphone">8092850954</At>
      <At x={97.5} base={19.4} size={4.7} className="pi">Tony</At>
      <At right={107.5} base={25.4} size={4.2} className="pb">8092850956 <i>Vijay</i></At>
      <img className="plogo" src="/shiv-logo.png" alt="" style={{ left: mm(LOGO_X), top: mm(LOGO_TOP), width: mm(LOGO_H * 154 / 174), height: mm(LOGO_H) }} />
      <At x={31} base={34.8} size={6.3} className="pshop">Shiv Hardware Store</At>
      <At x={31} base={40.4} size={4.15} className="pi">Shivaji Road, Near Gandhi High School</At>
      <At x={31} base={45.8} size={4.15} className="pi">Ramgarh Cantt- 829122 Jharkhand</At>

      {FIELDS.map((f) => (
        <div key={f.key}>
          {f.label && <At x={MARGIN + 1} base={f.y - 0.6} size={4.0} className="pi">{f.label}</At>}
          <HLine y={f.y} x0={f.from} x1={FIELD_END} />
          <At centre={(f.from + FIELD_END) / 2} base={f.y - 1.3} size={5} fit={FIELD_END - f.from - 1} className="ink">{values[f.key]}</At>
        </div>
      ))}
      <At x={MARGIN + 1} base={100.5} size={4.0} className="pi">Customer Satisfaction Sig.</At>

      <div className="padl" style={{ left: mm(DIVIDER_X - 0.2), top: 0, width: mm(0.4), height: mm(SPLIT_Y) }} />
      <HLine y={SPLIT_Y} x0={MARGIN} x1={EST_X1} w={0.4} />

      <At centre={170} base={7.4} size={4.2} className="pi">Estimate</At>
      {/* What each column is, small, on the double line. */}
      <At x={117.4} base={15.2} size={2.8} className="phead">Particulars</At>
      {/* The count and the feet each a column with its own head (Tony, 22 Nov 2026). */}
      <At centre={QTY_L + countW / 2} base={15.2} size={2.8} className="phead">Qty</At>
      {feetW > 0 && <At right={QTY_R} base={15.2} size={2.8} className="phead">Ft</At>}
      <At right={EST_X1 - 1} base={15.2} size={2.8} className="phead">Amount</At>
      <HLine y={16.4} x0={EST_X0} x1={EST_X1} />
      <HLine y={18.6} x0={EST_X0} x1={EST_X1} />
      {Array.from({ length: ruleCount }, (_, i) => (
        <HLine key={i} y={RULE_FIRST + i * step} x0={EST_X0} x1={EST_X1} />
      ))}
      {rows.map((r, i) => {
        // The rule under this line, and the baseline that puts the figures' middle halfway up to the rule above.
        const rule = RULE_FIRST + i * step
        const base = rule - step / 2 + fsz * 0.36
        return (
          <div key={r.key}>
            {r.label && <At x={LEFT} base={base} size={fsz} className="ink">{r.label}</At>}
            {r.qn && <At x={QTY_L} base={base} size={fsz} className="ink">{r.qn}</At>}
            {r.qf && <At right={QTY_R} base={base} size={fsz} className="ink">{r.qf}</At>}
            {r.word && <At right={QTY_R} base={base} size={fsz} className="ink">{r.word}</At>}
            <At right={EST_X1 - 1} base={base} size={fsz} className={`ink${r.strong ? ' pstrong' : ''}`}>{r.amt}</At>
            {/* The sum lines exactly on the pad's own rules, thicker, only as wide as the amounts (Tony, 22 Nov 2026).
                A double line is that, and a thinner one just under it. */}
            {r.over && <HLine y={rule - step} x0={SUM_X0} x1={SUM_X1} w={0.7} pen heavy />}
            {r.under && <HLine y={rule} x0={SUM_X0} x1={SUM_X1} w={0.6} pen heavy double={r.under === 'double'} gap={0.8} />}
          </div>
        )
      })}

      <PadSketch openings={sheet.openings} style={{ left: mm(MARGIN), top: mm(SPLIT_Y + 6), width: mm(PAD_W - MARGIN * 2), height: mm(PAD_H - SPLIT_Y - (last ? 18 : 26)) }} />
      {/* More to come: P.T.O. at the foot of every page but the last, and each page numbered. */}
      {!last && <At right={EST_X1} base={PAD_H - 13} size={6.4} className="ink pstrong pto">P.T.O.</At>}
      {sheet.count > 1 && <At x={MARGIN + 1} base={PAD_H - 7} size={3.4} className="pcopy">Page {sheet.index + 1} of {sheet.count}</At>}
      <At right={EST_X1} base={PAD_H - 7} size={3.4} className="pcopy">{copy.label}</At>
    </>
  )
}

/** Format 1: on A4 in the visit order's look. */
function Format1({ copy, number, who, pad }) {
  const total = totalOf(pad)
  const adv = Math.round(Number(pad.advance) || 0)
  const openings = openingsOf(pad)
  const gathered = gatheredOf(pad)
  return (
    <div className="slip" style={{ '--zoom': 1 }}>
      <Letterhead />

      <div className="sliptitle">
        <h1>Work order</h1>
        <dl>
          <div><dt>Order No.</dt><dd>{number ?? ''}</dd></div>
          <div><dt>Date</dt><dd>{sheetDate(pad.orderDate)}</dd></div>
          <div><dt>Delivery</dt><dd>{sheetDate(pad.deliveryDate)}</dd></div>
        </dl>
      </div>

      <div className="slipwho">
        <small>For</small>
        <b>{[addressed(who.name), who.address].filter(Boolean).join(', ') || ' '}</b>
        {who.mobile && <span>Mobile {who.mobile}</span>}
      </div>

      <table className="sliptable worktable">
        <thead><tr><th className="n">No.</th><th>Item</th><th className="s">Size</th><th className="q">Qty</th><th className="r">Rate</th><th className="r">Amount</th></tr></thead>
        <tbody>
          {pad.lines.map((l, i) => {
            const parts = partsOf(l)
            return [
              <tr key={l.id}>
                <td className="n">{i + 1}</td>
                <td>{l.label}</td>
                <td className="s">{l.w && l.h && (l.w.inches || l.w.soot) ? `${fmtDim(l.w)}″ × ${fmtDim(l.h)}″` : ''}</td>
                <td className="q">{qtyOf(l)}</td>
                <td className="r">{parts ? '' : l.rate ? rateOf(l.rate) : ''}</td>
                <td className="r">{parts ? rupees(parts[0].amount) : l.amount ? rupees(l.amount) : ''}</td>
              </tr>,
              ...(parts || []).slice(1).filter((p) => !GATHER.includes(p.key)).map((p) => (
                <tr key={`${l.id}-${p.key}`} className="partrow">
                  <td className="n" />
                  <td>{partName(p)}</td>
                  <td className="s" />
                  <td className="q">{partQty(l, p)}</td>
                  <td className="r" />
                  <td className="r">{rupees(p.amount)}</td>
                </tr>
              )),
            ]
          })}
          {gathered.map((g) => (
            <tr key={g.key} className="partrow">
              <td className="n" />
              <td>{g.name}</td>
              <td className="s" />
              <td className="q">{countOf(g.qty, g.unit)}{g.feet > 0 ? ` ${feetOf(g.feet)}` : ''}</td>
              <td className="r" />
              <td className="r">{rupees(g.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="worksums">
        {pad.fare > 0 && <div><dt>Fare</dt><dd>{rupees(pad.fare)}</dd></div>}
        <div className="strong"><dt>Total</dt><dd>{rupees(total)}</dd></div>
        {adv > 0 && <div><dt>Advance</dt><dd>− {rupees(adv)}</dd></div>}
        {adv > 0 && <div className="strong"><dt>Balance</dt><dd>{rupees(total - adv)}</dd></div>}
      </dl>

      {/* Every piece with a size, drawn, in the room that is left. */}
      <div className="workdraw">
        {openings.length > 0 && <PadSketch openings={openings} style={{ left: 0, top: 0, width: '100%', height: '100%' }} />}
      </div>

      <footer className="slipfoot">
        <div className="slipsign"><span />Customer signature</div>
        <b className="workcopy">{copy.label}</b>
        <div className="slipsign"><span />For Shiv Hardware Store</div>
      </footer>
    </div>
  )
}

/**
 * Sheets printed and nothing else: laid out off the screen (so drawings can
 * measure themselves), then the print dialog once every picture has loaded.
 * `margin` is the page's edge in mm. `onDone` when the dialog is closed.
 */
export function Printing({ margin = 3, onDone, children }) {
  const box = useRef(null)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = `@page { size: A4 portrait; margin: ${margin}mm; }`
    document.head.appendChild(style)
    document.body.classList.add('printingpads')
    let gone = false
    const finish = () => {
      if (gone) return
      gone = true
      style.remove()
      document.body.classList.remove('printingpads')
      window.removeEventListener('afterprint', finish)
      window.removeEventListener('focus', backAgain)
      done.current()
    }
    // A phone that never says the dialog closed: the page coming back to the front does.
    const backAgain = () => setTimeout(finish, 1000)
    const imgs = [...(box.current?.querySelectorAll('img') ?? [])]
    const loaded = Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r }))))
    const t = setTimeout(() => {
      void loaded.then(() => {
        if (gone) return
        window.addEventListener('afterprint', finish)
        window.print()
        window.addEventListener('focus', backAgain)
      })
    }, 150)
    return () => { clearTimeout(t); finish() }
  }, [margin])
  return createPortal(<div ref={box} className="padprint" aria-hidden="true">{children}</div>, document.body)
}

/**
 * The three copies as pictures for the colour printer (Tony, 21 Nov 2026): on
 * plain white paper, each with its colour as a band down both edges (pink for
 * the customer, grey for the shop, yellow for the workshop), not a full page
 * of colour. Customer, shop, workshop, in that order.
 */
export async function padPictures(number, who, pad) {
  const blobs = []
  for (const copy of COPIES) blobs.push(...await padCopyPictures(number, who, pad, copy.key))
  return blobs
}

/** One copy of the pad, every page of it, as pictures. */
export async function padCopyPictures(number, who, pad, copyKey) {
  const blobs = []
  const pages = padPageCount(pad)
  for (let page = 0; page < pages; page += 1) {
    blobs.push(await sheetBlob(<PadSheet copy={copyOf(copyKey)} number={number} who={who} pad={pad} fixedZoom={1} banded page={page} />, '.pad'))
  }
  return blobs
}

/** All three copies of the pad, printed: load pink, white, yellow paper, in that order. */
export function PrintPads({ number, who, pad, onDone }) {
  // The pad prints with a small edge; Format 1 fills the page.
  return (
    <Printing margin={sizeOf(padFormat()).margin} onDone={onDone}>
      {COPIES.flatMap((copy) => Array.from({ length: padPageCount(pad) }, (_, page) => (
        <PadSheet key={`${copy.key}-${page}`} copy={copy} number={number} who={who} pad={pad} fixedZoom={1} page={page} />
      )))}
    </Printing>
  )
}

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

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SketchGrid } from './sketch.jsx'
import { totalOf } from './forms.js'
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
const PAD_W = 230.8
const PAD_H = 270.8
const PRINT_SCALE = 204 / PAD_W
const DIVIDER_X = 118.6
const SPLIT_Y = 130
const EST_X0 = 119
const EST_X1 = 223.5
const RULE_FIRST = 38.0
const RULE_STEP = 9.2
const RULES = 10
const FIELDS = [
  { label: 'Name', y: 75.0, from: 29, key: 'name' },
  { label: '', y: 83.9, from: 29, key: 'address' },
  { label: 'Contact No.', y: 94.0, from: 41, key: 'mobile' },
  { label: 'Order Date', y: 104.1, from: 40, key: 'orderDate' },
  { label: 'Delivery Date', y: 113.9, from: 44.5, key: 'deliveryDate' },
]
const FIELD_END = 116
const LOGO_TOP = 45.4
const LOGO_H = 61.6 - LOGO_TOP
const LOGO_X = 31 - 2.6 - LOGO_H * 154 / 174

/** Amounts as the pad writes them: whole rupees, no sign, no commas. */
const plain = (n) => String(Math.round(Number(n) || 0))
/** Pieces as the pad writes them: 3 Pc, 12.5 ft. */
const qtyOf = (l) => `${Math.round((Number(l.qty) || 0) * 100) / 100} ${l.unit && l.unit !== 'pc' ? l.unit : 'Pc'}`

/** dd/mm/yy, as the pad is dated. */
function padDate(key) {
  if (!key) return ''
  const [y, m, d] = String(key).split('-')
  return d && m && y ? `${d}/${m}/${y.slice(-2)}` : ''
}

const mm = (n) => `${n}mm`

let ruler = null
/** How wide `text` runs in mm at `size` mm, in the sheet's Arial. */
function textMm(text, size, weight = 600) {
  ruler = ruler || document.createElement('canvas').getContext('2d')
  ruler.font = `${weight} 100px Arial, "Helvetica Neue", Helvetica, "Liberation Sans", sans-serif`
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

function HLine({ y, x0, x1, w = 0.3, double, pen }) {
  return <div className={`padl${double ? ' dbl' : ''}${pen ? ' pen' : ''}`} style={{ top: mm(y - w / 2), left: mm(x0), width: mm(x1 - x0), height: mm(double ? w * 3 : w) }} />
}

const SKETCH_ZOOM_MAX = 2.35

/**
 * The bottom half: every piece with a size, drawn. As large as the pad's hand
 * drawings when there is room, coming down together until all of them fit;
 * many go onto two rows rather than becoming specks.
 */
function PadSketch({ openings, style }) {
  const box = useRef(null)
  const [fit, setFit] = useState({ zoom: 1, wrap: false, row: 0, ready: false })
  const key = openings.map((o) => `${o.id}:${o.form}:${o.fill}:${o.qty}:${o.w?.inches}/${o.w?.soot}x${o.h?.inches}/${o.h?.soot}`).join('|')
  useLayoutEffect(() => { setFit({ zoom: 1, wrap: false, row: 0, ready: false }) }, [key])
  useLayoutEffect(() => {
    if (fit.ready) return
    const el = box.current
    const grid = el?.querySelector('.sketchgrid')
    if (!el || !grid) return
    const w = grid.offsetWidth
    const h = grid.offsetHeight
    if (!w || !h) return
    const zoom = Math.min(SKETCH_ZOOM_MAX, el.clientWidth / w, el.clientHeight / h) * 0.98
    if (!fit.wrap && zoom < 1.5 && openings.length > 2) {
      setFit({ zoom: 1, wrap: true, row: Math.ceil(w * 0.56), ready: false })
      return
    }
    setFit({ ...fit, zoom, ready: true })
  }, [fit, openings.length])
  return (
    <div ref={box} className="padsketch ink" style={style}>
      <div
        className={`padsketchin${fit.wrap ? ' rows2' : ''}`}
        style={{ zoom: fit.zoom, visibility: fit.ready ? 'visible' : 'hidden', width: fit.wrap ? fit.row : undefined }}
      >
        <SketchGrid openings={openings} />
      </div>
    </div>
  )
}

/** The pieces drawn in the bottom half: every built line with a size, once, its count beside it. */
export const openingsOf = (pad) => pad.lines
  .filter((l) => !l.extra && l.w && l.h && (l.w.inches || l.w.soot) && (l.h.inches || l.h.soot))
  .map((l) => ({ id: l.id, form: l.form, fill: l.fill, w: l.w, h: l.h, qty: l.qty }))

/**
 * One copy of the pad. `who` is the customer as the pad writes them: name,
 * address, mobile; `number` the work order's.
 */
export function PadSheet({ copy, number, who, pad, fixedZoom, thumb = false }) {
  const box = useRef(null)
  const [zoom, setZoom] = useState(fixedZoom ?? 1)
  useLayoutEffect(() => {
    if (fixedZoom) return undefined
    const el = box.current
    if (!el) return undefined
    const fitTo = () => {
      const padPx = (PAD_W / 25.4) * 96
      if (el.clientWidth) setZoom(Math.min(1.2, el.clientWidth / padPx))
    }
    fitTo()
    const ro = new ResizeObserver(fitTo)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fixedZoom])

  const total = totalOf(pad)
  const adv = Math.round(Number(pad.advance) || 0)
  const rows = [
    ...pad.lines.map((l) => ({ key: l.id, label: `× ${l.label}`, qty: qtyOf(l), amt: l.amount ? plain(l.amount) : '' })),
    ...(pad.fare ? [{ key: 'fare', word: 'Fare', amt: plain(pad.fare), under: 'single' }] : []),
    { key: 'total', amt: plain(total), strong: true },
    ...(adv > 0
      ? [
          { key: 'adv', word: 'Advance', amt: plain(adv), under: 'single' },
          { key: 'bal', amt: plain(total - adv), strong: true, under: 'double' },
        ]
      : []),
  ]
  // The pad has ten ruled lines; a longer order closes them up to fit.
  const step = rows.length > RULES ? (RULE_STEP * RULES) / rows.length : RULE_STEP
  const ruleCount = Math.max(RULES, rows.length)
  const size = Math.min(4.6, step * 0.5)
  const values = {
    name: who.name || '',
    address: who.address || '',
    mobile: who.mobile || '',
    orderDate: padDate(pad.orderDate),
    deliveryDate: padDate(pad.deliveryDate),
  }

  return (
    <div ref={box} className="padfit" style={thumb ? { height: mm(PAD_H * zoom) } : undefined}>
      {/* A thumbnail is shrunk as one picture: a phone will not draw letters that small. */}
      <div
        className={`pad copy-${copy.key}`}
        style={{
          width: mm(PAD_W), height: mm(PAD_H), '--print-zoom': PRINT_SCALE,
          ...(thumb ? { '--zoom': 1, transform: `scale(${zoom})`, transformOrigin: 'top left' } : { '--zoom': zoom }),
        }}
      >
        <At x={15.5} base={7} size={4.1} className="pi">Order No. -</At>
        <At x={42} base={13.2} size={5.2} className="ink">{number}</At>
        <At x={24.5} base={25.6} size={8.6} className="pphone">8092850954</At>
        <At x={97.5} base={26.4} size={4.7} className="pi">Tony</At>
        <At right={107.5} base={33.2} size={4.2} className="pb">8092850956 <i>Vijay</i></At>
        <img className="plogo" src="/shiv-logo.png" alt="" style={{ left: mm(LOGO_X), top: mm(LOGO_TOP), width: mm(LOGO_H * 154 / 174), height: mm(LOGO_H) }} />
        <At x={31} base={50.6} size={6.3} className="pshop">Shiv Hardware Store</At>
        <At x={31} base={56.2} size={4.15} className="pi">Shivaji Road, Near Gandhi High School</At>
        <At x={31} base={61.6} size={4.15} className="pi">Ramgarh Cantt- 829122 Jharkhand</At>

        {FIELDS.map((f) => (
          <div key={f.key}>
            {f.label && <At x={15} base={f.y - 0.6} size={4.0} className="pi">{f.label}</At>}
            <HLine y={f.y} x0={f.from} x1={FIELD_END} />
            <At centre={(f.from + FIELD_END) / 2} base={f.y - 1.3} size={5} fit={FIELD_END - f.from - 1} className="ink">{values[f.key]}</At>
          </div>
        ))}
        <At x={15} base={124.6} size={4.0} className="pi">Customer Satisfaction Sig.</At>

        <div className="padl" style={{ left: mm(DIVIDER_X - 0.2), top: 0, width: mm(0.4), height: mm(SPLIT_Y) }} />
        <HLine y={SPLIT_Y} x0={13} x1={EST_X1} w={0.4} />

        <At centre={170} base={9} size={4.2} className="pi">Estimate</At>
        <HLine y={26.2} x0={EST_X0} x1={EST_X1} />
        <HLine y={28.8} x0={EST_X0} x1={EST_X1} />
        {Array.from({ length: ruleCount }, (_, i) => (
          <HLine key={i} y={RULE_FIRST + i * step} x0={EST_X0} x1={EST_X1} />
        ))}
        {rows.map((r, i) => {
          const base = RULE_FIRST + i * step - 1.3
          return (
            <div key={r.key}>
              {r.label && <At x={120.5} base={base} size={size} fit={69} className="ink">{r.label}</At>}
              {r.qty && <At right={202} base={base} size={size} className="ink">{r.qty}</At>}
              {r.word && <At right={201} base={base} size={size} className="ink">{r.word}</At>}
              <At right={222.5} base={base} size={r.strong ? size * 1.1 : size} className={`ink${r.strong ? ' pstrong' : ''}`}>{r.amt}</At>
              {r.under && <HLine y={base + 1.1} x0={204} x1={222.8} w={0.35} pen double={r.under === 'double'} />}
            </div>
          )
        })}

        <PadSketch openings={openingsOf(pad)} style={{ left: mm(13), top: mm(SPLIT_Y + 6), width: mm(PAD_W - 26), height: mm(PAD_H - SPLIT_Y - 14) }} />
        <At right={223} base={267.5} size={2.6} className="pcopy">{copy.label}</At>
      </div>
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

/** All three copies of the pad, printed: load pink, white, yellow paper, in that order. */
export function PrintPads({ number, who, pad, onDone }) {
  return (
    <Printing onDone={onDone}>
      {COPIES.map((copy) => <PadSheet key={copy.key} copy={copy} number={number} who={who} pad={pad} fixedZoom={1} />)}
    </Printing>
  )
}

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
import { fmtDim } from './dims.js'
import { Letterhead, addressed, sheetDate } from './Letterhead.jsx'
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

/** A rate keeps its paise: 9.5 a foot. Figures only, no Rs.: the column heads say what they are (Tony, 21 Nov). */
const rateOf = (n) => `${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
/** Amounts as the work order writes them: 1,250. */
const rupees = (n) => `${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
/** Amounts as the old pad wrote them: whole rupees, no sign, no commas. */
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
  // Measured twice where there are three or more: all on one row, then on two;
  // whichever lets the drawings be bigger is kept.
  useLayoutEffect(() => {
    if (fit.ready) return
    const el = box.current
    const grid = el?.querySelector('.sketchgrid')
    if (!el || !grid) return
    const w = grid.offsetWidth
    const h = grid.offsetHeight
    if (!w || !h) return
    const zoom = Math.min(SKETCH_ZOOM_MAX, el.clientWidth / w, el.clientHeight / h) * 0.98
    if (!fit.wrap && openings.length > 2) {
      setFit({ zoom: 1, wrap: true, row: Math.ceil(w * 0.56), ready: false, one: zoom })
      return
    }
    if (fit.wrap && fit.one != null && fit.one >= zoom) {
      setFit({ zoom: fit.one, wrap: false, row: 0, ready: true })
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
  // Each drawing keeps its line's number in the table above it.
  .map((l, i) => ({ ...l, n: i + 1 }))
  .filter((l) => !l.extra && l.w && l.h && (l.w.inches || l.w.soot) && (l.h.inches || l.h.soot))
  .map((l) => ({ id: l.id, n: l.n, form: l.form, fill: l.fill, w: l.w, h: l.h, qty: l.qty }))

/**
 * One copy of the work order, on A4 in the visit order's look (Tony, 21 Nov
 * 2026): the letterhead, who it is for, the estimate as a table, every piece
 * drawn below it, and which copy it is. `who` is the customer: name,
 * address, mobile; `number` the work order's.
 */
export function PadSheet({ copy, number, who, pad, fixedZoom, thumb = false, fitHeight = false }) {
  const box = useRef(null)
  const [zoom, setZoom] = useState(fixedZoom ?? 1)
  useLayoutEffect(() => {
    if (fixedZoom) return undefined
    const el = box.current
    if (!el) return undefined
    // To the width it has; with `fitHeight`, the whole sheet within the height too, nothing to scroll.
    const fitTo = () => {
      const padPx = (SHEET_W / 25.4) * 96
      // Only where the screen gives it a fixed height (the counter, 900px and up); on a phone its height is its own.
      const byHeight = fitHeight && el.clientHeight && window.matchMedia('(min-width: 900px)').matches ? el.clientHeight / ((SHEET_H / 25.4) * 96 + 2) : Infinity
      if (el.clientWidth) setZoom(Math.min(1.2, el.clientWidth / padPx, byHeight))
    }
    fitTo()
    const ro = new ResizeObserver(fitTo)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fixedZoom, fitHeight])

  const total = totalOf(pad)
  const adv = Math.round(Number(pad.advance) || 0)
  const openings = openingsOf(pad)

  return (
    <div ref={box} className={`padfit${fitHeight ? ' tall' : ''}`} style={thumb ? { height: mm(SHEET_H * zoom) } : undefined}>
      {/* A thumbnail is shrunk as one picture: a phone will not draw letters that small. */}
      <div
        className={`pad worksheet copy-${copy.key}`}
        style={{
          width: mm(SHEET_W), height: mm(SHEET_H), '--print-zoom': 1,
          ...(thumb ? { '--zoom': 1, transform: `scale(${zoom})`, transformOrigin: 'top left' } : { '--zoom': zoom }),
        }}
      >
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
              {pad.lines.map((l, i) => (
                <tr key={l.id}>
                  <td className="n">{i + 1}</td>
                  <td>{l.label}</td>
                  <td className="s">{l.w && l.h && (l.w.inches || l.w.soot) ? `${fmtDim(l.w)}″ × ${fmtDim(l.h)}″` : ''}</td>
                  <td className="q">{qtyOf(l)}</td>
                  <td className="r">{l.rate ? rateOf(l.rate) : ''}</td>
                  <td className="r">{l.amount ? rupees(l.amount) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="worksums">
            {pad.fare > 0 && <div><dt>Fare</dt><dd>{rupees(pad.fare)}</dd></div>}
            <div className="strong"><dt>Total</dt><dd>{rupees(total)}</dd></div>
            {adv > 0 && <div><dt>Advance</dt><dd>{rupees(adv)}</dd></div>}
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
    <Printing margin={0} onDone={onDone}>
      {COPIES.map((copy) => <PadSheet key={copy.key} copy={copy} number={number} who={who} pad={pad} fixedZoom={1} />)}
    </Printing>
  )
}

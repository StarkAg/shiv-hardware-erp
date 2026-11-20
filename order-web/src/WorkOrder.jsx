// ── Stage 4 · the work order ────────────────────────────────────────────────
// The pink pad, both halves generated. The item lines come from grouping the
// measured openings; the sketches come from their sizes. Nobody counts pieces
// off a drawing and nobody redraws a box.
//
// The advance goes into the cash book the moment it is taken, because it is
// real money in the drawer and the alternative is somebody remembering to copy
// it across in the evening.

import { useLayoutEffect, useRef, useState } from 'react'
import { SketchGrid } from './sketch.jsx'
import { useHotkeys } from './keys.js'
import { inr, lineTotal, EXTRAS } from './rates.js'
import { fmtDate, todayKey } from './store.js'
import { CheckIcon } from './icons.jsx'

export default function WorkOrder({ job, onChange, onPrint, onAdvance, onDelivered }) {
  const order = job.order || {}
  const lines = order.lines || []
  const [advance, setAdvance] = useState(String(order.advance || ''))
  const [posting, setPosting] = useState(null)

  const fare = order.fare ?? (EXTRAS.find((e) => e.id === 'fare')?.rate || 0)
  const total = lineTotal(lines) + fare
  const adv = Math.round(Number(advance) || 0)
  const balance = total - adv

  const setOrder = (patch) => onChange({ ...job, order: { ...order, ...patch } })

  const saveAdvance = async () => {
    setOrder({ advance: adv, total, balance })
    setPosting('busy')
    const r = await onAdvance(adv)
    setPosting(r?.ok ? 'done' : 'failed')
  }

  useHotkeys({
    Enter: { run: () => { if (!adv || posting === 'busy') return false; saveAdvance(); return true }, inInputs: true },
  })

  return (
    <>
      <div className="block">
        <div className="blocktitle">Dates</div>
        <div className="daterow">
          <label className="field">
            <span className="flabel">Order date</span>
            <input
              type="date" value={order.orderDate || todayKey()}
              onChange={(e) => setOrder({ orderDate: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="flabel">Delivery date</span>
            <input
              type="date" value={order.deliveryDate || ''}
              onChange={(e) => setOrder({ deliveryDate: e.target.value })}
            />
          </label>
        </div>
      </div>

      <div className="block">
        <div className="blocktitle">Advance</div>
        <div className="qtyrow">
          <input
            className="qty" inputMode="numeric" value={advance} placeholder="₹ taken now"
            onChange={(e) => { setAdvance(e.target.value.replace(/[^0-9]/g, '')); setPosting(null) }}
          />
          <button className="primbtn" onClick={saveAdvance} disabled={!adv || posting === 'busy'}>
            {posting === 'busy' ? 'Posting…' : <>Take <kbd>⏎</kbd></>}
          </button>
        </div>
        <div className={`note ${posting === 'failed' ? 'bad' : ''}`}>
          {posting === 'done' && <><CheckIcon /> Written into the cash book as money received.</>}
          {posting === 'failed' && 'Could not reach the cash book — it will go in when the phone is back online.'}
          {!posting && 'Goes into the register against this customer the moment it is taken.'}
        </div>
      </div>

      {/* ── The sheet itself, three times over ─────────────────────────── */}
      {/* The screen shows the customer's copy; printing gives all three pages. */}
      {COPIES.map((copy, i) => (
        <Sheet
          key={copy.key} copy={copy} extra={i > 0}
          job={job} order={order} lines={lines} fare={fare} total={total} adv={adv} balance={balance}
        />
      ))}
      <div className="note copiesnote">
        Prints {COPIES.length} pages, no colour: load {COPIES.map((c) => c.colour).join(', ')} paper, in that order.
      </div>

      <div className="actions stack">
        <button className="ghostbtn wide" onClick={() => printPads(onPrint)}>Print the work order</button>
        {job.status === 'ordered' && (
          <button className="primbtn wide" onClick={onDelivered}>
            Mark delivered · {inr(balance)} to collect
          </button>
        )}
      </div>
    </>
  )
}


/**
 * The three copies of the pad, as the carbon book makes them: pink for the
 * customer, white kept at the shop, yellow for the workshop. One A4 each.
 */
export const COPIES = [
  { key: 'customer', label: 'Customer copy', colour: 'pink' },
  { key: 'shop', label: 'Shop copy', colour: 'white' },
  { key: 'workshop', label: 'Workshop copy', colour: 'yellow' },
]

/**
 * The printed pad, measured (2026-11-20) from a photo of order 814 laid flat,
 * against the 23 mm commemorative five-rupee coin beside it: 230.8 x 270.8 mm.
 * Every position below is in mm from the pad's top-left corner, where the pad
 * prints it. The Epson takes paper 216 mm wide at most, so the sheet goes on
 * A4 at PRINT_SCALE, every proportion kept.
 */
const PAD_W = 230.8
const PAD_H = 270.8
const PRINT_SCALE = 204 / PAD_W   // 204 mm: A4 less 3 mm a side
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
/** The logo stands beside the shop's name, from the name's cap line to the address's baseline. */
const LOGO_TOP = 45.4
const LOGO_H = 61.6 - LOGO_TOP
const LOGO_X = 31 - 2.6 - LOGO_H * 154 / 174

/** Amounts as the pad writes them: whole rupees, no sign, no commas. */
const plain = (n) => String(Math.round(Number(n) || 0))

/** dd/mm/yy, as the pad is dated. */
function padDate(key) {
  if (!key) return ''
  const [y, m, d] = String(key).split('-')
  return d && m && y ? `${d}/${m}/${y.slice(-2)}` : ''
}

const mm = (n) => `${n}mm`

/** How wide `text` runs in mm at `size` mm, in the sheet's Arial. */
let ruler = null
function textMm(text, size, weight = 600) {
  ruler = ruler || document.createElement('canvas').getContext('2d')
  ruler.font = `${weight} 100px Arial, "Helvetica Neue", Helvetica, "Liberation Sans", sans-serif`
  return (ruler.measureText(String(text ?? '')).width / 100) * size
}

/**
 * The size a line is written at to fit `width` mm whole, never cut short: a
 * little smaller first, and if that is not enough, on two lines, as a long
 * item is written on the pad.
 */
function fitText(text, size, width, weight) {
  const full = textMm(text, size, weight)
  if (full <= width) return { size, lines: 1 }
  const shrunk = size * (width / full)
  if (shrunk >= size * 0.72) return { size: shrunk, lines: 1 }
  return { size: Math.min(size * 0.82, (size * width * 1.9) / full), lines: 2 }
}

/** A line of text placed by its baseline, where it sits on the pad. With `fit`, kept whole inside that many mm. */
function At({ x, base, size, right, centre, fit, weight = 600, className = '', children, style }) {
  let fs = size
  let lines = 1
  if (fit) ({ size: fs, lines } = fitText(children, size, fit, weight))
  const place = right != null
    ? { right: mm(PAD_W - right) }
    : centre != null
      ? { left: mm(centre), transform: 'translateX(-50%)' }
      : { left: mm(x) }
  const two = lines === 2
  return (
    <div
      className={`padt ${className}`}
      style={{
        top: mm(base - fs * 0.86 - (two ? fs * 1.05 : 0)), fontSize: mm(fs), ...place,
        ...(fit ? { width: mm(fit), textAlign: centre != null ? 'center' : undefined } : {}),
        ...(two ? { whiteSpace: 'normal', lineHeight: 1.05 } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function HLine({ y, x0, x1, w = 0.3, double, pen }) {
  return <div className={`padl${double ? ' dbl' : ''}${pen ? ' pen' : ''}`} style={{ top: mm(y - w / 2), left: mm(x0), width: mm(x1 - x0), height: mm(double ? w * 3 : w) }} />
}

/** The sheet's own page for the print: A4, 3 mm edges. Taken away again after. */
export function printPads(print) {
  const style = document.createElement('style')
  style.textContent = '@page { size: A4 portrait; margin: 3mm; }'
  document.head.appendChild(style)
  const done = () => style.remove()
  window.addEventListener('afterprint', done, { once: true })
  setTimeout(done, 60_000)
  print()
}

/** The drawings at their largest, up to the pad's hand-drawn size. */
const SKETCH_ZOOM_MAX = 2.35

/**
 * The bottom half: every opening drawn, all of it on the pad. The drawings
 * are as large as the pad's hand drawings when there is room, and come down
 * together until the widest row and the tallest box both fit, never cut off
 * at an edge. Many openings go onto two rows rather than becoming specks.
 */
function PadSketch({ openings, style }) {
  const box = useRef(null)
  // `row`: in two rows, how wide a row may run, in px at zoom 1.
  const [fit, setFit] = useState({ zoom: 1, wrap: false, row: 0, ready: false })
  const key = openings.map((o) => `${o.id}:${o.form}:${o.fill}:${o.qty}:${o.w?.inches}/${o.w?.soot}x${o.h?.inches}/${o.h?.soot}`).join('|')
  useLayoutEffect(() => {
    setFit({ zoom: 1, wrap: false, row: 0, ready: false })
  }, [key])
  useLayoutEffect(() => {
    if (fit.ready) return
    const el = box.current
    const grid = el?.querySelector('.sketchgrid')
    if (!el || !grid) return
    // Layout sizes, all at zoom 1 inside the same pad, so the pad's own zoom cancels out.
    const w = grid.offsetWidth
    const h = grid.offsetHeight
    if (!w || !h) return
    const zoom = Math.min(SKETCH_ZOOM_MAX, el.clientWidth / w, el.clientHeight / h) * 0.98
    // One row too small to read: two rows, each a little over half as long, measured again.
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

export function Sheet({ copy, extra, job, order, lines, fare, total, adv, balance }) {
  // On the screen the true-size sheet is zoomed to the width it has.
  const box = useRef(null)
  const [zoom, setZoom] = useState(1)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return undefined
    const fit = () => {
      const padPx = (PAD_W / 25.4) * 96
      if (el.clientWidth) setZoom(Math.min(1.2, el.clientWidth / padPx))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rows = [
    ...lines.map((l) => ({ key: l.id, label: `× ${l.label}`, qty: `${l.qty} Pc`, amt: l.unpriced ? '' : plain(l.amount) })),
    { key: 'fare', word: 'Fare', amt: plain(fare), under: 'single' },
    { key: 'total', amt: plain(total), strong: true },
    ...(adv > 0
      ? [
          { key: 'adv', word: 'Advance', amt: plain(adv), under: 'single' },
          { key: 'bal', amt: plain(balance), strong: true, under: 'double' },
        ]
      : []),
  ]
  // The pad has ten ruled lines; a longer order closes them up to fit.
  const step = rows.length > RULES ? (RULE_STEP * RULES) / rows.length : RULE_STEP
  const ruleCount = Math.max(RULES, rows.length)
  const size = Math.min(4.6, step * 0.5)
  const values = {
    name: job.customer?.name || '',
    address: job.customer?.address || '',
    mobile: job.customer?.mobile || '',
    orderDate: padDate(order.orderDate || todayKey()),
    deliveryDate: padDate(order.deliveryDate),
  }

  return (
    <div ref={box} className={`padfit${extra ? ' copyextra' : ''}`}>
      <div
        className={`pad copy-${copy.key}`}
        style={{ width: mm(PAD_W), height: mm(PAD_H), '--zoom': zoom, '--print-zoom': PRINT_SCALE }}
      >
        {/* The shop's half, as printed on the pad. */}
        <At x={15.5} base={7} size={4.1} className="pi">Order No. -</At>
        <At x={42} base={13.2} size={5.2} className="ink">{job.number}</At>
        <At x={24.5} base={25.6} size={8.6} className="pphone">8092850954</At>
        <At x={97.5} base={26.4} size={4.7} className="pi">Tony</At>
        <At right={107.5} base={33.2} size={4.2} className="pb">8092850956 <i>Vijay</i></At>
        {/* The shop's own logo (the letterhead's), 154 x 174 as drawn: as tall
            as the name and its two address lines beside it, as the letterhead sets it. */}
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

        {/* The estimate. */}
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

        {/* The sketches: the bottom half. */}
        <PadSketch openings={job.openings || []} style={{ left: mm(13), top: mm(SPLIT_Y + 6), width: mm(PAD_W - 26), height: mm(PAD_H - SPLIT_Y - 14) }} />
        <At right={223} base={267.5} size={2.6} className="pcopy">{copy.label}</At>
      </div>
    </div>
  )
}

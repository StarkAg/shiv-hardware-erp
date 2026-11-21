// ── The pieces, drawn ───────────────────────────────────────────────────────
// Under the work order's table, every piece with a size, drawn the way a shop
// drawing is (Tony, 21 Nov 2026): the width and height on dimension lines
// with ticks at their ends, the aluminium frame as two lines, each leaf a
// sash set inside it, the way it opens as thin dashed lines meeting at the
// hinge side, small hinge plates and a handle on the frame, and what goes in
// it written on a clear label in the middle, never over a line. Under each,
// its number (the table's), what it is, the fill and how many.
//
// Drawn to proportion rather than to scale: a 12″ ventilator beside an 84″
// door at true scale leaves the ventilator a speck, and what the workshop
// needs is which piece is which, with its figures.

import { useId } from 'react'
import { fmtDim, inchesOf } from './dims.js'
import { FORMS, FILLS } from './forms.js'

const LONG_MAX = 150 // the longest side of the biggest piece on the sheet
const LONG_MIN = 56 // below this a piece stops being readable
const DIM = 26 // room for a dimension line and its figure, above and at the left
const FRAME = 4 // the frame's face, between its two lines

/**
 * Every piece is drawn to its own true ratio, sized against the biggest on
 * the sheet with the scale compressed, so bigger things stay bigger while a
 * ventilator still reads beside a door.
 */
function boxSize(w, h, longest) {
  const wi = inchesOf(w) || 1
  const hi = inchesOf(h) || 1
  const long = Math.max(wi, hi)
  const rel = Math.pow(long / (longest || long), 0.55)
  const k = Math.max(LONG_MIN, LONG_MAX * rel) / long
  return { width: wi * k, height: hi * k }
}

/** The longest side anywhere in the set, which everything is drawn against. */
export const longestSide = (openings) => (openings || []).reduce(
  (m, o) => Math.max(m, inchesOf(o.w) || 0, inchesOf(o.h) || 0), 0,
) || 1

/** A dimension line: the line, a tick at each end, the figure beside it. */
function Dim({ x1, y1, x2, y2, text, vertical }) {
  const t = 3.2
  return (
    <g className="opdim">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      {/* Architect's ticks, a short slant across each end. */}
      <line x1={x1 - t} y1={y1 + t} x2={x1 + t} y2={y1 - t} />
      <line x1={x2 - t} y1={y2 + t} x2={x2 + t} y2={y2 - t} />
      {vertical
        ? <text x={x1 - 5} y={(y1 + y2) / 2} transform={`rotate(-90 ${x1 - 5} ${(y1 + y2) / 2})`} textAnchor="middle" className="opfig">{text}″</text>
        : <text x={(x1 + x2) / 2} y={y1 - 5} textAnchor="middle" className="opfig">{text}″</text>}
    </g>
  )
}

/** Three small hinge plates down one side of a leaf. */
const Hinges = ({ x, y, h }) => (
  <>
    {[0.15, 0.5, 0.85].map((f) => <rect key={f} x={x - 1.2} y={y + h * f - 4} width="2.4" height="8" className="ophinge" />)}
  </>
)

/** The handle, at the middle of the side that opens. */
const Handle = ({ x, y, h, side }) => (
  <rect x={side === 'left' ? x + 2 : x - 4} y={y + h / 2 - 6} width="2.4" height="12" rx="1.2" className="ophandle" />
)

/**
 * One leaf: the sash inside the frame, the way it opens (dashed lines from
 * the handle side's corners to the middle of the hinge side), its hinges and
 * handle. `hinge` is the side it hangs on.
 */
function Leaf({ x, y, w, h, hinge, paint, glass }) {
  const hx = hinge === 'left' ? x : x + w
  const ox = hinge === 'left' ? x + w : x
  return (
    <>
      <rect x={x} y={y} width={w} height={h} className="opsash" style={{ fill: paint }} />
      {glass && <Glint x={x} y={y} w={w} h={h} />}
      <polyline points={`${ox},${y} ${hx},${y + h / 2} ${ox},${y + h}`} className="opswing" />
      <Hinges x={hx} y={y} h={h} />
      <Handle x={ox} y={y} h={h} side={hinge === 'left' ? 'right' : 'left'} />
    </>
  )
}

/**
 * What goes in it, shown as its own texture inside the frame (Tony, 21 Nov
 * 2026): a fine mesh for SS net, clear with a glint for glass, a flat grey
 * sheet for ACP and a wood grain for ACP with film. Kept to greys, so the
 * pad prints clean in black.
 */
function Paint({ id, fill }) {
  if (fill === 'net') return (
    <pattern id={id} width="3" height="3" patternUnits="userSpaceOnUse">
      <rect width="3" height="3" fill="#fbfbfb" />
      <path d="M0 0H3M0 0V3" stroke="#555" strokeWidth=".3" />
    </pattern>
  )
  if (fill === 'acp') return (
    <pattern id={id} width="8" height="5" patternUnits="userSpaceOnUse">
      <rect width="8" height="5" fill="#d9d9d9" />
      <path d="M0 4.6H8" stroke="#c4c4c4" strokeWidth=".4" />
    </pattern>
  )
  if (fill === 'acp-film') return (
    <pattern id={id} width="24" height="7" patternUnits="userSpaceOnUse">
      <rect width="24" height="7" fill="#e2dbd2" />
      <path d="M0 3.5Q6 1.2 12 3.5T24 3.5" fill="none" stroke="#a99a88" strokeWidth=".45" />
      <path d="M0 6.4Q6 5 12 6.4T24 6.4" fill="none" stroke="#c2b6a8" strokeWidth=".35" />
    </pattern>
  )
  return null
}
const paintOf = (fill, id) => (fill === 'glass' ? '#f4f7f8' : ['net', 'acp', 'acp-film'].includes(fill) ? `url(#${id})` : '#fff')

/** The glint on a pane of glass: two short strokes across its upper corner. */
const Glint = ({ x, y, w, h }) => (
  <g className="opglint">
    <line x1={x + w * 0.18} y1={y + h * 0.3} x2={x + w * 0.42} y2={y + h * 0.1} />
    <line x1={x + w * 0.24} y1={y + h * 0.38} x2={x + w * 0.52} y2={y + h * 0.14} />
  </g>
)

/** What goes in it, on a white label so no line runs through the words. */
function FillLabel({ cx, cy, text, room }) {
  if (!text || room < 24) return null
  const fs = Math.max(6.5, Math.min(9.5, room / (text.length * 0.62)))
  const w = text.length * fs * 0.6 + 8
  return (
    <g>
      <rect x={cx - w / 2} y={cy - fs * 0.85} width={w} height={fs * 1.5} className="oplabelbg" />
      <text x={cx} y={cy + fs * 0.35} textAnchor="middle" className="oplabel" fontSize={fs}>{text}</text>
    </g>
  )
}

export function Opening({ o, n, longest }) {
  const form = FORMS[o.form]
  const fill = FILLS[o.fill]
  const { width, height } = boxSize(o.w, o.h, longest ?? Math.max(inchesOf(o.w), inchesOf(o.h)))
  const draw = form?.draw || 'plain'
  const leaves = o.leaves ?? form?.leaves ?? 1
  const words = fill?.short || o.fill || ''
  const uid = `fill${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const paint = paintOf(o.fill, uid)
  const glass = o.fill === 'glass'

  // The box sits below and right of its dimension lines.
  const X = DIM
  const Y = DIM
  const W = DIM + width + 4
  const H = DIM + height + 4
  const ix = X + FRAME
  const iy = Y + FRAME
  const iw = width - FRAME * 2
  const ih = height - FRAME * 2
  const half = iw / 2

  return (
    <figure className="opening">
      <svg className="opbox" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`${fmtDim(o.w)} by ${fmtDim(o.h)} inch ${form?.label || ''} with ${words}`}>
        <defs><Paint id={uid} fill={o.fill} /></defs>
        {/* Extension lines from the corners, and the dimension lines on them. */}
        <g className="opext">
          <line x1={X} y1={Y - 2} x2={X} y2={Y - DIM + 6} />
          <line x1={X + width} y1={Y - 2} x2={X + width} y2={Y - DIM + 6} />
          <line x1={X - 2} y1={Y} x2={X - DIM + 6} y2={Y} />
          <line x1={X - 2} y1={Y + height} x2={X - DIM + 6} y2={Y + height} />
        </g>
        <Dim x1={X} y1={Y - DIM + 10} x2={X + width} y2={Y - DIM + 10} text={fmtDim(o.w)} />
        <Dim x1={X - DIM + 10} y1={Y} x2={X - DIM + 10} y2={Y + height} text={fmtDim(o.h)} vertical />

        {/* The frame: its outer and inner edge. A wall panel is one flat sheet in its own texture. */}
        <rect x={X} y={Y} width={width} height={height} className="opframe" />
        {draw !== 'panel' && <rect x={ix} y={iy} width={iw} height={ih} className="opinner" />}

        {draw === 'openable' && leaves >= 2 && (
          <>
            <Leaf x={ix + 2} y={iy + 2} w={half - 3} h={ih - 4} hinge="left" paint={paint} glass={glass} />
            <Leaf x={ix + half + 1} y={iy + 2} w={half - 3} h={ih - 4} hinge="right" paint={paint} glass={glass} />
            <FillLabel cx={ix + half / 2 + 2} cy={iy + ih / 2} text={words} room={half - 12} />
            <FillLabel cx={ix + half * 1.5} cy={iy + ih / 2} text={words} room={half - 12} />
          </>
        )}
        {draw === 'openable' && leaves < 2 && (
          <>
            <Leaf x={ix + 2} y={iy + 2} w={iw - 4} h={ih - 4} hinge="left" paint={paint} glass={glass} />
            <FillLabel cx={ix + iw / 2} cy={iy + ih / 2} text={words} room={iw - 14} />
          </>
        )}
        {draw === 'door' && (
          <>
            <Leaf x={ix + 2} y={iy + 2} w={iw - 4} h={ih - 4} hinge="left" paint={paint} glass={glass} />
            <FillLabel cx={ix + iw / 2} cy={iy + ih / 2} text={words} room={iw - 14} />
          </>
        )}
        {draw === 'plain' && (
          <>
            <rect x={ix + 1} y={iy + 1} width={iw - 2} height={ih - 2} className="opsash" style={{ fill: paint }} />
            {glass && <Glint x={ix} y={iy} w={iw} h={ih} />}
            <FillLabel cx={ix + iw / 2} cy={iy + ih / 2} text={words} room={iw - 6} />
          </>
        )}
        {draw === 'panel' && (
          <>
            <rect x={X + 1} y={Y + 1} width={width - 2} height={height - 2} style={{ fill: paint }} />
            <FillLabel cx={X + width / 2} cy={Y + height / 2} text={words} room={width - 8} />
          </>
        )}
      </svg>
      {/* Two short lines, no wider than the drawing needs: what it is, then what goes in it and how many. */}
      <figcaption className="opcap" style={{ marginLeft: DIM }}>
        {n != null && <b className="opn">{n}</b>}
        <span>
          <i>{form?.label}</i>
          <small>{[words, `${Math.round((Number(o.qty) || 0) * 100) / 100} Pc`].filter(Boolean).join(' · ')}</small>
        </span>
      </figcaption>
    </figure>
  )
}

export function SketchGrid({ openings, numbered = true }) {
  if (!openings?.length) return null
  const longest = longestSide(openings)
  // In the table's order, each with the number of its line, so 1 is drawn first.
  const sorted = openings.map((o, i) => ({ ...o, n: o.n ?? i + 1 })).sort((a, b) => a.n - b.n)
  return (
    <div className="sketchgrid">
      {sorted.map((o) => <Opening key={o.id} o={o} n={numbered ? o.n : null} longest={longest} />)}
    </div>
  )
}

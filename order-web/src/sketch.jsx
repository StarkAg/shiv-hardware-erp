// ── The openings, drawn ─────────────────────────────────────────────────────
// The bottom half of the pink pad, generated. Today somebody redraws fifteen
// boxes by hand from the mechanic's sheet and writes the sizes on them again,
// which is two chances to lose a piece and one to mis-copy a fraction. The
// sizes are already typed; the boxes come from them.
//
// The form decides what gets drawn — a two-door window gets its centre stile,
// its hinge dots on the outer stiles and the two swing brackets the pad draws;
// a flat ACP wall gets none of that, because there is nothing to hang. The
// fill decides only what is written inside.
//
// Drawn roughly to proportion rather than to scale: a 12″ ventilator beside an
// 84″ door at true scale leaves the ventilator unreadable, and what the
// workshop needs off this sheet is which opening is which, with its figures.

import { fmtDim, inchesOf } from './dims.js'
import { FORMS, FILLS } from './rates.js'

const LONG_MAX = 124   // the longest side of the biggest opening on the sheet
const LONG_MIN = 44    // below this a box stops being readable

/**
 * Every box is drawn to its own true ratio, and sized against the biggest
 * opening on the sheet — so a 12″ ventilator is visibly smaller than a 41″
 * window instead of both filling the same square, and two ventilators that
 * differ by an inch look like it.
 *
 * The scale is compressed rather than linear. A door is seven times a
 * ventilator; drawn at true scale the ventilator is a speck, and what the
 * workshop needs off this sheet is to tell the pieces apart. The power here
 * keeps bigger things bigger while pulling the extremes together.
 */
function boxSize(w, h, longest) {
  const wi = inchesOf(w) || 1
  const hi = inchesOf(h) || 1
  const long = Math.max(wi, hi)
  const rel = Math.pow(long / (longest || long), 0.55)
  const longPx = Math.max(LONG_MIN, LONG_MAX * rel)
  const k = longPx / long           // one factor for both axes, so the ratio holds
  return { width: wi * k, height: hi * k }
}

/** The longest side anywhere in the set, which everything is drawn against. */
export const longestSide = (openings) => (openings || []).reduce(
  (m, o) => Math.max(m, inchesOf(o.w) || 0, inchesOf(o.h) || 0), 0,
) || 1

/** The dots a leaf swings on, down one stile. */
const Hinges = ({ x, height }) => (
  <>
    {[0.2, 0.5, 0.8].map((f) => (
      <circle key={f} cx={x} cy={height * f} r="2" className="ophinge" />
    ))}
  </>
)

/** The little bracket the pad draws in the middle of an openable leaf. */
const Swing = ({ x, height, dir }) => (
  <path
    className="opswing"
    d={dir === 'left'
      ? `M ${x + 4} ${height * 0.34} q -5 ${height * 0.16} 0 ${height * 0.32}`
      : `M ${x - 4} ${height * 0.34} q 5 ${height * 0.16} 0 ${height * 0.32}`}
  />
)

export function Opening({ o, n, longest, qty }) {
  const form = FORMS[o.form]
  const fill = FILLS[o.fill]
  const { width, height } = boxSize(o.w, o.h, longest ?? Math.max(inchesOf(o.w), inchesOf(o.h)))
  const draw = form?.draw || 'plain'
  const leaves = o.leaves ?? form?.leaves ?? 1
  const full = fill?.short || o.fill || ''
  // What the writing actually has to fit inside: one leaf, less the stiles and
  // the hinge dots down them. A label that runs over those is worse than no
  // label — it reads as part of the drawing.
  const perLeaf = (leaves >= 2 ? width / 2 : width) - 18
  // A tall window's leaves are narrow. Rather than drop what is inside it,
  // the label is written once across the whole box, low enough to clear the
  // swing brackets.
  const spanBox = leaves >= 2 && perLeaf < 26
  const avail = spanBox ? width - 14 : perLeaf
  // A narrow leaf takes the first word only: "Net" still says which of the
  // three fills it is, and "Net SS" laid over a hinge says nothing.
  const label = avail < 42 ? full.split(' ')[0] : full
  const fs = Math.max(6, Math.min(10, avail / (label.length * 0.66)))
  const fits = avail >= 22

  return (
    <div className="opening">
      {/* The figures sit against the edge each one measures, the way they are
          written on the sheet: the width centred along the top of the box,
          the height centred down its side. Each label is given the box's own
          dimension so it centres on the drawing rather than on the column. */}
      <div className="oprow">
        <div className="oph" style={{ height }}>{fmtDim(o.h)}″</div>
        <div className="opstack">
          <div className="opw" style={{ width }}>{fmtDim(o.w)}″</div>
          <svg
          className="opbox" width={width} height={height}
          viewBox={`0 0 ${width} ${height}`} role="img"
          aria-label={`${fmtDim(o.w)} by ${fmtDim(o.h)} inch ${form?.label || ''} with ${label}`}
        >
          <rect x="1" y="1" width={width - 2} height={height - 2} className="opframe" />

          {/* A door carries its chaukhat as a second line inside the first. */}
          {draw === 'door' && (
            <rect x="5" y="5" width={width - 10} height={height - 10} className="opframe thin" />
          )}

          {draw === 'openable' && leaves >= 2 && (
            <>
              <line x1={width / 2} y1="1" x2={width / 2} y2={height - 1} className="opframe" />
              <Hinges x={5} height={height} />
              <Hinges x={width - 5} height={height} />
              <Swing x={width / 2} height={height} dir="left" />
              <Swing x={width / 2} height={height} dir="right" />
              {fits && (spanBox ? (
                <text x={width / 2} y={height * 0.78} className="oplabel" fontSize={fs} textAnchor="middle">{label}</text>
              ) : (
                <>
                  <text x={width * 0.25} y={height / 2 + fs / 3} className="oplabel" fontSize={fs} textAnchor="middle">{label}</text>
                  <text x={width * 0.75} y={height / 2 + fs / 3} className="oplabel" fontSize={fs} textAnchor="middle">{label}</text>
                </>
              ))}
            </>
          )}

          {draw === 'openable' && leaves < 2 && (
            <>
              <Hinges x={5} height={height} />
              <Swing x={width - 4} height={height} dir="right" />
              {fits && <text x={width / 2} y={height / 2 + fs / 3} className="oplabel" fontSize={fs} textAnchor="middle">{label}</text>}
            </>
          )}

          {draw === 'door' && (
            <>
              <Hinges x={9} height={height} />
              {/* The handle, so the sheet says which side it opens from. */}
              <rect x={width - 16} y={height / 2 - 5} width="4" height="10" className="ophandle" />
              {fits && <text x={width / 2} y={height / 2 + fs / 3} className="oplabel" fontSize={fs} textAnchor="middle">{label}</text>}
            </>
          )}

          {draw === 'plain' && fits && (
            <text x={width / 2} y={height / 2 + fs / 3} className="oplabel" fontSize={fs} textAnchor="middle">{label}</text>
          )}

          {draw === 'panel' && (
            <>
              {/* Hatched, so a solid wall panel never reads as an opening. */}
              <line x1="1" y1={height - 1} x2={width - 1} y2="1" className="ophatch" />
              <text x={width / 2} y={height / 2 + fs / 3} className="oplabel" fontSize={fs} textAnchor="middle">{label}</text>
            </>
          )}

          {n != null && <text x="5" y="11" className="opnum">{n}</text>}
          </svg>
        </div>
        {qty > 1 && <span className="opqty">×{qty}</span>}
      </div>
      {o.note ? <div className="opnote">{o.note}</div> : null}
    </div>
  )
}

export function SketchGrid({ openings, numbered = true }) {
  if (!openings?.length) return null
  const longest = longestSide(openings)
  // Tall first, the way the pad runs: doors and openable windows across the
  // top, then the ventilators in rows underneath.
  const sorted = [...openings].sort((a, b) => {
    const ah = inchesOf(a.h) > inchesOf(a.w) ? 0 : 1
    const bh = inchesOf(b.h) > inchesOf(b.w) ? 0 : 1
    return ah - bh
  })
  return (
    <div className="sketchgrid">
      {sorted.map((o, i) => (
        <Opening key={o.id} o={o} n={numbered ? i + 1 : null} longest={longest} qty={o.qty} />
      ))}
    </div>
  )
}

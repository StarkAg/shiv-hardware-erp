import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * The two charts the front page needs, drawn as plain SVG.
 *
 * No chart library: two forms at this size are a few dozen lines of geometry,
 * and the smallest usable library is heavier than the panel's own React. The
 * series colours are `--series-sale` and `--series-purchase` in index.css,
 * stepped separately for light and dark and checked for colour-blind
 * separation rather than picked by eye.
 */

const inr = (n: number) =>
  n >= 10_000_000 ? `${(n / 10_000_000).toFixed(1)}Cr`
  : n >= 100_000 ? `${(n / 100_000).toFixed(1)}L`
  : n >= 1_000 ? `${Math.round(n / 1_000)}k`
  : String(Math.round(n))

const full = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

/**
 * A top gridline that is a number a person would say, and close enough to the
 * tallest bar that the chart is not mostly empty.
 *
 * Rounding to the next power of ten does the first and ruins the second: a
 * busiest month of ₹10.2L would take a ₹20L ceiling and spend half the plot
 * on white space. Stepping through 1 · 1.5 · 2 · 2.5 · 3 · 4 · 5 · 7.5 keeps
 * the label round and the tallest bar above four fifths of the height.
 */
const NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]
function niceCeiling(peak: number, divisions = 4) {
  const raw = peak / divisions
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const stepped = NICE.find((n) => n * magnitude >= raw) ?? 10
  return stepped * magnitude * divisions
}

/**
 * The width the chart is actually being drawn at.
 *
 * An SVG stretched to fit its box drags the type with it — 11px labels come
 * out 13px wide and 11px tall on a laptop, and squashed on a phone. Measuring
 * the box and drawing at that many units instead keeps one SVG unit equal to
 * one pixel, so text is the size it says it is at every width.
 */
function useDrawnWidth(fallback = 640) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width)
      if (next > 0) setWidth(next)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

export type Month = { ym: string; label: string; sales: number; purchases: number }

/**
 * Sales against purchases, by month.
 *
 * Grouped bars rather than two lines: a month is a bucket the shop closes, not
 * a reading on a continuum, and the pair is meant to be compared within the
 * month before it is read across them. One axis — both series are rupees, so
 * a second scale would only be a way of making them look alike.
 */
export function TradeByMonth({ months }: { months: Month[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const titleId = useId()

  const peak = Math.max(1, ...months.flatMap((m) => [m.sales, m.purchases]))
  const ceiling = niceCeiling(peak)
  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((f) => f * ceiling)

  const [plotRef, W] = useDrawnWidth()
  const H = 240, padL = 46, padR = 8, padT = 8, padB = 26
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const slot = plotW / Math.max(months.length, 1)
  // Thin marks, and never wider than the gap that separates the pair.
  const barW = Math.max(3, Math.min(14, (slot - 6) / 2))
  // "Sept" needs about 26px at 11px type. Where a month is narrower than that,
  // label every other one rather than letting them run together.
  const everyOther = slot < 30
  const y = (v: number) => padT + plotH - (v / ceiling) * plotH

  return (
    <figure className="chart-card">
      <figcaption className="chart-head">
        <h2 id={titleId} className="chart-title">Sales and purchases</h2>
        <div className="chart-legend">
          <span><i className="key key-sale" /> Sales</span>
          <span><i className="key key-purchase" /> Purchases</span>
        </div>
      </figcaption>

      <div className="chart-plot" ref={plotRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-labelledby={titleId}>
          {gridlines.map((g) => (
            <g key={g}>
              <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} className="grid" />
              <text x={padL - 8} y={y(g) + 4} className="axis" textAnchor="end">{inr(g)}</text>
            </g>
          ))}

          {months.map((m, i) => {
            const x = padL + i * slot
            const mid = x + slot / 2
            return (
              <g key={m.ym}
                 onMouseEnter={() => setHover(i)}
                 onMouseLeave={() => setHover(null)}>
                {/* A hit area the width of the month, so the pointer does not
                    have to find a 14px bar. */}
                <rect x={x} y={padT} width={slot} height={plotH} fill="transparent" />
                {hover === i && <rect x={x} y={padT} width={slot} height={plotH} className="hoverband" />}
                <rect
                  x={mid - barW - 1} y={y(m.sales)} width={barW}
                  height={Math.max(plotH - (y(m.sales) - padT), 0)}
                  rx={3} className="bar bar-sale"
                />
                <rect
                  x={mid + 1} y={y(m.purchases)} width={barW}
                  height={Math.max(plotH - (y(m.purchases) - padT), 0)}
                  rx={3} className="bar bar-purchase"
                />
                {(!everyOther || i % 2 === 0) && (
                  <text x={mid} y={H - 8} className="axis" textAnchor="middle">{m.label}</text>
                )}
              </g>
            )
          })}
        </svg>

        {/* The figures themselves, for the month under the pointer. Values are
            in text tokens, never in the series colour — the swatch carries
            identity, the number carries the amount. */}
        {hover !== null && months[hover] && (
          <div className="chart-tip" style={{ left: `${((hover + 0.5) / months.length) * 100}%` }}>
            <div className="chart-tip-when">{months[hover].label} {months[hover].ym.slice(0, 4)}</div>
            <div><i className="key key-sale" /> Sales <b>{full(months[hover].sales)}</b></div>
            <div><i className="key key-purchase" /> Purchases <b>{full(months[hover].purchases)}</b></div>
          </div>
        )}
      </div>
    </figure>
  )
}

/**
 * The largest balances, largest first.
 *
 * Bars run along the name so the names stay readable at any length, and each
 * carries its own amount — six rows is a list to be read, not a shape to be
 * eyeballed against an axis.
 */
export function TopBalances({
  title,
  rows,
  side,
  tone,
}: {
  title: string
  rows: { ledgerId: string; name: string; amount: number }[]
  side: 'customers' | 'suppliers'
  tone: 'sale' | 'purchase'
}) {
  const peak = Math.max(1, ...rows.map((r) => r.amount))
  return (
    <figure className="chart-card">
      <figcaption className="chart-head">
        <h2 className="chart-title">{title}</h2>
      </figcaption>
      {!rows.length ? (
        <div className="empty">Nothing outstanding.</div>
      ) : (
        <ul className="rankrows">
          {rows.map((r) => (
            <li key={r.ledgerId}>
              <Link to={`/ledger/${side}/${r.ledgerId}`}>
                <span className="rank-name">{r.name}</span>
                <span className="rank-amt">{full(r.amount)}</span>
                <span className="rank-track">
                  <span className={`rank-fill rank-${tone}`} style={{ width: `${(r.amount / peak) * 100}%` }} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </figure>
  )
}

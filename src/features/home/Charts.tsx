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
/** "today", "1 day ago", "34 days ago": counted in whole days, from the date written on the entry. */
const ago = (date: number) => {
  const days = Math.max(0, Math.floor((Date.now() - date) / 86_400_000))
  return days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}

export function TopBalances({
  title,
  rows,
  side,
  tone,
}: {
  title: string
  rows: { ledgerId: string; name: string; amount: number; lastMoney?: number | null }[]
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
                {r.lastMoney !== undefined && (
                  <span className="rank-when">
                    {r.lastMoney === null ? (side === 'customers' ? 'Never paid' : 'Never paid by us') : `Last money ${ago(r.lastMoney)}`}
                  </span>
                )}
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

// ── Sales, month by month ─────────────────────────────────────────────────

/** A straight line through the points, by ordinary least squares. */
function trendLine(values: number[]) {
  const n = values.length
  const meanX = (n - 1) / 2
  const meanY = values.reduce((t, v) => t + v, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY)
    den += (i - meanX) ** 2
  }
  const slope = den ? num / den : 0
  const intercept = meanY - slope * meanX
  return { slope, meanY, at: (i: number) => Math.max(0, intercept + slope * i) }
}

const daysIn = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/**
 * Sales month by month since the books began, and where they are heading.
 *
 * Only finished months make the line and the trend through it. The month in
 * hand is shown twice: what is billed so far, and the pace that sets for the
 * whole month, worked out over the days the books are written up for
 * (`writtenTo`, the last sale's date) rather than the days gone, because books
 * typed up a week late would otherwise read as a collapse. Months before the
 * books really began, with a handful of entries in them, are left off so they
 * do not drag the line down.
 */
export function SalesTrajectory({ months, writtenTo }: { months: Month[]; writtenTo: number | null }) {
  const titleId = useId()
  const [hover, setHover] = useState<number | null>(null)
  const [plotRef, W] = useDrawnWidth(820)

  const current = months[months.length - 1]
  const before = months.slice(0, -1)
  // From after the last thin month: Apr to Jul 2026 held a few big bills each
  // before the books were kept in full, and drew a trend of +38% a month.
  const peak = Math.max(0, ...before.map((m) => m.sales))
  const thin = before.map((m) => m.sales < peak * 0.1).lastIndexOf(true)
  const done = peak > 0 ? before.slice(thin + 1) : []

  // The pace of the month in hand, from the days written up so far.
  const written = writtenTo === null ? null : new Date(writtenTo)
  const writtenYm = written && `${written.getUTCFullYear()}-${String(written.getUTCMonth() + 1).padStart(2, '0')}`
  const daysWritten = written && current && writtenYm === current.ym ? written.getUTCDate() : 0
  const pace = current && daysWritten ? (current.sales / daysWritten) * daysIn(current.ym) : null

  const fit = done.length >= 3 ? trendLine(done.map((m) => m.sales)) : null
  const perMonth = fit && fit.meanY ? (fit.slope / fit.meanY) * 100 : null

  if (!current || done.length < 2) {
    return (
      <figure className="chart-card">
        <figcaption className="chart-head"><h2 className="chart-title">Sales month by month</h2></figcaption>
        <div className="empty">Two finished months of sales are needed to draw this.</div>
      </figure>
    )
  }

  const labels = [...done.map((m) => m.label), current.label]
  const H = 250, padL = 48, padR = 16, padT = 16, padB = 26
  const plotW = Math.max(W - padL - padR, 1)
  const plotH = H - padT - padB
  const n = labels.length
  const now = n - 1
  const top = Math.max(1, ...done.map((m) => m.sales), current.sales, pace ?? 0, fit ? fit.at(now) : 0)
  const ceiling = niceCeiling(top)
  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((f) => f * ceiling)
  const step = plotW / Math.max(n - 1, 1)
  const x = (i: number) => padL + i * step
  const y = (v: number) => padT + plotH - (v / ceiling) * plotH
  const line = done.map((m, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(m.sales).toFixed(1)}`).join(' ')

  const tip = (i: number): { when: string; rows: [string, number][] } => i < done.length
    ? { when: `${done[i].label} ${done[i].ym.slice(0, 4)}`, rows: [['Sales', done[i].sales]] }
    : {
        when: `${current.label} ${current.ym.slice(0, 4)} · so far`,
        rows: [['Billed so far', current.sales], ...(pace !== null ? [['On pace for', pace] as [string, number]] : [])],
      }

  const last = done[done.length - 1]
  return (
    <figure className="chart-card">
      <figcaption className="chart-head">
        <h2 id={titleId} className="chart-title">Sales month by month</h2>
        <div className="chart-legend">
          <span><i className="key key-sale" /> Sales</span>
          {fit && <span><i className="key key-projected" /> Trend</span>}
        </div>
      </figcaption>

      <div className="outlook-lede">
        <div className="outlook-figure">
          {pace !== null ? (
            <>
              <span className="outlook-label">{current.label}, at its pace so far</span>
              <span className="outlook-hero">{full(pace)}</span>
              <span className="outlook-range">{full(current.sales)} billed in the {daysWritten} days written up</span>
            </>
          ) : (
            <>
              <span className="outlook-label">{last.label}, the last finished month</span>
              <span className="outlook-hero">{full(last.sales)}</span>
              <span className="outlook-range">No sales written up for {current.label} yet</span>
            </>
          )}
        </div>
        {perMonth !== null && (
          <span className={`outlook-chip ${perMonth >= 0 ? 'is-up' : 'is-down'}`}>
            <b>{perMonth >= 0 ? '▲' : '▼'} {Math.abs(perMonth).toFixed(0)}% a month</b>
            <small>the trend over {done.length} months</small>
          </span>
        )}
      </div>

      <div className="chart-plot" ref={plotRef}>
        <svg
          viewBox={`0 0 ${W} ${H}`} width={W} height={H}
          role="img" aria-labelledby={titleId}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            const at = Math.round((e.clientX - box.left - padL) / step)
            setHover(at >= 0 && at < n ? at : null)
          }}
        >
          <desc>Sales for each finished month since the books began, this month so far and at its pace, and the trend line.</desc>
          {gridlines.map((g) => (
            <g key={g}>
              <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} className="grid" />
              <text x={padL - 8} y={y(g) + 4} className="axis" textAnchor="end">{inr(g)}</text>
            </g>
          ))}

          {fit && (
            <path
              d={`M${x(0).toFixed(1)} ${y(fit.at(0)).toFixed(1)} L${x(now).toFixed(1)} ${y(fit.at(now)).toFixed(1)}`}
              className="outlook-line is-projected"
            />
          )}
          <path d={line} className="outlook-line" />
          {done.map((m, i) => <circle key={m.ym} cx={x(i)} cy={y(m.sales)} r={3.5} className="outlook-dot" />)}

          {/* The month in hand: billed so far, filled; its pace, hollow. */}
          <circle cx={x(now)} cy={y(current.sales)} r={4.5} className="outlook-dot" />
          {pace !== null && (
            <>
              <line x1={x(now)} x2={x(now)} y1={y(current.sales)} y2={y(pace)} className="grid" />
              <circle cx={x(now)} cy={y(pace)} r={5} className="outlook-dot is-projected" />
              <text x={x(now)} y={y(pace) - 10} className="outlook-endlabel" textAnchor="end">{inr(pace)}</text>
            </>
          )}

          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} className="crosshair" />}
          {labels.map((label, i) => (
            <text key={i} x={x(i)} y={H - 8} className="axis" textAnchor="middle">{label}</text>
          ))}
        </svg>

        {hover !== null && (
          <div className="chart-tip" style={{ left: `${(hover / Math.max(n - 1, 1)) * 100}%` }}>
            <div className="chart-tip-when">{tip(hover).when}</div>
            {tip(hover).rows.map(([label, value]) => (
              <div key={label}><i className="key key-sale" /> {label} <b>{full(value)}</b></div>
            ))}
          </div>
        )}
      </div>

      <p className="chart-note">
        The trend is a straight line through the finished months. It knows nothing of
        contracts, festivals or the season: read it as the direction so far, not a promise.
      </p>
    </figure>
  )
}

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

// ── Outlook ────────────────────────────────────────────────────────────────

/**
 * A straight line through the recent months, and how far the months actually
 * sat from it.
 *
 * Ordinary least squares, which is the honest ceiling for what twelve numbers
 * from one counter can say. It is deliberately not dressed up as more than
 * that: the shop is told the method in the caption and given a range rather
 * than a single figure, because a hardware shop's month turns on a couple of
 * contracts and no arithmetic here can know about them.
 */
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
  // Spread of the actual months about that line — the basis of the range.
  const residuals = values.map((v, i) => v - (intercept + slope * i))
  const sd = Math.sqrt(
    residuals.reduce((t, r) => t + r * r, 0) / Math.max(1, n - 2),
  )
  return { slope, intercept, sd, at: (i: number) => intercept + slope * i }
}

export type Projection = {
  ym: string
  label: string
  value: number
  low: number
  high: number
}

/**
 * The next few months, projected from the last six.
 *
 * Six rather than all twelve: a shop's trade a year ago is a different shop,
 * and a stale slow season drags the line through a run of good months. Fewer
 * than four months of trade projects nothing at all — a line through two
 * points is a rumour, not a forecast.
 */
export function project(months: Month[], ahead = 3): Projection[] {
  const traded = months.filter((m) => m.sales > 0)
  if (traded.length < 4) return []

  const window = months.slice(-6)
  const fit = trendLine(window.map((m) => m.sales))
  const last = months[months.length - 1]
  const [y, mo] = last.ym.split('-').map(Number)

  return Array.from({ length: ahead }, (_, step) => {
    const d = new Date(Date.UTC(y, mo - 1 + step + 1, 1))
    const value = Math.max(0, fit.at(window.length - 1 + step + 1))
    // The band widens the further out it reaches: the arithmetic is no more
    // certain about March than about next week, and a flat band would say it
    // was.
    const spread = fit.sd * Math.sqrt(1 + (step + 1) / window.length)
    return {
      ym: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }),
      value,
      low: Math.max(0, value - spread),
      high: value + spread,
    }
  })
}

/**
 * Turnover as it has run, and where the trend points next.
 *
 * One measure — money billed — so one scale. The projected months are the same
 * series in a different state, so they keep the same hue and are told apart by
 * a dashed stroke, a hollow marker and the band around them. That pairing is
 * worth a legend: a dashed line is a convention, not something the eye reads
 * on its own.
 *
 * The hero figure is next month, because that is the number the shop plans
 * against; the chart behind it is the evidence for it.
 */
export function TurnoverOutlook({ months }: { months: Month[] }) {
  const titleId = useId()
  const [hover, setHover] = useState<number | null>(null)
  const [plotRef, W] = useDrawnWidth(820)

  const ahead = project(months)
  const points = [
    ...months.map((m) => ({ ym: m.ym, label: m.label, value: m.sales, projected: false })),
    ...ahead.map((p) => ({ ym: p.ym, label: p.label, value: p.value, projected: true })),
  ]

  const H = 250, padL = 48, padR = 16, padT = 12, padB = 26
  const plotW = Math.max(W - padL - padR, 1)
  const plotH = H - padT - padB
  const peak = Math.max(1, ...points.map((p) => p.value), ...ahead.map((p) => p.high))
  const ceiling = niceCeiling(peak)
  const gridlines = [0, 0.25, 0.5, 0.75, 1].map((f) => f * ceiling)

  const step = plotW / Math.max(points.length - 1, 1)
  const x = (i: number) => padL + i * step
  const y = (v: number) => padT + plotH - (v / ceiling) * plotH
  const everyOther = step < 30

  const path = (from: number, to: number) =>
    points.slice(from, to + 1)
      .map((p, k) => `${k ? 'L' : 'M'}${x(from + k).toFixed(1)} ${y(p.value).toFixed(1)}`)
      .join(' ')

  const lastActual = months.length - 1
  // Drawn from the last real month, so the band springs from the figure it is
  // extrapolating rather than appearing out of a gap.
  const band = ahead.length
    ? [
        `M${x(lastActual).toFixed(1)} ${y(months[lastActual].sales).toFixed(1)}`,
        ...ahead.map((p, k) => `L${x(lastActual + k + 1).toFixed(1)} ${y(p.high).toFixed(1)}`),
        ...[...ahead].reverse().map((p, k) =>
          `L${x(points.length - 1 - k).toFixed(1)} ${y(p.low).toFixed(1)}`),
        'Z',
      ].join(' ')
    : ''

  const next = ahead[0]
  // Measured against the recent run, not against last month alone: one quiet
  // month would otherwise read as a collapse.
  const recent = months.slice(-4, -1).filter((m) => m.sales > 0)
  const baseline = recent.length
    ? recent.reduce((t, m) => t + m.sales, 0) / recent.length
    : 0
  const change = next && baseline ? ((next.value - baseline) / baseline) * 100 : null

  return (
    <figure className="chart-card">
      <figcaption className="chart-head">
        <h2 id={titleId} className="chart-title">Turnover outlook</h2>
        {ahead.length > 0 && (
          <div className="chart-legend">
            <span><i className="key key-sale" /> Billed</span>
            <span><i className="key key-projected" /> Projected</span>
          </div>
        )}
      </figcaption>

      {ahead.length === 0 ? (
        <div className="empty">
          Not enough trade yet to project — four months of sales are needed.
        </div>
      ) : (
        <>
          <div className="outlook-lede">
            <div className="outlook-figure">
              <span className="outlook-label">Expected next month · {next.label}</span>
              <span className="outlook-hero">{full(next.value)}</span>
              <span className="outlook-range">
                likely {full(next.low)} to {full(next.high)}
              </span>
            </div>
            {change !== null && (
              <span className={`outlook-chip ${change >= 0 ? 'is-up' : 'is-down'}`}>
                <b>{change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(0)}%</b>
                <small>against the recent run</small>
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
                setHover(at >= 0 && at < points.length ? at : null)
              }}
            >
              <desc>
                Monthly turnover for the last {months.length} months, with the next
                {' '}{ahead.length} projected by straight-line trend.
              </desc>

              {gridlines.map((g) => (
                <g key={g}>
                  <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} className="grid" />
                  <text x={padL - 8} y={y(g) + 4} className="axis" textAnchor="end">{inr(g)}</text>
                </g>
              ))}

              {/* Where measurement stops and arithmetic begins. */}
              <line x1={x(lastActual)} x2={x(lastActual)} y1={padT} y2={padT + plotH} className="grid" />

              <path d={band} className="outlook-band" />
              <path d={path(0, lastActual)} className="outlook-line" />
              <path d={path(lastActual, points.length - 1)} className="outlook-line is-projected" />

              {hover !== null && (
                <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} className="crosshair" />
              )}

              {/* Markers only where they say something: the last real month,
                  the far end of the projection, and whatever is hovered. */}
              {points.map((p, i) => (
                (i === hover || i === lastActual || i === points.length - 1) ? (
                  <circle
                    key={p.ym} cx={x(i)} cy={y(p.value)} r={4.5}
                    className={`outlook-dot ${p.projected ? 'is-projected' : ''}`}
                  />
                ) : null
              ))}

              {/* One direct label, on the figure the card is about. */}
              <text
                x={x(points.length - 1)} y={y(points[points.length - 1].value) - 12}
                className="outlook-endlabel" textAnchor="end"
              >
                {inr(points[points.length - 1].value)}
              </text>

              {points.map((p, i) => (
                (!everyOther || i % 2 === 0) ? (
                  <text key={p.ym} x={x(i)} y={H - 8} className="axis" textAnchor="middle">
                    {p.label}
                  </text>
                ) : null
              ))}
            </svg>

            {hover !== null && points[hover] && (
              <div
                className="chart-tip"
                style={{ left: `${(hover / Math.max(points.length - 1, 1)) * 100}%` }}
              >
                <div className="chart-tip-when">
                  {points[hover].label} {points[hover].ym.slice(0, 4)}
                  {points[hover].projected ? ' · projected' : ''}
                </div>
                <div>
                  <i className={`key ${points[hover].projected ? 'key-projected' : 'key-sale'}`} />
                  Turnover <b>{full(points[hover].value)}</b>
                </div>
              </div>
            )}
          </div>

          <p className="chart-note">
            Straight-line trend on the last six months. It knows nothing of
            contracts, festivals or the season — read it as the shape of the run
            so far, not a promise.
          </p>
        </>
      )}
    </figure>
  )
}

/**
 * What the shop billed against what it bought, month by month.
 *
 * The difference, not the pair: `TradeByMonth` above already shows both sides
 * side by side, and this answers the other question — whether a month put money
 * in or took it out. That makes it a polarity, so it is drawn diverging about a
 * zero rule, warm above and cool below, with the rule itself the neutral
 * midpoint.
 *
 * It is not gross profit and is not labelled as such. Stock bought in March is
 * sold in May, so a month buying heavily reads negative here while being a
 * perfectly good month — which is exactly the thing worth seeing.
 */
export function NetTrade({ months }: { months: Month[] }) {
  const titleId = useId()
  const [hover, setHover] = useState<number | null>(null)
  const [plotRef, W] = useDrawnWidth()

  const net = months.map((m) => ({ ...m, net: m.sales - m.purchases }))
  const reach = Math.max(1, ...net.map((m) => Math.abs(m.net)))
  const ceiling = niceCeiling(reach, 2)

  const H = 190, padL = 48, padR = 8, padT = 10, padB = 26
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const slot = plotW / Math.max(net.length, 1)
  const barW = Math.max(3, Math.min(18, slot - 10))
  const zero = padT + plotH / 2
  const y = (v: number) => zero - (v / ceiling) * (plotH / 2)
  const everyOther = slot < 30

  const ahead = net.filter((m) => m.net > 0).length
  const behind = net.length - ahead

  return (
    <figure className="chart-card">
      <figcaption className="chart-head">
        <h2 id={titleId} className="chart-title">Billed less bought</h2>
        <div className="chart-legend">
          <span><i className="key key-sale" /> Sold more ({ahead})</span>
          <span><i className="key key-purchase" /> Bought more ({behind})</span>
        </div>
      </figcaption>

      <div className="chart-plot" ref={plotRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-labelledby={titleId}>
          {[ceiling, 0, -ceiling].map((g) => (
            <g key={g}>
              <line x1={padL} x2={W - padR} y1={y(g)} y2={y(g)} className="grid" />
              <text x={padL - 8} y={y(g) + 4} className="axis" textAnchor="end">
                {g > 0 ? `+${inr(g)}` : g < 0 ? `-${inr(-g)}` : '0'}
              </text>
            </g>
          ))}

          {net.map((m, i) => {
            const mid = padL + i * slot + slot / 2
            const up = m.net >= 0
            const top = up ? y(m.net) : zero
            const height = Math.max(Math.abs(y(m.net) - zero), 1)
            return (
              <g key={m.ym}
                 onMouseEnter={() => setHover(i)}
                 onMouseLeave={() => setHover(null)}>
                <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" />
                {hover === i && (
                  <rect x={padL + i * slot} y={padT} width={slot} height={plotH} className="hoverband" />
                )}
                <rect
                  x={mid - barW / 2} y={top} width={barW} height={height}
                  rx={3} className={`bar ${up ? 'bar-sale' : 'bar-purchase'}`}
                />
                {(!everyOther || i % 2 === 0) && (
                  <text x={mid} y={H - 8} className="axis" textAnchor="middle">{m.label}</text>
                )}
              </g>
            )
          })}
        </svg>

        {hover !== null && net[hover] && (
          <div className="chart-tip" style={{ left: `${((hover + 0.5) / net.length) * 100}%` }}>
            <div className="chart-tip-when">{net[hover].label} {net[hover].ym.slice(0, 4)}</div>
            <div>
              <i className={`key ${net[hover].net >= 0 ? 'key-sale' : 'key-purchase'}`} />
              {net[hover].net >= 0 ? 'Sold more by' : 'Bought more by'}
              <b>{full(Math.abs(net[hover].net))}</b>
            </div>
          </div>
        )}
      </div>
    </figure>
  )
}

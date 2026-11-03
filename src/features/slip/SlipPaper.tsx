import './slip.css'
import { printedRows, slipFigure, slipTotal, stampedNumber, wobble, type Slip } from './slip'

// Every measure below is taken from a photo of a real slip, scaled to this width.
const WIDTH = 520
const ROW_HEIGHT = 37.5
const FIRST_ROW = 114
const BALANCE_ROW = 68
const STAMP_LEFT = 282
const ITEM_LEFT = 44
const QTY_LEFT = 318
const FIGURE_RIGHT = 19
const INK = '#1d2f9e'

/** The perforated top edge, torn a little differently along its length. */
const TORN_EDGE = (() => {
  const points: string[] = []
  for (let x = 0; x <= WIDTH; x += 7) {
    points.push(`${x}px ${(x % 14 === 0 ? 2 : 7) + wobble(x, 1.6)}px`)
  }
  return `polygon(${points.join(', ')}, ${WIDTH}px 100%, 0 100%)`
})()

/** Item names are written smaller, not cut off, when they run long. */
const itemSize = (name: string) => {
  const room = QTY_LEFT - ITEM_LEFT - 10
  return Math.max(12, Math.min(22, room / (0.62 * Math.max(name.length, 1))))
}

/** Flecks in the pulp and the blue that rubs off a carbon, scattered once for the whole sheet. */
function PaperFlecks({ height }: { height: number }) {
  const place = (seed: number, max: number) => ((wobble(seed, 1) + 1) / 2) * max
  return (
    <svg width={WIDTH} height={height} style={{ position: 'absolute', inset: 0 }} aria-hidden>
      <filter id="slip-pulp">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="5" />
        <feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.34  0 0 0 0 0.32  0 0 0 0.55 -0.2" />
      </filter>
      <rect width={WIDTH} height={height} filter="url(#slip-pulp)" />
      {Array.from({ length: 34 }, (_, i) => (
        <circle
          key={`pulp-${i}`}
          cx={place(i * 2 + 1, WIDTH)}
          cy={place(i * 2 + 2, height)}
          r={0.5 + place(i + 300, 1)}
          fill="#3f4344"
          opacity={0.35 + place(i + 400, 0.5)}
        />
      ))}
      {Array.from({ length: 130 }, (_, i) => (
        <circle
          key={`carbon-${i}`}
          cx={place(i * 3 + 500, WIDTH)}
          cy={place(i * 3 + 501, height)}
          r={0.3 + place(i + 900, 0.7)}
          fill={INK}
          opacity={0.1 + place(i + 1100, 0.3)}
        />
      ))}
    </svg>
  )
}

/** Ballpoint through a carbon: a rough edge, a slight bleed, and gaps in the line. */
function InkFilters() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <filter id="slip-ink" x="-2%" y="-2%" width="104%" height="104%">
        <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="3" result="warp" />
        <feDisplacementMap in="SourceGraphic" in2="warp" scale="1.5" result="rough" />
        <feGaussianBlur in="rough" stdDeviation="0.55" result="bleed" />
        <feTurbulence type="fractalNoise" baseFrequency="1.5" numOctaves="1" seed="8" />
        <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -4 3.1" result="gaps" />
        <feComposite in="rough" in2="gaps" operator="in" result="line" />
        <feMerge>
          <feMergeNode in="bleed" />
          <feMergeNode in="line" />
        </feMerge>
      </filter>
      <filter id="slip-worn" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="1" seed="11" />
        <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -5 3.7" result="gaps" />
        <feComposite in="SourceGraphic" in2="gaps" operator="in" />
      </filter>
    </svg>
  )
}

/** A line drawn by hand: not quite straight, and climbing a little to the right. */
function HandRule({ top, left, right, rise, seed, weight = 2.3 }: {
  top: number
  left: number
  right: number
  rise: number
  seed: number
  weight?: number
}) {
  const width = right - left
  const y = (share: number) => rise * (1 - share) + wobble(seed + share * 5, 0.9)
  return (
    <svg
      width={width}
      height={rise + 6}
      viewBox={`0 -3 ${width} ${rise + 6}`}
      style={{ position: 'absolute', top, left, overflow: 'visible' }}
      aria-hidden
    >
      <path
        d={`M0 ${y(0)} C ${width * 0.3} ${y(0.3)}, ${width * 0.65} ${y(0.6)}, ${width} ${y(1)}`}
        fill="none"
        stroke={INK}
        strokeWidth={weight}
        strokeLinecap="round"
      />
    </svg>
  )
}

/** The tick: two quick strokes, the second falling away from the first. */
function PenCross({ center, seed }: { center: number; seed: number }) {
  const lean = wobble(seed, 2)
  return (
    <svg
      width="22"
      height="24"
      viewBox="0 0 22 24"
      style={{ position: 'absolute', top: center - 11, left: 17 + wobble(seed + 1, 3), overflow: 'visible' }}
      aria-hidden
    >
      <g fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round">
        <path d={`M${3 + lean} 5 Q 10 11 ${17 + lean} 21`} />
        <path d={`M${16 - lean} 3 Q 10 11 ${2 - lean} 23`} />
      </g>
    </svg>
  )
}

/** One piece of writing, set on the row whose middle is `center`. */
function Hand({ center, left, right, size, seed, children }: {
  center: number
  left?: number
  right?: number
  size: number
  seed: number
  children: React.ReactNode
}) {
  return (
    <div
      className="slip-hand"
      style={{
        position: 'absolute',
        top: center - ROW_HEIGHT / 2 + wobble(seed, 1.6),
        left,
        right,
        fontSize: size,
        lineHeight: `${ROW_HEIGHT}px`,
        whiteSpace: 'nowrap',
        transform: `rotate(${wobble(seed + 7, 0.8)}deg)`,
        transformOrigin: right === undefined ? 'left center' : 'right center',
      }}
    >
      {children}
    </div>
  )
}

/** Figures are written one digit at a time, so no two come out alike. */
function Figures({ text, seed }: { text: string; seed: number }) {
  return (
    <>
      {text.split('').map((digit, index) => (
        <span
          key={index}
          style={{
            display: 'inline-block',
            marginLeft: index ? 3 : 0,
            fontSize: `${1 + wobble(seed + index * 2, 0.06)}em`,
            transform: `translateY(${wobble(seed + index * 3, 1.5)}px) rotate(${wobble(seed + index * 5, 4)}deg)`,
          }}
        >
          {digit}
        </span>
      ))}
    </>
  )
}

/** The slip itself. The same layout is the preview, the picture and the print. */
export default function SlipPaper({ slip }: { slip: Slip }) {
  const rows = printedRows(slip.rows)
  const lastRow = FIRST_ROW + (rows.length - 1) * ROW_HEIGHT
  const height = lastRow + 117
  const hasPrevious = slip.previous.trim() !== ''

  return (
    <div
      className="slip-sheet"
      style={{ position: 'relative', width: WIDTH, height, color: INK, clipPath: TORN_EDGE, overflow: 'hidden' }}
    >
      <PaperFlecks height={height} />
      <InkFilters />
      <div className="slip-stamp" style={{ position: 'absolute', top: BALANCE_ROW - 11, left: STAMP_LEFT }}>
        {stampedNumber(slip.number)}
      </div>

      <div className="slip-ink" style={{ position: 'absolute', inset: 0 }}>
        {hasPrevious && (
          <Hand center={BALANCE_ROW} right={FIGURE_RIGHT + 2} size={33} seed={1}>
            <Figures text={slip.previous.trim()} seed={1} />
          </Hand>
        )}

        {rows.map((row, index) => {
          const center = FIRST_ROW + index * ROW_HEIGHT
          const seed = 10 + index * 3
          const qty = row.qty.trim()
          return (
            <div key={row.id}>
              <PenCross center={center} seed={seed} />
              <Hand center={center} left={ITEM_LEFT + wobble(seed + 20, 5)} size={itemSize(row.item)} seed={seed + 1}>
                {row.item}
              </Hand>
              {qty && (
                <Hand center={center} left={QTY_LEFT + wobble(seed + 30, 5)} size={20} seed={seed + 2}>
                  {qty}<span style={{ marginLeft: 3 }}>{row.unit}</span>
                </Hand>
              )}
              <Hand center={center} right={FIGURE_RIGHT - 6 + Math.abs(wobble(seed + 40, 12))} size={31} seed={seed + 3}>
                <Figures text={row.amount.trim()} seed={seed + 3} />
              </Hand>
            </div>
          )
        })}

        <HandRule top={lastRow + 8} left={396} right={520} rise={3} seed={2} />
        {slip.note.trim() && <Hand center={lastRow + 43} left={238} size={33} seed={3}>{slip.note}</Hand>}
        <Hand center={lastRow + 32} right={FIGURE_RIGHT + 2} size={33} seed={4}>
          <Figures text={slipFigure(slipTotal(slip))} seed={4} />
        </Hand>
        <HandRule top={lastRow + 49} left={396} right={524} rise={15} seed={5} weight={2.6} />
      </div>
    </div>
  )
}

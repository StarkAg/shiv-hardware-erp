// ── Stage 3 · the delta gate ────────────────────────────────────────────────
//
// The screen the whole app exists for. On paper the estimate and the work
// order are two separate sheets written five months apart, and the money moves
// between them without anybody having to agree to it — on this job it moved by
// ₹5,189 and nothing anywhere recorded that it had.
//
// Two figures are shown, and keeping them apart is the entire design:
//
//   ① what changes the customer's bill — counts and scope, nothing else. This
//      is the number that gets read out on the phone.
//
//   ② what the nominal size is costing the shop — material only, never shown
//      to the customer, never added to the price unless somebody chooses to
//      re-price. Today this figure does not exist anywhere.
//
// Mixing them would be the obvious mistake: it would turn a quiet internal
// margin note into a price rise the customer has to be argued into.

import { useMemo } from 'react'
import { useHotkeys } from './keys.js'
import {
  linesFromOpenings, lineTotal, explainDelta, varianceFor, EXTRAS, inr,
} from './rates.js'

export default function Delta({ job, material, onAccept, onReprice, onRemeasure }) {
  const openings = job.openings || []

  const est = job.estimate
  const nominalLines = useMemo(() => linesFromOpenings(openings, 'nominal', material, est), [openings, material, est])
  const measuredLines = useMemo(() => linesFromOpenings(openings, 'measured', material, est), [openings, material, est])

  const fare = EXTRAS.find((e) => e.id === 'fare')?.rate || 0
  const nominalTotal = lineTotal(nominalLines) + fare
  const measuredTotal = lineTotal(measuredLines) + fare

  const estimateTotal = job.estimate?.total || 0
  const quoteDelta = nominalTotal - estimateTotal
  const reasons = useMemo(() => explainDelta(job.estimate, nominalLines), [job.estimate, nominalLines])
  const variance = useMemo(() => varianceFor(openings, material, est), [openings, material, est])

  const repriceDelta = measuredTotal - nominalTotal

  // Accept is the path this screen recommends and the one the shop takes
  // today, so it is what Enter does. Nothing here is final — the stage bar
  // goes back and the decision can be taken again.
  useHotkeys({ Enter: () => onAccept(nominalLines, nominalTotal, variance) })

  return (
    <>
      {/* ① The customer's number. */}
      <div className="block">
        <div className="blocktitle">What the customer is told</div>

        <div className="deltabox">
          <div className="drow">
            <span>Estimate</span><b>{inr(estimateTotal)}</b>
          </div>
          <div className="drow">
            <span>After measuring</span><b>{inr(nominalTotal)}</b>
          </div>
          <div className={`drow big ${quoteDelta >= 0 ? 'up' : 'down'}`}>
            <span>{quoteDelta >= 0 ? 'More' : 'Less'}</span>
            <b>{quoteDelta >= 0 ? '+' : '−'}{inr(Math.abs(quoteDelta))}</b>
          </div>
        </div>

        <div className="reasons">
          {reasons.length === 0 && <div className="empty sm">Nothing changed.</div>}
          {reasons.map((r, i) => (
            <div className="reason" key={i}>
              <span>
                {r.label}
                {r.from != null && <em> {r.from} → {r.to}</em>}
              </span>
              <b className={r.amount >= 0 ? 'up' : 'down'}>
                {r.amount >= 0 ? '+' : '−'}{inr(Math.abs(r.amount))}
              </b>
            </div>
          ))}
        </div>

        <div className="note">
          Every piece stays at the price it was quoted at. This figure is counts
          and scope only.
        </div>
      </div>

      {/* ② The shop's own number. Never leaves this screen. */}
      <div className="block warnblock">
        <div className="blocktitle warn">⚠ Size variance — not billed</div>

        <div className="varrow">
          <span>{variance.pieces} pieces against the size they were quoted at</span>
        </div>
        <div className="varrow">
          <span>Measured area against quoted</span>
          <b className={variance.pct >= 0 ? 'up' : 'down'}>
            {variance.pct >= 0 ? '+' : ''}{variance.pct}%
          </b>
        </div>
        <div className="varrow">
          <span>Aluminium section</span>
          <b>{variance.sectionFt >= 0 ? '+' : ''}{variance.sectionFt} rft</b>
        </div>
        <div className="varrow">
          <span>Net / ACP</span>
          <b>{variance.panelSqft >= 0 ? '+' : ''}{variance.panelSqft} sqft</b>
        </div>
        <div className="varrow total">
          <span>Extra material {variance.estimated ? '(estimated)' : ''}</span>
          <b>{variance.rupees >= 0 ? '+' : '−'}{inr(Math.abs(variance.rupees))}</b>
        </div>

        {variance.mixed > 0 && (
          <div className="note">
            This job quoted the same product at more than one size. The
            comparison uses the size most of the pieces were quoted at.
          </div>
        )}

        <div className="note">
          {variance.estimated
            ? 'Rupees are rough until the section list and ₹/kg are filled in on the Rates screen. The feet and square feet are exact.'
            : 'Worked from the section figures on the Rates screen.'}
          {' '}Re-pricing this job would make it {inr(measuredTotal)}
          {repriceDelta >= 0 ? `, ₹${Math.abs(repriceDelta).toLocaleString('en-IN')} more` : ''}.
        </div>
      </div>

      <div className="block">
        <div className="blocktitle">What the order will say</div>
        <div className="linelist">
          {nominalLines.map((l) => (
            <div className={`line ${l.unpriced ? 'nope' : ''}`} key={l.id}>
              <div className="lmain">
                <div className="llabel">{l.label}</div>
                <div className="lsub">
                  {l.qty} Pc {l.unpriced ? '· no rate set' : `× ${inr(l.rate)}`}
                </div>
              </div>
              <b className="lamt">{l.unpriced ? '—' : inr(l.amount)}</b>
            </div>
          ))}
          <div className="line">
            <div className="lmain"><div className="llabel">Fare</div></div>
            <b className="lamt">{inr(fare)}</b>
          </div>
        </div>
        <div className="totalrow"><span>Total</span><b>{inr(nominalTotal)}</b></div>
      </div>

      <div className="actions stack">
        <button className="primbtn wide" onClick={() => onAccept(nominalLines, nominalTotal, variance)}>
          Accept — keep the quoted price <kbd>⏎</kbd>
        </button>
        <button className="ghostbtn wide" onClick={() => onReprice(measuredLines, measuredTotal, variance)}>
          Re-price at measured sizes · {inr(measuredTotal)}
        </button>
        <button className="ghostbtn wide quiet" onClick={onRemeasure}>
          Send back to be measured again
        </button>
      </div>
    </>
  )
}

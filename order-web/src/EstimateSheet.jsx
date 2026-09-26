// ── The estimate, on paper ──────────────────────────────────────────────────
// What the customer walks out with, and it has to be one page. An estimate
// that runs onto a second sheet gets the second sheet lost, and then the shop
// is arguing about a total whose working nobody can find.
//
// So the sheet is measured after it is laid out and scaled down to fit, rather
// than being designed small and hoped about. Ten lines and fifteen boxes fit
// at full size; a long job shrinks, which is the right trade — smaller type on
// one page beats correct type on two.
//
// The shop writes these on pre-printed letterhead, so by default the header is
// left blank for the paper to supply. Turn that off and it prints its own.

import { useLayoutEffect, useRef, useState } from 'react'
import { SketchGrid } from './sketch.jsx'
import { inr, lineTotal } from './rates.js'
import { fmtSize, sqftOf } from './dims.js'
import { fmtDate, todayKey } from './store.js'

// A4 at 96dpi, less the 12mm margins the print stylesheet sets.
const PAGE_W = 703
const PAGE_H = 1032

export default function EstimateSheet({ job, preview, letterhead }) {
  const sheet = useRef(null)
  const wrap = useRef(null)
  const [screenScale, setScreenScale] = useState(1)
  const [printScale, setPrintScale] = useState(1)
  const [height, setHeight] = useState(0)

  // Two scales: one so the A4 sheet is legible on a phone, one so it never
  // runs onto a second page when it is actually printed.
  useLayoutEffect(() => {
    const measure = () => {
      const el = sheet.current
      const box = wrap.current
      if (!el || !box) return
      const tall = el.scrollHeight
      const s = Math.min(1, (box.clientWidth || PAGE_W) / PAGE_W)
      setScreenScale(s)
      setHeight(tall * s)
      setPrintScale(Math.min(1, PAGE_H / tall))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (wrap.current) ro.observe(wrap.current)
    return () => ro.disconnect()
  })

  const lines = job.estimate?.lines || []
  const total = lineTotal(lines)
  const date = job.estimate?.date || todayKey()

  const sizeOf = (l) => (l.kind === 'product' ? l.nominal : l.size)

  // Staff type the name either way — "M/s H Khan jee" or just "H Khan jee" —
  // and the sheet always addresses it the same. Any prefix already there is
  // taken off first, so it can never come out doubled.
  const rawName = (job.customer?.name || '').trim()
  const toName = rawName ? `M/s ${rawName.replace(/^m\s*\/?\s*s\.?\s*/i, '')}` : ''

  return (
    <div
      className="a4wrap" ref={wrap}
      style={{ height: height || undefined, '--print-scale': printScale }}
    >
      <div
        className="a4" ref={sheet}
        style={{ '--screen-scale': screenScale }}
      >
        {letterhead ? (
          // Room for what is already printed on the paper.
          <div className="lhgap" aria-hidden="true" />
        ) : (
          <div className="lhead">
            <div className="lhname">Shiv Hardware Store</div>
            <div className="lhline">Shivaji Road, Near Gandhi High School</div>
            <div className="lhline">Ramgarh Cantt.- 829122</div>
            <div className="lhline">GSTIN - 20AGEPG3564B1Z6</div>
            <div className="lhphones">8092850954 Tony · 9835350954 Shiv</div>
          </div>
        )}

        <div className="lhmeta">
          <span>Ref. No. <b>{job.number}</b></span>
          <span>Date <b>{fmtDate(date)}</b></span>
        </div>

        <div className="lhcust">
          <div className="lhto">{toName}</div>
          {job.customer?.address && <div>{job.customer.address}</div>}
          {job.customer?.mobile && <div>Mo - {job.customer.mobile}</div>}
        </div>

        <table className="lhtable">
          <tbody>
            {lines.map((l) => {
              const sz = sizeOf(l)
              const sized = sz && sqftOf(sz.w, sz.h) > 0
              return (
                <tr key={l.id}>
                  <td className="ltsize">{sized ? fmtSize(sz.w, sz.h) : ''}</td>
                  <td className="ltdesc">
                    {l.kind === 'product' && <>{l.qty} pc · {l.label.replace(/^Alu\. /, '')}</>}
                    {l.kind === 'netfit' && 'जाली लगाना SS'}
                    {l.kind === 'extra' && l.label}
                  </td>
                  <td className="ltrate">
                    {l.kind === 'extra' ? `${l.qty} ${l.unit} × ${inr(l.rate)}` : ''}
                    {l.kind === 'netfit' ? `${l.sqft?.toFixed(2)} sqft × ₹${l.rate}` : ''}
                    {l.kind === 'product' ? `@ ${inr(l.rate)}` : ''}
                  </td>
                  <td className="ltamt">{inr(l.amount)}</td>
                </tr>
              )
            })}
            <tr className="lttotal">
              <td colSpan="3" />
              <td className="ltamt"><span className="hl">{inr(total)}</span></td>
            </tr>
          </tbody>
        </table>

        {preview?.length > 0 && (
          <div className="lhsketch">
            <SketchGrid openings={preview} />
          </div>
        )}

        <div className="lhfoot">
          Estimate only — sizes are as quoted and will be confirmed on site.
          Prices hold for 15 days.
        </div>
      </div>
    </div>
  )
}

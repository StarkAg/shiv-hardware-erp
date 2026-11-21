// ── The visit order, on the shop's letterhead ───────────────────────────────
//
// The slip the counter writes by hand on the letterhead (photographed
// 2026-11-21: Deepak Saha Jee, Bangali Tola; Rajesh Kumar Ji, Patratu Basti),
// typed instead and printed whole on plain A4: the letterhead as the shop's
// paper has it, then the date, who it is for, each item with how many, and
// the advance taken with a line to sign. The workshop's phone draws the same
// sheet from the same figures.

import { useLayoutEffect, useRef, useState } from 'react'
import { Printing } from './PadSheet.jsx'

const SHEET_W = 210 // mm, A4
const SHEET_H = 296 // a hair under A4, so it never spills a blank second page

const DEALS = 'Plywood, Flush Door, Laminates, PVC & Acrylic Hi-Gloss Laminates, Adhesive, Hardware, Aluminium & Stainless Steel Architectural Section, Wooden & WPC Chowket, Gypsum False Ceiling, WPC Grill, Modular Kitchen Accessories, All types of Wooden Bit, Decorative wall Panel & General Order Suppliers.'
const INSTALLS = 'Aluminium Door & Window, UPVC Door & Window, Stainless Steel Railing, Wooden & Readymade Door, PVC / FRP / Rajshree Bathroom Door, Mosquito Solution in Door & Window, PVC & Wooden Flooring, Only 2\' x 2\' Gypsum False Ceiling, Wall Paper, ACP & Glass work in Exterior Wall.'

/** dd-mm-yy, as the slip is dated. */
const slipDate = (key) => {
  const [y, m, d] = String(key ?? '').split('-')
  return d && m && y ? `${d}-${m}-${y.slice(-2)}` : ''
}
/** "M/s" once, however the name was typed. */
const addressed = (name) => {
  const bare = String(name ?? '').trim().replace(/^m\s*\/?\s*s\.?\s*/i, '')
  return bare ? `M/s ${bare}` : ''
}
const qtyOf = (l) => `${Math.round((Number(l.qty) || 0) * 100) / 100} ${l.unit || 'Pc'}`

/**
 * The slip. `who` is { name, address, mobile }; `number` the job's, once it
 * has one (Ref. No.); `fixedZoom` for print, else it fits the width it has.
 */
export function SlipSheet({ number, who, slip, fixedZoom, fitHeight = false }) {
  const box = useRef(null)
  const [zoom, setZoom] = useState(fixedZoom ?? 1)
  useLayoutEffect(() => {
    if (fixedZoom) return undefined
    const el = box.current
    if (!el) return undefined
    // To the width it has; with `fitHeight`, the whole sheet within the height too, nothing to scroll.
    const fit = () => {
      if (!el.clientWidth) return
      const byWidth = el.clientWidth / ((SHEET_W / 25.4) * 96)
      const byHeight = fitHeight && el.clientHeight ? el.clientHeight / ((SHEET_H / 25.4) * 96 + 2) : Infinity
      setZoom(Math.min(1.2, byWidth, byHeight))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fixedZoom, fitHeight])

  return (
    <div ref={box} className={`slipfit${fitHeight ? " tall" : ""}`}>
      <div className="slip" style={{ width: `${SHEET_W}mm`, height: `${SHEET_H}mm`, '--zoom': zoom }}>
        <header className="sliphead">
          <img className="sliplogo" src="/shiv-logo.png" alt="" />
          <div className="slipshop">
            <b>Shiv Hardware Store</b>
            <span>Shivaji Road, Near Gandhi High School, Ramgarh Cantt. 829122</span>
          </div>
          <dl className="slipcontact">
            <div><dt>GSTIN</dt><dd>20AGEPG3564B1Z6</dd></div>
            <div><dt>Tony</dt><dd>8092850954</dd></div>
            <div><dt>Shop</dt><dd>9835350954</dd></div>
          </dl>
        </header>
        <div className="slipdeals">
          <p><b>Deals in</b>{DEALS}</p>
          <p><b>Installation</b>{INSTALLS}</p>
        </div>

        <div className="sliptitle">
          <h1>Visit order</h1>
          <dl>
            <div><dt>Ref. No.</dt><dd>{number ?? ''}</dd></div>
            <div><dt>Date</dt><dd>{slipDate(slip.date)}</dd></div>
          </dl>
        </div>

        <div className="slipwho">
          <small>For</small>
          {/* The place after the name, on one line, as the shop writes it: "M/s Harsh, Ramgarh". */}
          <b>{[addressed(who.name), who.address].filter(Boolean).join(', ') || ' '}</b>
          {who.mobile && <span>Mobile {who.mobile}</span>}
        </div>

        <table className="sliptable">
          <thead><tr><th className="n">No.</th><th>Item</th><th className="q">Qty</th></tr></thead>
          <tbody>
            {slip.lines.map((l, i) => (
              <tr key={l.id}><td className="n">{i + 1}</td><td>{l.text}</td><td className="q">{qtyOf(l)}</td></tr>
            ))}
          </tbody>
        </table>

        <footer className="slipfoot">
          {slip.advance > 0 ? (
            <div className="slipadv">
              <small>Advance received</small>
              <b>Rs. {Math.round(slip.advance).toLocaleString('en-IN')}</b>
              <span>{slipDate(slip.date)}</span>
            </div>
          ) : <div />}
          <div className="slipsign"><span />For Shiv Hardware Store</div>
        </footer>
      </div>
    </div>
  )
}

/** The slip printed on plain A4, letterhead and all. */
export function PrintSlip({ number, who, slip, onDone }) {
  return (
    <Printing margin={0} onDone={onDone}>
      <SlipSheet number={number} who={who} slip={slip} fixedZoom={1} />
    </Printing>
  )
}

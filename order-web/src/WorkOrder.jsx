// ── Stage 4 · the work order ────────────────────────────────────────────────
// The pink pad, both halves generated. The item lines come from grouping the
// measured openings; the sketches come from their sizes. Nobody counts pieces
// off a drawing and nobody redraws a box.
//
// The advance goes into the cash book the moment it is taken, because it is
// real money in the drawer and the alternative is somebody remembering to copy
// it across in the evening.

import { useState } from 'react'
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

      {/* ── The sheet itself ────────────────────────────────────────────── */}
      <div className="page">
        <div className="pagehead">
          <div className="phleft">
            <div className="phshop">Shiv Hardware Store</div>
            <div className="phaddr">Shivaji Road, Near Gandhi High School</div>
            <div className="phaddr">Ramgarh Cantt- 829122 Jharkhand</div>
          </div>
          <div className="phright">
            <div className="phno">Order No. <b>{job.number}</b></div>
            <div className="phdate">Order {fmtDate(order.orderDate || todayKey())}</div>
            <div className="phdate">Delivery {order.deliveryDate ? fmtDate(order.deliveryDate) : '—'}</div>
          </div>
        </div>

        <div className="pagecust">
          <div><span>Name</span> <b>{job.customer?.name}</b></div>
          {job.customer?.address && <div><span>Address</span> {job.customer.address}</div>}
          <div><span>Contact</span> {job.customer?.mobile}</div>
        </div>

        <table className="pagetable">
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="ptlabel">{l.label}</td>
                <td className="ptqty">{l.qty} Pc</td>
                <td className="ptamt">{l.unpriced ? '—' : inr(l.amount)}</td>
              </tr>
            ))}
            <tr>
              <td className="ptlabel">Fare</td>
              <td className="ptqty" />
              <td className="ptamt">{inr(fare)}</td>
            </tr>
            <tr className="pttotal">
              <td className="ptlabel" />
              <td className="ptqty" />
              <td className="ptamt">{inr(total)}</td>
            </tr>
            {adv > 0 && (
              <>
                <tr>
                  <td className="ptlabel">Advance</td>
                  <td className="ptqty" />
                  <td className="ptamt">{inr(adv)}</td>
                </tr>
                <tr className="ptbalance">
                  <td className="ptlabel" />
                  <td className="ptqty" />
                  <td className="ptamt">{inr(balance)}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>

        <SketchGrid openings={job.openings || []} />
      </div>

      <div className="actions stack">
        <button className="ghostbtn wide" onClick={onPrint}>Print the work order</button>
        {job.status === 'ordered' && (
          <button className="primbtn wide" onClick={onDelivered}>
            Mark delivered · {inr(balance)} to collect
          </button>
        )}
      </div>
    </>
  )
}

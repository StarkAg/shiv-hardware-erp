// ── The rack ────────────────────────────────────────────────────────────────
//
// Every end the shop has decided is worth keeping, with where it came from.
// This is the list the cutting plan spends before it opens a new section, so
// what is on it decides how much aluminium gets bought.
//
// It is also the only place the shop can see its own waste. A month of
// "scrapped" adding up to forty feet is a conversation about how pieces are
// being nested; without the number there is nothing to have the conversation
// about.

import { useState } from 'react'
import { fmtInches, fmtFeet } from './cutting.js'
import { rackSummary, rackHistory, scrapOffcut, addOffcut, readRule, writeRule } from './offcuts.js'
import { fmtDate } from './store.js'

const ROLES = ['Outer frame', 'Leaf']

export default function Rack({ onBack }) {
  const [nonce, setNonce] = useState(0)
  const [adding, setAdding] = useState(false)
  const [role, setRole] = useState(ROLES[0])
  const [len, setLen] = useState('')
  const [rule, setRule] = useState(() => readRule())

  const rack = rackSummary()
  const past = rackHistory()

  const bump = () => setNonce((n) => n + 1)

  const add = () => {
    const v = Number(len)
    if (!(v > 0)) return
    addOffcut(role, v)
    setLen('')
    setAdding(false)
    bump()
  }

  const setKeep = (v) => {
    const next = { ...rule, keepOver: Number(v) || 0 }
    setRule(next)
    writeRule(next)
  }

  return (
    <>
      <div className="matsum" key={nonce}>
        <div className="matbig">
          <b>{rack.pieces}</b>
          <span>end{rack.pieces === 1 ? '' : 's'} on the rack</span>
        </div>
        <div className="matside">
          <div><span>Total</span><b>{fmtFeet(rack.inches)}</b></div>
          <div><span>Spent</span><b>{past.used}</b></div>
        </div>
      </div>

      {rack.pieces === 0 && (
        <div className="empty">
          Nothing on the rack. Ends appear here when a cutting run is recorded
          on the What-to-cut screen.
        </div>
      )}

      {rack.groups.map((g) => (
        <div className="block" key={g.role}>
          <div className="blocktitle">
            {g.role}
            <span className="counter">{g.items.length} · {fmtFeet(g.inches)}</span>
          </div>
          <div className="racklist">
            {g.items.map((o) => (
              <div className="rackrow" key={o.id}>
                <b className="racklen">{fmtInches(o.len)}</b>
                <span className="rackfrom">
                  {o.byHand ? 'added by hand' : `from #${o.fromJob || '—'}`}
                  {o.at ? ` · ${fmtDate(new Date(o.at).toISOString().slice(0, 10))}` : ''}
                </span>
                <button
                  className="lx" aria-label="Scrap this end"
                  onClick={() => { scrapOffcut(o.id); bump() }}
                >×</button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="block">
        {adding ? (
          <div className="tunebox">
            <div className="blocktitle">Put an end on the rack</div>
            <div className="chips">
              {ROLES.map((r) => (
                <button key={r} className={`chip ${role === r ? 'on' : ''}`} onClick={() => setRole(r)}>{r}</button>
              ))}
            </div>
            <div className="qtyrow">
              <input
                className="qty" inputMode="decimal" value={len} placeholder="Length in inches" autoFocus
                onChange={(e) => setLen(e.target.value.replace(/[^0-9.]/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') add() }}
              />
              <button className="primbtn" onClick={add} disabled={!(Number(len) > 0)}>Add</button>
            </div>
            <button className="ghostbtn wide" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        ) : (
          <button className="addbtn" onClick={() => setAdding(true)}>
            + Measure an end into the rack
          </button>
        )}
      </div>

      <div className="block warnblock">
        <div className="blocktitle warn">Waste</div>
        <div className="recrow">
          <span>Ends used on jobs</span><b className="good">{past.used} · {fmtFeet(past.usedInches)}</b>
        </div>
        <div className="recrow">
          <span>Scrapped</span><b className="bad">{past.scrapped} · {fmtFeet(past.scrappedInches)}</b>
        </div>
        <div className="raterow">
          <span>Keep ends longer than</span>
          <input inputMode="decimal" value={rule.keepOver} onChange={(e) => setKeep(e.target.value)} />
        </div>
        <div className="note">
          Lower the keep-over and more ends get racked, which saves stock but
          fills the corner. Raise it and the rack stays short and the bin fills.
          These two numbers are the trade, and now they are both visible.
        </div>
      </div>
    </>
  )
}

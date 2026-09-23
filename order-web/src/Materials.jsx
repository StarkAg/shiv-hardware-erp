// ── What to pull, where to cut it, and what to keep ─────────────────────────
//
// The other half of a work order. The piece list says what to make; this says
// what to make it out of — which ends off the rack, how many new 12 ft
// sections, and the cuts to take down each one in order.
//
// The end of every bar is shown on purpose, and it is the point of the screen.
// A bar with 31" left is not waste, it is the next ventilator's frame, and the
// only way anybody treats it that way is if the sheet says so and the rack is
// written down. Recording the run does both: spends the ends it used, and puts
// the new ones on the rack.

import { useMemo, useState } from 'react'
import {
  cuttingPlan, rackEffect, readCutting, writeCutting, fmtInches, fmtFeet,
} from './cutting.js'
import { readRule, writeRule, recordRun } from './offcuts.js'

export default function Materials({ job, onRecorded }) {
  const [cfg, setCfg] = useState(() => readCutting())
  const [rule, setRule] = useState(() => readRule())
  const [open, setOpen] = useState(null)      // which bar's cuts are shown
  const [tuning, setTuning] = useState(false)
  const [nonce, setNonce] = useState(0)       // re-plan after the rack changes
  const [saved, setSaved] = useState(null)

  const plan = useMemo(() => cuttingPlan(job.openings || [], cfg), [job, cfg, nonce])
  const effect = useMemo(() => rackEffect(plan, rule.keepOver), [plan, rule])

  const already = !!job.cutRunAt

  const set = (k, v) => {
    const next = { ...cfg, [k]: Number(v) || 0 }
    setCfg(next)
    writeCutting(next)
  }
  const setKeep = (v) => {
    const next = { ...rule, keepOver: Number(v) || 0 }
    setRule(next)
    writeRule(next)
  }

  const record = () => {
    const r = recordRun({
      jobNumber: job.number,
      consumedIds: effect.consumedIds,
      newEnds: effect.newEnds,
    })
    setSaved(r)
    setNonce((n) => n + 1)
    onRecorded?.()
  }

  return (
    <>
      <div className="matsum">
        <div className="matbig">
          <b>{plan.totalBars}</b>
          <span>new section{plan.totalBars === 1 ? '' : 's'} of {cfg.barInches / 12} ft</span>
        </div>
        <div className="matside">
          <div><span>From rack</span><b>{plan.fromRack} end{plan.fromRack === 1 ? '' : 's'}</b></div>
          <div><span>Waste</span><b>{plan.wastePct}%</b></div>
        </div>
      </div>

      {plan.fromRack > 0 && (
        <div className="racknote">
          {plan.rackFt} ft of this order comes off the rack — that is
          {' '}{plan.fromRack} end{plan.fromRack === 1 ? '' : 's'} that would
          otherwise have been new stock.
        </div>
      )}

      <button className="tunebtn" onClick={() => setTuning((t) => !t)}>
        {tuning ? 'Hide settings' : 'Section length, kerf, allowance, keep-over'}
      </button>

      {tuning && (
        <div className="block tunebox">
          <div className="raterow">
            <span>Section length (inches)</span>
            <input inputMode="numeric" value={cfg.barInches} onChange={(e) => set('barInches', e.target.value)} />
          </div>
          <div className="raterow">
            <span>Saw kerf per cut</span>
            <input inputMode="decimal" value={cfg.kerf} onChange={(e) => set('kerf', e.target.value)} />
          </div>
          <div className="raterow">
            <span>Allowance added to every side</span>
            <input inputMode="decimal" value={cfg.allowance} onChange={(e) => set('allowance', e.target.value)} />
          </div>
          <div className="raterow">
            <span>Keep ends longer than</span>
            <input inputMode="decimal" value={rule.keepOver} onChange={(e) => setKeep(e.target.value)} />
          </div>
          <div className="note">
            The allowance is however much longer than the opening the shop cuts
            a frame — it starts at zero because guessing it would put the whole
            plan out by a bar. Keep-over is the line between an end worth
            racking and one worth binning.
          </div>
        </div>
      )}

      {plan.groups.length === 0 && (
        <div className="empty">Nothing measured on this order yet.</div>
      )}

      {plan.groups.map((g) => (
        <div className="block" key={g.role}>
          <div className="blocktitle">
            {g.role}
            <span className="counter">
              {g.barsNeeded} new{g.offcutsUsed ? ` + ${g.offcutsUsed} end${g.offcutsUsed === 1 ? '' : 's'}` : ''}
            </span>
          </div>
          <div className="note">
            {g.pieces} cuts · {fmtFeet(g.cutInches)} used · {Math.round(g.wastePct * 10) / 10}% waste
          </div>

          <div className="barlist">
            {g.bars.map((bar, i) => {
              const id = `${g.role}-${i}`
              const showing = open === id
              const keepIt = bar.left >= rule.keepOver
              return (
                <div className={`bar ${bar.oversize ? 'bad' : ''} ${bar.source === 'offcut' ? 'rack' : ''}`} key={id}>
                  <button className="barhead" onClick={() => setOpen(showing ? null : id)}>
                    <span className="barn">
                      {bar.source === 'offcut'
                        ? <>End {fmtInches(bar.stockLen)}</>
                        : <>New bar</>}
                    </span>
                    <span className="barbits">
                      {bar.cuts.length} cuts
                      {bar.fromJob ? ` · from #${bar.fromJob}` : ''}
                    </span>
                    <span className={`barleft ${keepIt ? '' : 'tight'}`}>
                      {bar.oversize
                        ? 'too long for stock'
                        : `${fmtInches(bar.left)} ${keepIt ? 'to keep' : 'scrap'}`}
                    </span>
                  </button>

                  {/* The bar drawn to its own length, so a glance says how full
                      it is and how much of it is an end worth racking. */}
                  <div className="barviz">
                    {bar.cuts.map((c, j) => (
                      <span
                        key={j} className="barcut"
                        style={{ width: `${(c.len / bar.stockLen) * 100}%` }}
                        title={fmtInches(c.len)}
                      />
                    ))}
                    {!bar.oversize && bar.left > 0 && (
                      <span
                        className={`barend ${keepIt ? 'keep' : 'scrap'}`}
                        style={{ width: `${(bar.left / bar.stockLen) * 100}%` }}
                      />
                    )}
                  </div>

                  {showing && (
                    <div className="barcuts">
                      {bar.cuts.map((c, j) => (
                        <div className="barcutrow" key={j}>
                          <span>{j + 1}</span>
                          <b>{fmtInches(c.len)}</b>
                        </div>
                      ))}
                      {!bar.oversize && (
                        <div className={`barcutrow off ${keepIt ? '' : 'binned'}`}>
                          <span>{keepIt ? 'end — rack it' : 'end — scrap'}</span>
                          <b>{fmtInches(bar.left)}</b>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {plan.groups.length > 0 && (
        <div className="block recordbox">
          <div className="blocktitle">When it is cut</div>
          <div className="recrow">
            <span>Ends spent off the rack</span><b>{effect.consumedIds.length}</b>
          </div>
          <div className="recrow">
            <span>New ends worth keeping (over {fmtInches(rule.keepOver)})</span>
            <b className="good">{effect.keep.length}</b>
          </div>
          <div className="recrow">
            <span>Scrap</span>
            <b className="bad">
              {effect.scrap.length} · {fmtFeet(effect.scrap.reduce((t, e) => t + e.len, 0))}
            </b>
          </div>

          {saved ? (
            <div className="recdone">
              ✓ Rack updated — {saved.kept} end{saved.kept === 1 ? '' : 's'} on,
              {' '}{saved.consumed} spent, {saved.scrapped} scrapped.
            </div>
          ) : (
            <button className="primbtn wide" onClick={record}>
              {already ? 'Record this cutting again' : 'Record this cutting'}
            </button>
          )}
          <div className="note">
            Marks the ends it used as spent and puts the new ones on the rack,
            so the next order can be cut out of them. Only press it once the
            bars are actually cut.
          </div>
        </div>
      )}
    </>
  )
}

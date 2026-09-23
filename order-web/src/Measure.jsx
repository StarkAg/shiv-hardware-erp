// ── Stage 2 · the site measurement ──────────────────────────────────────────
// The mechanic's sheet, typed instead of drawn. One row per opening, and the
// boxes on the work order are generated from these rows rather than redrawn by
// hand at the counter.
//
// Three taps and a size: what it is, what goes in it, how big. The form row
// comes first because it decides which fills are even offered — a wall is
// never netted — and because it is what the drawing is made from.
//
// The whole screen is built around being quicker than paper, because paper
// always wins a fight about speed. Sizes go in on a pad with an eighths strip;
// the keyboard only appears for the note, which is optional.

import { useState } from 'react'
import { SizePad } from './ui.jsx'
import { useHotkeys } from './keys.js'
import { Opening, SketchGrid } from './sketch.jsx'
import {
  FORMS, FORM_IDS, FILLS, FILLS_FOR, rateFor, productShort,
} from './rates.js'
import { fmtSize, blankDim, sqftOf } from './dims.js'
import { uid } from './store.js'

export default function Measure({ job, onChange, onDone }) {
  const openings = job.openings || []
  const [editing, setEditing] = useState(null)
  const [drawn, setDrawn] = useState(false)

  const setOpenings = (next) => onChange({ ...job, openings: next })

  const addOpening = () => {
    const last = openings[openings.length - 1]
    const form = last?.form || 'ventilator'
    const fresh = {
      id: uid('o'),
      w: blankDim(), h: blankDim(),
      // Carries the last row's choices forward: a house is measured in runs of
      // the same thing, so the common case is no tap at all beyond the size.
      form,
      fill: last?.fill || FILLS_FOR[form][0],
      leaves: last?.leaves ?? FORMS[form].leaves,
      note: '',
    }
    setOpenings([...openings, fresh])
    setEditing(fresh.id)
  }

  const patch = (id, p) => setOpenings(openings.map((o) => (o.id === id ? { ...o, ...p } : o)))
  const remove = (id) => setOpenings(openings.filter((o) => o.id !== id))

  /** Changing the form can strand the fill, so it is re-picked with it. */
  const setForm = (o, form) => {
    const allowed = FILLS_FOR[form] || Object.keys(FILLS)
    patch(o.id, {
      form,
      fill: allowed.includes(o.fill) ? o.fill : allowed[0],
      leaves: FORMS[form].leaves,
    })
  }

  const sized = openings.filter((o) => sqftOf(o.w, o.h) > 0)
  const ready = openings.length > 0 && sized.length === openings.length
  const target = editing ? openings.find((o) => o.id === editing) : null

  // Enter starts the next opening and opens its pad, so a house is measured
  // without the hand leaving the keyboard. The pad owns Enter while it is up.
  useHotkeys({ Enter: { run: addOpening, inInputs: true } }, !target)

  return (
    <>
      <div className="block">
        <div className="blocktitle">
          Openings<span className="counter">{openings.length}</span>
        </div>

        {openings.length === 0 && (
          <div className="empty">
            Nothing measured yet. Add one opening per hole in the wall.
          </div>
        )}

        <div className="openlist">
          {openings.map((o, i) => {
            const unsized = !(sqftOf(o.w, o.h) > 0)
            const allowed = FILLS_FOR[o.form] || Object.keys(FILLS)
            const priced = rateFor(o.form, o.fill) != null
            const twoLeafable = FORMS[o.form]?.draw === 'openable'

            return (
              <div className={`openrow ${unsized ? 'unsized' : ''}`} key={o.id}>
                <div className="orhead">
                  <span className="orn">{i + 1}</span>
                  <button className="orsize" onClick={() => setEditing(o.id)}>
                    {unsized ? 'Tap to measure' : fmtSize(o.w, o.h)}
                  </button>
                  <button className="lx" onClick={() => remove(o.id)} aria-label="Remove">×</button>
                </div>

                <div className="pickrow">
                  <span className="picklbl">Make</span>
                  <div className="chips wrap sm">
                    {FORM_IDS.map((id) => (
                      <button
                        key={id} className={`chip ${o.form === id ? 'on' : ''}`}
                        onClick={() => setForm(o, id)}
                      >
                        {FORMS[id].label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pickrow">
                  <span className="picklbl">Inside</span>
                  <div className="chips wrap sm">
                    {allowed.map((id) => (
                      <button
                        key={id} className={`chip ${o.fill === id ? 'on' : ''}`}
                        onClick={() => patch(o.id, { fill: id })}
                      >
                        {FILLS[id].label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="orfoot">
                  {twoLeafable && (
                    <div className="chips sm">
                      {[1, 2].map((n) => (
                        <button
                          key={n} className={`chip ${o.leaves === n ? 'on' : ''}`}
                          onClick={() => patch(o.id, { leaves: n })}
                        >
                          {n} leaf{n > 1 ? 'ves' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    className="ornote" value={o.note} placeholder="note"
                    onChange={(e) => patch(o.id, { note: e.target.value })}
                  />
                </div>

                {!unsized && (
                  <div className="orpreview">
                    <Opening o={o} n={null} />
                    <div className="orsub">
                      {sqftOf(o.w, o.h).toFixed(2)} sqft · {productShort(o.form, o.fill)}
                      {!priced && <em className="unpriced">no rate yet</em>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <button className="addbtn" onClick={addOpening}>+ Add opening <kbd>⏎</kbd></button>
      </div>

      {sized.length > 1 && (
        <div className="block">
          <button className="blocktitle asbtn" onClick={() => setDrawn((d) => !d)}>
            The whole sheet<span className="caret">{drawn ? '▾' : '▸'}</span>
          </button>
          {drawn && <SketchGrid openings={sized} />}
        </div>
      )}

      <div className="actions">
        <button className="primbtn wide" onClick={onDone} disabled={!ready}>
          {openings.length && !ready
            ? `${openings.length - sized.length} still to measure`
            : 'Send back to the counter'}
        </button>
      </div>

      {target && (
        <SizePad
          w={target.w} h={target.h}
          onCancel={() => setEditing(null)}
          onDone={(w, h) => { patch(target.id, { w, h }); setEditing(null) }}
        />
      )}
    </>
  )
}

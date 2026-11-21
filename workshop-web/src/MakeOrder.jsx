import { useEffect, useMemo, useState } from 'react'
import { contactsOf, addressOf, nameOf } from './flow.js'
import { post } from './outbox.js'
import { BackIcon, CloseIcon, PlusIcon, SendIcon, Sheet, SheetIcon } from './ui.jsx'
import { PadSheet, PrintPads, copyOf } from './pad/PadSheet.jsx'
import {
  EXTRAS, FARE, FILLS, FILLS_FOR, FORMS, FORM_IDS, amountOf, inr, learnRate, productLabel, rateFor, todayKey, totalOf,
} from './pad/forms.js'
import { fmtDim, inchesOf, parseDim } from './pad/dims.js'

/**
 * The work order made on the app, at the counter: the other way to the
 * photographed one. Each line is a piece (what is built and what goes in
 * it), how many, its size and what each costs; or a loose item such as
 * liping. The pad's three copies are drawn from it (pad/PadSheet.jsx):
 * printed here, and sent, which hands the workshop its yellow copy, counts
 * the pieces to make and moves the job on to Assemble.
 *
 * What is typed is kept on this phone until it is sent, so leaving the page
 * loses nothing.
 */

const draftKey = (job) => `workshop:pad-draft:${job.id}`
const readDraft = (job) => { try { return JSON.parse(localStorage.getItem(draftKey(job)) || 'null') } catch { return null } }
const newId = () => Math.random().toString(36).slice(2, 9)

/** The customer as the pad writes them. */
// Every number to ring, as the slip and the pad write them: "8709964141, 8709964142".
export const whoOf = (job) => ({ name: nameOf(job), address: addressOf(job), mobile: contactsOf(job.phone).join(', ') })

/** A line as it is kept: sizes as typed, so "13 7/8" stays as written while it is being typed. */
function lineFor(id) {
  if (EXTRAS[id]) {
    const line = { id: newId(), form: id, extra: true, label: EXTRAS[id].label, unit: EXTRAS[id].unit, qty: '1', rate: '' }
    return { ...line, rate: String(rateFor(line) ?? '') }
  }
  const fill = FILLS_FOR[id][0]
  const line = { id: newId(), form: id, fill, label: productLabel(id, fill), qty: '1', rate: '', wText: '', hText: '' }
  return { ...line, rate: String(rateFor(line) ?? '') }
}

/** The pad as it goes to the books: figures as numbers, sizes read. */
export function padOf(draft) {
  const lines = draft.lines.map((l) => {
    const qty = Number(l.qty) || 0
    const rate = Number(l.rate) || 0
    const base = { id: l.id, form: l.form, label: l.label, qty, rate, amount: amountOf({ qty, rate }) }
    if (l.extra) return { ...base, extra: true, unit: l.unit }
    const w = parseDim(l.wText)
    const h = parseDim(l.hText)
    return { ...base, fill: l.fill, ...(inchesOf(w) > 0 && inchesOf(h) > 0 ? { w, h } : {}) }
  })
  return {
    orderDate: draft.orderDate || todayKey(),
    ...(draft.deliveryDate ? { deliveryDate: draft.deliveryDate } : {}),
    fare: Math.max(0, Math.round(Number(draft.fare) || 0)),
    advance: Math.max(0, Math.round(Number(draft.advance) || 0)),
    lines,
  }
}

export default function MakeOrder({ job, onClose }) {
  const [draft, setDraft] = useState(() => readDraft(job) ?? { orderDate: todayKey(), deliveryDate: '', fare: String(FARE), advance: '', lines: [] })
  useEffect(() => { try { localStorage.setItem(draftKey(job), JSON.stringify(draft)) } catch { /* kept in memory only */ } }, [draft, job])
  const [adding, setAdding] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [sending, setSending] = useState(false)

  const pad = useMemo(() => padOf(draft), [draft])
  const who = whoOf(job)
  const ready = pad.lines.some((l) => l.qty > 0)
  const pieces = pad.lines.filter((l) => !l.extra).reduce((t, l) => t + l.qty, 0)
  const unsized = draft.lines.filter((l) => !l.extra && !(inchesOf(parseDim(l.wText)) > 0 && inchesOf(parseDim(l.hText)) > 0)).length

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const setLine = (id, patch) => setDraft((d) => ({
    ...d,
    lines: d.lines.map((l) => {
      if (l.id !== id) return l
      const next = { ...l, ...patch }
      // A new fill is a new piece: its own label and, if the shop has used one, its own rate.
      if (patch.fill) {
        next.label = productLabel(next.form, next.fill)
        const known = rateFor(next)
        if (known) next.rate = String(known)
      }
      return next
    }),
  }))
  const add = (id) => { setDraft((d) => ({ ...d, lines: [...d.lines, lineFor(id)] })); setAdding(false) }
  const drop = (id) => setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== id) }))

  const send = () => {
    for (const l of pad.lines) learnRate(l)
    post({ jobId: job.id, step: 'quotation', pad: { ...pad, lines: pad.lines.filter((l) => l.qty > 0) } })
    try { localStorage.removeItem(draftKey(job)) } catch { /* nothing kept */ }
    setSending(false)
    onClose()
  }

  return (
    <div className="app page makeorder">
      <header className="pagehead">
        <button type="button" className="back" onClick={onClose} aria-label="Back to the job"><BackIcon /></button>
        <div className="who">
          <b>Work order</b>
          <small>{[who.name, `Work order ${job.number}`].filter(Boolean).join(' · ')}</small>
        </div>
      </header>

      <main className="scroll">
        <section className="padblock" aria-label="Dates">
          <div className="padpair">
            <label className="ask">Order date
              <input type="date" value={draft.orderDate} onChange={(e) => set({ orderDate: e.target.value })} />
            </label>
            <label className="ask">Delivery date
              <input type="date" value={draft.deliveryDate} onChange={(e) => set({ deliveryDate: e.target.value })} />
            </label>
          </div>
        </section>

        <section className="padblock" aria-label="Items">
          <h2 className="padhead">Items</h2>
          {draft.lines.length === 0 && <p className="padhint">Nothing yet. Add each piece from the measurements: what it is, how many, its size and what each costs.</p>}
          {draft.lines.map((l, i) => (
            <div key={l.id} className="padline">
              <div className="padlinetop">
                <b>{i + 1}. {l.extra ? l.label : FORMS[l.form]?.label}</b>
                <button type="button" className="padx" onClick={() => drop(l.id)} aria-label={`Remove ${l.label}`}><CloseIcon size={20} /></button>
              </div>
              {!l.extra && (
                <div className="padchips" role="group" aria-label="Fill">
                  {FILLS_FOR[l.form].map((f) => (
                    <button key={f} type="button" className={l.fill === f ? 'on' : ''} aria-pressed={l.fill === f} onClick={() => setLine(l.id, { fill: f })}>{FILLS[f].label}</button>
                  ))}
                </div>
              )}
              <div className={`padgrid ${l.extra ? 'extra' : ''}`}>
                <label className="ask">{l.extra ? l.unit : 'Pieces'}
                  <input inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.id, { qty: e.target.value.replace(/[^\d.]/g, '') })} />
                </label>
                {!l.extra && (
                  <>
                    <label className="ask">Width ″
                      <input inputMode="decimal" placeholder={fmtDim(FORMS[l.form].nominal?.w) || '0'} value={l.wText} onChange={(e) => setLine(l.id, { wText: e.target.value })} />
                    </label>
                    <label className="ask">Height ″
                      <input inputMode="decimal" placeholder={fmtDim(FORMS[l.form].nominal?.h) || '0'} value={l.hText} onChange={(e) => setLine(l.id, { hText: e.target.value })} />
                    </label>
                  </>
                )}
                <label className="ask">₹ each
                  <input inputMode="numeric" value={l.rate} onChange={(e) => setLine(l.id, { rate: e.target.value.replace(/[^\d.]/g, '') })} />
                </label>
              </div>
              <p className="padsum">
                {!l.extra && (inchesOf(parseDim(l.wText)) > 0 && inchesOf(parseDim(l.hText)) > 0
                  ? <span>{fmtDim(parseDim(l.wText))}″ × {fmtDim(parseDim(l.hText))}″</span>
                  : <span className="wait">No size yet: not drawn</span>)}
                <b>{inr(amountOf({ qty: Number(l.qty) || 0, rate: Number(l.rate) || 0 }))}</b>
              </p>
            </div>
          ))}
          <button type="button" className="key ghost padadd" onClick={() => setAdding(true)}><PlusIcon /> Add item</button>
        </section>

        <section className="padblock" aria-label="Money">
          <div className="padpair">
            <label className="ask">Fare ₹
              <input inputMode="numeric" value={draft.fare} onChange={(e) => set({ fare: e.target.value.replace(/\D/g, '') })} />
            </label>
            <label className="ask">Advance ₹
              <input inputMode="numeric" placeholder="0" value={draft.advance} onChange={(e) => set({ advance: e.target.value.replace(/\D/g, '') })} />
            </label>
          </div>
          <div className="padtotals">
            <span>Total <b>{inr(totalOf(pad))}</b></span>
            {pad.advance > 0 && <span>Balance <b>{inr(totalOf(pad) - pad.advance)}</b></span>}
          </div>
          <p className="padhint">The advance is written on the pad only. Put it in the cash book as usual.</p>
        </section>

        {ready && (
          <section className="padblock" aria-label="The pad">
            <h2 className="padhead">Customer copy</h2>
            <PadSheet copy={copyOf('customer')} number={job.number} who={who} pad={pad} />
            <button type="button" className="key ghost padadd" onClick={() => setPrinting(true)}><SheetIcon /> Print 3 pages</button>
            <p className="padhint">Prints with no colour: load pink, white, yellow paper, in that order.</p>
          </section>
        )}
      </main>

      <div className="dock">
        <button type="button" className="key safe" disabled={!ready} onClick={() => setSending(true)}><SendIcon size={26} strokeWidth="2.6" /> Send to workshop</button>
      </div>

      {adding && (
        <Sheet label="Add item" wide onClose={() => setAdding(false)}>
          <b className="sheettitle">Add item</b>
          <p>A piece to make, drawn on the pad once it has a size:</p>
          <div className="padpick">
            {FORM_IDS.map((id) => <button key={id} type="button" className="key ghost" onClick={() => add(id)}>{FORMS[id].label}</button>)}
          </div>
          <p>Or a loose item, not drawn:</p>
          <div className="padpick">
            {Object.keys(EXTRAS).map((id) => <button key={id} type="button" className="key ghost" onClick={() => add(id)}>{EXTRAS[id].label}</button>)}
          </div>
        </Sheet>
      )}
      {sending && (
        <Sheet label="Send to workshop" onClose={() => setSending(false)}>
          <b className="sheettitle">Send the work order?</b>
          <p>
            {pieces > 0 ? `${pieces} ${pieces === 1 ? 'piece' : 'pieces'} to make. ` : ''}
            The workshop gets the yellow copy and the job moves on to Assemble. This cannot be gone back to.
            {unsized > 0 ? ` ${unsized} ${unsized === 1 ? 'piece has' : 'pieces have'} no size and will not be drawn.` : ''}
          </p>
          <div className="sheetbtns">
            <button type="button" className="ghost" onClick={() => setSending(false)}>Not yet</button>
            <button type="button" className="solid safe" onClick={send}>Send</button>
          </div>
        </Sheet>
      )}
      {printing && <PrintPads number={job.number} who={who} pad={pad} onDone={() => setPrinting(false)} />}
    </div>
  )
}

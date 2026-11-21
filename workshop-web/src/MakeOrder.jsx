import { useEffect, useMemo, useState } from 'react'
import { contactsOf, addressOf, nameOf } from './flow.js'
import { post } from './outbox.js'
import { BackIcon, CloseIcon, SendIcon, Sheet, SheetIcon } from './ui.jsx'
import { NumberPad } from './NewOrder.jsx'
import { DatePick } from './DatePick.jsx'
import { PadSheet, PrintPads, copyOf } from './pad/PadSheet.jsx'
import {
  EXTRAS, FARE, FILLS, FILLS_FOR, FORMS, FORM_IDS, amountOf, inr, learnRate, productLabel, rateFor, todayKey, totalOf,
} from './pad/forms.js'
import { SOOT_GLYPH, fmtDim, inchesOf, parseDim } from './pad/dims.js'

/**
 * The work order made on the app, at the counter: the other way to the
 * photographed one. Laid out as the New visit order (Tony, 21 Nov 2026): the
 * whole screen, by touch, no keyboard. Dates and money on the left; the
 * pieces as tiles in the middle, each opening its fill, size, how many and
 * rate on big keys; the pad itself on the right, drawn as it is made.
 *
 * Each line is a piece (what is built and what goes in it), how many, its
 * size and what each costs; or a loose item such as liping. The pad's three
 * copies are drawn from it (pad/PadSheet.jsx): printed here, and sent, which
 * hands the workshop its yellow copy, counts the pieces to make and moves the
 * job on to Assemble.
 *
 * What is tapped is kept on this device until it is sent, so leaving the page
 * loses nothing.
 */

const draftKey = (job) => `workshop:pad-draft:${job.id}`
const readDraft = (job) => { try { return JSON.parse(localStorage.getItem(draftKey(job)) || 'null') } catch { return null } }
const newId = () => Math.random().toString(36).slice(2, 9)

// Every number to ring, as the slip and the pad write them: "8709964141, 8709964142".
export const whoOf = (job) => ({ name: nameOf(job), address: addressOf(job), mobile: contactsOf(job.phone).join(', ') })

/** A new line for a tile: its first fill, and the rate this counter last used for it. */
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

const sized = (l) => !l.extra && inchesOf(parseDim(l.wText)) > 0 && inchesOf(parseDim(l.hText)) > 0
const sizeLine = (l) => (sized(l) ? `${fmtDim(parseDim(l.wText))}″ × ${fmtDim(parseDim(l.hText))}″` : 'No size')

/* ── a size on big keys: the inches, then the eighths ──────────────────────── */
// The tape is read in eighths and the shop writes them that way, 13 7/8; so
// the figures go in first and an eighth key finishes it.
const splitSize = (text) => { const d = parseDim(text); return { whole: d.inches ? String(d.inches) : '', soot: d.soot } }
const joinSize = ({ whole, soot }) => (whole || soot ? `${whole || '0'}${soot ? ` ${soot}/8` : ''}` : '')

function SizeKeys({ value, onChange }) {
  const v = splitSize(value)
  const press = (k) => {
    if (k === 'back') return onChange(joinSize(v.soot ? { ...v, soot: 0 } : { ...v, whole: v.whole.slice(0, -1) }))
    if (k === 'C') return onChange('')
    return onChange(joinSize({ ...v, whole: (v.whole + k).replace(/^0+(?=\d)/, '').slice(0, 3) }))
  }
  return (
    <div className="sizekeys">
      <div className="numpad">
        {['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', 'back'].map((k) => (
          <button key={k} type="button" onClick={() => press(k)} aria-label={k === 'back' ? 'Delete' : k === 'C' ? 'Clear' : k}>
            {k === 'back' ? <BackIcon size={24} /> : k}
          </button>
        ))}
      </div>
      <div className="eighths" role="group" aria-label="Eighths">
        {SOOT_GLYPH.map((g, s) => (
          <button key={s} type="button" className={v.soot === s ? 'on' : ''} aria-pressed={v.soot === s} onClick={() => onChange(joinSize({ ...v, soot: s }))}>{s ? g : 'No 8th'}</button>
        ))}
      </div>
    </div>
  )
}

/** Plain figures on big keys, for a rate or a length. */
function FigureKeys({ value, onChange, decimal }) {
  const press = (k) => {
    if (k === 'back') return onChange(value.slice(0, -1))
    if (k === 'C') return onChange('')
    if (k === '.') return onChange(decimal && !value.includes('.') ? `${value || '0'}.` : value)
    return onChange((value + k).replace(/^0+(?=\d)/, '').slice(0, 7))
  }
  return (
    <div className="numpad">
      {['7', '8', '9', '4', '5', '6', '1', '2', '3', decimal ? '.' : 'C', '0', 'back'].map((k) => (
        <button key={k} type="button" onClick={() => press(k)} aria-label={k === 'back' ? 'Delete' : k === 'C' ? 'Clear' : k}>
          {k === 'back' ? <BackIcon size={24} /> : k}
        </button>
      ))}
    </div>
  )
}

/**
 * One piece, open on the whole screen: what goes in it, its width and height,
 * how many and what each costs, the figure being set on the keys at the right.
 * A loose item has only how many and its rate.
 */
function PieceSheet({ start, onClose, onSave }) {
  const [l, setL] = useState(start)
  const [field, setField] = useState(start.extra ? 'qty' : sized(start) ? 'rate' : 'w')
  const set = (patch) => setL((x) => {
    const next = { ...x, ...patch }
    // A new fill is a new piece: its own label and, if the counter has used one, its own rate.
    if (patch.fill) {
      next.label = productLabel(next.form, next.fill)
      const known = rateFor(next)
      if (known) next.rate = String(known)
    }
    return next
  })
  const title = l.extra ? l.label : FORMS[l.form]?.label
  const fields = l.extra
    ? [['qty', `How many (${l.unit})`, l.qty || '0'], ['rate', `₹ each ${l.unit}`, l.rate || '0']]
    : [
        ['w', 'Width ″', l.wText || fmtDim(FORMS[l.form].nominal?.w) || '0', !l.wText],
        ['h', 'Height ″', l.hText || fmtDim(FORMS[l.form].nominal?.h) || '0', !l.hText],
        ['rate', '₹ each', l.rate || '0'],
      ]
  const amount = amountOf({ qty: Number(l.qty) || 0, rate: Number(l.rate) || 0 })
  const step = (by) => set({ qty: String(Math.max(1, (Number(l.qty) || 0) + by)) })

  return (
    <Sheet label={title} wide onClose={onClose}>
      <b className="sheettitle">{title}</b>
      <div className="optpanel">
        <div className="optleft">
          {!l.extra && (
            <div className="optrow">
              <span className="ask">What goes in it</span>
              <div className="needs" role="group" aria-label="Fill">
                {FILLS_FOR[l.form].map((f) => (
                  <button key={f} type="button" className={l.fill === f ? 'on' : ''} aria-pressed={l.fill === f} onClick={() => set({ fill: f })}>{FILLS[f].label}</button>
                ))}
              </div>
            </div>
          )}
          <div className="figrows">
            {fields.map(([k, label, shown, hint]) => (
              <button key={k} type="button" className={`figrow ${field === k ? 'on' : ''}`} aria-pressed={field === k} onClick={() => setField(k)}>
                <span>{label}</span><b className={hint ? 'hint' : ''}>{shown}</b>
              </button>
            ))}
          </div>
          {!l.extra && (
            <div className="optqty">
              <button type="button" className="step" onClick={() => step(-1)} aria-label="One less">−</button>
              <b>{l.qty || 0} <small>Pc</small></b>
              <button type="button" className="step" onClick={() => step(1)} aria-label="One more">+</button>
            </div>
          )}
          <p className="optline">{l.label}{sized(l) ? ` · ${sizeLine(l)}` : ''} · {inr(amount)}</p>
        </div>
        <div className="optright">
          {field === 'w' && <SizeKeys value={l.wText} onChange={(v) => set({ wText: v })} />}
          {field === 'h' && <SizeKeys value={l.hText} onChange={(v) => set({ hText: v })} />}
          {field === 'rate' && <FigureKeys value={l.rate} decimal onChange={(v) => set({ rate: v })} />}
          {field === 'qty' && <FigureKeys value={l.qty} decimal onChange={(v) => set({ qty: v })} />}
          <div className="sheetbtns">
            <button type="button" className="ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="solid safe" disabled={!(Number(l.qty) > 0)} onClick={() => onSave(l)}>{start.fresh ? 'Add' : 'Done'}</button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

export default function MakeOrder({ job, onClose }) {
  const [draft, setDraft] = useState(() => readDraft(job) ?? { orderDate: todayKey(), deliveryDate: '', fare: String(FARE), advance: '', lines: [] })
  useEffect(() => { try { localStorage.setItem(draftKey(job), JSON.stringify(draft)) } catch { /* kept in memory only */ } }, [draft, job])
  const [editing, setEditing] = useState(null) // a line, open in PieceSheet
  const [money, setMoney] = useState(null) // 'fare' | 'advance', open on the number pad
  const [printing, setPrinting] = useState(false)
  const [sending, setSending] = useState(false)

  const pad = useMemo(() => padOf(draft), [draft])
  const who = whoOf(job)
  const ready = pad.lines.some((l) => l.qty > 0)
  const pieces = pad.lines.filter((l) => !l.extra).reduce((t, l) => t + l.qty, 0)
  const unsized = draft.lines.filter((l) => !l.extra && !sized(l)).length
  const total = totalOf(pad)

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const save = (line) => {
    const { fresh, ...l } = line
    setDraft((d) => ({ ...d, lines: fresh ? [...d.lines, l] : d.lines.map((x) => (x.id === l.id ? l : x)) }))
    setEditing(null)
  }
  const bump = (id, by) => setDraft((d) => ({
    ...d,
    lines: d.lines.flatMap((l) => {
      if (l.id !== id) return [l]
      const qty = Math.round(((Number(l.qty) || 0) + by) * 100) / 100
      return qty > 0 ? [{ ...l, qty: String(qty) }] : []
    }),
  }))
  const drop = (id) => setDraft((d) => ({ ...d, lines: d.lines.filter((l) => l.id !== id) }))
  // A tile's count: every line made from it.
  const countOf = (id) => draft.lines.filter((l) => l.form === id).reduce((t, l) => t + (Number(l.qty) || 0), 0)

  const send = () => {
    for (const l of pad.lines) learnRate(l)
    post({ jobId: job.id, step: 'quotation', pad: { ...pad, lines: pad.lines.filter((l) => l.qty > 0) } })
    try { localStorage.removeItem(draftKey(job)) } catch { /* nothing kept */ }
    setSending(false)
    onClose()
  }

  const tiles = [
    { group: 'Pieces to make', ids: FORM_IDS, label: (id) => FORMS[id].label },
    { group: 'Loose items', ids: Object.keys(EXTRAS), label: (id) => EXTRAS[id].label },
  ]

  return (
    <div className="app page neworder making makeorder" role="dialog" aria-modal="true" aria-label="Work order">
      <header className="pagehead">
        <button type="button" className="back" onClick={onClose} aria-label="Back to the job"><BackIcon /></button>
        <div className="who">
          <b>Work order</b>
          <small>{[[who.name, who.address].filter(Boolean).join(', '), `Work order ${job.number}`].filter(Boolean).join(' · ')}</small>
        </div>
        {/* Cancel and Send up here, in sight beside the title. */}
        <div className="nwkeys">
          <button type="button" className="key ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="key safe" disabled={!ready} onClick={() => setSending(true)}><SendIcon size={18} strokeWidth="2.6" /> Send to workshop</button>
        </div>
      </header>

      <main className="scroll nwgrid">
        <section className="nwform" aria-label="Dates and money">
          <div className="slipform">
            <DatePick label="Order date" value={draft.orderDate} onChange={(k) => set({ orderDate: k || todayKey() })} />
            <DatePick label="Delivery" value={draft.deliveryDate} noneLabel="Not set" onChange={(k) => set({ deliveryDate: k })} />
            <button type="button" className="advkey" onClick={() => setMoney('fare')}>
              <span>Fare</span><b>{pad.fare ? inr(pad.fare) : 'None'}</b>
            </button>
            <button type="button" className="advkey" onClick={() => setMoney('advance')}>
              <span>Advance</span><b>{pad.advance ? inr(pad.advance) : 'None'}</b>
            </button>
          </div>
          <div className="padsums">
            <p><span>Total</span><b>{inr(total)}</b></p>
            {pad.advance > 0 && <p><span>Balance</span><b>{inr(total - pad.advance)}</b></p>}
          </div>
          <p className="padhint">The advance is written on the pad only. Put it in the cash book as usual.</p>
        </section>

        <section className="nwitems" aria-label="Items">
          <div className="tiles">
            {tiles.map((g) => (
              <div key={g.group} className="tilegroup">
                <h3>{g.group}</h3>
                <div className="tilegrid">
                  {g.ids.map((id) => {
                    const n = countOf(id)
                    return (
                      <button key={id} type="button" className={`tile ${n ? 'on' : ''}`} onClick={() => setEditing({ ...lineFor(id), fresh: true })}>
                        <span>{g.label(id)}</span>
                        {n > 0 && <b>{n}</b>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="chosenlist" aria-label="On the work order">
            {draft.lines.length === 0 && <p className="chosenempty">Tap each piece from the measurements: what goes in it, its size, how many and the rate.</p>}
            {draft.lines.map((l) => (
              <div key={l.id} className="chosenline padline2">
                <button type="button" className="what" onClick={() => setEditing(l)}>
                  {l.label}
                  <small className={!l.extra && !sized(l) ? 'wait' : ''}>
                    {l.extra ? '' : `${sizeLine(l)} · `}{inr(Number(l.rate) || 0)} each · {inr(amountOf({ qty: Number(l.qty) || 0, rate: Number(l.rate) || 0 }))}
                  </small>
                </button>
                <button type="button" className="step" onClick={() => bump(l.id, -1)} aria-label={`One less ${l.label}`}>−</button>
                <button type="button" className="count" onClick={() => setEditing(l)} aria-label={`Change ${l.label}`}>{l.qty}<small>{l.extra ? l.unit : 'Pc'}</small></button>
                <button type="button" className="step" onClick={() => bump(l.id, 1)} aria-label={`One more ${l.label}`}>+</button>
                <button type="button" className="drop" onClick={() => drop(l.id)} aria-label={`Remove ${l.label}`}><CloseIcon size={18} /></button>
              </div>
            ))}
          </div>
        </section>

        <section className="nwslip" aria-label="The pad">
          <PadSheet copy={copyOf('customer')} number={job.number} who={who} pad={pad} fitHeight />
          <button type="button" className="pick" disabled={!ready} onClick={() => setPrinting(true)}><SheetIcon /> Print 3 pages</button>
        </section>
      </main>

      {editing && <PieceSheet start={editing} onClose={() => setEditing(null)} onSave={save} />}
      {money && (
        <NumberPad
          title={money === 'fare' ? 'Fare ₹' : 'Advance ₹'}
          start={draft[money]}
          quick={money === 'fare' ? [0, 100, 200, 300] : [500, 1000, 2000, 5000]}
          onClose={() => setMoney(null)}
          onDone={(v) => { set({ [money]: v }); setMoney(null) }}
        />
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

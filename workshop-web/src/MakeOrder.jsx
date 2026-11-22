import { useEffect, useMemo, useState } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { api, contactsOf, addressOf, nameOf, said } from './flow.js'
import { post } from './outbox.js'
import { BackIcon, CloseIcon, SendIcon, Sheet, SheetIcon, TickIcon } from './ui.jsx'
import { NumberPad } from './NewOrder.jsx'
import { DatePick } from './DatePick.jsx'
import { PadSheet, copyOf, padFormat, padPageCount, padPictures } from './pad/PadSheet.jsx'
import { QueuePrint, printOnQueue } from './sendOut.jsx'
import {
  CHAUKHATS, EXTRAS, FARE, FILLS, FILLS_FOR, FLUSH_BRANDS, FORMS, FORM_IDS, HOME_IDS, THICK, THICKS, THICK_IDS, amountOf, flushLabel,
  hasThick, homeRates, inr, learnHome, learnRate, productLabel, rateFor, sheetPrice, todayKey, totalOf,
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
/** The tile, and the lines it makes: door fittings picked from the shop's catalog. */
const FITTINGS = 'fitting'

/** The advance already taken on this job's visit order(s), pulled onto the work order (Tony, 22 Nov 2026). */
export const visitAdvanceOf = (job) => (job.messages || []).reduce((t, m) => t + (m.slip?.advance > 0 ? Math.round(m.slip.advance) : 0), 0)

// Every number to ring, as the slip and the pad write them: "8709964141, 8709964142".
export const whoOf = (job) => ({ name: nameOf(job), address: addressOf(job), mobile: contactsOf(job.phone).join(', ') })

/** A new line for a tile: its first fill, and the rate this counter last used for it. */
function lineFor(id) {
  if (EXTRAS[id]) {
    const line = { id: newId(), form: id, extra: true, label: EXTRAS[id].label, unit: EXTRAS[id].unit, qty: '1', rate: '' }
    return { ...line, rate: String(rateFor(line) ?? '') }
  }
  const fill = FILLS_FOR[id][0]
  const thick = hasThick(id) ? THICK : undefined
  if (id === 'flush-door') {
    const line = { id: newId(), form: id, fill, brand: FLUSH_BRANDS[0][0], qty: '1', rate: '', wText: '', hText: '' }
    return { ...line, label: flushLabel(line) }
  }
  const line = { id: newId(), form: id, fill, ...(thick ? { thick } : {}), label: productLabel(id, fill, thick), qty: '1', rate: '', wText: '', hText: '' }
  return { ...line, rate: String(rateFor(line) ?? '') }
}

/**
 * A line brought up to date: its thickness (1.2 MM on one made before it was
 * asked), its label, and its rate worked out from the rate sheet when the
 * sheet prices it and the counter has not typed one (`rateHand`).
 */
export function freshen(l) {
  if (l.extra) return l
  const thick = hasThick(l.form) ? (THICKS[l.thick] ? l.thick : THICK) : undefined
  const next = { ...l, ...(thick ? { thick } : {}), label: l.form === 'flush-door' ? flushLabel(l) : productLabel(l.form, l.fill, thick) }
  if (!next.rateHand) {
    const s = sheetPrice(next)
    if (s) next.rate = String(s.rate)
  }
  return next
}

/** The pad as it goes to the books: figures as numbers, sizes read. */
export function padOf(draft) {
  // Each line worked out afresh from the rate sheet, so a door's rows never drop off for a price kept from before.
  const lines = draft.lines.map(freshen).map((l) => {
    const qty = Number(l.qty) || 0
    const rate = Number(l.rate) || 0
    const base = { id: l.id, form: l.form, label: l.label, qty, rate, amount: amountOf({ qty, rate }) }
    if (l.extra) return { ...base, extra: true, unit: l.unit }
    const w = parseDim(l.wText)
    const h = parseDim(l.hText)
    // The area the rate sheet priced it at, written after the Pc on the pad: "1 Pc 11.38'" (Tony, 22 Nov 2026).
    const sheet = sheetPrice(l)
    const sqft = sheet?.sqft
    // A door at the sheet's rate goes on the pad part by part, each on its own line:
    // the door, the chaukhat, the accessories (Tony, 22 Nov 2026). A rate typed by hand is one line.
    const parts = !l.rateHand && sheet?.parts ? sheet.parts : null
    return {
      ...base, fill: l.fill, ...(l.thick ? { thick: l.thick } : {}), ...(inchesOf(w) > 0 && inchesOf(h) > 0 ? { w, h } : {}),
      ...(sqft ? { sqft } : {}), ...(parts ? { parts } : {}),
      // A door sent without its fitting items is drawn with none (sketch.jsx DoorFittings).
      ...(l.form === 'alu-door' && l.fitting === false ? { fitting: false } : {}),
      ...(l.form === 'alu-door' && l.chaukhat === false ? { chaukhat: false } : {}),
      // Which side it hangs on, seen from the room; left unless asked.
      ...(HINGED.includes(l.form) && l.hinge === 'right' ? { hinge: 'right' } : {}),
      // A flush door: its paneling, its chaukhat and whether it is fitted, for its drawing.
      ...(l.form === 'flush-door' ? { brand: l.brand, paneling: !!l.paneling, ...(l.wpc ? { wpc: l.wpc } : {}), ...(l.fitting === false ? { fitting: false } : {}) } : {}),
    }
  })
  return {
    orderDate: draft.orderDate || todayKey(),
    ...(draft.deliveryDate ? { deliveryDate: draft.deliveryDate } : {}),
    fare: Math.max(0, Math.round(Number(draft.fare) || 0)),
    advance: Math.max(0, Math.round(Number(draft.advance) || 0)),
    lines,
  }
}

/** Pieces that hang on one side, so the customer is asked which (Tony, 22 Nov 2026). */
const HINGED = ['alu-door', 'window-1', 'flush-door']

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
  const [l, setL] = useState(() => freshen(start))
  const [field, setField] = useState(start.extra ? 'qty' : sized(start) ? (start.form === 'flush-door' ? 'w' : 'rate') : 'w')
  const set = (patch) => setL((x) => {
    let next = { ...x, ...patch }
    // A new fill is a new piece: if the counter has used one, its own rate.
    if (patch.fill && !next.rateHand) {
      const known = rateFor(next)
      if (known) next.rate = String(known)
    }
    // A rate typed by hand stays; otherwise the rate sheet works it out from the size and thickness.
    if (patch.rate !== undefined) next.rateHand = true
    if (!next.extra) next = freshen(next)
    return next
  })
  const sheet = l.extra ? null : sheetPrice(l)
  const title = l.extra ? l.label : FORMS[l.form]?.label
  const flush = l.form === 'flush-door'
  const kept = homeRates()
  // A home job's own rates, typed once and remembered: a sunmica sheet, the fitting, the items.
  const typed = (k) => (l[k] !== undefined && l[k] !== '' ? l[k] : kept[k] ? String(kept[k]) : '')
  const fields = l.extra
    ? [['qty', `How many (${l.unit})`, l.qty || '0'], ['rate', `₹ each ${l.unit}`, l.rate || '0']]
    : [
        // An unset size says so: a suggested figure in grey was read as a real one.
        ['w', 'Width ″', l.wText || 'Not set', !l.wText],
        ['h', 'Height ″', l.hText || 'Not set', !l.hText],
        ...(flush && FILLS[l.fill]?.sides ? [
          ['micaNo', 'Front mica no.', l.micaNo || 'Not set', !l.micaNo],
          ['sunRate', '₹ front mica sheet', typed('sunRate') || 'Not set', !typed('sunRate')],
          ['linerRate', '₹ liner teak sheet', typed('linerRate') || 'Not set', !typed('linerRate')],
        ] : []),
        ...(flush && l.fitting !== false ? [['fitRate', '₹ door fitting', typed('fitRate') || 'Not set', !typed('fitRate')]] : []),
        ...(flush ? [] : [['rate', '₹ each', l.rate || '0']]),
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
          {hasThick(l.form) && !l.extra && (
            <div className="optrow">
              <span className="ask">Thickness</span>
              <div className="needs" role="group" aria-label="Thickness">
                {THICK_IDS.map((t) => (
                  <button key={t} type="button" className={l.thick === t ? 'on' : ''} aria-pressed={l.thick === t} onClick={() => set({ thick: t })}>{THICKS[t].label}</button>
                ))}
              </div>
            </div>
          )}
          {HINGED.includes(l.form) && (
            <div className="optrow">
              <span className="ask">Hinges, seen from the room</span>
              <div className="needs hingeside" role="group" aria-label="Hinges, seen from the room">
                {[['left', 'Left'], ['right', 'Right']].map(([k, word]) => {
                  const on = (l.hinge === 'right' ? 'right' : 'left') === k
                  return <button key={k} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => set({ hinge: k })}>{word}</button>
                })}
              </div>
            </div>
          )}
          {flush && (
            <>
              <div className="optrow">
                <span className="ask">Door brand (rate a sqft)</span>
                <div className="needs" role="group" aria-label="Door brand">
                  {FLUSH_BRANDS.map(([b, r]) => (
                    <button key={b} type="button" className={l.brand === b ? 'on' : ''} aria-pressed={l.brand === b} onClick={() => set({ brand: b })}>{b} {r}</button>
                  ))}
                </div>
              </div>
              <div className="optrow">
                <span className="ask">Chaukhat</span>
                <div className="needs" role="group" aria-label="Chaukhat">
                  {[['', 'None'], ...Object.entries(CHAUKHATS).map(([k, c]) => [k, c.label])].map(([k, word]) => (
                    <button key={k || 'none'} type="button" className={(l.wpc || '') === k ? 'on' : ''} aria-pressed={(l.wpc || '') === k} onClick={() => set({ wpc: k || undefined })}>{word}</button>
                  ))}
                </div>
              </div>
              {CHAUKHATS[l.wpc] && Object.keys(CHAUKHATS[l.wpc].sets).length > 1 && (
                <div className="optrow">
                  <span className="ask">Chaukhat brand</span>
                  <div className="needs" role="group" aria-label="Chaukhat brand">
                    {Object.entries(CHAUKHATS[l.wpc].sets).map(([b, r]) => {
                      const on = (CHAUKHATS[l.wpc].sets[l.wpcBrand] ? l.wpcBrand : Object.keys(CHAUKHATS[l.wpc].sets)[0]) === b
                      return <button key={b} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => set({ wpcBrand: b })}>{b} {r}</button>
                    })}
                  </div>
                </div>
              )}
              <div className="optrow">
                <span className="ask">With the door</span>
                <div className="needs" role="group" aria-label="With the door">
                  {[['paneling', 'Paneling', !!l.paneling], ['fitting', 'Fitting at home', l.fitting !== false]].map(([k, word, on]) => (
                    <button key={k} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => set({ [k]: !on })}>{word}</button>
                  ))}
                </div>
              </div>
            </>
          )}
          {l.form === 'alu-door' && (
            <div className="optrow">
              <span className="ask">With the door</span>
              <div className="needs" role="group" aria-label="With the door">
                {[['chaukhat', 'Chaukhat'], ['fitting', 'Fitting items']].map(([k, word]) => {
                  const on = l[k] !== false
                  return <button key={k} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => set({ [k]: !on })}>{word}</button>
                })}
              </div>
            </div>
          )}
          {!l.extra && (
            <div className="optqty">
              <button type="button" className="step" onClick={() => step(-1)} aria-label="One less">−</button>
              <b>{l.qty || 0} <small>Pc</small></b>
              <button type="button" className="step" onClick={() => step(1)} aria-label="One more">+</button>
            </div>
          )}
          <p className="optline">{l.label}{sized(l) ? ` · ${sizeLine(l)}` : ''} · {inr(amount)}</p>
          {sheet && (
            <p className="sheetwork">
              {l.rateHand
                ? <>Rate sheet says {inr(sheet.rate)} each. <button type="button" className="linkish" onClick={() => setL((x) => freshen({ ...x, rateHand: false }))}>Use it</button></>
                : <>From the rate sheet: {sheet.working} = {inr(sheet.rate)} each</>}
            </p>
          )}
        </div>
        <div className="optright">
          {/* The figures sit over their keys, on the side with room, so the screen never scrolls. */}
          <div className="figrows">
            {fields.map(([k, label, shown, hint]) => (
              <button key={k} type="button" className={`figrow ${field === k ? 'on' : ''}`} aria-pressed={field === k} onClick={() => setField(k)}>
                <span>{label}</span><b className={hint ? 'hint' : ''}>{shown}</b>
              </button>
            ))}
          </div>
          {field === 'w' && <SizeKeys value={l.wText} onChange={(v) => set({ wText: v })} />}
          {field === 'h' && <SizeKeys value={l.hText} onChange={(v) => set({ hText: v })} />}
          {field === 'rate' && <FigureKeys value={l.rate} decimal onChange={(v) => set({ rate: v })} />}
          {field === 'qty' && <FigureKeys value={l.qty} decimal onChange={(v) => set({ qty: v })} />}
          {['sunRate', 'linerRate', 'fitRate'].includes(field) && <FigureKeys value={typed(field)} onChange={(v) => set({ [field]: v })} />}
          {field === 'micaNo' && <FigureKeys value={l.micaNo || ''} onChange={(v) => set({ micaNo: v })} />}
          <div className="sheetbtns">
            <button type="button" className="ghost" onClick={onClose}>Cancel</button>
            <button type="button" className="solid safe" disabled={!(Number(l.qty) > 0)} onClick={() => onSave(l)}>{start.fresh ? 'Add' : 'Done'}</button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

/* ── Door fittings, from the shop's own catalog ─────────────────────────────
   (Tony, 22 Nov 2026.) Handles, hinges, aldrops, locks, tower bolts, magnets
   and screws as the shop bills them, each with the rate it last went at: one
   tapped, how many on the keys, and it is a line of the work order. */
export const FIT_GROUPS = [
  ['Handles', /handle/i],
  ['Hinges', /hinge/i],
  ['Aldrops', /aldrop|kunda/i],
  ['Locks', /lock|latch/i],
  ['Tower bolts', /tower\s*bolt|\bt\.?\s?b\b/i],
  ['Magnets & stoppers', /magnet|stopper/i],
  ['Screws', /screw|nut\s*bolt/i],
]
/** The catalog's door fittings, each in the first group its name fits. */
export function fittingsOf(catalog) {
  const items = Array.isArray(catalog?.customCatalog) ? catalog.customCatalog : []
  return FIT_GROUPS.map(([name, re]) => [name, items.filter((i) => i?.name && re.test(i.name) && FIT_GROUPS.find(([, r]) => r.test(i.name))?.[0] === name)
    .sort((a, b) => a.name.localeCompare(b.name))])
}
export function FittingsSheet({ catalog, onClose, onPick }) {
  const groups = fittingsOf(catalog)
  const [group, setGroup] = useState(groups.find(([, list]) => list.length)?.[0] ?? groups[0][0])
  const list = groups.find(([g]) => g === group)?.[1] ?? []
  return (
    <Sheet label="Door fittings" wide onClose={onClose}>
      <b className="sheettitle">Door fittings</b>
      <div className="fitpick">
        <div className="needs fitgroups" role="group" aria-label="Kind">
          {groups.map(([g, items]) => (
            <button key={g} type="button" className={group === g ? 'on' : ''} aria-pressed={group === g} disabled={!items.length} onClick={() => setGroup(g)}>{g} <small>{items.length}</small></button>
          ))}
        </div>
        {catalog === undefined
          ? <p className="fitnone">Reading the shop's list…</p>
          : !list.length
            ? <p className="fitnone">Nothing of this kind in the shop's list yet.</p>
            : (
              <div className="fititems">
                {list.map((i) => (
                  <button key={i.id ?? i.name} type="button" onClick={() => onPick(i)}>
                    <span>{i.name}</span><b>{i.rate ? `${inr(i.rate)} / ${i.unit || 'Pc'}` : 'No rate'}</b>
                  </button>
                ))}
              </div>
            )}
        <div className="sheetbtns"><button type="button" className="ghost" onClick={onClose}>Close</button></div>
      </div>
    </Sheet>
  )
}

/* ── Proceed: check, choose what goes with it, send ────────────────────────
   (Tony, 21 Nov 2026.) One screen: what the order comes to and anything
   missing; whether the three copies print; then Send, each step ticked as it
   is done. It goes to the workshop in the app only, not to WhatsApp (Tony,
   21 Nov 2026). */
const PROCEED_KEY = 'workshop:proceed'
const readProceed = () => { try { return { print: JSON.parse(localStorage.getItem(PROCEED_KEY) || '{}').print ?? true } } catch { return { print: true } } }

function ProceedSheet({ job, who, pad, draft, pieces, unsized, total, onSend, onBack, onDone }) {
  const convex = useConvex()
  const [opts, setOpts] = useState(readProceed)
  const [steps, setSteps] = useState(null) // null while choosing; then { send, print } each 'wait' | 'doing' | 'done' | { error }
  const pick = (k) => setOpts((o) => {
    const next = { ...o, [k]: !o[k] }
    try { localStorage.setItem(PROCEED_KEY, JSON.stringify(next)) } catch { /* this visit only */ }
    return next
  })
  const loose = pad.lines.filter((l) => l.extra && l.qty > 0).length
  const adv = pad.advance || 0
  const name = `Work order ${job.number}`
  // Three copies, each as many pages as the pad runs to.
  const sheets = 3 * padPageCount(pad)

  const go = async () => {
    const mark = (k, v) => setSteps((s) => ({ ...s, [k]: v }))
    setSteps({ send: 'doing', ...(opts.print ? { print: 'wait' } : {}) })
    const out = onSend()
    mark('send', 'done')
    if (opts.print) {
      mark('print', 'doing')
      try { await printOnQueue(convex, await padPictures(job.number, who, out), name, 'color'); mark('print', 'done') } catch (err) { mark('print', { error: said(err) }) }
    }
  }
  const busy = steps && Object.values(steps).some((v) => v === 'doing' || v === 'wait')
  const STEP_WORDS = { send: 'Sent to the workshop', print: sheets > 3 ? `Three copies, ${sheets} pages, to the printer` : 'Three copies to the printer' }
  const state = (v) => (v === 'done' ? <TickIcon size={22} /> : v === 'doing' ? <span className="spin" /> : v === 'wait' ? <span className="stepwait" /> : <CloseIcon size={20} />)

  return (
    <Sheet label="Send the work order" wide onClose={busy ? () => {} : steps ? onDone : onBack}>
      <b className="sheettitle">{steps ? (busy ? `Sending ${name}` : `${name} sent`) : `Send ${name}?`}</b>
      {!steps ? (
        <div className="proceed">
          <dl className="proceedsum">
            <div><dt>For</dt><dd>{[who.name, who.address].filter(Boolean).join(', ') || 'No name'}</dd></div>
            <div><dt>Pieces to make</dt><dd>{pieces}</dd></div>
            {loose > 0 && <div><dt>Loose items</dt><dd>{loose}</dd></div>}
            <div><dt>Total</dt><dd>{inr(total)}</dd></div>
            {adv > 0 && <div><dt>Advance</dt><dd>− {inr(adv)}</dd></div>}
            {adv > 0 && <div><dt>Balance</dt><dd>{inr(total - adv)}</dd></div>}
          </dl>
          {(unsized > 0 || !draft.deliveryDate) && (
            <ul className="proceedwarn">
              {unsized > 0 && <li>{unsized} {unsized === 1 ? 'piece has' : 'pieces have'} no size and will not be drawn.</li>}
              {!draft.deliveryDate && <li>No delivery date set.</li>}
            </ul>
          )}
          <span className="ask">With it</span>
          <div className="proceedopts">
            <button type="button" className={opts.print ? 'on' : ''} aria-pressed={opts.print} onClick={() => pick('print')}>
              {opts.print ? <TickIcon size={22} /> : <span className="box" />} <span><b>Print {sheets} pages</b><small>Customer, shop and workshop copies{sheets > 3 ? `, ${sheets / 3} pages each` : ''}, in colour</small></span>
            </button>
          </div>
          <p className="proceednote">The job moves on to Assemble, and the workshop sees the yellow copy. This cannot be gone back to.</p>
          <div className="sheetbtns">
            <button type="button" className="ghost" onClick={onBack}>Not yet</button>
            <button type="button" className="solid safe" onClick={go}><SendIcon size={20} /> Send</button>
          </div>
        </div>
      ) : (
        <div className="proceed">
          <ul className="proceedsteps">
            {Object.entries(steps).map(([k, v]) => (
              <li key={k} className={typeof v === 'object' ? 'bad' : v}>
                {state(v)} <span><b>{STEP_WORDS[k]}</b>{typeof v === 'object' && <small>{v.error}</small>}</span>
              </li>
            ))}
          </ul>
          <div className="sheetbtns">
            <button type="button" className="solid safe" disabled={busy} onClick={onDone}>Done</button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

export default function MakeOrder({ job, onClose }) {
  // The advance follows the visit order's until the counter changes it by hand (`advanceSet`).
  const pulled = visitAdvanceOf(job)
  const [draft, setDraft] = useState(() => {
    const saved = readDraft(job)
    // Lines kept from before the thickness and the rate sheet: brought up to date.
    const d = saved ? { ...saved, lines: (saved.lines || []).map(freshen) } : { orderDate: todayKey(), deliveryDate: '', fare: String(FARE), advance: '', lines: [] }
    // A draft from before the pull, with an advance typed in: that figure stays.
    if (d.advanceSet || (d.advanceSet === undefined && d.advance)) return { ...d, advanceSet: true }
    return { ...d, advanceSet: false, advance: pulled ? String(pulled) : '' }
  })
  useEffect(() => { try { localStorage.setItem(draftKey(job), JSON.stringify(draft)) } catch { /* kept in memory only */ } }, [draft, job])
  useEffect(() => { if (!draft.advanceSet) setDraft((d) => ({ ...d, advance: pulled ? String(pulled) : '' })) }, [pulled, draft.advanceSet])
  const fromVisit = !draft.advanceSet && pulled > 0
  const [editing, setEditing] = useState(null) // a line, open in PieceSheet
  const [fitting, setFitting] = useState(false) // the door fittings list, open
  // The shop's catalog, for the door fittings and their rates.
  const catalog = useQuery(api.catalog.get, {})
  const [money, setMoney] = useState(null) // 'fare' | 'advance', open on the number pad
  const [sending, setSending] = useState(false)
  // The look it prints in: the pad, the only one offered (Format 1 is kept in PadSheet.jsx, hidden).
  const [format] = useState(padFormat)

  const pad = useMemo(() => padOf(draft), [draft])
  // A pad too long for one page runs on; the preview shows a page at a time.
  const pageCount = format === 'pad' ? padPageCount(pad, format) : 1
  const [viewPage, setViewPage] = useState(0)
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

  // The order to the workshop: into the outbox at once (it goes up behind), the draft cleared.
  const send = () => {
    const out = { ...pad, lines: pad.lines.filter((l) => l.qty > 0) }
    for (const l of out.lines) learnRate(l)
    for (const l of draft.lines) if (l.form === 'flush-door') learnHome({ sunRate: l.sunRate, linerRate: l.linerRate, fitRate: l.fitRate })
    post({ jobId: job.id, step: 'quotation', pad: out })
    try { localStorage.removeItem(draftKey(job)) } catch { /* nothing kept */ }
    return out
  }

  const tiles = [
    { group: 'Pieces to make', ids: FORM_IDS, label: (id) => FORMS[id].label },
    { group: 'Home jobs', ids: HOME_IDS, label: (id) => FORMS[id].label },
    { group: 'Loose items', ids: [...Object.keys(EXTRAS), FITTINGS], label: (id) => (id === FITTINGS ? 'Door fittings' : EXTRAS[id].label) },
  ]

  return (
    <div className={`app page neworder making makeorder fmt-${format}`} role="dialog" aria-modal="true" aria-label="Work order">
      <header className="pagehead">
        <button type="button" className="back" onClick={onClose} aria-label="Back to the job"><BackIcon /></button>
        <div className="who">
          <b>Work order</b>
          <small>{[[who.name, who.address].filter(Boolean).join(', '), `Work order ${job.number}`].filter(Boolean).join(' · ')}</small>
        </div>
        {/* Cancel and Send up here, in sight beside the title. */}
        <div className="nwkeys">
          <button type="button" className="key ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="key safe" disabled={!ready} onClick={() => setSending(true)}><SendIcon size={18} strokeWidth="2.6" /> Proceed</button>
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
              <span>Advance{fromVisit && <small> from visit order</small>}</span><b>{pad.advance ? `− ${inr(pad.advance)}` : 'None'}</b>
            </button>
          </div>
          <div className="padsums">
            <p><span>Total</span><b>{inr(total)}</b></p>
            {pad.advance > 0 && <p><span>Balance</span><b>{inr(total - pad.advance)}</b></p>}
          </div>
          <p className="padhint">{fromVisit
            ? 'The advance is taken from the visit order. Tap Advance to change it if more was paid.'
            : 'The advance is written on the pad only. Put it in the cash book as usual.'}</p>
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
                      <button key={id} type="button" className={`tile ${n ? 'on' : ''}`} onClick={() => (id === FITTINGS ? setFitting(true) : setEditing({ ...lineFor(id), fresh: true }))}>
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
            {draft.lines.map(freshen).map((l) => {
              const sheet = l.extra ? null : sheetPrice(l)
              const q = Number(l.qty) || 0
              // A door at the sheet's rate: its parts as rows of their own under it, as on the pad (Tony, 22 Nov 2026).
              const parts = !l.rateHand && sheet?.parts ? sheet.parts : null
              return [
              <div key={l.id} className="chosenline padline2">
                <button type="button" className="what" onClick={() => setEditing(l)}>
                  {l.label}
                  <small className={!l.extra && !sized(l) ? 'wait' : ''}>
                    {l.extra ? '' : `${sizeLine(l)} · `}{sheet ? `${sheet.sqft.toFixed(2)}' · ` : ''}
                    {parts
                      ? inr(parts[0].amount * q)
                      : <>{inr(Number(l.rate) || 0)} each · {inr(amountOf({ qty: q, rate: Number(l.rate) || 0 }))}</>}
                  </small>
                </button>
                <button type="button" className="step" onClick={() => bump(l.id, -1)} aria-label={`One less ${l.label}`}>−</button>
                <button type="button" className="count" onClick={() => setEditing(l)} aria-label={`Change ${l.label}`}>{l.qty}<small>{l.extra ? l.unit : 'Pc'}</small></button>
                <button type="button" className="step" onClick={() => bump(l.id, 1)} aria-label={`One more ${l.label}`}>+</button>
                <button type="button" className="drop" onClick={() => drop(l.id)} aria-label={`Remove ${l.label}`}><CloseIcon size={18} /></button>
              </div>,
              ...(parts || []).slice(1).map((p) => (
                <div key={`${l.id}-${p.key}`} className="chosenpart">
                  <span>{p.name}</span>
                  <span>{Math.round(q * (p.per || 1) * 100) / 100} {p.unit || 'Pc'}{p.feet > 0 ? ` ${Number(p.feet).toFixed(2)}'` : ''}</span>
                  <b>{inr(p.amount * q)}</b>
                </div>
              )),
              ]
            })}
          </div>
        </section>

        <section className="nwslip" aria-label="The pad">
          {/* Print right under the sheet, as wide as it. */}
          <PadSheet key={format} copy={copyOf('customer')} number={job.number} who={who} pad={pad} format={format} fitHeight page={Math.min(viewPage, pageCount - 1)}
            below={(
              <>
                {pageCount > 1 && (
                  <div className="pagepick" role="group" aria-label="Page">
                    {Array.from({ length: pageCount }, (_, i) => (
                      <button key={i} type="button" className={Math.min(viewPage, pageCount - 1) === i ? 'on' : ''} aria-pressed={Math.min(viewPage, pageCount - 1) === i} onClick={() => setViewPage(i)}>Page {i + 1}</button>
                    ))}
                  </div>
                )}
                <QueuePrint label={`Print ${3 * pageCount} pages`} className="pick" mode="color" name={`Work order ${job.number}`} disabled={!ready} makeBlobs={() => padPictures(job.number, who, pad)} />
              </>
            )} />
        </section>
      </main>

      {editing && <PieceSheet start={editing} onClose={() => setEditing(null)} onSave={save} />}
      {fitting && (
        <FittingsSheet catalog={catalog} onClose={() => setFitting(false)}
          onPick={(i) => { setFitting(false); setEditing({ id: newId(), form: FITTINGS, extra: true, label: i.name, unit: i.unit || 'Pc', qty: '1', rate: i.rate ? String(i.rate) : '', fresh: true }) }} />
      )}
      {money && (
        <NumberPad
          title={money === 'fare' ? 'Fare ₹' : 'Advance ₹'}
          start={draft[money]}
          quick={money === 'fare' ? [0, 100, 200, 300] : [500, 1000, 2000, 5000]}
          onClose={() => setMoney(null)}
          onDone={(v) => { set(money === 'advance' ? { advance: v, advanceSet: true } : { [money]: v }); setMoney(null) }}
        />
      )}
      {sending && (
        <ProceedSheet job={job} who={who} pad={pad} draft={draft} pieces={pieces} unsized={unsized} total={total}
          onSend={send} onBack={() => setSending(false)} onDone={onClose} />
      )}
    </div>
  )
}

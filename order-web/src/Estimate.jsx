// ── Stage 1 · the counter estimate ──────────────────────────────────────────
// Written with the customer standing there, so it has to be faster than the
// letterhead pad or nobody will use it. Nothing is measured at this point: a
// ventilator is quoted at the size the shop always quotes one at, and the only
// thing typed is how many.
//
// What matters for later is that the app writes down WHICH size it assumed.
// That is the whole basis of the variance warning three screens on, and it is
// invisible here on purpose.
//
// A combination the shop has never priced asks for the rate once and then
// remembers it. Inventing a number would be worse than asking.

import { useRef, useState } from 'react'
import { Field, Chips, SizePad } from './ui.jsx'
import { useHotkeys, onEnterNext } from './keys.js'
import { SketchGrid } from './sketch.jsx'
import EstimateSheet from './EstimateSheet.jsx'
import {
  FORMS, FORM_IDS, FILLS, FILLS_FOR, EXTRAS, NET_FITTING_PER_SQFT,
  rateFor, learnRateAtSize, productLabel, nominalFor, priceFor, priceBreakdown,
  readMaterial, inr, lineTotal,
} from './rates.js'
import { fmtSize, sqftOf, blankDim } from './dims.js'
import { uid } from './store.js'

const KINDS = [
  { id: 'product', label: 'Make new' },
  { id: 'netfit', label: 'Net into existing' },
  { id: 'extra', label: 'Material / charge' },
]

export default function Estimate({ job, onChange, onPrint, onSendToMeasure }) {
  const mat = readMaterial()
  const [kind, setKind] = useState('product')
  const [form, setForm] = useState('ventilator')
  const [fill, setFill] = useState('net')
  const [qty, setQty] = useState('')
  const [askRate, setAskRate] = useState('')
  const [extra, setExtra] = useState('liping')
  const [size, setSize] = useState(() => nominalFor('ventilator') || { w: blankDim(), h: blankDim() })
  const [padOpen, setPadOpen] = useState(false)
  const [editLine, setEditLine] = useState(null)   // a line whose size is being changed
  const [sheetOpen, setSheetOpen] = useState(false)
  // The shop writes estimates on pre-printed letterhead, so the header is left
  // for the paper unless somebody is printing on plain stock.
  const [letterhead, setLetterhead] = useState(() => {
    try { return localStorage.getItem('shiv-orders:plain') !== '1' } catch { return true }
  })
  const qtyBox = useRef(null)

  const lines = job.estimate?.lines || []
  const total = lineTotal(lines)

  const setLines = (next) => onChange({
    ...job,
    estimate: { ...(job.estimate || {}), lines: next, total: lineTotal(next) },
  })
  const setCustomer = (patch) => onChange({ ...job, customer: { ...(job.customer || {}), ...patch } })

  const allowed = FILLS_FOR[form] || Object.keys(FILLS)
  const known = rateFor(form, fill)
  const sized = sqftOf(size.w, size.h) > 0

  // The price follows the size that is actually being quoted. At the usual
  // size it comes back to the figure on the rate card exactly; bigger, and it
  // costs more without anybody working it out again.
  const calc = known != null && sized
    ? priceBreakdown(form, fill, size.w, size.h, mat)
    : null
  const rate = calc ? calc.total : (Number(askRate) || 0)

  const pickForm = (id) => {
    setForm(id)
    const next = FILLS_FOR[id] || Object.keys(FILLS)
    if (!next.includes(fill)) setFill(next[0])
    // Each form carries its own usual size, so switching offers that one.
    const nom = nominalFor(id)
    setSize(nom || { w: blankDim(), h: blankDim() })
    setAskRate('')
  }

  const add = () => {
    const n = Math.max(1, Math.round(Number(qty) || 0))
    if (kind === 'product') {
      if (!(rate > 0) || !sized) return
      // A rate typed at this size is stored against the usual size, or the
      // next quote at a different size would compound the difference.
      if (known == null) learnRateAtSize(form, fill, rate, size.w, size.h, mat)
      setLines([...lines, {
        id: uid('l'), kind: 'product', form, fill,
        label: productLabel(form, fill),
        qty: n, rate, amount: rate * n,
        // The size this was quoted at, written down. Nothing reads it until
        // the delta, where it is what the measurement gets compared against.
        nominal: size,
        leaves: FORMS[form].leaves,
      }])
      setAskRate('')
    } else if (kind === 'netfit') {
      const area = sqftOf(size.w, size.h)
      if (!(area > 0)) return
      setLines([...lines, {
        id: uid('l'), kind: 'netfit',
        label: `${fmtSize(size.w, size.h)} जाली लगाना SS`,
        qty: n, rate: NET_FITTING_PER_SQFT, size, sqft: area,
        amount: Math.round(area * NET_FITTING_PER_SQFT * n),
      }])
      setSize({ w: blankDim(), h: blankDim() })
    } else {
      const e = EXTRAS.find((x) => x.id === extra)
      setLines([...lines, {
        id: uid('l'), kind: 'extra', extra: e.id,
        label: e.label, qty: n, unit: e.unit, rate: e.rate,
        amount: Math.round(e.rate * n),
      }])
    }
    setQty('')
    qtyBox.current?.focus()
  }

  const remove = (id) => setLines(lines.filter((l) => l.id !== id))

  /** A line's own size, and the price that follows from it. */
  const sizeOf = (l) => (l.kind === 'product' ? l.nominal : l.size)
  const resize = (id, w, h) => setLines(lines.map((l) => {
    if (l.id !== id) return l
    if (l.kind === 'product') {
      const r = priceFor(l.form, l.fill, w, h, mat) ?? l.rate
      return { ...l, nominal: { w, h }, rate: r, amount: r * l.qty }
    }
    if (l.kind === 'netfit') {
      const area = sqftOf(w, h)
      return {
        ...l, size: { w, h }, sqft: area,
        label: `${fmtSize(w, h)} जाली लगाना SS`,
        amount: Math.round(area * NET_FITTING_PER_SQFT * l.qty),
      }
    }
    return l
  }))

  const ready = lines.length > 0 && (job.customer?.name || '').trim()

  const canAdd = qty && (
    kind === 'extra'
    || (kind === 'netfit' && sqftOf(size.w, size.h) > 0)
    || (kind === 'product' && rate > 0 && sized)
  )

  // Enter is the only key this screen needs: it adds the line that is ready.
  // Held off while the size pad is up, because the pad is listening then.
  useHotkeys({
    Enter: { run: () => { if (!canAdd) return false; add(); return true }, inInputs: true },
  }, !padOpen && !editLine)

  // What the estimate would look like drawn — one box per piece, the way the
  // pad draws it. Seven ventilators are seven boxes, because that is what the
  // workshop is being handed and what anybody counts off the sheet.
  const preview = lines
    .filter((l) => l.kind === 'product' && sqftOf(l.nominal?.w, l.nominal?.h) > 0)
    .flatMap((l) => Array.from({ length: l.qty }, (_, i) => ({
      id: `${l.id}-${i}`,
      form: l.form, fill: l.fill, leaves: l.leaves,
      w: l.nominal.w, h: l.nominal.h,
    })))

  return (
    <>
      <div className="block">
        <div className="blocktitle">Customer</div>
        <Field
          label="Name" value={job.customer?.name} onChange={(v) => setCustomer({ name: v })}
          placeholder="M/s …" autoFocus={!job.customer?.name}
        />
        <Field label="Mobile" value={job.customer?.mobile} onChange={(v) => setCustomer({ mobile: v })} inputMode="tel" />
        <Field label="Address" value={job.customer?.address} onChange={(v) => setCustomer({ address: v })} />
      </div>

      <div className="block">
        <div className="blocktitle">Add a line</div>
        <Chips options={KINDS} value={kind} onChange={setKind} />

        {kind === 'product' && (
          <>
            <div className="pickrow">
              <span className="picklbl">Make</span>
              <div className="chips wrap sm">
                {FORM_IDS.map((id) => (
                  <button key={id} className={`chip ${form === id ? 'on' : ''}`} onClick={() => pickForm(id)}>
                    {FORMS[id].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pickrow">
              <span className="picklbl">Inside</span>
              <div className="chips wrap sm">
                {allowed.map((id) => (
                  <button key={id} className={`chip ${fill === id ? 'on' : ''}`} onClick={() => { setFill(id); setAskRate('') }}>
                    {FILLS[id].label}
                  </button>
                ))}
              </div>
            </div>

            <button className="sizebtn" onClick={() => setPadOpen(true)}>
              <span className="sbwhat">Size being quoted</span>
              <span className="sbsize">
                {sized ? `${fmtSize(size.w, size.h)} · ${sqftOf(size.w, size.h).toFixed(2)} sqft` : 'Tap to enter'}
              </span>
            </button>

            {calc ? (
              <div className="calcbox">
                <div className="calcrow">
                  <span>Section {calc.sectionFt} rft · {calc.kg} kg</span><b>{inr(calc.sectionRs)}</b>
                </div>
                <div className="calcrow">
                  <span>{FILLS[fill].label} {calc.fillSqft} sqft</span><b>{inr(calc.fillRs)}</b>
                </div>
                <div className="calcrow">
                  <span>Making and margin</span><b>{inr(calc.margin)}</b>
                </div>
                <div className="calcrow out">
                  <span>Each</span><b>{inr(calc.total)}</b>
                </div>
                <div className="calcnote">
                  Anchored on {inr(known)} at {fmtSize(nominalFor(form).w, nominalFor(form).h)} —
                  the figure the shop already uses. Change the size and only the
                  material moves.
                </div>
              </div>
            ) : (
              <div className="asklrate">
                <div className="asklbl">
                  The shop has not priced {productLabel(form, fill).toLowerCase()} yet.
                  Enter what it comes to per piece at this size — it will be remembered.
                </div>
                <input
                  className="qty" inputMode="numeric" value={askRate} placeholder="₹ per piece"
                  onChange={(e) => setAskRate(e.target.value.replace(/[^0-9]/g, ''))}
                  onKeyDown={onEnterNext}
                />
              </div>
            )}
          </>
        )}

        {kind === 'netfit' && (
          <button className="sizebtn" onClick={() => setPadOpen(true)}>
            {sqftOf(size.w, size.h) > 0
              ? `${fmtSize(size.w, size.h)} · ${sqftOf(size.w, size.h).toFixed(2)} sqft × ₹${NET_FITTING_PER_SQFT}`
              : 'Tap to enter the opening size'}
          </button>
        )}

        {kind === 'extra' && (
          <div className="chips wrap">
            {EXTRAS.map((e) => (
              <button key={e.id} className={`chip ${extra === e.id ? 'on' : ''}`} onClick={() => setExtra(e.id)}>
                {e.label}
              </button>
            ))}
          </div>
        )}

        <div className="qtyrow">
          <input
            ref={qtyBox}
            className="qty" inputMode="numeric" value={qty} placeholder="How many"
            onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))}
          />
          <button className="primbtn" onClick={add} disabled={!canAdd}>Add <kbd>⏎</kbd></button>
        </div>
      </div>

      {lines.length > 0 && (
        <div className="block">
          <div className="blocktitle">Estimate</div>
          <div className="linelist">
            {lines.map((l) => {
              const sz = sizeOf(l)
              return (
                <div className="line" key={l.id}>
                  <div className="lmain">
                    <div className="llabel">{l.label}</div>
                    <div className="lsub">
                      {l.qty} {l.unit || 'pc'} × {inr(l.rate)}{l.kind === 'netfit' ? ' /sqft' : ''}
                      {sz && sqftOf(sz.w, sz.h) > 0 && (
                        <button className="lsize" onClick={() => setEditLine(l.id)}>
                          {fmtSize(sz.w, sz.h)}
                        </button>
                      )}
                    </div>
                  </div>
                  <b className="lamt">{inr(l.amount)}</b>
                  <button className="lx" onClick={() => remove(l.id)} aria-label="Remove">×</button>
                </div>
              )
            })}
          </div>
          <div className="totalrow"><span>Total</span><b>{inr(total)}</b></div>
        </div>
      )}

      {preview.length > 0 && !sheetOpen && (
        <div className="block">
          <div className="blocktitle">What is being quoted</div>
          <div className="assumed soft">The sizes quoted — nobody has measured yet</div>
          <SketchGrid openings={preview} />
        </div>
      )}

      {sheetOpen && (
        <div className="block sheetblock">
          <div className="blocktitle">
            Print preview
            <button
              className={`lhtoggle ${letterhead ? 'on' : ''}`}
              onClick={() => {
                const next = !letterhead
                setLetterhead(next)
                try { localStorage.setItem('shiv-orders:plain', next ? '0' : '1') } catch { /* ignore */ }
              }}
            >
              {letterhead ? 'On letterhead paper' : 'Plain paper'}
            </button>
          </div>
          <EstimateSheet job={job} preview={preview} letterhead={letterhead} />
        </div>
      )}

      <div className="actions">
        {sheetOpen ? (
          <>
            <button className="ghostbtn wide" onClick={() => setSheetOpen(false)}>Back</button>
            <button className="primbtn wide" onClick={onPrint}>Print</button>
          </>
        ) : (
          <>
            <button className="ghostbtn wide" onClick={() => setSheetOpen(true)} disabled={!ready}>
              Print estimate
            </button>
            <button className="primbtn wide" onClick={onSendToMeasure} disabled={!ready}>
              Send for measurement
            </button>
          </>
        )}
      </div>

      {padOpen && (
        <SizePad
          w={size.w} h={size.h}
          onCancel={() => setPadOpen(false)}
          onDone={(w, h) => { setSize({ w, h }); setPadOpen(false) }}
        />
      )}

      {editLine && (() => {
        const l = lines.find((x) => x.id === editLine)
        const sz = l && sizeOf(l)
        if (!sz) return null
        return (
          <SizePad
            w={sz.w} h={sz.h}
            onCancel={() => setEditLine(null)}
            onDone={(w, h) => { resize(editLine, w, h); setEditLine(null) }}
          />
        )
      })()}
    </>
  )
}

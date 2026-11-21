import { useEffect, useRef, useState } from 'react'
import { useQuery } from 'convex/react'
import { api, contactsOf } from './flow.js'
import { useKept } from './offline.js'
import { post } from './outbox.js'
import { BackIcon, CameraIcon, CloseIcon, FlagIcon, PersonIcon, PhoneIcon, PhotosIcon, Picked, PlusIcon, SendIcon, Sheet, SheetIcon, TickIcon, usePicked } from './ui.jsx'
import { VISIT_ITEMS, lineText, recentDesigns, rememberDesign, shown, startPicks, stepOf } from './pad/visitItems.js'
import { SlipSheet } from './pad/VisitSlip.jsx'
import { PrintSlipButton } from './pad/PrintSlipButton.jsx'
import Camera from './Camera.jsx'
import { DatePick } from './DatePick.jsx'

/**
 * A name as it is typed, the shop's rule (mirrored from convex/lib/text.ts
 * `properTyping`): the first letter of each word raised, nothing else
 * changed, so the length stays and the caret stays put. The books apply the
 * whole rule when the order is saved.
 */
const properTyping = (input) => input
  .replace(/(^|[^A-Za-z0-9'’])([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase())
  .replace(/(['’])([a-z])([a-z]{2,})/g, (_, quote, first, rest) => quote + first.toUpperCase() + rest)

/**
 * Who an order is for: `{ ledgerId, name, place, phone }` once an account is
 * picked from the panel's customers, `{ name }` for a name typed for someone
 * who has no account yet, or null. Either way `phones` holds any more numbers
 * to ring, added here one at a time.
 */
export function CustomerPicker({ value, onChange, disabled, onDone, autoFocus = false }) {
  const customers = useKept('workshop:customers', useQuery(api.workshop.customers, {}))
  // A name typed for someone not in the accounts, and where they are: kept as
  // the books keep a customer, "Harsh, Bangali Tola".
  const typed = value && !value.ledgerId ? String(value.name ?? '') : ''
  const [q, setQ] = useState(typed.split(',')[0])
  const [place, setPlace] = useState(typed.split(',').slice(1).join(',').trim())
  const joined = (n, p) => (p.trim() ? `${n.trim()}, ${p.trim()}` : n)
  const phones = value?.phones ?? []
  // Enter goes down the form at the counter's keyboard: name, place, then phone, then `onDone`.
  const phoneBox = useRef(null)
  const placeBox = useRef(null)
  const toPhone = () => setTimeout(() => phoneBox.current?.focus(), 0)
  const pick = (c) => { onChange({ ledgerId: c.id, name: c.name, place: c.place, phone: c.phone, phones: phones.filter((n) => !contactsOf(c.phone).includes(n)) }); toPhone() }

  let who
  if (value?.ledgerId) {
    who = (
      <div className="chosen">
        <PersonIcon size={20} />
        <span>
          <b>{value.name}</b>
          <small>{[value.place, value.phone].filter(Boolean).join(' · ') || 'From the accounts'}</small>
        </span>
        <button type="button" onClick={() => { setQ(''); setPlace(''); onChange(phones.length ? { name: '', phones } : null) }} disabled={disabled} aria-label="Pick another customer"><CloseIcon size={16} /></button>
      </div>
    )
  } else {
    const needle = q.trim().toLowerCase()
    const found = needle ? (customers ?? []).filter((c) => `${c.name} ${c.place} ${c.phone}`.toLowerCase().includes(needle)).slice(0, 8) : []
    who = (
      <div className="picker">
        <input className="field" placeholder="Customer name" aria-label="Customer: search the accounts, or type a name" value={q} maxLength={80} disabled={disabled} autoFocus={autoFocus}
          onChange={(e) => {
            // Proper as it is typed: "harsh" shows as "Harsh", the caret where it was.
            const el = e.target
            const name = properTyping(el.value)
            if (name !== el.value) { const at = el.selectionStart; el.value = name; el.setSelectionRange(at, at) }
            setQ(name)
            onChange(name.trim() || phones.length ? { name: joined(name, place), phones } : null)
          }}
          // Enter takes the top account found, or keeps the name as typed and goes on to the place.
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
            e.preventDefault()
            if (found.length) pick(found[0])
            else if (placeBox.current) setTimeout(() => placeBox.current?.focus(), 0)
            else toPhone()
          }} />
        {found.length > 0 && (
          <ul className="found">
            {found.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => pick(c)}>
                  <b>{c.name}</b>
                  <small>{[c.place, c.phone].filter(Boolean).join(' · ')}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {needle && customers && !found.length && <p className="pickhint">Not in the accounts. Add where they are:</p>}
        {/* Where a customer not in the accounts is: saved after the name, "Harsh, Bangali Tola". */}
        {((needle && !found.length) || place) && (
          <input ref={placeBox} className="field placebox" placeholder="Place" aria-label="Place" value={place} maxLength={60} disabled={disabled}
            onChange={(e) => {
              const p = properTyping(e.target.value)
              setPlace(p)
              onChange(q.trim() || p.trim() || phones.length ? { name: joined(q, p), phones } : null)
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); toPhone() } }} />
        )}
      </div>
    )
  }
  return (
    <>
      {who}
      <Numbers phones={phones} taken={contactsOf(value?.phone)} disabled={disabled} box={phoneBox} onDone={onDone}
        onChange={(next) => onChange(value ? { ...value, phones: next } : next.length ? { name: '', phones: next } : null)} />
    </>
  )
}

/**
 * The numbers to ring besides the account's own, as many as the customer
 * gives: each on its line with a cross, and a field for one more. A number
 * typed and not yet added is added when the field is left, so Save keeps it.
 */
function Numbers({ phones, taken, onChange, disabled, box, onDone }) {
  const [draft, setDraft] = useState('')
  const typed = contactsOf(draft).filter((n) => !phones.includes(n) && !taken.includes(n))
  const addTyped = () => {
    if (!typed.length) return
    onChange([...phones, ...typed].slice(0, 8))
    setDraft('')
  }
  return (
    <div className="numbers">
      {phones.map((n) => (
        <div key={n} className="number">
          <PhoneIcon size={18} />
          <span>{n}</span>
          <button type="button" onClick={() => onChange(phones.filter((x) => x !== n))} disabled={disabled} aria-label={`Remove ${n}`}><CloseIcon size={16} /></button>
        </div>
      ))}
      {phones.length < 8 && (
        <div className="addnumber">
          <input ref={box} className="field" type="tel" inputMode="tel" maxLength={16} disabled={disabled}
            placeholder={phones.length || taken.length ? 'Another number' : 'Phone number'} aria-label="A number to ring"
            value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^\d+\s-]/g, ''))}
            onBlur={addTyped}
            // Enter adds the number typed; on an empty box it goes on to what comes next.
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              if (typed.length) addTyped()
              else if (!draft.trim()) onDone?.()
            }} />
          <button type="button" className="key ghost" onClick={addTyped} disabled={disabled || !typed.length} aria-label="Add this number"><PlusIcon size={22} /></button>
        </div>
      )}
    </div>
  )
}

/** A picked or typed customer, as the server takes it. */
export const customerArgs = (c) => ({
  ...(c?.ledgerId ? { ledgerId: c.ledgerId } : c?.name?.trim() ? { title: c.name.trim() } : {}),
  ...(c ? { phones: c.phones ?? [] } : {}),
})

/** What a job can ask for, a tick each; either or both, chosen once, here. */
const NEEDS = [['assemble', 'Assemble'], ['order', 'Order in']]

/** How the visit order is given: a photo of the paper one, or made here. The counter's last choice is kept. */
const MODE_KEY = 'workshop:visit-mode'
const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'make' ? 'make' : 'photo' } catch { return 'photo' } }
const todayKey = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }

/**
 * A number by touch, as a till takes it: the keys, a back key, and for
 * money a row of the usual amounts. `decimal` allows a point (12.5 ft).
 */
export function NumberPad({ title, start, quick, decimal, onClose, onDone }) {
  const [v, setV] = useState(String(start ?? '') === '0' ? '' : String(start ?? ''))
  const press = (k) => setV((x) => {
    if (k === 'back') return x.slice(0, -1)
    if (k === '.') return decimal && !x.includes('.') ? `${x || '0'}.` : x
    return (x + k).replace(/^0+(?=\d)/, '').slice(0, 7)
  })
  return (
    <Sheet label={title} onClose={onClose}>
      <b className="sheettitle">{title}</b>
      <div className="padshow">{v || '0'}</div>
      {quick && (
        <div className="padquick">
          {quick.map((q) => <button key={q} type="button" onClick={() => setV(String(q))}>{q.toLocaleString('en-IN')}</button>)}
        </div>
      )}
      <div className="numpad">
        {['7', '8', '9', '4', '5', '6', '1', '2', '3', decimal ? '.' : 'C', '0', 'back'].map((k) => (
          <button key={k} type="button" onClick={() => (k === 'C' ? setV('') : press(k))} aria-label={k === 'back' ? 'Delete' : k === 'C' ? 'Clear' : k}>
            {k === 'back' ? <BackIcon size={26} /> : k}
          </button>
        ))}
      </div>
      <div className="sheetbtns">
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="solid safe" onClick={() => onDone(v.replace(/\.$/, ''))}>Done</button>
      </div>
    </Sheet>
  )
}

/**
 * A design number by touch, "9161 WA": the digits, then the letters that end
 * it, a space between them by itself. Big keys, a back key; no keyboard.
 */
const DESIGN_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
function DesignKeys({ value, onChange }) {
  const v = value ?? ''
  const press = (k) => {
    if (k === 'back') return onChange(v.slice(0, -1).trimEnd())
    if (/\d/.test(k)) return onChange(/[A-Z]$/.test(v) ? v : (v + k).slice(0, 12))
    // The first letter after the figures starts the code: "9161" then W gives "9161 W".
    return onChange((/\d$/.test(v) ? `${v} ${k}` : v + k).slice(0, 12))
  }
  return (
    <div className="designkeys">
      <div className="designshow">{v || 'Tap the number'}</div>
      <div className="numpad">
        {['7', '8', '9', '4', '5', '6', '1', '2', '3', 'clear', '0', 'back'].map((k) => (
          <button key={k} type="button" onClick={() => (k === 'clear' ? onChange('') : press(k))} aria-label={k === 'back' ? 'Delete' : k === 'clear' ? 'Clear' : k}>
            {k === 'back' ? <BackIcon size={24} /> : k === 'clear' ? 'C' : k}
          </button>
        ))}
      </div>
      <div className="letterkeys">
        {DESIGN_LETTERS.map((k) => <button key={k} type="button" onClick={() => press(k)}>{k}</button>)}
      </div>
    </div>
  )
}

/**
 * A new job, in the order the counter has it: who it is for, whether the
 * workshop assembles it or the shop orders it in (or both), then the visit
 * order: the photo or photos of the paper slip, or the slip made here (the
 * items, how many, the advance), printed on plain A4 with the letterhead
 * (pad/VisitSlip.jsx) and sent with no photo. It starts at measurement.
 */
export default function NewOrder({ onClose }) {
  const { picked, add, drop, take } = usePicked()
  const [customer, setCustomer] = useState(null)
  const [priority, setPriority] = useState(false)
  const [needs, setNeeds] = useState({ assemble: true, order: false })
  // The live camera, open over the sheet while photographing.
  const [cam, setCam] = useState(false)
  const camera = useRef(null)
  const gallery = useRef(null)
  const took = (e) => { add(e.target.files); e.target.value = '' }

  const [mode, setModeNow] = useState(readMode)
  const setMode = (m) => { setModeNow(m); try { localStorage.setItem(MODE_KEY, m) } catch { /* kept for this visit only */ } }
  const [slip, setSlip] = useState(() => ({ id: `slip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, date: todayKey(), lines: [], advance: '' }))
  const slipOut = {
    id: slip.id,
    date: slip.date || todayKey(),
    advance: Math.max(0, Math.round(Number(slip.advance) || 0)),
    lines: slip.lines.filter((l) => l.text.trim()).map((l) => ({ id: l.id, text: l.text.trim(), qty: Number(l.qty) || 1, unit: l.unit })),
  }
  // A slip may have no items at all: a visit to measure, with the advance taken (Amarjeet Kumar Jee, 13 Nov).
  const ready = mode === 'make' ? slipOut.lines.length > 0 || !!customer?.name?.trim() : picked.length > 0
  const who = {
    name: customer?.name?.trim() ?? '',
    address: customer?.ledgerId ? (customer.place ?? '') : '',
    // Every number to ring, not only the first: "8709964141, 8709964142".
    mobile: contactsOf([customer?.phone, ...(customer?.phones ?? [])].filter(Boolean).join(' ')).join(', '),
  }
  // "Rajesh Kumar Ji, Patratu Basti": the place, after the comma, on its own line.
  if (!customer?.ledgerId && who.name.includes(',')) {
    const [n, ...rest] = who.name.split(',')
    who.name = n.trim()
    who.address = rest.join(',').trim()
  }

  // Sent at once: the order shows at the head of the list while it goes up behind.
  const send = () => {
    if (!ready) return
    const base = { customer: customerArgs(customer), title: customer?.name?.trim() ?? '', priority, needs }
    if (mode === 'make') post({ ...base, slip: slipOut })
    else {
      const photos = take()
      post({ ...base, files: photos.map((p) => p.file), previews: photos.map((p) => p.url) })
    }
    onClose()
  }

  /* ── Enter down the form ──────────────────────────────────────────────── */
  // Name, phone, then the visit order: the photos to choose, or the first item
  // to type; each item's words, then how many, then the next item; an empty
  // item goes on to the advance; the advance to Send.
  const sendKey = useRef(null)
  const form = useRef(null)
  // Made on the app, the items are tapped, not typed: the end of the name and phone goes to Send.
  const next = () => {
    if (mode === 'make') return sendKey.current?.focus()
    return picked.length ? send() : gallery.current?.click()
  }

  /* ── items by touch, as a till takes them ─────────────────────────────── */
  // A tile adds one of it, or one more if it is already on the slip; each
  // line then has − and +, and its figure opens the number pad. Nothing typed
  // but an item not among the tiles (Other), on the screen's own keyboard.
  // A tile's count: every line made from it, whatever details were picked.
  const countOf = (base) => slip.lines.filter((l) => (l.base ?? l.text) === base).reduce((t, l) => t + (Number(l.qty) || 0), 0)
  /** Adds `by` of a line, written `text`, to the slip; one already there with the same words gets them. */
  const addLine = (base, text, unit, by) => setSlip((s) => {
    const at = s.lines.findIndex((l) => l.text === text)
    if (at === -1) return { ...s, lines: [...s.lines, { id: Math.random().toString(36).slice(2, 9), base, text, qty: String(by), unit }] }
    return { ...s, lines: s.lines.map((l, j) => (j === at ? { ...l, qty: String((Number(l.qty) || 0) + by) } : l)) }
  })
  // A tile with details (thickness, glass, model) opens them as buttons; one without adds itself.
  const [choosing, setChoosing] = useState(null)
  const tap = (item) => {
    if (item.options?.length) setChoosing({ item, picks: startPicks(item), qty: item.step ?? 1 })
    else addLine(item.text, item.text, item.unit, item.step ?? 1)
  }
  const bump = (i, by) => setSlip((s) => ({
    ...s,
    lines: s.lines.flatMap((l, j) => {
      if (j !== i) return [l]
      const qty = Math.round(((Number(l.qty) || 0) + by) * 100) / 100
      return qty > 0 ? [{ ...l, qty: String(qty) }] : []
    }),
  }))
  const setLine = (i, patch) => setSlip((s) => ({ ...s, lines: s.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }))
  // The number pad, open for a line's figure (`line`) or the advance.
  const [pad, setPad] = useState(null)
  const [other, setOther] = useState(null)
  // Once there is a photo, Send has the cursor, so the next Enter sends.
  const had = useRef(0)
  useEffect(() => {
    if (picked.length > had.current) sendKey.current?.focus()
    had.current = picked.length
  }, [picked.length])

  return (
    // The whole screen, as the counter's computer has it: the form on the
    // left and, while the slip is being made, the slip itself on the right.
    // On a phone the two stack.
    <div className={`app page neworder ${mode === 'make' ? 'making' : ''}`} ref={form} role="dialog" aria-modal="true" aria-label="New visit order">
      <header className="pagehead">
        <button type="button" className="back" onClick={onClose} aria-label="Back to the list"><BackIcon /></button>
        <div className="who"><b>New visit order</b></div>
        {/* Cancel and Send up here, in sight beside the title. */}
        <div className="nwkeys">
          <button type="button" className="key ghost" onClick={onClose}>Cancel</button>
          <button ref={sendKey} type="button" className="key safe" onClick={send} disabled={!ready}><SendIcon size={18} strokeWidth="2.6" /> Send to workshop</button>
        </div>
      </header>
      <main className="scroll nwgrid">
      <section className="nwform" aria-label="The order">
        <CustomerPicker value={customer} onChange={setCustomer} onDone={next} autoFocus />
        <div className="needs" role="group" aria-label="What this job needs">
          {NEEDS.map(([k, label]) => (
            <button key={k} type="button" className={needs[k] ? 'on' : ''} aria-pressed={needs[k]}
              onClick={() => { const n = { ...needs, [k]: !needs[k] }; if (n.assemble || n.order) setNeeds(n) }}>
              {needs[k] && <TickIcon size={20} strokeWidth="3" />} {label}
            </button>
          ))}
        </div>
        <span className="ask sheetask">Visit order</span>
        <div className="needs modes" role="group" aria-label="How the visit order is given">
          <button type="button" className={mode === 'photo' ? 'on' : ''} aria-pressed={mode === 'photo'} onClick={() => setMode('photo')}><CameraIcon size={20} /> Photo</button>
          <button type="button" className={mode === 'make' ? 'on' : ''} aria-pressed={mode === 'make'} onClick={() => setMode('make')}><SheetIcon size={20} /> Make on the app</button>
        </div>
        {mode === 'photo' ? (
          <>
            {/* The camera's way out where no live one can be had, and pictures already on the phone. */}
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={took} />
            <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={took} />
            {cam && <Camera title="Visit order" onUse={add} onClose={() => setCam(false)} onFallback={() => camera.current?.click()} />}
            <Picked picked={picked} onDrop={drop} />
            <div className="pickrow">
              <button type="button" className="pick" onClick={() => setCam(true)}><CameraIcon /> Take photo</button>
              <button type="button" className="pick" onClick={() => gallery.current?.click()}><PhotosIcon /> Choose</button>
            </div>
          </>
        ) : (
          <div className="slipform">
            <DatePick label="Date" value={slip.date} onChange={(k) => setSlip({ ...slip, date: k || todayKey() })} />
            <button type="button" className="advkey" onClick={() => setPad({ advance: true })}>
              <span>Advance</span><b>{slipOut.advance ? `₹${slipOut.advance.toLocaleString('en-IN')}` : 'None'}</b>
            </button>
          </div>
        )}
        <button type="button" className={`priority ${priority ? 'on' : ''}`} aria-pressed={priority} onClick={() => setPriority(!priority)}>
          <FlagIcon size={20} strokeWidth="2.6" /> Priority
        </button>
      </section>
      {mode === 'make' && (
        <section className="nwitems" aria-label="Items">
          <div className="tiles">
            {VISIT_ITEMS.map((g) => (
              <div key={g.group} className="tilegroup">
                <h3>{g.group}</h3>
                <div className="tilegrid">
                  {g.items.map((item) => {
                    const n = countOf(item.text)
                    return (
                      <button key={item.text} type="button" className={`tile ${n ? 'on' : ''}`} onClick={() => tap(item)}>
                        <span>{item.text}</span>
                        {n > 0 && <b>{n}{item.unit !== 'Pc' ? ` ${item.unit}` : ''}</b>}
                      </button>
                    )
                  })}
                  {g.group === VISIT_ITEMS[VISIT_ITEMS.length - 1].group && (
                    <button type="button" className="tile other" onClick={() => setOther({ text: '', unit: 'Pc' })}><PlusIcon size={20} /><span>Other</span></button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="chosenlist" aria-label="On the slip">
            {slip.lines.length === 0 && <p className="chosenempty">Tap the items the customer wants.</p>}
            {slip.lines.map((l, i) => (
              <div key={l.id} className="chosenline">
                <span className="what">{l.text}</span>
                <button type="button" className="step" onClick={() => bump(i, -stepOf(l.base ?? l.text))} aria-label={`One less ${l.text}`}>−</button>
                <button type="button" className="count" onClick={() => setPad({ line: i })} aria-label={`How many ${l.text}`}>{l.qty}<small>{l.unit}</small></button>
                <button type="button" className="step" onClick={() => bump(i, stepOf(l.base ?? l.text))} aria-label={`One more ${l.text}`}>+</button>
                <button type="button" className="drop" onClick={() => setSlip((s) => ({ ...s, lines: s.lines.filter((_, j) => j !== i) }))} aria-label={`Remove ${l.text}`}><CloseIcon size={18} /></button>
              </div>
            ))}
          </div>
        </section>
      )}
      {mode === 'make' && (
        <section className="nwslip" aria-label="The slip">
          <SlipSheet who={who} slip={slipOut} fitHeight />
          <PrintSlipButton className="pick" who={who} slip={slipOut} disabled={!slipOut.lines.length} />
        </section>
      )}
      </main>

      {pad && (
        <NumberPad
          title={pad.advance ? 'Advance ₹' : `${slip.lines[pad.line]?.text} (${slip.lines[pad.line]?.unit})`}
          start={pad.advance ? slip.advance : slip.lines[pad.line]?.qty}
          quick={pad.advance ? [500, 1000, 2000, 5000] : null}
          decimal={!pad.advance}
          onClose={() => setPad(null)}
          onDone={(v) => {
            if (pad.advance) setSlip((s) => ({ ...s, advance: v }))
            else if (Number(v) > 0) setLine(pad.line, { qty: v })
            else setSlip((s) => ({ ...s, lines: s.lines.filter((_, j) => j !== pad.line) }))
            setPad(null)
          }}
        />
      )}
      {/* An item's details as buttons, how many, then Add: "Aluminium Door 1.6mm With Film", 2 Pc. */}
      {choosing && (
        <Sheet label={choosing.item.text} wide onClose={() => setChoosing(null)}>
          <b className="sheettitle">{choosing.item.text}</b>
          {/* The whole width: the choices on the left; the keypad, how many and Add on the right. Nothing to scroll. */}
          <div className="optpanel">
          <div className="optleft">
          {choosing.item.options.map((o, i) => shown(o, choosing.picks) && (
            <div key={o.label} className="optrow">
              <span className="ask">{o.label}</span>
              <div className="needs" role="group" aria-label={o.label}>
                {o.none && (
                  <button type="button" className={!choosing.picks[i] && choosing.typing !== i ? 'on' : ''} aria-pressed={!choosing.picks[i] && choosing.typing !== i}
                    onClick={() => setChoosing({ ...choosing, typing: null, picks: choosing.picks.map((p, j) => (j === i ? '' : p)) })}>{o.none}</button>
                )}
                {/* A custom option (a design number): the last few used as buttons, the one being typed, and Type no. */}
                {(o.custom ? [...new Set([...recentDesigns(), ...(choosing.picks[i] ? [choosing.picks[i]] : [])])] : o.choices).map((c) => (
                  <button key={c} type="button" className={choosing.picks[i] === c ? 'on' : ''} aria-pressed={choosing.picks[i] === c}
                    onClick={() => setChoosing({ ...choosing, typing: null, picks: choosing.picks.map((p, j) => (j === i ? c : p)) })}>{c}</button>
                ))}
                {o.custom && (
                  <button type="button" className={`typeno ${choosing.typing === i ? 'on' : ''}`}
                    onClick={() => setChoosing({ ...choosing, typing: choosing.typing === i ? null : i, picks: choosing.picks.map((p, j) => (j === i ? '' : p)) })}>Type no.</button>
                )}
              </div>
            </div>
          ))}
          </div>
          <div className="optright">
          {choosing.typing != null && (
            <DesignKeys value={choosing.picks[choosing.typing]} onChange={(v) => setChoosing({ ...choosing, picks: choosing.picks.map((p, j) => (j === choosing.typing ? v : p)) })} />
          )}
          <div className="optqty">
            <button type="button" className="step" onClick={() => setChoosing({ ...choosing, qty: Math.max(stepOf(choosing.item.text), choosing.qty - stepOf(choosing.item.text)) })} aria-label="One less">−</button>
            <b>{choosing.qty} <small>{choosing.item.unit}</small></b>
            <button type="button" className="step" onClick={() => setChoosing({ ...choosing, qty: choosing.qty + stepOf(choosing.item.text) })} aria-label="One more">+</button>
          </div>
          <p className="optline">{lineText(choosing.item, choosing.picks)}</p>
          <div className="sheetbtns">
            <button type="button" className="ghost" onClick={() => setChoosing(null)}>Cancel</button>
            <button type="button" className="solid safe" onClick={() => {
              addLine(choosing.item.text, lineText(choosing.item, choosing.picks), choosing.item.unit, choosing.qty)
              choosing.item.options.forEach((o, i) => { if (o.custom) rememberDesign(choosing.picks[i]) })
              setChoosing(null)
            }}>Add</button>
          </div>
          </div>
          </div>
        </Sheet>
      )}
      {other && (
        <Sheet label="Other item" wide onClose={() => setOther(null)}>
          <b className="sheettitle">Other item</b>
          <input className="field" autoFocus maxLength={120} placeholder="What is it?" value={other.text}
            onChange={(e) => setOther({ ...other, text: properTyping(e.target.value) })}
            onKeyDown={(e) => { if (e.key === 'Enter' && other.text.trim()) { tap({ text: other.text.trim(), unit: other.unit }); setOther(null) } }} />
          <div className="needs" role="group" aria-label="Counted in">
            {['Pc', 'Set', 'Ft', 'Sqft'].map((u) => (
              <button key={u} type="button" className={other.unit === u ? 'on' : ''} aria-pressed={other.unit === u} onClick={() => setOther({ ...other, unit: u })}>{u}</button>
            ))}
          </div>
          <div className="sheetbtns">
            <button type="button" className="ghost" onClick={() => setOther(null)}>Cancel</button>
            <button type="button" className="solid safe" disabled={!other.text.trim()} onClick={() => { tap({ text: other.text.trim(), unit: other.unit }); setOther(null) }}>Add</button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

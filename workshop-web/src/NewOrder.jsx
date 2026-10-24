import { useRef, useState } from 'react'
import { useQuery } from 'convex/react'
import { api, contactsOf } from './flow.js'
import { useKept } from './offline.js'
import { post } from './outbox.js'
import { CameraIcon, CloseIcon, FlagIcon, PersonIcon, PhoneIcon, PhotosIcon, Picked, PlusIcon, Sheet, TickIcon, usePicked } from './ui.jsx'
import Camera from './Camera.jsx'

/**
 * Who an order is for: `{ ledgerId, name, place, phone }` once an account is
 * picked from the panel's customers, `{ name }` for a name typed for someone
 * who has no account yet, or null. Either way `phones` holds any more numbers
 * to ring, added here one at a time.
 */
export function CustomerPicker({ value, onChange, disabled }) {
  const customers = useKept('workshop:customers', useQuery(api.workshop.customers, {}))
  const [q, setQ] = useState(value && !value.ledgerId ? value.name : '')
  const phones = value?.phones ?? []

  let who
  if (value?.ledgerId) {
    who = (
      <div className="chosen">
        <PersonIcon size={20} />
        <span>
          <b>{value.name}</b>
          <small>{[value.place, value.phone].filter(Boolean).join(' · ') || 'From the accounts'}</small>
        </span>
        <button type="button" onClick={() => { setQ(''); onChange(phones.length ? { name: '', phones } : null) }} disabled={disabled} aria-label="Pick another customer"><CloseIcon size={16} /></button>
      </div>
    )
  } else {
    const needle = q.trim().toLowerCase()
    const found = needle ? (customers ?? []).filter((c) => `${c.name} ${c.place} ${c.phone}`.toLowerCase().includes(needle)).slice(0, 8) : []
    who = (
      <div className="picker">
        <input className="field" placeholder="Customer name" aria-label="Customer: search the accounts, or type a name" value={q} maxLength={80} disabled={disabled}
          onChange={(e) => { setQ(e.target.value); onChange(e.target.value.trim() || phones.length ? { name: e.target.value, phones } : null) }} />
        {found.length > 0 && (
          <ul className="found">
            {found.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onChange({ ledgerId: c.id, name: c.name, place: c.place, phone: c.phone, phones: phones.filter((n) => !contactsOf(c.phone).includes(n)) })}>
                  <b>{c.name}</b>
                  <small>{[c.place, c.phone].filter(Boolean).join(' · ')}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        {needle && customers && !found.length && <p className="pickhint">Not in the accounts. It is sent under this name.</p>}
      </div>
    )
  }
  return (
    <>
      {who}
      <Numbers phones={phones} taken={contactsOf(value?.phone)} disabled={disabled}
        onChange={(next) => onChange(value ? { ...value, phones: next } : next.length ? { name: '', phones: next } : null)} />
    </>
  )
}

/**
 * The numbers to ring besides the account's own, as many as the customer
 * gives: each on its line with a cross, and a field for one more. A number
 * typed and not yet added is added when the field is left, so Save keeps it.
 */
function Numbers({ phones, taken, onChange, disabled }) {
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
          <input className="field" type="tel" inputMode="tel" maxLength={16} disabled={disabled}
            placeholder={phones.length || taken.length ? 'Another number' : 'Phone number'} aria-label="A number to ring"
            value={draft} onChange={(e) => setDraft(e.target.value.replace(/[^\d+\s-]/g, ''))}
            onBlur={addTyped} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped() } }} />
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

/**
 * A new job, in the order the counter has it: who it is for, whether the
 * workshop assembles it or the shop orders it in (or both), then the photo or
 * photos of the visit order. It starts at measurement.
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

  // Sent at once: the order shows at the head of the list while it goes up behind.
  const send = () => {
    if (!picked.length) return
    const photos = take()
    post({ customer: customerArgs(customer), title: customer?.name?.trim() ?? '', priority, needs, files: photos.map((p) => p.file), previews: photos.map((p) => p.url) })
    onClose()
  }

  return (
    <Sheet label="New visit order" wide onClose={onClose}>
      <b className="sheettitle">New visit order</b>
      <CustomerPicker value={customer} onChange={setCustomer} />
      <div className="needs" role="group" aria-label="What this job needs">
        {NEEDS.map(([k, label]) => (
          <button key={k} type="button" className={needs[k] ? 'on' : ''} aria-pressed={needs[k]}
            onClick={() => { const next = { ...needs, [k]: !needs[k] }; if (next.assemble || next.order) setNeeds(next) }}>
            {needs[k] && <TickIcon size={20} strokeWidth="3" />} {label}
          </button>
        ))}
      </div>
      <span className="ask sheetask">Visit order</span>
      {/* The camera's way out where no live one can be had, and pictures already on the phone. */}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={took} />
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={took} />
      {cam && <Camera title="Visit order" onUse={add} onClose={() => setCam(false)} onFallback={() => camera.current?.click()} />}
      <Picked picked={picked} onDrop={drop} />
      <div className="pickrow">
        <button type="button" className="pick" onClick={() => setCam(true)}><CameraIcon /> Take photo</button>
        <button type="button" className="pick" onClick={() => gallery.current?.click()}><PhotosIcon /> Choose</button>
      </div>
      <button type="button" className={`priority ${priority ? 'on' : ''}`} aria-pressed={priority} onClick={() => setPriority(!priority)}>
        <FlagIcon size={20} strokeWidth="2.6" /> Priority
      </button>
      <div className="sheetbtns">
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="solid safe" onClick={send} disabled={!picked.length}>Send to workshop</button>
      </div>
    </Sheet>
  )
}

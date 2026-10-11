import { useRef, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from './flow.js'
import { post } from './outbox.js'
import { CameraIcon, CloseIcon, PersonIcon, PhotosIcon, Picked, Sheet, usePicked } from './ui.jsx'
import Camera from './Camera.jsx'

/**
 * Who an order is for: `{ ledgerId, name, place, phone }` once an account is
 * picked from the panel's customers, `{ name }` for a name typed for someone
 * who has no account yet, or null.
 */
export function CustomerPicker({ value, onChange, disabled }) {
  const customers = useQuery(api.workshop.customers, {})
  const [q, setQ] = useState(value && !value.ledgerId ? value.name : '')

  if (value?.ledgerId) {
    return (
      <div className="chosen">
        <PersonIcon size={20} />
        <span>
          <b>{value.name}</b>
          <small>{[value.place, value.phone].filter(Boolean).join(' · ') || 'From the accounts'}</small>
        </span>
        <button type="button" onClick={() => { setQ(''); onChange(null) }} disabled={disabled} aria-label="Pick another customer"><CloseIcon size={16} /></button>
      </div>
    )
  }
  const needle = q.trim().toLowerCase()
  const found = needle ? (customers ?? []).filter((c) => `${c.name} ${c.place} ${c.phone}`.toLowerCase().includes(needle)).slice(0, 8) : []
  return (
    <div className="picker">
      <input className="field" placeholder="Customer: search the accounts, or type a name" value={q} maxLength={80} disabled={disabled}
        onChange={(e) => { setQ(e.target.value); onChange(e.target.value.trim() ? { name: e.target.value } : null) }} />
      {found.length > 0 && (
        <ul className="found">
          {found.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onChange({ ledgerId: c.id, name: c.name, place: c.place, phone: c.phone })}>
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
/** A picked or typed customer, as the server takes it. */
export const customerArgs = (c) => (c?.ledgerId ? { ledgerId: c.ledgerId } : c?.name?.trim() ? { title: c.name.trim() } : {})

/** A new job: the photo or photos of the visit order, and who it is for. It starts at measurement. */
export default function NewOrder({ onClose }) {
  const { picked, add, drop, take } = usePicked()
  const [customer, setCustomer] = useState(null)
  // The live camera, open over the sheet while photographing.
  const [cam, setCam] = useState(false)
  const camera = useRef(null)
  const gallery = useRef(null)
  const took = (e) => { add(e.target.files); e.target.value = '' }

  // Sent at once: the order shows at the head of the list while it goes up behind.
  const send = () => {
    if (!picked.length) return
    const photos = take()
    post({ customer: customerArgs(customer), title: customer?.name?.trim() ?? '', files: photos.map((p) => p.file), previews: photos.map((p) => p.url) })
    onClose()
  }

  return (
    <Sheet label="New visit order" wide onClose={onClose}>
      <b className="sheettitle">New visit order</b>
      <p>Photograph the visit order. It goes to the workshop, to visit and measure.</p>
      {/* The camera's way out where no live one can be had, and pictures already on the phone. */}
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={took} />
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={took} />
      {cam && <Camera title="Visit order" onUse={add} onClose={() => setCam(false)} onFallback={() => camera.current?.click()} />}
      <Picked picked={picked} onDrop={drop} />
      <div className="pickrow">
        <button type="button" className="pick" onClick={() => setCam(true)}><CameraIcon /> Take photo</button>
        <button type="button" className="pick" onClick={() => gallery.current?.click()}><PhotosIcon /> Choose</button>
      </div>
      <CustomerPicker value={customer} onChange={setCustomer} />
      <div className="sheetbtns">
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="solid" onClick={send} disabled={!picked.length}>Send to workshop</button>
      </div>
    </Sheet>
  )
}

import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'

/**
 * Shiv Intro, kept simple (22 Nov 2026): type the customer's number, tick what
 * to send, press Send. It goes on WhatsApp from Tony's number through the
 * WhatsApp Bills service: the greeting and visiting card, the shop's QR
 * (MSwipe) or Harsh's QR (Paytm), each QR with its UPI link under it.
 * No name for now, so no Save to the Samsung's contacts from this screen; the
 * server still has Save (convex/shivIntro.ts) for when the name comes back.
 */
const api = anyApi

/** A send that took this long never finished: the service stopped halfway. */
const STUCK_MS = 5 * 60_000

const CHOICES = [
  { id: 'card', title: 'Greeting + card', small: 'Smile, folded hands, visiting card', pic: '/card.jpg' },
  { id: 'shop', title: 'Shop QR', small: 'Shiv Hardware Store, MSwipe', pic: '/qr-shop.jpg' },
  { id: 'harsh', title: 'Harsh QR', small: 'Harsh Agarwal, Paytm, 8709964141', pic: '/qr-harsh.jpg' },
]
const titleOf = (id) => CHOICES.find((c) => c.id === id)?.title ?? id

const sendSign = (row) => ({
  requested: ['Waiting to send', 'wait'],
  sending: ['Sending', 'wait'],
  sent: ['Sent', 'done'],
  skipped: ['Not on WhatsApp', 'stop'],
  failed: ['Not sent', 'stop'],
})[row.sendStatus] ?? null

const words = (err) => (typeof err?.data === 'string' ? err.data : 'Not done. Check the internet and try again.')
const last10 = (typed) => typed.replace(/\D/g, '').slice(-10)
const spaced = (p) => (p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p)

/** Rows from before the choices had only the card. */
const hasCard = (row) => Boolean(row?.cardSentAt) || (row?.sendStatus === 'sent' && !row?.sendWhat)
const onItsWay = (row) => row?.sendStatus === 'requested'
  || (row?.sendStatus === 'sending' && Date.now() - (row.sendAskedAt ?? 0) <= STUCK_MS)

export default function App() {
  const data = useQuery(api.shivIntro.recent)
  const send = useMutation(api.shivIntro.send)
  const [phone, setPhone] = useState('')
  const [picked, setPicked] = useState(['card'])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState('')

  const rows = data?.rows ?? []
  const typed = last10(phone)
  const ready = typed.length === 10
  const current = ready ? rows.find((row) => row.phone === typed) : undefined
  const waiting = onItsWay(current)

  const toggle = (id) => setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]))

  const typePhone = (value) => {
    setPhone(value)
    setProblem('')
    setDone('')
    // A number that already has the card starts with it unticked.
    const p = last10(value)
    const row = p.length === 10 ? rows.find((r) => r.phone === p) : undefined
    if (row && hasCard(row)) setPicked((now) => now.filter((x) => x !== 'card'))
  }

  async function go() {
    if (busy || !ready || !picked.length || waiting) return
    let again = false
    if (picked.includes('card') && hasCard(current)) {
      if (!window.confirm(`${spaced(typed)} was already sent the greeting and card. Send it again?`)) return
      again = true
    }
    setBusy(true)
    setProblem('')
    try {
      await send({ phone: typed, what: picked, again })
      setDone(`${picked.map(titleOf).join(', ')} on its way to ${spaced(typed)}.`)
      setPhone('')
      setPicked(['card'])
    } catch (err) {
      setProblem(words(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <header className="top">
        <img src="/icon-192.png" alt="" />
        <h1 className="brand">Shiv Intro</h1>
      </header>

      <main className="body">
        <label className="field">
          <span>Mobile number</span>
          <input
            value={phone}
            onChange={(e) => typePhone(e.target.value)}
            inputMode="tel"
            autoComplete="off"
            autoFocus
            placeholder="10 digits"
          />
        </label>

        <div className="choices" role="group" aria-label="What to send">
          {CHOICES.map((c) => {
            const on = picked.includes(c.id)
            return (
              <button
                key={c.id}
                type="button"
                className={`choice${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => toggle(c.id)}
              >
                <img src={c.pic} alt="" />
                <span className="choice-words">
                  <span className="choice-title">{c.title}</span>
                  <span className="small">{c.small}</span>
                  {c.id === 'card' && hasCard(current) && <span className="small">Already sent to this number</span>}
                </span>
                <span className="tick" aria-hidden="true">
                  {on && (
                    <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="square" /></svg>
                  )}
                </span>
              </button>
            )
          })}
        </div>

        {problem && <p className="problem">{problem}</p>}
        {done && <p className="done-note">{done}</p>}
        {waiting && <p className="note quiet">Still sending to this number. Wait a moment.</p>}

        {rows.length > 0 && <h2 className="list-head">Sent lately</h2>}
        <ul className="list">
          {rows.map((row) => {
            const sign = sendSign(row)
            const what = row.sendStatus ? (row.sendWhat ?? ['card']).map(titleOf).join(', ') : ''
            return (
              <li key={row._id}>
                <button type="button" className="row" onClick={() => typePhone(row.phone)}>
                  <span className="who">{spaced(row.phone)}</span>
                  {row.name && <span className="small">{row.name}{row.place ? `, ${row.place}` : ''}</span>}
                  <span className="row-signs">
                    {sign && <span className={`tag ${sign[1]}`}>{sign[0]}</span>}
                    {what && <span className="small">{what}</span>}
                  </span>
                  {row.sendError && <span className="small">{row.sendError}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </main>

      <footer className="dock">
        <button
          type="button"
          className="key safe"
          disabled={busy || !ready || !picked.length || waiting}
          onClick={() => void go()}
        >
          {busy ? 'Sending' : 'Send'}
        </button>
      </footer>
    </div>
  )
}

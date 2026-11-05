import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'

/**
 * Shiv Intro, for a new customer. Save puts them in the contacts on the owner's
 * Samsung; Send gives them the shop's greeting and visiting card on WhatsApp
 * from Tony's number. Two separate keys, because either can be wanted alone.
 * The functions are Shiv_Panel's convex/shivIntro.ts.
 */
const api = anyApi

/** A send that took this long never finished: the service stopped halfway. */
const STUCK_MS = 5 * 60_000

const saveSign = (row) => ({
  waiting: ['Waiting for phone', 'wait'],
  saved: ['Saved on phone', 'done'],
  already: ['Already on phone', 'done'],
  failed: ['Not saved', 'stop'],
})[row.saveStatus] ?? null

const sendSign = (row) => ({
  requested: ['Waiting to send', 'wait'],
  sending: ['Sending', 'wait'],
  sent: ['Card sent', 'done'],
  skipped: ['Not on WhatsApp', 'stop'],
  failed: ['Not sent', 'stop'],
})[row.sendStatus] ?? null

const words = (err) => (typeof err?.data === 'string' ? err.data : 'Not done. Check the internet and try again.')
const last10 = (typed) => typed.replace(/\D/g, '').slice(-10)

const ago = (at) => {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} hours ago`
  return `${Math.round(minutes / 1440)} days ago`
}

const canSave = (row) => !row || !row.saveStatus || row.saveStatus === 'failed'
const canSend = (row) => {
  if (!row?.sendStatus) return true
  if (row.sendStatus === 'sending') return Date.now() - (row.sendAskedAt ?? 0) > STUCK_MS
  return row.sendStatus !== 'requested' && row.sendStatus !== 'sent'
}

export default function App() {
  const data = useQuery(api.shivIntro.recent)
  const save = useMutation(api.shivIntro.save)
  const send = useMutation(api.shivIntro.send)
  const [name, setName] = useState('')
  const [place, setPlace] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  const rows = data?.rows ?? []
  const typed = last10(phone)
  const current = typed.length === 10 ? rows.find((row) => row.phone === typed) : undefined
  const filled = Boolean(name.trim() && typed.length === 10)
  const seenAt = data?.phoneSeenAt ?? null
  // The phone checks in every 15 minutes, so a good while longer means it stopped.
  const phoneQuiet = seenAt === null || Date.now() - seenAt > 40 * 60_000

  const clear = () => { setName(''); setPlace(''); setPhone('') }

  async function run(job, otherDone) {
    if (busy) return
    setBusy(true)
    setProblem('')
    try {
      await job()
      // Both done: ready for the next customer, with nothing to press.
      if (otherDone) clear()
    } catch (err) {
      setProblem(words(err))
    } finally {
      setBusy(false)
    }
  }

  const person = { name, place, phone }
  const of = (row) => ({ name: row.name, place: row.place, phone: row.phone })
  const sendRow = (row) => {
    const again = Boolean(row.sendStatus)
    if (again && !window.confirm(`${row.name} was already sent the card. Send it again?`)) return
    void run(() => send({ ...of(row), again }), false)
  }

  return (
    <div className="app">
      <header className="top">
        <img src="/icon-192.png" alt="" />
        <h1 className="brand">Shiv Intro</h1>
      </header>

      <main className="body">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoCapitalize="words" />
        </label>
        <label className="field">
          <span>Place</span>
          <input value={place} onChange={(e) => setPlace(e.target.value)} autoComplete="off" autoCapitalize="words" />
        </label>
        <label className="field">
          <span>Mobile number</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" />
        </label>

        {problem && <p className="problem">{problem}</p>}
        {current && (
          <p className="note">
            {current.name} is already on the list below.{' '}
            <button type="button" className="link" onClick={clear}>New customer</button>
          </p>
        )}
        {data && (
          <p className={`note${phoneQuiet ? ' quiet' : ''}`}>
            Main phone: {seenAt === null ? 'not connected yet' : `last seen ${ago(seenAt)}`}
            {phoneQuiet ? '. Saves will wait until it is back.' : ''}
          </p>
        )}

        <ul className="list">
          {rows.map((row) => {
            const saved = saveSign(row)
            const sent = sendSign(row)
            return (
              <li key={row._id}>
                <div className="who">{row.name}{row.place ? `, ${row.place}` : ''}</div>
                <div className="small">
                  {row.phone}
                  {row.savedAs ? ` · on phone as ${row.savedAs}` : ''}
                </div>
                <div className="row-signs">
                  {saved && <span className={`tag ${saved[1]}`}>{saved[0]}</span>}
                  {sent && <span className={`tag ${sent[1]}`}>{sent[0]}</span>}
                  {canSave(row) && (
                    <button type="button" className="mini" disabled={busy} onClick={() => void run(() => save(of(row)), false)}>
                      {row.saveStatus === 'failed' ? 'Save again' : 'Save'}
                    </button>
                  )}
                  {(canSend(row) || row.sendStatus === 'sent') && (
                    <button type="button" className="mini" disabled={busy} onClick={() => sendRow(row)}>
                      {row.sendStatus ? 'Send again' : 'Send'}
                    </button>
                  )}
                </div>
                {(row.saveError || row.sendError) && <div className="small">{row.saveError ?? row.sendError}</div>}
              </li>
            )
          })}
        </ul>
      </main>

      <footer className="dock two">
        <button
          type="button"
          className="key must"
          disabled={busy || !filled || !canSave(current)}
          onClick={() => void run(() => save(person), Boolean(current?.sendStatus))}
        >
          Save
        </button>
        <button
          type="button"
          className="key safe"
          disabled={busy || !filled || !canSend(current)}
          onClick={() => void run(() => send(person), Boolean(current?.saveStatus))}
        >
          Send
        </button>
      </footer>
    </div>
  )
}

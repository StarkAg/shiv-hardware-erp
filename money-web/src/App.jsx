import { useEffect, useMemo, useRef, useState } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'

/**
 * Shiv Money: is the business making money?
 *
 * The money the shop has is counted by hand, place by place: cash in the
 * shop, cash at home, each bank account, MSwipe, and any other place added.
 * What it owes suppliers comes live from the books (convex/money.ts, added up
 * as Shiv Accounts adds them). Together they say what the business is worth
 * today. Customers' balances and suppliers paid ahead are left out: the
 * books do not hold them accurately enough to count on.
 *
 * Save keeps the count whole, with the books' figures at that moment, so a
 * later count can be read against it: worth more than last time is money
 * made. The amounts typed stay on the phone until saved, and a new count
 * starts from the last one saved, so only what changed needs typing.
 */
const api = anyApi

const read = (key) => { try { const raw = localStorage.getItem(`money:${key}`); return raw ? JSON.parse(raw) : undefined } catch { return undefined } }
const write = (key, value) => { try { localStorage.setItem(`money:${key}`, JSON.stringify(value)) } catch { /* storage full: it only opens cold */ } }

/** A live query that answers at once with what this phone saw last. */
function useCached(fn, args, key) {
  const live = useQuery(fn, args)
  const [kept] = useState(() => read(`q:${key}`))
  useEffect(() => { if (live !== undefined) write(`q:${key}`, live) }, [live, key])
  return live ?? kept
}

const rupees = (n) => `₹${Math.round(Math.abs(Number(n) || 0)).toLocaleString('en-IN')}`
const amountOf = (text) => {
  const n = Number(String(text ?? '').replace(/[,\s₹]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const when = (ms) => new Date(ms).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const day = (ms) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** What the business is worth: money held, less what it owes suppliers and others. */
const worth = (have, owe, b) => have - (b?.toPay ?? 0) - owe
/**
 * A saved count's worth, worked out the same way every time from what it
 * kept. Counts saved earlier had customers and supplier advances in their `net`.
 */
const worthOf = (c) => worth(
  c.places.filter((p) => p.kind === 'have').reduce((t, p) => t + p.amount, 0),
  c.places.filter((p) => p.kind === 'owe').reduce((t, p) => t + p.amount, 0),
  c,
)

export default function App() {
  const [tab, setTab] = useState(() => read('tab') ?? 'count')
  useEffect(() => { write('tab', tab) }, [tab])
  const places = useCached(api.money.places, {}, 'places')
  const books = useCached(api.money.books, {}, 'books')
  const counts = useCached(api.money.counts, {}, 'counts')
  const convex = useConvex()

  // The shop's own places are written the first time the app opens.
  const setUpAsked = useRef(false)
  useEffect(() => {
    if (places && places.length === 0 && !setUpAsked.current) {
      setUpAsked.current = true
      convex.mutation(api.money.setUp, {}).catch(() => { setUpAsked.current = false })
    }
  }, [places, convex])

  return (
    <div className="app">
      <header className="top">
        <div className="brand">Shiv Money</div>
        <nav className="tabs" aria-label="Screens">
          <button type="button" className={tab === 'count' ? 'on' : ''} onClick={() => setTab('count')}>Count</button>
          <button type="button" className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>Saved{counts?.length ? ` (${counts.length})` : ''}</button>
        </nav>
      </header>
      {tab === 'count'
        ? <Count places={places} books={books} counts={counts} onSaved={() => setTab('saved')} />
        : <Saved counts={counts} />}
    </div>
  )
}

function Count({ places, books, counts, onSaved }) {
  const convex = useConvex()
  const last = counts?.[0]
  // What is typed, by place name. A place not typed yet starts from the last count.
  const [typed, setTyped] = useState(() => read('draft') ?? {})
  const [note, setNote] = useState(() => read('note') ?? '')
  useEffect(() => { write('draft', typed) }, [typed])
  useEffect(() => { write('note', note) }, [note])
  const lastAmount = (name) => last?.places.find((p) => p.name === name)?.amount
  const valueOf = (p) => typed[p.name] ?? (lastAmount(p.name) != null ? String(lastAmount(p.name)) : '')

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const list = places ?? []
  const haves = list.filter((p) => p.kind === 'have')
  const owes = list.filter((p) => p.kind === 'owe')
  const have = haves.reduce((t, p) => t + amountOf(valueOf(p)), 0)
  const owe = owes.reduce((t, p) => t + amountOf(valueOf(p)), 0)
  const net = worth(have, owe, books)
  const change = last ? net - worthOf(last) : null

  const save = async () => {
    setError('')
    setBusy(true)
    try {
      await convex.mutation(api.money.save, {
        places: list.map((p) => ({ name: p.name, kind: p.kind, amount: amountOf(valueOf(p)) })),
        note: note.trim() || undefined,
      })
      // The saved count is the start of the next one.
      setTyped({})
      setNote('')
      onSaved()
    } catch (err) {
      setError(err?.data?.message ?? err?.message ?? 'Not saved. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <main className="body">
        <section className="worth" aria-live="polite">
          <div className="label">What the business is worth</div>
          <div className={`big ${net < 0 ? 'out' : ''}`}>{net < 0 ? '-' : ''}{rupees(net)}</div>
          {change !== null && (
            <div className={`since ${change > 0.5 ? 'in' : change < -0.5 ? 'out' : ''}`}>
              {Math.abs(change) < 0.5 ? `Same as ${day(last.at)}` : `${change > 0 ? 'Up' : 'Down'} ${rupees(change)} since ${day(last.at)}`}
            </div>
          )}
        </section>

        <section>
          <h2 className="head"><span>Money we have</span><b>{rupees(have)}</b></h2>
          <ul className="rows">
            {haves.map((p) => (
              <PlaceRow key={p.id} place={p} value={valueOf(p)} onChange={(v) => setTyped({ ...typed, [p.name]: v })} onEdit={() => setEditing(p)} />
            ))}
            {!places && <li className="note">Loading...</li>}
          </ul>
          <button type="button" className="key ghost add" onClick={() => setAdding(true)}>Add a place</button>
        </section>

        <section>
          <h2 className="head"><span>From the books</span></h2>
          <ul className="rows">
            <BookRow label="To pay suppliers" amount={books?.toPay} tone="out" />
          </ul>
        </section>

        {owes.length > 0 && (
          <section>
            <h2 className="head"><span>Money we owe</span><b className="out">{rupees(owe)}</b></h2>
            <ul className="rows">
              {owes.map((p) => (
                <PlaceRow key={p.id} place={p} value={valueOf(p)} onChange={(v) => setTyped({ ...typed, [p.name]: v })} onEdit={() => setEditing(p)} />
              ))}
            </ul>
          </section>
        )}

        <section>
          <label className="field">
            <span>Note (optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Diwali stock bought, loan paid..." />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      </main>
      <footer className="dock">
        <button type="button" className="key safe" onClick={() => void save()} disabled={busy || !places || !books}>
          {busy ? 'Saving...' : 'Save this count'}
        </button>
      </footer>
      {adding && <AddPlace onClose={() => setAdding(false)} />}
      {editing && <EditPlace place={editing} places={list} onClose={() => setEditing(null)} />}
    </>
  )
}

function PlaceRow({ place, value, onChange, onEdit }) {
  return (
    <li className="row">
      <button type="button" className="name" onClick={onEdit} aria-label={`${place.name}: rename, move or remove`}>{place.name}</button>
      <input
        className={`amount ${place.kind === 'owe' ? 'out' : ''}`}
        inputMode="decimal"
        aria-label={`${place.name} amount`}
        placeholder="0"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        onFocus={(e) => e.target.select()}
      />
    </li>
  )
}

function BookRow({ label, amount, tone }) {
  return (
    <li className="row">
      <span className="name plain">{label}</span>
      <b className={`figure ${amount ? tone : ''}`}>{amount == null ? '...' : rupees(amount)}</b>
    </li>
  )
}

/** A sheet over the screen, closed by its own buttons or a tap outside. */
function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="sheetback" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 className="sheettitle">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function AddPlace({ onClose }) {
  const convex = useConvex()
  const [name, setName] = useState('')
  const [kind, setKind] = useState('have')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const add = async () => {
    setBusy(true)
    setError('')
    try {
      await convex.mutation(api.money.addPlace, { name, kind })
      onClose()
    } catch (err) {
      setError(err?.data?.message ?? err?.message ?? 'Not added. Try again.')
      setBusy(false)
    }
  }
  return (
    <Sheet title="Add a place" onClose={onClose}>
      <label className="field">
        <span>Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ICICI current account" onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void add() }} />
      </label>
      <div className="choice" role="radiogroup" aria-label="Kind">
        <button type="button" role="radio" aria-checked={kind === 'have'} className={kind === 'have' ? 'on' : ''} onClick={() => setKind('have')}>Money we have</button>
        <button type="button" role="radio" aria-checked={kind === 'owe'} className={kind === 'owe' ? 'on' : ''} onClick={() => setKind('owe')}>Money we owe</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="sheetkeys">
        <button type="button" className="key ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="key must" onClick={() => void add()} disabled={busy || !name.trim()}>Add</button>
      </div>
    </Sheet>
  )
}

function EditPlace({ place, places, onClose }) {
  const convex = useConvex()
  const [name, setName] = useState(place.name)
  const [error, setError] = useState('')
  const [sure, setSure] = useState(false)
  const at = places.findIndex((p) => p.id === place.id)
  const run = async (fn) => {
    setError('')
    try { await fn(); } catch (err) { setError(err?.data?.message ?? err?.message ?? 'Not done. Try again.') }
  }
  return (
    <Sheet title={place.name} onClose={onClose}>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="sheetkeys">
        <button type="button" className="key ghost" disabled={at <= 0} onClick={() => void run(() => convex.mutation(api.money.movePlace, { id: place.id, by: -1 }))}>Move up</button>
        <button type="button" className="key ghost" disabled={at >= places.length - 1} onClick={() => void run(() => convex.mutation(api.money.movePlace, { id: place.id, by: 1 }))}>Move down</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="sheetkeys">
        {sure
          ? <button type="button" className="key stop" onClick={() => void run(async () => { await convex.mutation(api.money.removePlace, { id: place.id }); onClose() })}>Yes, remove it</button>
          : <button type="button" className="key ghost stoptext" onClick={() => setSure(true)}>Remove</button>}
        <button type="button" className="key must" disabled={!name.trim() || name.trim() === place.name}
          onClick={() => void run(async () => { await convex.mutation(api.money.renamePlace, { id: place.id, name }); onClose() })}>Rename</button>
      </div>
      {sure && <p className="small">Counts already saved keep what it held.</p>}
    </Sheet>
  )
}

function Saved({ counts }) {
  const [open, setOpen] = useState(null)
  if (!counts) return <main className="body"><p className="note">Loading...</p></main>
  if (!counts.length) return <main className="body"><p className="note">No count saved yet. Fill in the Count screen and save it; the next one is read against it.</p></main>
  const first = counts[counts.length - 1]
  const overall = worthOf(counts[0]) - worthOf(first)
  return (
    <main className="body">
      {counts.length > 1 && (
        <section className="worth small">
          <div className="label">Since the first count, {day(first.at)}</div>
          <div className={`big ${overall > 0.5 ? 'in' : overall < -0.5 ? 'out' : ''}`}>{overall > 0.5 ? 'Up ' : overall < -0.5 ? 'Down ' : ''}{rupees(overall)}</div>
        </section>
      )}
      <ul className="rows saved">
        {counts.map((c, i) => {
          const before = counts[i + 1]
          const net = worthOf(c)
          const change = before ? net - worthOf(before) : null
          return (
            <li key={c.id}>
              <button type="button" className="row savedrow" onClick={() => setOpen(c)}>
                <span className="who">
                  <b>{when(c.at)}</b>
                  {c.note && <small>{c.note}</small>}
                </span>
                <span className="figs">
                  <b className={net < 0 ? 'out' : ''}>{net < 0 ? '-' : ''}{rupees(net)}</b>
                  {change !== null && (
                    <small className={change > 0.5 ? 'in' : change < -0.5 ? 'out' : ''}>
                      {Math.abs(change) < 0.5 ? 'Same' : `${change > 0 ? 'Up' : 'Down'} ${rupees(change)}`}
                    </small>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {open && <CountSheet count={open} before={counts[counts.findIndex((c) => c.id === open.id) + 1]} onClose={() => setOpen(null)} />}
    </main>
  )
}

function CountSheet({ count, before, onClose }) {
  const convex = useConvex()
  const [sure, setSure] = useState(false)
  const [error, setError] = useState('')
  const was = (name) => before?.places.find((p) => p.name === name)?.amount
  const line = (label, amount, tone, prev) => (
    <li className="row" key={label}>
      <span className="name plain">{label}</span>
      <span className="figs">
        <b className={amount ? tone : ''}>{rupees(amount)}</b>
        {prev != null && Math.abs(amount - prev) >= 0.5 && <small>was {rupees(prev)}</small>}
      </span>
    </li>
  )
  return (
    <Sheet title={when(count.at)} onClose={onClose}>
      <div className="sheetscroll">
        <ul className="rows">
          {count.places.filter((p) => p.kind === 'have').map((p) => line(p.name, p.amount, '', was(p.name)))}
          {line('To pay suppliers', count.toPay, 'out', before?.toPay)}
          {count.places.filter((p) => p.kind === 'owe').map((p) => line(p.name, p.amount, 'out', was(p.name)))}
        </ul>
        <div className="total"><span>Worth</span><b className={worthOf(count) < 0 ? 'out' : ''}>{worthOf(count) < 0 ? '-' : ''}{rupees(worthOf(count))}</b></div>
        {count.note && <p className="small">{count.note}</p>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="sheetkeys">
        {sure
          ? <button type="button" className="key stop" onClick={async () => {
              try { await convex.mutation(api.money.removeCount, { id: count.id }); onClose() } catch (err) { setError(err?.data?.message ?? err?.message ?? 'Not deleted.') }
            }}>Yes, delete it</button>
          : <button type="button" className="key ghost stoptext" onClick={() => setSure(true)}>Delete</button>}
        <button type="button" className="key ghost" onClick={onClose}>Close</button>
      </div>
    </Sheet>
  )
}

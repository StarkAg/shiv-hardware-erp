/**
 * The Inventory site: what is on the shelf, worked out from the bills.
 *
 * Stock is the last shelf count plus the bills after it (convex/inventory.ts):
 * purchases and goods received add, sales take away, returns go back the way
 * they came. Counting an item here resets it to what is actually there. No
 * sign-in, by the shop's choice; it is unlisted and kept out of search engines.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'

const api = anyApi.inventory

const STATUS = {
  ok: { label: 'In stock', cls: 'ok' },
  low: { label: 'Low', cls: 'low' },
  out: { label: 'Out', cls: 'out' },
  check: { label: 'Count it', cls: 'check' },
}
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'low', label: 'Low' },
  { key: 'out', label: 'Out' },
  { key: 'check', label: 'Count it' },
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = (d) => {
  if (!d) return ''
  const [y, m, dd] = String(d).slice(0, 10).split('-')
  return `${dd} ${MONTHS[Number(m) - 1] ?? ''} ${String(y).slice(2)}`
}
const qty = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }))
const rupees = (n) => (n === null || n === undefined ? '' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`)

// Same forgiving search as the sort app: case, spaces and punctuation do not
// matter, and words can come in any order.
const squash = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '')
const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const matches = (item, q) => {
  const sq = squash(q)
  if (!sq) return true
  const hay = squash([item.name, ...(item.aliases ?? []), item.place].join(' '))
  return hay.includes(sq) || words(q).every((w) => hay.includes(w))
}

const errorText = (e) => String(e?.data ?? e?.message ?? e).replace(/^.*Uncaught (Convex)?Error:\s*/s, '').split('\n')[0]

export default function App() {
  const [tab, setTab] = useState('stock')
  const [open, setOpen] = useState(null) // an item's ref

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <b>Inventory</b>
          <span>Shiv Hardware</span>
        </div>
        {!open && (
          <nav className="tabs" aria-label="Sections">
            <button className={tab === 'stock' ? 'on' : ''} onClick={() => setTab('stock')}>Stock</button>
            <button className={tab === 'moves' ? 'on' : ''} onClick={() => setTab('moves')}>Moves</button>
          </nav>
        )}
      </header>
      {open ? (
        <ItemPage itemRef={open} onBack={() => setOpen(null)} />
      ) : tab === 'stock' ? (
        <StockList onOpen={setOpen} />
      ) : (
        <Moves onOpen={setOpen} />
      )}
    </div>
  )
}

/* ── every item ───────────────────────────────────────────────────────── */

function StockList({ onOpen }) {
  const items = useQuery(api.list, {})
  const [find, setFind] = useState('')
  const [filter, setFilter] = useState('all')
  const [onlyListed, setOnlyListed] = useState(true)

  const counts = useMemo(() => {
    const out = { all: 0, low: 0, out: 0, check: 0 }
    for (const i of items ?? []) {
      if (onlyListed && !i.listed) continue
      out.all += 1
      if (out[i.status] !== undefined) out[i.status] += 1
    }
    return out
  }, [items, onlyListed])

  const shown = useMemo(
    () =>
      (items ?? []).filter(
        (i) => (!onlyListed || i.listed) && (filter === 'all' || i.status === filter) && matches(i, find),
      ),
    [items, find, filter, onlyListed],
  )

  const totalValue = useMemo(
    () => shown.reduce((s, i) => s + (i.value ?? 0), 0),
    [shown],
  )

  return (
    <main className="page">
      <div className="bar">
        <input
          className="search"
          type="search"
          placeholder="Item, other name or rack"
          aria-label="Find an item"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          autoCorrect="off"
          spellCheck="false"
        />
        <div className="chips" role="tablist" aria-label="Filter">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              className={`chip ${filter === f.key ? 'on' : ''} ${f.key !== 'all' ? `chip-${f.key}` : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label} <span>{counts[f.key]}</span>
            </button>
          ))}
          <label className="toggle">
            <input type="checkbox" checked={!onlyListed} onChange={(e) => setOnlyListed(!e.target.checked)} />
            Names typed on bills too
          </label>
        </div>
      </div>

      {items === undefined ? (
        <p className="hint pad">Loading…</p>
      ) : !shown.length ? (
        <p className="hint pad">{find.trim() ? `Nothing matches “${find.trim()}”.` : 'Nothing here.'}</p>
      ) : (
        <>
          <p className="hint summary">
            {shown.length} {shown.length === 1 ? 'item' : 'items'}
            {totalValue > 0 ? ` · stock worth about ${rupees(Math.round(totalValue))} at last purchase price` : ''}
          </p>
          <ul className="list">
            {shown.map((i) => (
              <li key={i.ref}>
                <button className="row" onClick={() => onOpen(i.ref)}>
                  <span className="row-main">
                    <b>{i.name}</b>
                    <span className="hint">
                      {i.place ? `${i.place} · ` : ''}
                      {i.min !== null ? `reorder at ${qty(i.min)} · ` : ''}
                      {i.lastMove ? `moved ${day(i.lastMove)}` : 'no bills yet'}
                      {!i.listed ? ' · not in My Items' : ''}
                    </span>
                    {i.otherUnits?.length > 0 && (
                      <span className="hint warn">
                        + {i.otherUnits.map((o) => `${qty(o.qty)} ${o.unit}`).join(', ')} with no pack size
                      </span>
                    )}
                  </span>
                  <span className={`stock ${STATUS[i.status]?.cls ?? ''}`}>
                    <b>{qty(i.stock)}</b>
                    <small>{i.unit}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}

/* ── one item ─────────────────────────────────────────────────────────── */

function ItemPage({ itemRef, onBack }) {
  const item = useQuery(api.item, { ref: itemRef })
  const [mode, setMode] = useState(null) // 'count' | 'settings' | null
  const [said, setSaid] = useState('')

  useEffect(() => {
    if (!said) return undefined
    const t = setTimeout(() => setSaid(''), 1800)
    return () => clearTimeout(t)
  }, [said])

  return (
    <main className="page">
      <button className="back" onClick={onBack}>‹ All items</button>
      {item === undefined ? (
        <p className="hint pad">Loading…</p>
      ) : (
        <>
          <section className="card head">
            <div className="head-main">
              <h1>{item.name}</h1>
              {item.aliases?.length > 0 && <p className="hint">Also: {item.aliases.join(', ')}</p>}
              <p className="hint">
                {item.place || 'No rack set'}
                {!item.listed ? ' · not in My Items' : ''}
              </p>
              <span className={`badge ${STATUS[item.status]?.cls ?? ''}`}>{STATUS[item.status]?.label}</span>
            </div>
            <div className={`big ${STATUS[item.status]?.cls ?? ''}`}>
              <b>{qty(item.stock)}</b>
              <small>{item.unit}</small>
            </div>
          </section>

          {item.otherUnits?.length > 0 && (
            <p className="note">
              Not in stock above (no pack size): {item.otherUnits.map((o) => `${qty(o.qty)} ${o.unit}`).join(', ')}
            </p>
          )}

          <div className="actions">
            <button className={`btn ${mode === 'count' ? 'on' : 'go'}`} onClick={() => setMode(mode === 'count' ? null : 'count')}>
              Count the shelf
            </button>
            <button className={`btn ${mode === 'settings' ? 'on' : ''}`} onClick={() => setMode(mode === 'settings' ? null : 'settings')}>
              Settings
            </button>
          </div>

          {mode === 'count' && (
            <CountForm item={item} onDone={(msg) => { setMode(null); setSaid(msg) }} />
          )}
          {mode === 'settings' && (
            <SettingsForm item={item} onDone={(msg) => { setMode(null); setSaid(msg) }} />
          )}

          <section className="facts">
            <Fact label={item.counted ? 'In since count' : 'In (all bills)'} value={`${qty(item.bought)} ${item.unit}`} />
            <Fact label={item.counted ? 'Out since count' : 'Out (all bills)'} value={`${qty(item.sold)} ${item.unit}`} />
            <Fact
              label="Last count"
              value={item.counted ? `${qty(item.counted.qty)} ${item.unit}` : 'Never counted'}
              sub={item.counted ? day(item.counted.day) : ''}
            />
            <Fact label="Reorder at" value={item.min !== null ? `${qty(item.min)} ${item.unit}` : 'Not set'} />
            <Fact
              label="Last bought"
              value={item.lastBuy ? `${rupees(item.lastBuy.each)} / ${item.lastBuy.unit}` : '—'}
              sub={item.lastBuy ? `${day(item.lastBuy.day)}${item.lastBuy.party ? ` · ${item.lastBuy.party}` : ''}` : ''}
            />
            <Fact
              label="Last sold"
              value={item.lastSale ? `${rupees(item.lastSale.each)} / ${item.lastSale.unit}` : '—'}
              sub={item.lastSale ? day(item.lastSale.day) : ''}
            />
            <Fact label="Rate (My Items)" value={item.rate !== null ? rupees(item.rate) : '—'} />
            <Fact label="Stock worth" value={item.value !== null ? rupees(item.value) : '—'} sub="at last purchase price" />
          </section>

          <section className="card">
            <h2>History</h2>
            {!item.history?.length ? (
              <p className="hint">No bills or counts for this item yet.</p>
            ) : (
              <ul className="history">
                {item.history.map((h, idx) =>
                  h.type === 'count' ? (
                    <li key={`c${h.at}-${idx}`} className="h-count">
                      <span className="h-day">{day(h.day)}</span>
                      <span className="h-what">
                        <b>Counted</b>
                        {h.note ? <span className="hint"> · {h.note}</span> : null}
                      </span>
                      <span className="h-qty">= {qty(h.qty)} {item.unit}</span>
                    </li>
                  ) : (
                    <li key={`m${h.billId}-${idx}`}>
                      <span className="h-day">{day(h.day)}</span>
                      <span className="h-what">
                        <b>{h.why}</b>
                        <span className="hint">
                          {h.party ? ` · ${h.party}` : ''}
                          {h.number ? ` · ${h.number}` : ''}
                          {h.each !== null ? ` · ${rupees(h.each)} each` : ''}
                        </span>
                      </span>
                      <span className={`h-qty ${h.kind}`}>
                        {h.kind === 'in' ? '+' : '−'}
                        {qty(h.qty)} {h.unit}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            )}
          </section>
        </>
      )}
      {said && <div className="flash" role="status">{said}</div>}
    </main>
  )
}

function Fact({ label, value, sub }) {
  return (
    <div className="fact">
      <span className="hint">{label}</span>
      <b>{value}</b>
      {sub ? <span className="hint">{sub}</span> : null}
    </div>
  )
}

function CountForm({ item, onDone }) {
  const count = useMutation(api.count)
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const box = useRef(null)
  useEffect(() => { box.current?.focus() }, [])

  const save = async (e) => {
    e.preventDefault()
    const n = Number(value)
    if (value.trim() === '' || !Number.isFinite(n) || n < 0) return setError('Type how many are on the shelf (0 or more).')
    setBusy(true)
    setError('')
    try {
      await count({ ref: item.ref, qty: n, note: note.trim() || undefined })
      onDone(`Counted: ${qty(n)} ${item.unit}`)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={save}>
      <h2>Shelf count</h2>
      <p className="hint">Bills say {qty(item.stock)} {item.unit}</p>
      <div className="row2">
        <label>
          <span>Counted ({item.unit})</span>
          <input
            ref={box}
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))}
            enterKeyHint="done"
          />
        </label>
        <label>
          <span>Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn go" disabled={busy}>{busy ? 'Saving…' : 'Save count'}</button>
    </form>
  )
}

function SettingsForm({ item, onDone }) {
  const setItem = useMutation(api.setItem)
  const [min, setMin] = useState(item.min ?? '')
  const [place, setPlace] = useState(item.place ?? '')
  const [unit, setUnit] = useState(item.unit ?? '')
  const [note, setNote] = useState(item.note ?? '')
  const [packs, setPacks] = useState(() => Object.entries(item.packs ?? {}).map(([u, n]) => ({ u, n: String(n) })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async (e) => {
    e.preventDefault()
    const minNum = String(min).trim() === '' ? null : Number(min)
    if (minNum !== null && (!Number.isFinite(minNum) || minNum < 0)) return setError('Reorder level must be 0 or more.')
    const packObj = {}
    for (const p of packs) {
      if (!p.u.trim() && !p.n.trim()) continue
      const n = Number(p.n)
      if (!p.u.trim() || !Number.isFinite(n) || n <= 0) return setError('Each pack size needs a unit and how many it holds.')
      packObj[p.u.trim()] = n
    }
    setBusy(true)
    setError('')
    try {
      await setItem({
        ref: item.ref,
        min: minNum,
        place,
        unit,
        note,
        packs: Object.keys(packObj).length ? packObj : null,
      })
      onDone('Settings saved')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={save}>
      <h2>Settings</h2>
      <div className="row2">
        <label>
          <span>Reorder at ({unit || item.unit})</span>
          <input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value.replace(/[^0-9.]/g, ''))} />
        </label>
        <label>
          <span>Rack / shelf</span>
          <input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={60} />
        </label>
        <label>
          <span>Main unit</span>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={20} />
        </label>
        <label>
          <span>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </label>
      </div>
      <div className="packs">
        <span className="hint">Pack sizes</span>
        {packs.map((p, i) => (
          <div className="pack" key={i}>
            <span>1</span>
            <input
              aria-label="Pack unit"
              value={p.u}
              onChange={(e) => setPacks(packs.map((x, j) => (j === i ? { ...x, u: e.target.value } : x)))}
            />
            <span>=</span>
            <input
              aria-label="How many in one pack"
              inputMode="decimal"
              value={p.n}
              onChange={(e) => setPacks(packs.map((x, j) => (j === i ? { ...x, n: e.target.value.replace(/[^0-9.]/g, '') } : x)))}
            />
            <span>{unit || item.unit}</span>
            <button type="button" className="x" aria-label="Remove pack size" onClick={() => setPacks(packs.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="link" onClick={() => setPacks([...packs, { u: item.otherUnits?.[0]?.unit ?? 'Box', n: '' }])}>
          + Add a pack size
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <button className="btn go" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
    </form>
  )
}

/* ── the latest movements ─────────────────────────────────────────────── */

function Moves({ onOpen }) {
  const moves = useQuery(api.recent, { limit: 200 })
  const [find, setFind] = useState('')
  const shown = useMemo(
    () => (moves ?? []).filter((m) => matches({ name: m.name, aliases: [m.party, m.number] }, find)),
    [moves, find],
  )
  return (
    <main className="page">
      <div className="bar">
        <input
          className="search"
          type="search"
          placeholder="Item, party or bill no."
          aria-label="Find a movement"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
      </div>
      {moves === undefined ? (
        <p className="hint pad">Loading…</p>
      ) : !shown.length ? (
        <p className="hint pad">No movements.</p>
      ) : (
        <ul className="list">
          {shown.map((m, idx) => (
            <li key={`${m.billId}-${idx}`}>
              <button className="row" onClick={() => onOpen(m.ref)}>
                <span className="row-main">
                  <b>{m.name}</b>
                  <span className="hint">
                    {day(m.day)} · {m.why}
                    {m.party ? ` · ${m.party}` : ''}
                    {m.number ? ` · ${m.number}` : ''}
                  </span>
                </span>
                <span className={`move ${m.kind}`}>
                  {m.kind === 'in' ? '+' : '−'}
                  {qty(m.qty)} <small>{m.unit}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

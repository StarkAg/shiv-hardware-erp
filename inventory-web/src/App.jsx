/** The shop's supplied plywood stock, with PIN-protected shelf adjustments. */
import { useState } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'

const api = anyApi.inventory
const quantity = n => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 })
const errorText = error => String(error?.data ?? error?.message ?? 'Could not save. Please try again.')
  .replace(/^.*Uncaught (Convex)?Error:\s*/s, '').split('\n')[0]

function StepIcon({ plus }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M5 12h14" />
    {plus && <path d="M12 5v14" />}
  </svg>
}

function PinForm({ onUnlock }) {
  const convex = useConvex()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const unlock = async event => {
    event.preventDefault()
    if (!pin || busy) return
    setBusy(true)
    setError('')
    try {
      await convex.query(api.checkPin, { pin })
      onUnlock(pin)
      setPin('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return <form className="pin-form" onSubmit={unlock}>
    <h1>Edit stock</h1>
    <p>Enter your PIN to change quantities.</p>
    <label htmlFor="inventory-pin">PIN</label>
    <input id="inventory-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={6}
      value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} autoFocus required />
    {error && <p className="error" role="alert">{error}</p>}
    <button className="primary" disabled={busy || pin.length !== 6}>{busy ? 'Checking…' : 'Unlock'}</button>
  </form>
}

export default function App() {
  const items = useQuery(api.seedList, {})
  const adjust = useMutation(api.adjustSeed)
  const [tab, setTab] = useState('stock')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [pin, setPin] = useState('') // Memory only; a reload locks editing again.
  const [pending, setPending] = useState(() => new Set())
  const [error, setError] = useState('')
  const editing = tab === 'edit' && Boolean(pin)
  const locked = tab === 'edit' && !pin
  const shown = (items ?? []).filter(item => {
    const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean)
    return (filter === 'all' || item.stock <= (item.min ?? 2))
      && terms.every(term => item.name.toLowerCase().includes(term))
  })
  const change = async (item, delta) => {
    if (pending.has(item.ref)) return
    setPending(old => new Set(old).add(item.ref))
    setError('')
    try {
      await adjust({ pin, ref: item.ref, delta })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setPending(old => { const next = new Set(old); next.delete(item.ref); return next })
    }
  }

  return <div className="app">
    <header className="top">
      <div className="brand"><b>Inventory</b><span>Shiv Hardware</span></div>
      <nav className="tabs" aria-label="Sections">
        <button className={tab === 'stock' ? 'on' : ''} onClick={() => { setTab('stock'); setError('') }}>Stock</button>
        <button className={tab === 'edit' ? 'on' : ''} onClick={() => { setTab('edit'); setError('') }}>Edit</button>
      </nav>
    </header>
    <main className="page">
      {locked ? <PinForm onUnlock={setPin} /> : <>
        <div className="toolbar">
          <div className="filters" aria-label="Stock filter">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')} aria-pressed={filter === 'all'}>All</button>
            <button className={filter === 'low' ? 'active' : ''} onClick={() => setFilter('low')} aria-pressed={filter === 'low'} title="At or below reorder level (2 sheets by default)">Low</button>
          </div>
          {editing && <button className="lock" onClick={() => { setPin(''); setError('') }} disabled={pending.size > 0}>Lock</button>}
        </div>
        <input className="search" type="search" aria-label="Search stock" placeholder="Search brand or size"
          value={search} onChange={e => setSearch(e.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        {items === undefined ? <p className="hint">Loading…</p>
          : !shown.length ? <p className="hint">{search ? 'No matching stock.' : 'No low stock.'}</p>
          : <ul className="stock-list">
            {shown.map(item => <li key={item.ref}>
              <span className="item-name">{item.name}</span>
              {editing ? <div className="stepper" aria-label={`Quantity for ${item.name}`} aria-busy={pending.has(item.ref)}>
                <button aria-label={`Decrease ${item.name}`} disabled={pending.has(item.ref) || item.stock <= 0} onClick={() => change(item, -1)}><StepIcon /></button>
                <span className="quantity" aria-live="polite">{quantity(item.stock)}</span>
                <button aria-label={`Increase ${item.name}`} disabled={pending.has(item.ref)} onClick={() => change(item, 1)}><StepIcon plus /></button>
              </div> : <span className={`stock-quantity ${item.stock <= (item.min ?? 2) ? 'low' : ''}`}><b>{quantity(item.stock)}</b><small>{item.stock === 1 ? 'sheet' : 'sheets'}</small></span>}
            </li>)}
          </ul>}
      </>}
    </main>
  </div>
}

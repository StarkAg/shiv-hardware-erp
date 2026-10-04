/** Local-first plywood stock: every tap is saved on the device before syncing. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import { BRAND_ORDER, FALLBACK_ITEMS, hydrateStockItems, matchesStockSearch } from './seed'
import {
  acknowledgeAdjustment, loadDeviceInventory, nextAdjustment, queueAdjustment,
  queuedStock, saveRemoteInventory,
} from './localInventory'

const api = anyApi.inventory
const quantity = n => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 })
const errorText = error => String(error?.data ?? error?.message ?? 'Could not save. Please try again.')
  .replace(/^.*Uncaught (Convex)?Error:\s*/s, '').split('\n')[0]
const isOnline = () => typeof navigator === 'undefined' || navigator.onLine
const brandCode = { Signature: 'S', 'Signature Gold': 'SG', Milton: 'MS' }

function ItemLabel({ item }) {
  return <span className="item-name">
    <span>{item.mm}mm</span>
    <span className="item-separator">·</span>
    <span>{item.size.replace('x', ' × ')}</span>
    <span className="item-code">{brandCode[item.brand]}</span>
  </span>
}

function ProductIcon({ category }) {
  return category === 'door'
    ? <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="12" y="5" width="24" height="38" rx="2" fill="currentColor" opacity=".14" /><path d="M14 43V7h20v36M18 11h12M29 25h1" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    : <svg viewBox="0 0 48 48" aria-hidden="true"><path d="m8 15 25-7 8 6-25 8-8-7Z" fill="currentColor" opacity=".16" /><path d="m8 15 25-7 8 6-25 8-8-7Zm8 7v16l25-8V14M16 38l-8-7V15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function StockCard({ item }) {
  const low = item.stock <= (item.min ?? 2)
  return <div className={`stock-card ${low ? 'low' : ''}`}>
    <span className="stock-thumbnail"><ProductIcon category={item.category} /></span>
    <span className="stock-details"><strong>{item.size.replace('x', ' × ')}</strong><small>{item.brand} · {item.mm}mm</small></span>
    <span className="stock-count"><span>α</span><strong>{quantity(item.stock)}</strong></span>
  </div>
}

function StepIcon({ plus }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M5 12h14" />
    {plus && <path d="M12 5v14" />}
  </svg>
}

function CloudIcon() {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.5 18.5H7a4.5 4.5 0 1 1 .75-8.94A5.8 5.8 0 0 1 19 11.5a3.5 3.5 0 0 1-1.5 7Z" />
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
      setError(isOnline() ? errorText(err) : 'Connect once to check the PIN before editing offline.')
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

function syncLabel({ queue, online, syncing, pin, blocked }) {
  if (!queue.length) return 'Synced'
  if (syncing) return `Syncing ${queue.length} saved change${queue.length === 1 ? '' : 's'}…`
  if (!online) return `${queue.length} saved on this device · waiting for connection`
  if (!pin) return `${queue.length} saved on this device · unlock Edit to sync`
  if (blocked) return `${queue.length} saved on this device · needs a check before sync`
  return `${queue.length} saved on this device · will sync when available`
}

export default function App() {
  const remoteItems = useQuery(api.seedList, {})
  const adjust = useMutation(api.adjustSeed)
  const [device, setDevice] = useState(null)
  const [tab, setTab] = useState('stock')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [pin, setPin] = useState('') // Never written to device storage.
  const [online, setOnline] = useState(isOnline)
  const [syncing, setSyncing] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState('')
  const syncingRef = useRef(false)
  const pinRef = useRef(pin)
  pinRef.current = pin

  useEffect(() => {
    let live = true
    loadDeviceInventory().then(state => { if (live) setDevice(state) }).catch(() => {
      if (live) setError('This browser cannot save inventory changes on this device.')
    })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!remoteItems) return
    let live = true
    saveRemoteInventory(hydrateStockItems(remoteItems)).then(state => { if (live) setDevice(state) }).catch(() => {
      if (live) setError('This browser cannot save inventory changes on this device.')
    })
    return () => { live = false }
  }, [remoteItems])

  const sync = async () => {
    if (syncingRef.current || !pinRef.current || !isOnline()) return
    syncingRef.current = true
    setSyncing(true)
    setBlocked(false)
    try {
      for (;;) {
        if (!pinRef.current || !isOnline()) break
        const operation = await nextAdjustment()
        if (!operation) break
        const result = await adjust({ pin: pinRef.current, ref: operation.ref, delta: operation.delta, operationId: operation.id })
        const state = await acknowledgeAdjustment(operation.id, operation.ref, result.qty)
        setDevice(state)
      }
    } catch (err) {
      if (isOnline()) {
        setBlocked(true)
        setError(errorText(err))
      }
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }

  useEffect(() => {
    const onlineNow = () => { setOnline(true); void sync() }
    const offlineNow = () => setOnline(false)
    addEventListener('online', onlineNow)
    addEventListener('offline', offlineNow)
    const timer = setInterval(() => void sync(), 12_000)
    void sync()
    return () => {
      removeEventListener('online', onlineNow)
      removeEventListener('offline', offlineNow)
      clearInterval(timer)
    }
  }, [pin])

  const base = device?.items ?? (remoteItems ? hydrateStockItems(remoteItems) : FALLBACK_ITEMS)
  const queue = device?.queue ?? []
  const items = useMemo(() => queuedStock(base, queue), [base, queue])
  const shown = useMemo(() => items.filter(item =>
    (filter === 'all' || item.stock <= (item.min ?? 2)) && matchesStockSearch(item, search),
  ), [items, filter, search])
  const groups = useMemo(() => BRAND_ORDER.map(brand => ({ brand, items: shown.filter(item => item.brand === brand) }))
    .filter(group => group.items.length), [shown])
  const editing = tab === 'edit' && Boolean(pin)
  const locked = tab === 'edit' && !pin

  const change = async (item, delta) => {
    setError('')
    setBlocked(false)
    // This resolves only after the device has stored the tap, so a refresh or
    // connection drop cannot lose it.
    try {
      const state = await queueAdjustment(item.ref, delta)
      setDevice(state)
      void sync()
    } catch (err) {
      setError(errorText(err))
    }
  }

  const status = syncLabel({ queue, online, syncing, pin, blocked })
  return <div className="app">
    <header className="top">
      <div className="brand"><b>Inventory</b><span>Shiv Hardware</span></div>
      <nav className="tabs" aria-label="Sections">
        <button className={tab === 'stock' ? 'on' : ''} onClick={() => { setTab('stock'); setError('') }}>Stock</button>
        <button className={tab === 'edit' ? 'on' : ''} onClick={() => { setTab('edit'); setError('') }}>Edit</button>
      </nav>
    </header>
    <main className="page">
      {locked ? <PinForm onUnlock={nextPin => { setPin(nextPin); setBlocked(false); setError('') }} /> : <>
        <div className="toolbar">
          <div className="filters" aria-label="Stock filter">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')} aria-pressed={filter === 'all'}>All</button>
            <button className={filter === 'low' ? 'active' : ''} onClick={() => setFilter('low')} aria-pressed={filter === 'low'}>Low</button>
            <span className={`cloud-status ${queue.length ? 'waiting' : ''}`} role="status" aria-live="polite" aria-label={status} title={status}><CloudIcon /></span>
          </div>
          {editing && <button className="lock" onClick={() => { setPin(''); setError('') }}>Lock</button>}
        </div>
        <input className="search" type="search" aria-label="Search stock" placeholder="Search: S, SG, MS, size"
          value={search} onChange={e => setSearch(e.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        {!groups.length ? <p className="hint">{search ? 'No matching stock.' : 'No low stock.'}</p>
          : editing ? groups.map(group => <section className="brand-group" key={group.brand}>
            <h2>{group.brand}</h2>
            <ul className="stock-list">
              {group.items.map(item => <li key={item.ref}>
                <><ItemLabel item={item} /><div className="stepper" aria-label={`Quantity for ${item.name}`}>
                  <button aria-label={`Decrease ${item.name}`} disabled={item.stock <= 0} onClick={() => change(item, -1)}><StepIcon /></button>
                  <span className="quantity alpha-quantity" aria-live="polite"><span>α</span><span>{quantity(item.stock)}</span></span>
                  <button aria-label={`Increase ${item.name}`} onClick={() => change(item, 1)}><StepIcon plus /></button>
                </div></>
              </li>)}
            </ul>
          </section>) : <ul className="stock-list stock-cards">{shown.map(item => <li key={item.ref}><StockCard item={item} /></li>)}</ul>}
      </>}
    </main>
  </div>
}

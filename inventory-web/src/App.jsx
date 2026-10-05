/** Local-first plywood stock: every tap is saved on the device before syncing. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import { BRAND_ORDER, FALLBACK_ITEMS, hydrateStockItems, matchesStockSearch } from './seed'
import {
  acknowledgeAdjustment, hydrateFromConvexOnce, loadDeviceInventory, nextAdjustment,
  queueAdjustment, queuedStock, recordConvexSync, rememberAddedItem,
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
    ? <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="12" y="4" width="24" height="40" rx="2" fill="currentColor" opacity=".13" /><path d="M13 44V5h22v39M17 10h14M17 38h14M17 15v5m0 5v5m0 5v3m13-16h1.5" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
    : <svg viewBox="0 0 48 48" aria-hidden="true"><path d="m6 14 25-8 11 7-25 8-11-7Z" fill="currentColor" opacity=".16" /><path d="m6 14 25-8 11 7-25 8-11-7Zm0 5 11 7 25-8M6 24l11 7 25-8M6 29l11 7 25-8M17 21v15M42 13v15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
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

function SortIcon() {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
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

function AddItemForm({ pin, online, initialBrand, onAdded, onCancel }) {
  const addItem = useMutation(api.addItem)
  const [category, setCategory] = useState('door')
  const [brand, setBrand] = useState(initialBrand || BRAND_ORDER[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async event => {
    event.preventDefault()
    if (busy || !online) return
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const item = await addItem({ pin, category, brand,
        mm: Number(form.get('mm')), height: Number(form.get('height')),
        width: Number(form.get('width')), qty: Number(form.get('qty')) })
      await onAdded(item)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return <form className="add-form" onSubmit={submit} aria-labelledby="add-item-title">
    <h2 id="add-item-title">Add stock item</h2>
    <fieldset disabled={busy}>
      <label>Type<select value={category} onChange={event => setCategory(event.target.value)}><option value="door">Door</option><option value="ply">Plywood</option></select></label>
      <label>Brand<select value={brand} onChange={event => setBrand(event.target.value)}>{BRAND_ORDER.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Thickness (mm)<input name="mm" type="number" min="0.001" max="1000" step="any" required autoFocus /></label>
      <div className="add-dimensions">
        <label>Height ({category === 'door' ? 'inches' : 'feet'})<input name="height" type="number" min="0.001" max="1000" step="any" required /></label>
        <label>Width ({category === 'door' ? 'inches' : 'feet'})<input name="width" type="number" min="0.001" max="1000" step="any" required /></label>
      </div>
      <label>Opening quantity (pieces)<input name="qty" type="number" min="0" step="1" defaultValue="0" required /></label>
    </fieldset>
    {!online && <p className="error" role="status">Connect to the internet to add a new item.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="add-actions"><button className="lock" type="button" onClick={onCancel} disabled={busy}>Cancel</button><button className="primary" disabled={busy || !online}>{busy ? 'Adding...' : 'Add item'}</button></div>
  </form>
}

export default function App() {
  const [device, setDevice] = useState(null)
  const remoteItems = useQuery(api.seedList, {})
  const adjust = useMutation(api.adjustSeed)
  const [tab, setTab] = useState('stock')
  const [sort, setSort] = useState('brand')
  const [sortOpen, setSortOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [brand, setBrand] = useState('')
  const [thickness, setThickness] = useState('')
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
    hydrateFromConvexOnce(hydrateStockItems(remoteItems)).then(state => { if (live) setDevice(state) }).catch(() => {
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
      let uploaded = 0
      for (;;) {
        if (!pinRef.current || !isOnline()) break
        const operation = await nextAdjustment()
        if (!operation) break
        const result = await adjust({ pin: pinRef.current, ref: operation.ref, delta: operation.delta, operationId: operation.id })
        const state = await acknowledgeAdjustment(operation.id, operation.ref, result.qty)
        setDevice(state)
        uploaded += 1
      }
      if (uploaded) setDevice(await recordConvexSync())
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
  const thicknesses = useMemo(() => brand
    ? [...new Set(items.filter(item => item.brand === brand).map(item => item.mm))].sort((a, b) => a - b)
    : [], [items, brand])
  const shown = useMemo(() => items
    .filter(item => (!brand || item.brand === brand) && (!thickness || item.mm === thickness) && matchesStockSearch(item, search))
    .sort((a, b) => {
      if (sort === 'stock') return a.stock - b.stock || a.brand.localeCompare(b.brand) || a.mm - b.mm
      if (sort === 'thickness') return a.mm - b.mm || a.brand.localeCompare(b.brand) || a.size.localeCompare(b.size)
      return BRAND_ORDER.indexOf(a.brand) - BRAND_ORDER.indexOf(b.brand) || a.mm - b.mm || a.size.localeCompare(b.size)
    }), [items, brand, thickness, search, sort])
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
  const lastSynced = device?.lastConvexSyncAt
    ? new Date(device.lastConvexSyncAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not yet synced on this device'
  const openSync = () => {
    setSyncOpen(true)
    void sync()
  }
  return <div className="app">
    <header className="top">
      <nav className="tabs" aria-label="Sections">
        <button className={tab === 'stock' ? 'on' : ''} onClick={() => { setTab('stock'); setError('') }}>Stock</button>
        <button className={tab === 'edit' ? 'on' : ''} onClick={() => { setTab('edit'); setError('') }}>Edit</button>
      </nav>
    </header>
    <main className="page">
      {locked ? <PinForm onUnlock={nextPin => { setPin(nextPin); setBlocked(false); setError('') }} /> : <>
        {editing && <div className="edit-toolbar"><button className="primary add-button" aria-expanded={addOpen} onClick={() => setAddOpen(open => !open)}><StepIcon plus />Add</button><button className="lock" onClick={() => { setPin(''); setAddOpen(false); setError('') }}>Lock</button></div>}
        {editing && addOpen && <AddItemForm pin={pin} online={online} initialBrand={brand} onCancel={() => setAddOpen(false)} onAdded={async item => {
          try { setDevice(await rememberAddedItem(item)) } catch {
            setError('Item saved to inventory, but this browser could not keep an offline copy. Reload when storage is available.')
          }
          setBrand(item.brand)
          setThickness(item.mm)
          setSearch('')
          setAddOpen(false)
        }} />}
        <div className="filter-stages" aria-label="Product filters">
          <div className="filter-stage" aria-label="Brand"><div className="filter-chips">
            {BRAND_ORDER.map(name => <button key={name} className={brand === name ? 'active' : ''} aria-pressed={brand === name} onClick={() => {
              setBrand(current => current === name ? '' : name)
              setThickness('')
            }}>{name}</button>)}
          </div></div>
          {brand && <div className="filter-stage" aria-label="Thickness"><div className="filter-chips">
            {thicknesses.map(mm => <button key={mm} className={thickness === mm ? 'active' : ''} aria-pressed={thickness === mm} onClick={() => setThickness(current => current === mm ? '' : mm)}>{mm}mm</button>)}
          </div></div>}
        </div>
        <div className="search-row"><input className="search" type="search" aria-label="Search stock" placeholder="Search: S, SG, MS, size"
          value={search} onChange={e => setSearch(e.target.value)} /><div className="search-actions"><button type="button" className="icon-button" aria-label="Choose stock sort" title="Sort" aria-expanded={sortOpen} onClick={() => setSortOpen(open => !open)}><SortIcon /></button><button type="button" className={`icon-button cloud-status ${queue.length ? 'waiting' : ''}`} aria-label={`Convex sync: ${status}`} title="Convex sync" onClick={openSync}><CloudIcon /></button></div></div>
        {sortOpen && <div className="sort-menu" role="menu" aria-label="Sort stock">
          {[['brand', 'Brand'], ['thickness', 'Thickness'], ['stock', 'Low stock first']].map(([value, label]) => <button key={value} role="menuitemradio" aria-checked={sort === value} className={sort === value ? 'active' : ''} onClick={() => { setSort(value); setSortOpen(false) }}>{label}</button>)}
        </div>}
        {error && <p className="error" role="alert">{error}</p>}
        {!shown.length ? <p className="hint">No matching stock.</p>
          : <ul className={`stock-list ${editing ? '' : 'stock-cards'}`}>
              {shown.map(item => <li key={item.ref}>
                {editing ? <><ItemLabel item={item} /><div className="stepper" aria-label={`Quantity for ${item.name}`}>
                  <button aria-label={`Decrease ${item.name}`} disabled={item.stock <= 0} onClick={() => change(item, -1)}><StepIcon /></button>
                  <span className="quantity alpha-quantity" aria-live="polite"><span>α</span><span>{quantity(item.stock)}</span></span>
                  <button aria-label={`Increase ${item.name}`} onClick={() => change(item, 1)}><StepIcon plus /></button>
                </div></> : <StockCard item={item} />}
              </li>)}
            </ul>}
        {syncOpen && <div className="sync-backdrop" role="presentation" onMouseDown={() => setSyncOpen(false)}><section className="sync-modal" role="dialog" aria-modal="true" aria-labelledby="sync-title" onMouseDown={event => event.stopPropagation()}>
          <div className="sync-modal-head"><div><h2 id="sync-title">Convex sync</h2><p>{status}</p></div><button type="button" className="close-modal" aria-label="Close sync status" onClick={() => setSyncOpen(false)}>Close</button></div>
          <div className="sync-time"><span>Last synced</span><strong>{lastSynced}</strong></div>
          <div className="pending-uploads"><span>Pending uploads</span><strong>{queue.length}</strong></div>
          {!pin && queue.length > 0 && <p className="sync-note">Unlock Edit to send saved quantity changes to Convex.</p>}
          <button type="button" className="primary" onClick={() => void sync()} disabled={syncing || !pin || !online}>{syncing ? 'Syncing…' : 'Sync now'}</button>
        </section></div>}
      </>}
    </main>
  </div>
}

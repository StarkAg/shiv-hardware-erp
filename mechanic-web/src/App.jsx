import { useEffect, useState } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { anyApi as api } from 'convex/server'
import { makeDraft, read, write, remove } from './drafts'

function Ruler() {
  return <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 6v5m5-5v8m5-8v5" /></svg>
}

function useConnection() {
  const convex = useConvex()
  const [live, setLive] = useState(false)
  useEffect(() => {
    const update = () => setLive(navigator.onLine && convex.connectionState().isWebSocketConnected)
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [convex])
  return live
}

export default function App() {
  const incoming = useQuery(api.workOrders.open, {})
  const staff = useQuery(api.attendance.getStaff, {})
  const [cached, setCached] = useState(() => read('orders', []))
  const [name, setName] = useState(() => read('name', ''))
  const [opened, setOpened] = useState(null)
  const [stage, setStage] = useState('pending')
  const [search, setSearch] = useState('')
  const live = useConnection() && incoming !== undefined
  useEffect(() => { if (incoming !== undefined) { setCached(incoming); write('orders', incoming) } }, [incoming])
  useEffect(() => {
    const back = () => setOpened(null)
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])
  const orders = incoming ?? cached
  const names = [...new Set([...(staff ?? []), ...orders.map((o) => o.visitBy), name].filter(Boolean))].sort()
  const mine = orders.filter((o) => name && o.visitBy.trim().toLowerCase() === name.trim().toLowerCase())
  const rows = mine.filter((o) => (stage === 'measured' ? !!o.measuredAt : !o.measuredAt)
    && `${o.customerName} ${o.number} ${o.site}`.toLowerCase().includes(search.trim().toLowerCase()))
  const current = orders.find((o) => o.id === opened?.id)
  const open = (order) => { window.history.pushState({ order: order.id }, ''); setOpened(order) }
  return <div className="app">
    <header className="top"><div className="brand"><span className="brand-icon"><Ruler /></span><div><h1>Shiv Mechanic</h1><small>Sizes from site</small></div></div><span className={`live ${live ? 'on' : ''}`} role="status"><i />{live ? 'Live' : 'Offline / connecting'}</span></header>
    {opened ? <Order key={opened.id} order={current ?? opened} closed={incoming !== undefined && !current} name={name} live={live} onBack={() => window.history.back()} /> : <main>
      <label className="name-label">Your name<select value={name} onChange={(e) => { setName(e.target.value); write('name', e.target.value) }}><option value="">Choose your name</option>{names.map((n) => <option key={n}>{n}</option>)}</select></label>
      <nav className="tabs" aria-label="Order status"><button className={stage === 'pending' ? 'selected' : ''} onClick={() => setStage('pending')}>To measure <b>{mine.filter((o) => !o.measuredAt).length}</b></button><button className={stage === 'measured' ? 'selected' : ''} onClick={() => setStage('measured')}>Measured <b>{mine.filter((o) => !!o.measuredAt).length}</b></button></nav>
      <input className="search" type="search" aria-label="Search orders" placeholder="Customer, site or order number" value={search} onChange={(e) => setSearch(e.target.value)} />
      {!live && <p className="notice">Showing the last available orders. Drafts stay on this phone until you send them.</p>}
      {!name ? <div className="empty"><Ruler /><h2>Ready for your next visit</h2><p>Choose your name to see the orders assigned to you.</p></div> : !rows.length ? <div className="empty"><h2>{incoming === undefined && !cached.length ? 'Loading orders...' : 'No orders here'}</h2><p>{search ? 'Try another name or order number.' : 'Orders assigned to you on the shop Work list appear here.'}</p></div> : <div className="orders">{rows.map((o) => <button className="order-card" key={o.id} onClick={() => open(o)}><div className="card-meta"><span>{o.quotation ? 'Quotation' : 'Order'} {o.number}</span><span>{o.date}</span></div><h2>{o.customerName || 'Customer'}</h2><p>{o.site || 'No site address added'}</p><div className="card-foot"><span>{o.pieces.length} pieces</span><span>{read(`draft:${o.id}`) ? 'Draft on phone' : o.measuredAt ? 'Sizes sent' : 'Enter sizes'} <span aria-hidden="true">&rsaquo;</span></span></div></button>)}</div>}
    </main>}
  </div>
}

export function Order({ order, closed, name, live, onBack }) {
  const [draft, setDraft] = useState(() => read(`draft:${order.id}`) ?? makeDraft(order))
  const [dirty, setDirty] = useState(() => !!read(`draft:${order.id}`))
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const send = useMutation(api.workOrders.saveSizes)
  const conflict = (order.sizes?.at ?? 0) > draft.baseAt
  const details = new Map(order.pieces.map((p) => [p.key, p]))
  useEffect(() => {
    if (!dirty && !busy) setDraft((held) => (order.sizes?.at ?? 0) >= held.baseAt ? makeDraft(order) : held)
  }, [order, dirty, busy])
  useEffect(() => {
    if (!dirty) return
    const leave = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', leave)
    return () => window.removeEventListener('beforeunload', leave)
  }, [dirty])
  const change = (next) => {
    setDraft(next); setDirty(true); setError('')
    const kept = write(`draft:${order.id}`, next)
    setStatus(kept ? 'Draft saved on this phone' : '')
    if (!kept) setError('Phone storage is full. Keep this screen open until you send the sizes.')
  }
  const pieceChange = (key, field, value) => change({ ...draft, pieces: draft.pieces.map((p) => p.key === key ? { ...p, [field]: value } : p) })
  const reload = () => {
    if (dirty && !window.confirm('Replace this phone draft with the latest sizes from the shop?')) return
    const next = makeDraft(order)
    setDraft(next); setDirty(false); remove(`draft:${order.id}`); setError(''); setStatus('Latest sizes loaded')
  }
  const save = async (measured) => {
    if (busy || closed || conflict) return
    if (!live) { setError('Connect to the internet, then tap Send again. Your draft is still here.'); return }
    setBusy(true); setError(''); setStatus('Sending sizes...')
    try {
      const result = await send({ billId: order.id, by: name, ...draft, measured })
      const next = { ...draft, baseAt: result.at }
      setDraft(next); setDirty(false); remove(`draft:${order.id}`)
      setStatus(measured ? 'Sizes sent. The shop Work list is marked Measured.' : 'Sizes sent. The order stays To measure.')
    } catch (err) {
      setStatus('')
      setError(err?.data?.message || err.message || 'Could not send. Your draft is still on this phone.')
    } finally { setBusy(false) }
  }
  const phone = order.customerPhone.replace(/[^+\d]/g, '')
  return <main className="detail">
    <button className="back" onClick={onBack} disabled={busy}>&lsaquo; All orders</button>
    <div className="visit"><div className="card-meta">{order.quotation ? 'Quotation' : 'Order'} {order.number} <span>{order.date}</span></div><h2>{order.customerName || 'Customer'}</h2><p>{order.site || 'No site address added'}</p>{phone && <a href={`tel:${phone}`}>Call {order.customerPhone}</a>}{order.notes && <p className="shop-note">{order.notes}</p>}</div>
    {closed && <p className="error" role="alert">This order has been billed or removed from the Work list. Sizes cannot be sent.</p>}
    {conflict && <div className="error" role="alert">Newer sizes arrived from another device. Your draft is kept below. <button onClick={reload} disabled={busy}>Load latest sizes</button></div>}
    <fieldset disabled={busy || closed}>
      <div className="measure-heading"><h2>Measurements</h2><label>Unit<select aria-label="Measurement unit" value={draft.unit} onChange={(e) => change({ ...draft, unit: e.target.value })}><option value="in">Inches</option><option value="mm">Millimetres</option><option value="ft">Feet</option></select></label></div>
      <p className="hint">Width first, then height. Fractions such as 24 1/2 are welcome. All rows use the selected unit.</p>
      <div className="pieces">{draft.pieces.map((p, i) => <section className="piece" key={p.key} aria-label={`Piece ${i + 1}`}><div className="piece-title"><span>{i + 1}</span><div><h3>{p.what}</h3><small>{details.get(p.key)?.of || (details.has(p.key) ? `Quantity ${details.get(p.key).qty}` : 'Added on site')}</small></div></div><div className="dimensions"><label>Width<input aria-label={`Width of piece ${i + 1}`} value={p.w} maxLength={24} onChange={(e) => pieceChange(p.key, 'w', e.target.value)} placeholder="e.g. 24 1/2" /></label><span aria-hidden="true">x</span><label>Height<input aria-label={`Height of piece ${i + 1}`} value={p.h} maxLength={24} onChange={(e) => pieceChange(p.key, 'h', e.target.value)} placeholder="e.g. 72" /></label></div><label className="remark">Remark<input value={p.note || ''} maxLength={160} onChange={(e) => pieceChange(p.key, 'note', e.target.value)} placeholder="Location, fitting or other detail" /></label></section>)}</div>
      <button className="add" disabled={draft.pieces.length >= 200} onClick={() => { const what = window.prompt('What extra piece needs measuring?'); if (what?.trim()) change({ ...draft, pieces: [...draft.pieces, { key: `site-${crypto.randomUUID()}`, what: what.trim().slice(0, 160), w: '', h: '', note: '' }] }) }}>+ Add a piece from site</button>
      <label className="notes">Visit notes<textarea value={draft.notes} maxLength={600} onChange={(e) => change({ ...draft, notes: e.target.value })} placeholder="Anything the shop should know" rows={3} /></label>
    </fieldset>
    <div className="save-bar">{status && <p role="status">{status}</p>}{error && <p className="error" role="alert">{error}</p>}<div className="save-buttons"><button disabled={busy || closed || conflict || !name} onClick={() => save(false)}>Send partial sizes</button><button className="primary" disabled={busy || closed || conflict || !name} onClick={() => save(true)}>{busy ? 'Sending...' : 'Finish measurement'}</button></div><small>Sent by {name || 'choose your name'}{order.measuredAt ? ' / Already measured' : ''}</small></div>
  </main>
}

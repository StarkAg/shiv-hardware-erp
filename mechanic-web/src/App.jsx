import { useEffect, useState } from 'react'
import { useConvex, useMutation, useQuery } from 'convex/react'
import { anyApi as api } from 'convex/server'
import { makeDraft, read, write, remove } from './drafts'

const MECHANIC_NAME = 'Gopal & Bandhu'

const Icon = ({ d, size = 24, width = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
)
const Ruler = () => <Icon d={<><path d="M3.5 16.5l13-13 4 4-13 13z" /><path d="M7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2" /></>} />
const Tick = (p) => <Icon width={3.2} {...p} d={<path d="M5 12.5l4.5 4.5L19 7.5" />} />
const Back = () => <Icon width={2.6} d={<path d="M15 5l-7 7 7 7" />} />
const Plus = () => <Icon width={2.6} d={<path d="M12 5v14M5 12h14" />} />
const Phone = () => <Icon d={<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />} />
/** An order's day as it is said: "11 Oct". The books keep it as 2026-10-11. */
const dayOf = (date) => { const d = new Date(`${date}T00:00`); return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }
/** The units a size can be in, and what each key says. */
const UNITS = [['in', 'Inches'], ['mm', 'MM'], ['ft', 'Feet']]

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
  const [cached, setCached] = useState(() => read('orders', []))
  const name = MECHANIC_NAME
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
  const mine = orders.filter((o) => name && o.visitBy.trim().toLowerCase() === name.trim().toLowerCase())
  const rows = mine.filter((o) => (stage === 'measured' ? !!o.measuredAt : !o.measuredAt)
    && `${o.customerName} ${o.number} ${o.site}`.toLowerCase().includes(search.trim().toLowerCase()))
  const current = orders.find((o) => o.id === opened?.id)
  const open = (order) => { window.history.pushState({ order: order.id }, ''); setOpened(order) }
  /** What a row says is waiting: a draft held on this phone, sizes sent, or sizes to enter. */
  const stateOf = (o) => (read(`draft:${o.id}`) ? ['held', 'Draft on phone'] : o.measuredAt ? ['done', 'Sizes sent'] : ['mine', 'Enter sizes'])
  return <div className="app">
    {opened ? <Order key={opened.id} order={current ?? opened} closed={incoming !== undefined && !current} name={name} live={live} onBack={() => window.history.back()} /> : <>
      <header className="top"><img src="/icon-192.png" alt="" /><h1>Shiv Mechanic</h1><span className={`live ${live ? 'on' : ''}`} role="status"><i />{live ? 'Live' : 'Offline'}</span></header>
      <main className="scroll">
        <input className="search" type="search" aria-label="Search orders" placeholder="Customer, site or order number" value={search} onChange={(e) => setSearch(e.target.value)} />
        <nav className="tabs" aria-label="Order status">
          <button className={stage === 'pending' ? 'selected' : ''} aria-pressed={stage === 'pending'} onClick={() => setStage('pending')}>To measure <b>{mine.filter((o) => !o.measuredAt).length}</b></button>
          <button className={stage === 'measured' ? 'selected' : ''} aria-pressed={stage === 'measured'} onClick={() => setStage('measured')}>Measured <b>{mine.filter((o) => !!o.measuredAt).length}</b></button>
        </nav>
        {!live && <p className="notice">No line to the shop. These are the last orders it sent; a draft stays on this phone until you send it.</p>}
        {!rows.length ? <div className="empty"><h2>{incoming === undefined && !cached.length ? 'Loading orders' : 'No orders here'}</h2><p>{search ? 'Try another name or order number.' : 'Orders given to you on the shop Work list show here.'}</p></div> : <div className="orders">{rows.map((o) => {
          const [state, word] = stateOf(o)
          return <button className="order" key={o.id} onClick={() => open(o)}>
            <span className={`sign ${o.measuredAt ? 'done' : 'mine'}`}>{o.measuredAt ? <Tick /> : <Ruler />}</span>
            <span className="body">
              <span className="head"><b>{o.customerName || 'Customer'}</b><time>{dayOf(o.date)}</time></span>
              <span className="site">{o.site || 'No site address added'}</span>
              <span className="foot"><span className={`chip ${state}`}>{word}</span><small>{o.pieces.length} {o.pieces.length === 1 ? 'piece' : 'pieces'} · {o.quotation ? 'Quotation' : 'Order'} {o.number}</small></span>
            </span>
          </button>
        })}</div>}
      </main>
    </>}
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
    setBusy(true); setError(''); setStatus('Sending sizes')
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
  const stopped = busy || closed || conflict || !name
  return <>
    <header className="pagehead">
      <button className="back" onClick={onBack} disabled={busy} aria-label="Back to all orders"><Back /></button>
      <div className="who"><b>{order.customerName || 'Customer'}</b><small>{order.site || 'No site address added'}</small></div>
      {phone && <a className="round" href={`tel:${phone}`} aria-label={`Call ${order.customerPhone}`}><Phone /></a>}
    </header>
    <main className="scroll">
      <section className={`nowpanel ${order.measuredAt ? 'over' : ''}`} aria-label="What to do now">
        <div className="nowhead"><b>{order.measuredAt ? 'Measured' : 'Measure'}</b><small>{order.measuredAt ? 'Sizes sent' : 'Yours to do'}</small></div>
        <div className="units" role="group" aria-label="Measurement unit">
          {UNITS.map(([unit, word]) => <button key={unit} className={draft.unit === unit ? 'on' : ''} aria-pressed={draft.unit === unit} disabled={busy || closed} onClick={() => change({ ...draft, unit })}>{word}</button>)}
        </div>
      </section>
      {!live && <p className="notice" style={{ marginTop: 12 }}>No line to the shop. The draft stays on this phone until you send it.</p>}
      {closed && <p className="error" role="alert">This order has been billed or removed from the Work list. Sizes cannot be sent.</p>}
      {conflict && <div className="error" role="alert">Newer sizes arrived from another device. Your draft is kept below. <button className="key ghost" onClick={reload} disabled={busy}>Load latest sizes</button></div>}
      <div className="rows">
        <div className="rowline"><span className="lbl">{order.quotation ? 'Quotation' : 'Order'}</span><span className="val">{order.number} · {dayOf(order.date)}</span></div>
        {phone && <div className="rowline"><span className="lbl">Customer</span><span className="val">{order.customerPhone}</span></div>}
        {order.notes && <div className="rowline"><span className="lbl">Shop note</span><span className="val">{order.notes}</span></div>}
      </div>
      <fieldset disabled={busy || closed}>
        <div className="pieces">{draft.pieces.map((p, i) => <section className="piece" key={p.key} aria-label={`Piece ${i + 1}`}>
          <div className="piece-title"><span>{i + 1}</span><div><h3>{p.what}</h3><small>{details.get(p.key)?.of || (details.has(p.key) ? `Quantity ${details.get(p.key).qty}` : 'Added on site')}</small></div></div>
          <div className="dimensions">
            <label><span className="lbl">Width</span><input aria-label={`Width of piece ${i + 1}`} value={p.w} maxLength={24} onChange={(e) => pieceChange(p.key, 'w', e.target.value)} placeholder="24 1/2" /></label>
            <span aria-hidden="true">x</span>
            <label><span className="lbl">Height</span><input aria-label={`Height of piece ${i + 1}`} value={p.h} maxLength={24} onChange={(e) => pieceChange(p.key, 'h', e.target.value)} placeholder="72" /></label>
          </div>
          <label className="remark"><span className="lbl">Remark</span><input aria-label={`Remark for piece ${i + 1}`} value={p.note || ''} maxLength={160} onChange={(e) => pieceChange(p.key, 'note', e.target.value)} placeholder="Where it goes, the fitting" /></label>
        </section>)}</div>
        <button className="key ghost add" disabled={draft.pieces.length >= 200} onClick={() => { const what = window.prompt('What extra piece needs measuring?'); if (what?.trim()) change({ ...draft, pieces: [...draft.pieces, { key: `site-${crypto.randomUUID()}`, what: what.trim().slice(0, 160), w: '', h: '', note: '' }] }) }}><Plus /> Add a piece from site</button>
        <label className="notes"><span className="lbl">Visit notes</span><textarea value={draft.notes} maxLength={600} onChange={(e) => change({ ...draft, notes: e.target.value })} placeholder="Anything the shop should know" rows={3} /></label>
      </fieldset>
      <small className="sentby">Sent by {name || 'choose your name'}{order.measuredAt ? ' · Already measured' : ''}</small>
    </main>
    <div className="dock">
      {status && <p className="status" role="status">{status}</p>}
      {error && <p className="status bad" role="alert">{error}</p>}
      <div className="pair">
        <button className="key ghost" disabled={stopped} onClick={() => save(false)} aria-label="Send partial sizes">Send part</button>
        <button className="key safe" disabled={stopped} onClick={() => save(true)} aria-label="Finish measurement">{busy ? 'Sending' : <><Tick size={26} /> All measured</>}</button>
      </div>
    </div>
  </>
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'

/**
 * Shiv Accounts — the shop's accounts to read, and nothing to change.
 *
 * Made to be used like a chat app by someone who has never opened the panel:
 * two tabs (Customers, Suppliers), each a list like chats — a name, what is
 * owed either way, green for money to come and red for money to pay. Opening
 * one reads the account like a chat: every bill and payment a bubble, newest
 * at the bottom, with the bill's photos to tap open. What the shop sent sits
 * on the right, what the party sent on the left, and the account's lena hai /
 * dena hai stays in a box at the foot. No buttons that write.
 *
 * Live: every figure is a Convex subscription, so a bill saved at the counter
 * shows here within a second or two with the app left open — the light in the
 * header says the line is up, and a row whose figure has just moved is tinted
 * for a few seconds. In the shop's own colours (the attendance app's).
 */
const api = anyApi

// The last answer is kept on the phone, so it opens on figures at once and
// swaps in the live ones a moment later.
const read = (key) => { try { const raw = localStorage.getItem(`khata:${key}`); return raw ? JSON.parse(raw) : undefined } catch { return undefined } }
const write = (key, value) => { try { localStorage.setItem(`khata:${key}`, JSON.stringify(value)) } catch { /* phone storage full: it just opens cold */ } }
function useCached(fn, args, key) {
  const live = useQuery(fn, args)
  const [cached, setCached] = useState(() => read(key))
  useEffect(() => { setCached(read(key)) }, [key])
  useEffect(() => { if (live !== undefined) write(key, live) }, [live, key])
  return live !== undefined ? live : cached
}

const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`
const bare = (name) => String(name ?? '').replace(/^m\/s\.?\s+/i, '').trim()

/** The light that says the figures on screen are the live ones. */
function LiveLight() {
  const convex = useConvex()
  const [on, setOn] = useState(() => convex.connectionState().isWebSocketConnected)
  useEffect(() => {
    const timer = setInterval(() => setOn(convex.connectionState().isWebSocketConnected), 1500)
    return () => clearInterval(timer)
  }, [convex])
  return <span className={`live ${on ? 'on' : ''}`} role="status"><i />{on ? 'Live' : 'Connecting'}</span>
}
const dayOf = (ms) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
/** Dr / Cr in words a customer's or supplier's account is read in. */
const sideWord = (side, tab) => (tab === 'customers'
  ? (side === 'Dr' ? 'to come' : 'advance')
  : (side === 'Cr' ? 'to pay' : 'advance'))
const isPdf = (a) => /pdf/i.test(a?.contentType ?? '')
/** A line's voucher in the words of who sent what; the bubble's side says who. */
const SENT = { Sale: 'Bill sent', Purchase: 'Bill received', Receipt: 'Payment sent', Payment: 'Payment sent' }
// The money taken with a sale or purchase is a payment, not the bill again.
const kindOf = (r) => (r.settlement ? 'Payment sent' : SENT[r.vchType] ?? r.vchType)

export default function App() {
  const [tab, setTab] = useState(() => read('tab') ?? 'customers')
  const [open, setOpen] = useState(null)
  useEffect(() => { write('tab', tab) }, [tab])
  // The phone's Back closes an account, as it closes a chat.
  useEffect(() => {
    const onPop = () => setOpen(null)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const openParty = (party) => { window.history.pushState({ party: party.id }, ''); setOpen(party) }
  return open
    ? <Party party={open} onBack={() => window.history.back()} />
    : <Lists tab={tab} setTab={setTab} onOpen={openParty} />
}

const SORTS = [
  { id: 'amount', label: 'Amount' },
  { id: 'recent', label: 'Recent' },
  { id: 'name', label: 'Name A-Z' },
]
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'lena', label: 'Lena hai', test: (r) => r.closing >= 0.5 && r.closingSide === 'Dr' },
  { id: 'dena', label: 'Dena hai', test: (r) => r.closing >= 0.5 && r.closingSide === 'Cr' },
  { id: 'unpriced', label: 'Without amount', test: (r) => r.pendingCount > 0 },
  { id: 'settled', label: 'Settled', test: (r) => r.closing < 0.5 && !r.pendingCount },
]
const SortIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" /></svg>
)
const FilterIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" /></svg>
)

function Lists({ tab, setTab, onOpen }) {
  const customers = useCached(api.reports.receivables, {}, 'receivables')
  const suppliers = useCached(api.reports.outstanding, {}, 'payables')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(() => read('sort') ?? 'amount')
  const [filter, setFilter] = useState(() => read('filter') ?? 'all')
  const [panel, setPanel] = useState(null)
  useEffect(() => { write('sort', sort) }, [sort])
  useEffect(() => { write('filter', filter) }, [filter])
  const book = tab === 'customers' ? customers : suppliers
  const rows = useMemo(() => {
    const test = FILTERS.find((f) => f.id === filter)?.test
    const list = (book?.rows ?? [])
      .filter((r) => r.ledger && (!q || bare(r.ledger.name).toLowerCase().includes(q.trim().toLowerCase())))
      .filter((r) => !test || test(r))
    // Amount is the order the books send: open accounts first, the largest at the top.
    if (sort === 'recent') return [...list].sort((a, b) => (b.lastDate ?? 0) - (a.lastDate ?? 0))
    if (sort === 'name') return [...list].sort((a, b) => bare(a.ledger.name).localeCompare(bare(b.ledger.name)))
    return list
  }, [book, q, sort, filter])
  const pick = (options, value, set) => (
    <div className="chips">
      {options.map((o) => (
        <button key={o.id} type="button" className={value === o.id ? 'on' : ''} onClick={() => { set(o.id); setPanel(null) }}>{o.label}</button>
      ))}
    </div>
  )

  // Two plain figures, not one net: some owe, some have paid ahead, and the
  // net of the two hides both.
  const all = book?.rows ?? []
  const sumOf = (side) => all.filter((r) => r.closingSide === side).reduce((t, r) => t + (Number(r.closing) || 0), 0)
  const dr = sumOf('Dr')
  const cr = sumOf('Cr')

  // A figure that moves while the list is open is tinted for a few seconds,
  // so a change is seen rather than silently swapped in.
  const seen = useRef(new Map())
  const [changed, setChanged] = useState(() => new Set())
  useEffect(() => {
    const moved = new Set()
    for (const r of book?.rows ?? []) {
      const id = r.ledger?._id
      const figure = `${r.closingSide}:${Math.round(Number(r.closing) || 0)}`
      if (seen.current.has(id) && seen.current.get(id) !== figure) moved.add(id)
      seen.current.set(id, figure)
    }
    if (!moved.size) return undefined
    setChanged(moved)
    const timer = setTimeout(() => setChanged(new Set()), 4000)
    return () => clearTimeout(timer)
  }, [book])

  return (
    <div className="app">
      <header className="top">
        <div className="brandrow">
          <img src="/icon-192.png" alt="" />
          <div>
            <div className="brand">Shiv Accounts</div>
          </div>
          <LiveLight />
        </div>
        <nav className="tabs">
          <button className={tab === 'customers' ? 'on' : ''} onClick={() => setTab('customers')}>Customers</button>
          <button className={tab === 'suppliers' ? 'on' : ''} onClick={() => setTab('suppliers')}>Suppliers</button>
        </nav>
      </header>
      <div className="summary">
        {!book ? 'Loading…' : tab === 'customers' ? (
          <>
            <span className="in"><small>To come</small>{rupees(dr)}</span>
            <span><small>Advances held</small>{rupees(cr)}</span>
          </>
        ) : (
          <>
            <span className="out"><small>To pay</small>{rupees(cr)}</span>
            <span><small>Advances given</small>{rupees(dr)}</span>
          </>
        )}
      </div>
      <div className="searchbar">
        <input type="search" placeholder="Search a name" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className={`tool ${panel === 'sort' ? 'open' : ''} ${sort !== 'amount' ? 'set' : ''}`} aria-label="Sort" onClick={() => setPanel(panel === 'sort' ? null : 'sort')}><SortIcon /></button>
        <button type="button" className={`tool ${panel === 'filter' ? 'open' : ''} ${filter !== 'all' ? 'set' : ''}`} aria-label="Filter" onClick={() => setPanel(panel === 'filter' ? null : 'filter')}><FilterIcon /></button>
      </div>
      {panel === 'sort' && pick(SORTS, sort, setSort)}
      {panel === 'filter' && pick(FILTERS, filter, setFilter)}
      <ul className="chats">
        {rows.map((r) => {
          const name = bare(r.ledger.name)
          const zero = r.closing < 0.5
          const toCome = r.closingSide === 'Dr'
          const what = zero ? 'Settled'
            : tab === 'customers' ? (toCome ? 'Owes us' : 'Advance with us')
            : (toCome ? 'Advance given, owes us' : 'We owe')
          return (
            <li key={r.ledger._id} className={changed.has(r.ledger._id) ? 'changed' : undefined}>
              <button type="button" onClick={() => onOpen({ id: r.ledger._id, name, phone: r.ledger.phone ?? '', tab })}>
                <span className="avatar">{name[0]?.toUpperCase() ?? '?'}</span>
                <span className="who">
                  <b>{name}</b>
                  <small>{what}{r.pendingCount ? ` · ${r.pendingCount} bill${r.pendingCount === 1 ? '' : 's'} without amount` : ''}</small>
                </span>
                <span className={`amt ${zero ? '' : toCome ? 'in' : 'out'}`}>{zero ? '—' : rupees(r.closing)}</span>
              </button>
            </li>
          )
        })}
        {book && !rows.length && <li className="empty">{q ? 'No name like that.' : filter !== 'all' ? 'Nobody in this filter.' : 'Nobody here yet.'}</li>}
      </ul>
    </div>
  )
}

function Party({ party, onBack }) {
  const data = useCached(api.reports.ledger, { ledgerId: party.id }, `ledger:${party.id}`)
  const [photo, setPhoto] = useState(null)
  const end = useRef(null)
  // Like a chat: opens at the newest.
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [data?.rows?.length])

  // Our side on the right, as in a chat: a bill the shop sent a customer and a
  // payment the shop made a supplier are both Dr on the party's account. Their
  // payments to us and their bills to us (Cr) sit on the left.
  const ours = 'Dr'
  const pendingOurs = party.tab === 'customers'
  const items = useMemo(() => {
    const list = [
      ...(data?.rows ?? []).map((r) => ({ key: `${r.voucherId}-${r.side}-${r.date}`, date: r.date, r })),
      ...(data?.pending ?? []).map((p) => ({ key: `p-${p._id}`, date: p.date, p })),
    ].sort((a, b) => a.date - b.date)
    const out = []
    let lastDay = ''
    for (const it of list) {
      const day = dayOf(it.date)
      if (day !== lastDay) { out.push({ key: `d-${day}`, day }); lastDay = day }
      out.push(it)
    }
    return out
  }, [data])

  const closing = data ? (data.closing < 0.5 ? 'Settled' : `${rupees(data.closing)} ${party.tab === 'customers'
    ? (data.closingSide === 'Dr' ? 'owes us' : 'advance with us')
    : (data.closingSide === 'Cr' ? 'we owe' : 'owes us')}`) : 'Loading…'

  return (
    <div className="app chat">
      <header className="top chathead">
        <button type="button" className="back" onClick={onBack} aria-label="Back">‹</button>
        <span className="avatar small">{party.name[0]?.toUpperCase() ?? '?'}</span>
        <span className="who">
          <b>{party.name}</b>
          <small>{closing}</small>
        </span>
        {party.phone && (
          <a className="call" href={`tel:${party.phone}`} aria-label={`Call ${party.name}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
            </svg>
          </a>
        )}
      </header>
      <main className="thread">
        {data && !items.length && <p className="note">No bills or payments yet.</p>}
        {items.map((it) => {
          if (it.day) return <div key={it.key} className="daytag"><span>{it.day}</span></div>
          if (it.p) {
            const shots = (it.p.attachmentUrls ?? []).filter((a) => a.url)
            return (
              <div key={it.key} className={`bubble ${pendingOurs ? 'right' : 'left'} pending`}>
                <div className="kind">{SENT[it.p.vchType] ?? 'Bill'} · {it.p.vchLabel ?? ''} · amount not entered yet</div>
                <Photos shots={shots} onOpen={setPhoto} />
              </div>
            )
          }
          const r = it.r
          const right = r.side === ours
          const shots = (r.attachmentUrls ?? []).filter((a) => a.url)
          return (
            <div key={it.key} className={`bubble ${right ? 'right' : 'left'}`}>
              <div className="kind">{kindOf(r)} · {r.vchLabel}{r.refNo ? ` · ${r.refNo}` : ''}</div>
              <div className="money">{rupees(r.amount)}</div>
              {r.narration && <div className="narr">{r.narration}</div>}
              <Photos shots={shots} onOpen={setPhoto} />
              <div className="bal">Balance {rupees(r.balance < 0 ? -r.balance : r.balance)} {sideWord(r.balanceSide, party.tab)}</div>
            </div>
          )
        })}
        <div ref={end} />
      </main>
      {data && (
        <footer className={`due ${data.closing < 0.5 ? '' : data.closingSide === 'Dr' ? 'in' : 'out'}`}>
          <small>{data.closing < 0.5 ? 'Settled' : data.closingSide === 'Dr' ? 'Lena hai' : 'Dena hai'}</small>
          <b>{data.closing < 0.5 ? rupees(0) : rupees(data.closing)}</b>
          {data.pendingCount > 0 && <span>+ {data.pendingCount} bill{data.pendingCount === 1 ? '' : 's'} without amount</span>}
        </footer>
      )}
      {photo && (
        <div className="viewer" onClick={() => setPhoto(null)}>
          <button type="button" className="close" aria-label="Close">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <img src={photo} alt="Bill" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}

function Photos({ shots, onOpen }) {
  if (!shots.length) return null
  return (
    <div className="photos">
      {shots.map((a) => isPdf(a)
        ? <a key={a.storageId} className="pdf" href={a.url} target="_blank" rel="noreferrer">PDF</a>
        : <button key={a.storageId} type="button" onClick={() => onOpen(a.url)}><img src={a.previewUrl || a.url} alt="Bill photo" loading="lazy" /></button>)}
    </div>
  )
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'
import { SCREEN, THUMB, saveEverything, saveLedger, savedLedger, sized } from './offline.js'

/**
 * Shiv Accounts — the shop's accounts to read, and nothing to change.
 *
 * Made to be used like a chat app by someone who has never opened the panel:
 * two tabs (Customers, Suppliers), each a list like chats — a name, what is
 * owed either way (to get in green, to pay in red). Opening
 * one reads the account like a chat: every bill and payment a bubble, newest
 * at the bottom, with the bill's photos to tap open. What the shop sent sits
 * on the right, what the party sent on the left, and what the account comes
 * to (to get / to pay) stays in a box at the foot. Two things go out from
 * here: a bill's photos to the shop's printer, when asked and confirmed, and
 * a bill or payment added from inside an account with the + key (AddEntry),
 * posted the way the panel's voucher form posts it.
 *
 * Live: every figure is a Convex subscription, so a bill saved at the counter
 * shows here within a second or two with the app left open — the light in the
 * header says the line is up, and a row whose figure has just moved is tinted
 * for a few seconds. In the shop's own colours (the attendance app's).
 *
 * Kept on the phone: each time it opens, every account and every bill photo
 * is saved to the phone in the background (src/offline.js), so an account
 * opens at once from there, the live figures replacing it a moment later.
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

/** An account's page: the copy kept on the phone at once, then the live one, which is kept in turn. */
function useLedger(id) {
  const live = useQuery(api.reports.ledger, { ledgerId: id })
  const [kept, setKept] = useState(undefined)
  useEffect(() => {
    let current = true
    setKept(undefined)
    void savedLedger(id).then((rec) => { if (current) setKept(rec?.data) })
    return () => { current = false }
  }, [id])
  useEffect(() => { if (live !== undefined && live !== null) void saveLedger(id, live) }, [live, id])
  return live !== undefined ? live : kept
}

// Accounts were first kept in localStorage, which a few hundred of them
// overfill; they are in IndexedDB now (offline.js), and the old copies go.
try {
  for (const key of Object.keys(localStorage)) if (key.startsWith('khata:ledger:')) localStorage.removeItem(key)
} catch { /* nothing kept */ }

/**
 * Saves every account and bill photo to the phone, in the background, each
 * time the lists arrive or change. Returns how far it has got, for the list
 * to say: { step, done, total } (see saveEverything).
 */
function useSaveToPhone() {
  const convex = useConvex()
  const customers = useQuery(api.reports.receivables, {})
  const suppliers = useQuery(api.reports.outstanding, {})
  const [progress, setProgress] = useState(null)
  const state = useRef({ running: false, again: false, rows: [], runs: 0 })
  useEffect(() => {
    if (!customers || !suppliers) return
    const s = state.current
    s.rows = [...customers.rows, ...suppliers.rows]
    // One run at a time: a list that changes mid-run starts another after it.
    if (s.running) { s.again = true; return }
    s.running = true
    void (async () => {
      do {
        s.again = false
        try {
          await saveEverything({
            rows: s.rows,
            fetchLedger: (ledgerId) => convex.query(api.reports.ledger, { ledgerId }),
            onProgress: setProgress,
            // Only the first look says "all saved"; a later one that finds nothing new says nothing.
            announce: s.runs++ === 0,
          })
        } catch { /* a phone that keeps nothing still reads everything live */ }
      } while (s.again)
      s.running = false
    })()
  }, [customers, suppliers, convex])
  return progress
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
/** Dr / Cr in plain words: Dr on a party is money we get, Cr money we pay. */
const sideWord = (side) => (side === 'Dr' ? 'to get' : 'to pay')
const SETTLED = 'All clear'
const isPdf = (a) => /pdf/i.test(a?.contentType ?? '')

/**
 * A photo brought down to the size it is shown at.
 *
 * A bill's photo is 300-800 KB, and the thumbnail in a bubble used to fetch
 * all of it to fill a 56px square: an account with a dozen bills in view was
 * megabytes before anything showed. The site's own image service (vercel.json
 * "images") sends a few KB instead, and the phone keeps it (offline.js).
 * Where that is not to be had (a quota, a computer running this from the
 * repo) the photo itself is shown.
 */
function Shot({ url, width, ...rest }) {
  const [src, setSrc] = useState(() => sized(url, width))
  useEffect(() => { setSrc(sized(url, width)) }, [url, width])
  return <img src={src} onError={() => { if (src !== url) setSrc(url) }} {...rest} />
}

/** JPEG as it stands; anything else (a PNG screenshot) redrawn as one, on white. */
async function asJpeg(blob) {
  if (blob.type === 'image/jpeg') return blob
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()
  return await new Promise((done) => canvas.toBlob((made) => done(made ?? blob), 'image/jpeg', 0.92))
}
/** A line's voucher in the words of who sent what; the bubble's side says who. */
const SENT = { Sale: 'Bill sent', Purchase: 'Bill sent', Receipt: 'Payment sent', Payment: 'Payment sent' }
// The money taken with a sale or purchase is a payment, not the bill again.
const kindOf = (r) => (r.settlement ? 'Payment sent' : SENT[r.vchType] ?? r.vchType)
/** Where a delivery stands: still waiting for the supplier's bill, or billed. */
const grnStatus = (g) => {
  if (!g.open) return `Billed in ${g.billedLabel}`
  const days = Math.floor((Date.now() - g.date) / 86400000)
  return `Waiting for bill${days > 0 ? ` · ${days} day${days === 1 ? '' : 's'}` : ''}`
}

export default function App() {
  const [tab, setTab] = useState(() => read('tab') ?? 'customers')
  const [open, setOpen] = useState(null)
  const saving = useSaveToPhone()
  useEffect(() => { write('tab', tab) }, [tab])
  // The phone's Back closes an account, as it closes a chat. A photo open
  // over the account is closed first (Party), and the account stays.
  useEffect(() => {
    const onPop = (e) => { if (!e.state?.party) setOpen(null) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const openParty = (party) => { window.history.pushState({ party: party.id }, ''); setOpen(party) }
  return open
    ? <Party party={open} onBack={() => window.history.back()} />
    : <Lists tab={tab} setTab={setTab} onOpen={openParty} saving={saving} />
}

/**
 * How far the saving to the phone has got: a line and a bar under the tabs.
 * The accounts are the quick part, so the bar gives them its first tenth and
 * the bill photos the rest.
 */
function Saving({ saving }) {
  if (!saving || saving.step === 'paused') return null
  const share = saving.total ? saving.done / saving.total : 1
  const [text, part] =
    saving.step === 'accounts' ? [`Saving accounts on this phone: ${saving.done} of ${saving.total}`, share * 0.1]
    : saving.step === 'photos' ? [`Saving bill photos on this phone: ${saving.done} of ${saving.total}`, 0.1 + share * 0.9]
    : ['All accounts and bills are saved on this phone', 1]
  const percent = Math.round(part * 100)
  return (
    <div className={`saving ${saving.step === 'done' ? 'ok' : ''}`} role="status">
      <div className="savetext"><span>{text}</span>{saving.step !== 'done' && <b>{percent}%</b>}</div>
      <div className="savebar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></div>
    </div>
  )
}

const SORTS = [
  { id: 'recent', label: 'Newest' },
  { id: 'amount', label: 'Amount' },
  { id: 'name', label: 'Name' },
]
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'lena', label: 'To get', test: (r) => r.closing >= 0.5 && r.closingSide === 'Dr' },
  { id: 'dena', label: 'To pay', test: (r) => r.closing >= 0.5 && r.closingSide === 'Cr' },
  { id: 'unpriced', label: 'No amount', test: (r) => r.pendingCount > 0 },
  { id: 'settled', label: SETTLED, test: (r) => r.closing < 0.5 && !r.pendingCount },
]
const SortIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" /></svg>
)
const FilterIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" /></svg>
)

function Lists({ tab, setTab, onOpen, saving }) {
  const customers = useCached(api.reports.receivables, {}, 'receivables')
  const suppliers = useCached(api.reports.outstanding, {}, 'payables')
  const [q, setQ] = useState('')
  // 'sortBy', not 'sort': the first version stored 'amount' on every phone
  // that opened it, without anyone having chosen it.
  const [sort, setSort] = useState(() => read('sortBy') ?? 'recent')
  const [filter, setFilter] = useState(() => read('filter') ?? 'all')
  const [panel, setPanel] = useState(null)
  const [profile, setProfile] = useState(null)
  useEffect(() => { write('sortBy', sort) }, [sort])
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
        <Saving saving={saving} />
      </header>
      <div className="summary">
        {!book ? 'Loading…' : tab === 'customers' ? (
          <>
            <span className="in"><small>To get</small>{rupees(dr)}</span>
            <span><small>Advance, to pay</small>{rupees(cr)}</span>
          </>
        ) : (
          <>
            <span className="out"><small>To pay</small>{rupees(cr)}</span>
            <span><small>Advance, to get</small>{rupees(dr)}</span>
          </>
        )}
      </div>
      <div className="searchbar">
        <input type="search" placeholder="Search name" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className={`tool ${panel === 'sort' ? 'open' : ''} ${sort !== 'recent' ? 'set' : ''}`} aria-label="Sort" onClick={() => setPanel(panel === 'sort' ? null : 'sort')}><SortIcon /></button>
        <button type="button" className={`tool ${panel === 'filter' ? 'open' : ''} ${filter !== 'all' ? 'set' : ''}`} aria-label="Filter" onClick={() => setPanel(panel === 'filter' ? null : 'filter')}><FilterIcon /></button>
      </div>
      {panel === 'sort' && pick(SORTS, sort, setSort)}
      {panel === 'filter' && pick(FILTERS, filter, setFilter)}
      <ul className="chats">
        {rows.map((r) => {
          const name = bare(r.ledger.name)
          const zero = r.closing < 0.5
          const toCome = r.closingSide === 'Dr'
          const what = zero ? SETTLED
            : tab === 'customers' ? (toCome ? 'To get' : 'Advance, to pay')
            : (toCome ? 'Advance, to get' : 'To pay')
          const party = { id: r.ledger._id, name, phone: r.ledger.phone ?? '', tab }
          return (
            <li key={r.ledger._id} className={changed.has(r.ledger._id) ? 'changed' : undefined}>
              {/* The round letter is its own button: the whole name, which the row cuts short. */}
              <button type="button" className="face" aria-label={`${name}: full name`}
                onClick={() => setProfile({ party, what, amount: zero ? '' : rupees(r.closing), tone: zero ? '' : toCome ? 'in' : 'out' })}>
                <span className="avatar">{name[0]?.toUpperCase() ?? '?'}</span>
              </button>
              <button type="button" className="row" onClick={() => onOpen(party)}>
                <span className="who">
                  <b>{name}</b>
                  <small>{what}{r.pendingCount ? ` · ${r.pendingCount} bill${r.pendingCount === 1 ? '' : 's'} with no amount` : ''}</small>
                </span>
                <span className={`amt ${zero ? '' : toCome ? 'in' : 'out'}`}>{zero ? '—' : rupees(r.closing)}</span>
              </button>
            </li>
          )
        })}
        {book && !rows.length && <li className="empty">{q ? 'No one by that name.' : filter !== 'all' ? 'No one here.' : 'No one yet.'}</li>}
      </ul>
      {profile && <Profile {...profile} onClose={() => setProfile(null)} onOpen={() => { setProfile(null); onOpen(profile.party) }} />}
    </div>
  )
}

/** Who this is, in full: the name the list and the chat's header cut short. */
function Profile({ party, what, amount, tone, onClose, onOpen }) {
  return (
    <div className="sheetback" onClick={onClose}>
      <div className="sheet profile" role="dialog" aria-modal="true" aria-label={party.name} onClick={(e) => e.stopPropagation()}>
        <span className="avatar big">{party.name[0]?.toUpperCase() ?? '?'}</span>
        <b className="fullname">{party.name}</b>
        {party.phone && <a className="phone" href={`tel:${party.phone}`}>{party.phone}</a>}
        {what && <div className={`standing ${tone}`}><small>{what}</small>{amount && <b>{amount}</b>}</div>}
        <div className="sheetbtns">
          <button type="button" className="ghost" onClick={onClose}>Close</button>
          {onOpen && <button type="button" className="solid" onClick={onOpen}>Open account</button>}
        </div>
      </div>
    </div>
  )
}

function Party({ party, onBack }) {
  const data = useLedger(party.id)
  const [viewer, setViewer] = useState(null)
  const [profile, setProfile] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [adding, setAdding] = useState(false)
  const end = useRef(null)
  const thread = useRef(null)
  useEffect(() => {
    const onPop = (e) => { if (!e.state?.photo) setViewer(null) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
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
      // Goods the supplier delivered (GRNs): no amount, so no balance; the
      // open ones are waiting for the supplier's bill.
      ...(data?.received ?? []).map((g) => ({ key: `g-${g._id}`, date: g.date, g })),
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

  // Every bill in the account with photos, oldest first as in the thread, the
  // shop's and the party's alike: the viewer swipes on from one into the next.
  // A sale and the money taken with it are one voucher with the same photos,
  // so a voucher is in here once, as its bill.
  const bills = useMemo(() => {
    const out = []
    const at = new Map()
    for (const it of items) {
      if (it.day) continue
      const v = it.r ?? it.p ?? it.g
      const shots = (v.attachmentUrls ?? []).filter((a) => a.url && !isPdf(a))
      if (!shots.length) continue
      const id = it.r ? v.voucherId : v._id
      const label = `${v.vchLabel ?? 'Bill'}${v.refNo ? ` ${v.refNo}` : ''}`
      const bill = {
        key: it.key,
        shots,
        label: `${label} ${party.name}`,
        title: it.r ? `${kindOf(v)} · ${label}` : it.g ? `Goods received · ${label}` : `${SENT[v.vchType] ?? 'Bill'} · ${label}`,
        who: it.g ? party.name : (it.r ? v.side === ours : pendingOurs) ? 'Shop' : party.name,
        date: it.date,
        amount: it.r ? rupees(v.amount) : it.g ? grnStatus(v) : 'Amount not added yet',
      }
      if (!at.has(id)) { at.set(id, out.length); out.push(bill) }
      else if (it.r && !v.settlement) out[at.get(id)] = bill
    }
    return out
  }, [items, party.name, pendingOurs])
  const keyOf = useMemo(() => {
    const m = new Map()
    for (const it of items) {
      const v = it.r ?? it.p ?? it.g
      if (v) m.set(it.key, it.r ? v.voucherId : v._id)
    }
    return m
  }, [items])

  // A bill's photos open over the account; the phone's Back closes them. The
  // viewer holds the bills as they were when it opened, so a bill saved at the
  // counter meanwhile does not move the pages under a finger.
  const openPhotos = (key, page) => {
    const id = keyOf.get(key)
    const bill = bills.findIndex((b) => keyOf.get(b.key) === id)
    if (bill < 0) return
    window.history.pushState({ party: party.id, photo: true }, '')
    setViewer({ bills, bill, page, opened: Date.now() })
  }
  // The thread behind follows the viewer, so Back lands on the bill last seen.
  const showBubble = (key) => {
    const el = thread.current?.querySelector(`[data-key="${CSS.escape(key)}"]`)
    el?.scrollIntoView({ block: 'center' })
  }

  const closing = data ? (data.closing < 0.5 ? SETTLED : `${rupees(data.closing)} ${sideWord(data.closingSide)}`) : 'Loading…'

  return (
    <div className="app chat">
      <header className="top chathead">
        <button type="button" className="back" onClick={onBack} aria-label="Back">‹</button>
        <button type="button" className="face" aria-label={`${party.name}: full name`} onClick={() => setProfile(true)}>
          <span className="avatar small">{party.name[0]?.toUpperCase() ?? '?'}</span>
        </button>
        <span className="who">
          <b>{party.name}</b>
          <small>{closing}</small>
        </span>
        <button type="button" className="call add" onClick={() => setAdding(true)} aria-label={`Add a bill or payment for ${party.name}`}><PlusIcon /></button>
        {bills.length > 0 && (
          <button type="button" className="call" onClick={() => setSharing(true)} aria-label="Share all bills"><ShareIcon /></button>
        )}
        {party.phone && (
          <a className="call" href={`tel:${party.phone}`} aria-label={`Call ${party.name}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
            </svg>
          </a>
        )}
      </header>
      <main className="thread" ref={thread}>
        {data && !items.length && <p className="note">No bills or payments yet.</p>}
        {items.map((it) => {
          if (it.day) return <div key={it.key} className="daytag"><span>{it.day}</span></div>
          if (it.p) {
            const shots = (it.p.attachmentUrls ?? []).filter((a) => a.url)
            return (
              <div key={it.key} data-key={it.key} className={`bubble ${pendingOurs ? 'right' : 'left'} pending`}>
                <div className="kind">{SENT[it.p.vchType] ?? 'Bill'} · {it.p.vchLabel ?? ''} · amount not added yet</div>
                <Photos shots={shots} onOpen={(page) => openPhotos(it.key, page)} />
              </div>
            )
          }
          if (it.g) {
            const g = it.g
            const shots = (g.attachmentUrls ?? []).filter((a) => a.url)
            return (
              <div key={it.key} data-key={it.key} className={`bubble left grn${g.open ? ' pending' : ''}`}>
                <div className="kind">Goods received · {g.vchLabel}{g.refNo ? ` · ${g.refNo}` : ''}</div>
                <div className="line"><span className="grnstate">{grnStatus(g)}</span></div>
                {g.receivedBy && <div className="narr">Checked by {g.receivedBy}</div>}
                {g.narration && <div className="narr">{g.narration}</div>}
                <Photos shots={shots} onOpen={(page) => openPhotos(it.key, page)} />
              </div>
            )
          }
          const r = it.r
          const right = r.side === ours
          const shots = (r.attachmentUrls ?? []).filter((a) => a.url)
          return (
            <div key={it.key} data-key={it.key} className={`bubble ${right ? 'right' : 'left'}`}>
              <div className="kind">{kindOf(r)} · {r.vchLabel}{r.refNo ? ` · ${r.refNo}` : ''}</div>
              <div className="line">
                <span className="money">{rupees(r.amount)}</span>
                <span className="bal">Balance {rupees(r.balance < 0 ? -r.balance : r.balance)} {sideWord(r.balanceSide)}</span>
              </div>
              {r.narration && <div className="narr">{r.narration}</div>}
              {r.whatsappAt && (
                <div className="wa">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12.5l4.5 4.5L15 8.5M10 16l1 1 9.5-9.5" /></svg>
                  Sent on WhatsApp
                </div>
              )}
              <Photos shots={shots} onOpen={(page) => openPhotos(it.key, page)} />
            </div>
          )
        })}
        <div ref={end} />
      </main>
      {data && (
        <footer className={`due ${data.closing < 0.5 ? '' : data.closingSide === 'Dr' ? 'in' : 'out'}`}>
          <small>{data.closing < 0.5 ? SETTLED : data.closingSide === 'Dr' ? 'To get' : 'To pay'}</small>
          <b>{data.closing < 0.5 ? rupees(0) : rupees(data.closing)}</b>
          {data.pendingCount > 0 && <span>+ {data.pendingCount} bill{data.pendingCount === 1 ? '' : 's'} with no amount</span>}
          {(() => {
            const waiting = (data.received ?? []).filter((g) => g.open).length
            return waiting > 0 && <span>{waiting} deliver{waiting === 1 ? 'y' : 'ies'} waiting for a bill</span>
          })()}
        </footer>
      )}
      {sharing && <ShareAll party={party} bills={bills} onClose={() => setSharing(false)} />}
      {adding && <AddEntry party={party} onClose={() => setAdding(false)} />}
      {viewer && <Viewer key={viewer.opened} bills={viewer.bills} bill={viewer.bill} page={viewer.page} onBill={showBubble} onClose={() => window.history.back()} />}
      {profile && (
        <Profile
          party={party}
          what={data ? (data.closing < 0.5 ? SETTLED : data.closingSide === 'Dr' ? 'To get' : 'To pay') : ''}
          amount={data && data.closing >= 0.5 ? rupees(data.closing) : ''}
          tone={!data || data.closing < 0.5 ? '' : data.closingSide === 'Dr' ? 'in' : 'out'}
          onClose={() => setProfile(false)}
        />
      )}
    </div>
  )
}

function Photos({ shots, onOpen }) {
  if (!shots.length) return null
  // The viewer turns through a bill's photos; a PDF opens on its own.
  const pages = shots.filter((a) => !isPdf(a))
  return (
    <div className="photos">
      {shots.map((a) => isPdf(a)
        ? <a key={a.storageId} className="pdf" href={a.url} target="_blank" rel="noreferrer">PDF</a>
        : <button key={a.storageId} type="button" onClick={() => onOpen(pages.indexOf(a))}><Shot url={a.url} width={THUMB} alt="Bill photo" loading="lazy" decoding="async" /></button>)}
    </div>
  )
}

const PlusIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
)
const CloseIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
)
const ShareIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>
)
const PrintIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /></svg>
)

/**
 * An account's bill photos, full screen: swipe (or the arrow keys) to turn the
 * pages, and on past a bill's last page into the next bill, the shop's and the
 * party's alike, oldest to newest as in the thread. The bar names the bill in
 * view; Share and Print are that bill's.
 *
 * Each page shows at once from a screen-sized copy, and the photo itself is
 * fetched behind it, once, for the bill in view and the one either side: that
 * copy is what sharpens the page for zooming, what Share hands on (every page,
 * as JPG, in the bill's order) and what Print sends to the shop. Only the
 * pages near the one in view are drawn, so a long account opens as fast as a
 * short one.
 */
function Viewer({ bills, bill: startBill, page: startPage, onBill, onClose }) {
  const convex = useConvex()
  const strip = useRef(null)
  const slides = useMemo(() => bills.flatMap((b, bi) => b.shots.map((shot, pi) => ({ shot, bi, pi, key: `${b.key}:${shot.storageId}` }))), [bills])
  const start = slides.findIndex((s) => s.bi === startBill && s.pi === startPage)
  const [at, setAt] = useState(Math.max(0, start))
  const [full, setFull] = useState({})
  const fetching = useRef(new Set())
  const made = useRef([])
  const [note, setNote] = useState('')
  const [asking, setAsking] = useState(false)
  const [sending, setSending] = useState(false)
  const [job, setJob] = useState(null)

  const here = slides[at] ?? slides[0]
  const billAt = here?.bi ?? 0
  const current = bills[billAt]
  const shots = current?.shots ?? []

  useEffect(() => {
    let closed = false
    for (const b of [bills[billAt], bills[billAt + 1], bills[billAt - 1]]) {
      for (const shot of b?.shots ?? []) {
        if (fetching.current.has(shot.storageId)) continue
        fetching.current.add(shot.storageId)
        void (async () => {
          try {
            const res = await fetch(shot.url)
            if (!res.ok) throw new Error('fetch')
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            made.current.push(url)
            if (!closed) setFull((have) => ({ ...have, [shot.storageId]: { blob, url } }))
          } catch {
            // The screen-sized copy stays; coming back to the bill tries again.
            fetching.current.delete(shot.storageId)
          }
        })()
      }
    }
    return () => { closed = true }
  }, [bills, billAt])
  useEffect(() => () => { for (const url of made.current) URL.revokeObjectURL(url) }, [])

  // A new bill in view: the account behind follows it, and the last bill's
  // share or print message goes.
  const shown = useRef(billAt)
  useEffect(() => {
    if (shown.current === billAt) return
    shown.current = billAt
    if (current) onBill?.(current.key)
    setNote('')
    if (!sending) setJob(null)
  }, [billAt]) // eslint-disable-line react-hooks/exhaustive-deps

  // Opens on the page that was tapped.
  useLayoutEffect(() => {
    const el = strip.current
    if (el) el.scrollLeft = Math.max(0, start) * el.clientWidth
  }, [start])

  const turn = (by) => {
    const el = strip.current
    if (el) el.scrollTo({ left: Math.min(slides.length - 1, Math.max(0, at + by)) * el.clientWidth, behavior: 'smooth' })
  }
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') turn(1)
      else if (e.key === 'ArrowLeft') turn(-1)
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const ready = shots.length > 0 && shots.every((s) => full[s.storageId])
  const base = (current?.label ?? '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Bill'
  const nameOf = (i) => (shots.length > 1 ? `${base} page ${i + 1}.jpg` : `${base}.jpg`)
  const pages = `${shots.length} ${shots.length === 1 ? 'page' : 'pages'}`
  /** Every page of the bill in view as a JPG, named in the bill's order. */
  const jpegs = () => Promise.all(shots.map(async (s, i) => new File([await asJpeg(full[s.storageId].blob)], nameOf(i), { type: 'image/jpeg' })))

  const share = async () => {
    setNote('')
    try {
      const files = await jpegs()
      if (navigator.canShare?.({ files })) {
        await navigator.share({ files, title: base })
        return
      }
      // No share sheet here (a computer): the pages are saved instead, in order.
      for (const file of files) {
        const link = document.createElement('a')
        link.href = URL.createObjectURL(file)
        link.download = file.name
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(link.href), 1000)
      }
      setNote(`Saved ${pages} to this device.`)
    } catch (err) {
      if (err?.name !== 'AbortError') setNote('Could not share. Try again.')
    }
  }

  /**
   * To the shop's printer, the way Shiv Print sends a file: a copy of each
   * page goes up for the job (the print server deletes a job's files once
   * printed, so never the bill's own photo) and the shop PC prints them.
   */
  const print = async () => {
    setAsking(false)
    setSending(true)
    setNote('')
    setJob(null)
    try {
      const files = await Promise.all((await jpegs()).map(async (file) => {
        const url = await convex.mutation(api.files.generateUploadUrl, {})
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type }, body: file })
        if (!res.ok) throw new Error('upload')
        const { storageId } = await res.json()
        return { storageId, name: file.name, mediaType: file.type }
      }))
      setJob(await convex.mutation(api.printJobs.sendFiles, { files, mode: 'bw', copies: 1 }))
    } catch {
      setNote('Could not send to the printer. Try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={base}>
      <div className="vbar">
        <button type="button" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        <span className="count">{shots.length > 1 ? `Page ${here.pi + 1} of ${shots.length}` : ''}</span>
        <button type="button" className="text" onClick={share} disabled={!ready}><ShareIcon /> Share</button>
        <button type="button" className="text" onClick={() => setAsking(true)} disabled={!ready || sending}><PrintIcon /> Print</button>
      </div>
      {current && (
        <div className={`vbill ${current.who === 'Shop' ? 'shop' : ''}`}>
          <div className="vtitle"><b>{current.title}</b><span>{billAt + 1} of {bills.length}</span></div>
          <div className="vmeta"><span className="vwho">{current.who}</span><span>{dayOf(current.date)}</span><b>{current.amount}</b></div>
        </div>
      )}
      <div className="vstrip" ref={strip}
        onScroll={(e) => setAt(Math.min(slides.length - 1, Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth))))}>
        {slides.map((sl, i) => (
          <div key={sl.key} className="vslide" onClick={onClose}>
            {Math.abs(i - at) > 2 ? null
              : full[sl.shot.storageId]
                ? <img src={full[sl.shot.storageId].url} alt={`Bill, page ${sl.pi + 1}`} onClick={(e) => e.stopPropagation()} />
                : <Shot url={sl.shot.url} width={SCREEN} alt={`Bill, page ${sl.pi + 1}`} onClick={(e) => e.stopPropagation()} />}
          </div>
        ))}
      </div>
      {shots.length > 1 && (
        <div className="vdots" aria-hidden="true">{shots.map((s, i) => <i key={s.storageId} className={i === here.pi ? 'on' : ''} />)}</div>
      )}
      {(note || sending || job) && (
        <div className="vnote" role="status">
          {sending ? 'Sending to the shop printer' : job ? <PrintStatus id={job} /> : note}
        </div>
      )}
      {asking && (
        <div className="sheetback" onClick={() => setAsking(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Print this bill" onClick={(e) => e.stopPropagation()}>
            <b className="sheettitle">Print this bill at the shop?</b>
            <p>{base}<br />{pages}, black and white, on the shop printer.</p>
            <div className="sheetbtns">
              <button type="button" className="ghost" onClick={() => setAsking(false)}>Cancel</button>
              <button type="button" className="solid" onClick={print}>Print</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Every bill in an account, shared at once: each photo as a JPG, named so the
 * files fall in the account's order (number, date, bill), oldest first.
 *
 * The photos are fetched first, with how far it has got, and Share is a
 * second tap: a phone only opens its share sheet straight after a tap, and
 * fetching a long account takes longer than that allows.
 */
function ShareAll({ party, bills, onClose }) {
  const list = useMemo(() => {
    const width = String(bills.length).length
    const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    return bills.flatMap((b, bi) => b.shots.map((shot, pi) => {
      const name = `${String(bi + 1).padStart(width, '0')} ${ymd(b.date)} ${b.label}${b.shots.length > 1 ? ` page ${pi + 1}` : ''}`
      return { shot, name: `${name.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()}.jpg` }
    }))
  }, [bills])
  const got = useRef(new Map())
  const [done, setDone] = useState(0)
  const [failed, setFailed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const open = useRef(true)
  useEffect(() => () => { open.current = false }, [])

  const fetchAll = async () => {
    setBusy(true)
    setFailed(0)
    const left = list.filter((it) => !got.current.has(it.name))
    let missed = 0
    // A few at a time: quick on a good line, and no flood on a weak one.
    const next = async () => {
      for (let it = left.shift(); it && open.current; it = left.shift()) {
        try {
          const res = await fetch(it.shot.url)
          if (!res.ok) throw new Error('fetch')
          const file = new File([await asJpeg(await res.blob())], it.name, { type: 'image/jpeg' })
          got.current.set(it.name, file)
          if (open.current) setDone(got.current.size)
        } catch {
          missed++
        }
      }
    }
    await Promise.all([next(), next(), next(), next()])
    if (open.current) { setFailed(missed); setBusy(false) }
  }
  useEffect(() => { void fetchAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = done === list.length
  const share = async () => {
    setNote('')
    const files = list.map((it) => got.current.get(it.name))
    try {
      if (navigator.canShare?.({ files })) {
        await navigator.share({ files, title: party.name })
        onClose()
        return
      }
      // No share sheet here (a computer): the photos are saved instead, in order.
      for (const file of files) {
        const link = document.createElement('a')
        link.href = URL.createObjectURL(file)
        link.download = file.name
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(link.href), 1000)
      }
      setNote(`Saved ${files.length} photos to this device.`)
    } catch (err) {
      if (err?.name !== 'AbortError') setNote('Could not share. Try again.')
    }
  }

  const percent = list.length ? Math.round((done / list.length) * 100) : 100
  return (
    <div className="sheetback" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Share all bills" onClick={(e) => e.stopPropagation()}>
        <b className="sheettitle">Share all bills</b>
        <p>{party.name}<br />{bills.length} {bills.length === 1 ? 'bill' : 'bills'}, {list.length} {list.length === 1 ? 'photo' : 'photos'}, oldest first.</p>
        {!ready && (
          <div className="saving" role="status">
            <div className="savetext"><span>{failed && !busy ? `${failed} could not be got` : `Getting photos: ${done} of ${list.length}`}</span><b>{percent}%</b></div>
            <div className="savebar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{ width: `${percent}%` }} /></div>
          </div>
        )}
        {note && <p>{note}</p>}
        <div className="sheetbtns">
          <button type="button" className="ghost" onClick={onClose}>Close</button>
          {!ready && failed > 0 && !busy
            ? <button type="button" className="solid" onClick={() => void fetchAll()}>Try again</button>
            : <button type="button" className="solid" onClick={share} disabled={!ready}>Share</button>}
        </div>
      </div>
    </div>
  )
}

/** A sent print job, followed live until the shop PC prints it or says why not. */
function PrintStatus({ id }) {
  const live = useQuery(api.printJobs.getById, { id })
  const status = live?.status
  return status === 'printed' ? 'Printed at the shop'
    : status === 'failed' ? `Not printed: ${live.error || 'the printer refused it'}`
    : status === 'claimed' || status === 'printing' ? 'Printing at the shop'
    : 'Sent. Waiting for the shop PC'
}

/**
 * A bill or a payment for this account, added from the phone: what the
 * panel's voucher form writes, with the same ledgers on either side. A
 * customer's bill is a sale on credit and their payment a receipt; a
 * supplier's bill is a purchase and the shop's payment to them a payment.
 * A bill may go in with no amount (priced later at the counter, where it waits
 * as "amount not added yet"; a supplier's becomes a delivery waiting for its
 * bill); a payment needs one, and says whether it was cash or bank.
 */
const ENTRY = {
  customers: {
    bill: { label: 'Bill', fn: 'createSale', account: 'salesLedgerId', groups: ['Sales Accounts'], doc: 'bill', priced: false },
    pay: { label: 'Payment received', fn: 'createReceipt', account: 'receivedIntoLedgerId', groups: ['Cash-in-Hand', 'Bank Accounts'], doc: 'receipt', priced: true },
  },
  suppliers: {
    bill: { label: 'Bill', fn: 'createPurchase', account: 'purchaseLedgerId', groups: ['Purchase Accounts'], doc: 'bill', priced: false },
    pay: { label: 'Payment made', fn: 'createPayment', account: 'paidFromLedgerId', groups: ['Cash-in-Hand', 'Bank Accounts'], doc: 'receipt', priced: true },
  },
}
// The shop's day, not the phone's: vouchers are dated midnight UTC of India's date.
const indiaToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const asVoucherDate = (str) => { const [y, m, d] = str.split('-').map(Number); return Date.UTC(y, m - 1, d) }

function AddEntry({ party, onClose }) {
  const convex = useConvex()
  const masters = useQuery(api.masters.all, {})
  const kinds = ENTRY[party.tab] ?? ENTRY.customers
  const [which, setWhich] = useState('bill')
  const spec = kinds[which]
  const accounts = useMemo(
    () => (masters?.ledgers ?? []).filter((l) => spec.groups.includes(l.groupName)),
    [masters, spec]
  )
  const [accountId, setAccountId] = useState('')
  useEffect(() => {
    if (!accounts.some((a) => a._id === accountId)) setAccountId(accounts[0]?._id ?? '')
  }, [accounts, accountId])
  const [amount, setAmount] = useState('')
  const [refNo, setRefNo] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(indiaToday)
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const picker = useRef(null)
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])

  const save = async () => {
    setError('')
    const value = amount.trim() === '' ? undefined : Number(amount.replace(/,/g, ''))
    if (value !== undefined && !(value > 0)) return setError('Enter an amount above zero.')
    if (spec.priced && value === undefined) return setError('Enter the amount.')
    if (!accountId) return setError(masters ? 'No account to post this to. Add one in the panel.' : 'Still loading. Try again in a moment.')
    if (date > indiaToday()) return setError('That date has not come yet.')
    setBusy(true)
    try {
      const attachments = []
      for (const file of files) {
        const blob = file.type === 'application/pdf' ? file : await asJpeg(file)
        const url = await convex.mutation(api.files.generateUploadUrl, {})
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob })
        if (!res.ok) throw new Error('A photo did not upload. Try again.')
        const { storageId } = await res.json()
        attachments.push({ storageId, kind: spec.doc })
      }
      await convex.mutation(api.vouchers[spec.fn], {
        date: asVoucherDate(date),
        partyLedgerId: party.id,
        [spec.account]: accountId,
        amount: value,
        refNo: refNo.trim() || undefined,
        narration: note.trim() || undefined,
        attachments,
      })
      onClose()
    } catch (err) {
      setError(err?.data?.message ?? err?.message ?? 'Could not save. Try again.')
      setBusy(false)
    }
  }

  return (
    <div className="sheetback" onClick={busy ? undefined : onClose}>
      <div className="sheet addsheet" role="dialog" aria-modal="true" aria-label={`Add for ${party.name}`} onClick={(e) => e.stopPropagation()}>
        <b className="sheettitle">Add for {party.name}</b>
        <div className="addkinds" role="radiogroup" aria-label="What to add">
          {Object.entries(kinds).map(([id, k]) => (
            <button key={id} type="button" role="radio" aria-checked={which === id} className={which === id ? 'on' : ''} onClick={() => setWhich(id)}>{k.label}</button>
          ))}
        </div>
        <label className="addfield">
          <span>Amount</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={spec.priced ? '0' : 'Leave empty to add later'} />
        </label>
        {spec.priced && accounts.length > 1 && (
          <div className="addkinds small" role="radiogroup" aria-label="Paid how">
            {accounts.map((a) => (
              <button key={a._id} type="button" role="radio" aria-checked={accountId === a._id} className={accountId === a._id ? 'on' : ''} onClick={() => setAccountId(a._id)}>{a.name}</button>
            ))}
          </div>
        )}
        <div className="addrow">
          <label className="addfield">
            <span>Date</span>
            <input type="date" value={date} max={indiaToday()} onChange={(e) => setDate(e.target.value || indiaToday())} />
          </label>
          <label className="addfield">
            <span>{which === 'bill' ? 'Bill no.' : 'Ref no.'}</span>
            <input value={refNo} onChange={(e) => setRefNo(e.target.value)} />
          </label>
        </div>
        <label className="addfield">
          <span>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="addphotos">
          {previews.map((u, i) => (
            <button key={u} type="button" className="addthumb" aria-label={`Remove photo ${i + 1}`} onClick={() => setFiles(files.filter((_, n) => n !== i))}>
              {files[i].type === 'application/pdf' ? <span>PDF</span> : <img src={u} alt="" />}
              <i><CloseIcon /></i>
            </button>
          ))}
          <button type="button" className="addthumb new" onClick={() => picker.current?.click()} aria-label="Add a photo"><PlusIcon /><span>Photo</span></button>
          <input ref={picker} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = '' }} />
        </div>
        {error && <p className="adderror" role="alert">{error}</p>}
        <div className="sheetbtns">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="solid" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

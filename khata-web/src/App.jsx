import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { anyApi } from 'convex/server'

/**
 * Shiv Accounts — the shop's accounts to read, and nothing to change.
 *
 * Made to be used like a chat app by someone who has never opened the panel:
 * two tabs (Customers, Suppliers), each a list like chats — a name, what is
 * owed either way (to get in green, to pay in red). Opening
 * one reads the account like a chat: every bill and payment a bubble, newest
 * at the bottom, with the bill's photos to tap open. What the shop sent sits
 * on the right, what the party sent on the left, and what the account comes
 * to (to get / to pay) stays in a box at the foot. Nothing here changes the
 * books; the one thing it sends anywhere is a bill's photos to the shop's
 * printer, when asked and confirmed.
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
 * "images") sends a few KB instead and keeps it. Where that is not to be had
 * (a quota, a computer running this from the repo) the photo itself is shown.
 */
const sized = (url, width) => `/_vercel/image?url=${encodeURIComponent(url)}&w=${width}&q=70`
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

export default function App() {
  const [tab, setTab] = useState(() => read('tab') ?? 'customers')
  const [open, setOpen] = useState(null)
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
    : <Lists tab={tab} setTab={setTab} onOpen={openParty} />
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

function Lists({ tab, setTab, onOpen }) {
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
  const data = useCached(api.reports.ledger, { ledgerId: party.id }, `ledger:${party.id}`)
  const [viewer, setViewer] = useState(null)
  const [profile, setProfile] = useState(false)
  const end = useRef(null)
  // A bill's photos open over the account; the phone's Back closes them.
  const openPhotos = (shots, at, label) => {
    window.history.pushState({ party: party.id, photo: true }, '')
    setViewer({ shots, at, label })
  }
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
                <div className="kind">{SENT[it.p.vchType] ?? 'Bill'} · {it.p.vchLabel ?? ''} · amount not added yet</div>
                <Photos shots={shots} onOpen={(pages, at) => openPhotos(pages, at, `${it.p.vchLabel ?? 'Bill'} ${party.name}`)} />
              </div>
            )
          }
          const r = it.r
          const right = r.side === ours
          const shots = (r.attachmentUrls ?? []).filter((a) => a.url)
          return (
            <div key={it.key} className={`bubble ${right ? 'right' : 'left'}`}>
              <div className="kind">{kindOf(r)} · {r.vchLabel}{r.refNo ? ` · ${r.refNo}` : ''}</div>
              <div className="line">
                <span className="money">{rupees(r.amount)}</span>
                <span className="bal">Balance {rupees(r.balance < 0 ? -r.balance : r.balance)} {sideWord(r.balanceSide)}</span>
              </div>
              {r.narration && <div className="narr">{r.narration}</div>}
              <Photos shots={shots} onOpen={(pages, at) => openPhotos(pages, at, `${r.vchLabel}${r.refNo ? ` ${r.refNo}` : ''} ${party.name}`)} />
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
        </footer>
      )}
      {viewer && <Viewer key={viewer.label} {...viewer} onClose={() => window.history.back()} />}
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
        : <button key={a.storageId} type="button" onClick={() => onOpen(pages, pages.indexOf(a))}><Shot url={a.url} width={192} alt="Bill photo" loading="lazy" decoding="async" /></button>)}
    </div>
  )
}

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
 * A bill's photos, full screen: swipe (or the arrow keys) to turn its pages.
 *
 * Each page shows at once from a screen-sized copy, and the photo itself is
 * fetched behind it, once: that one copy is what sharpens the page for
 * zooming, what Share hands on (every page, as JPG, in the bill's order) and
 * what Print sends to the shop.
 */
function Viewer({ shots, at: start, label, onClose }) {
  const convex = useConvex()
  const strip = useRef(null)
  const [at, setAt] = useState(start)
  const [full, setFull] = useState({})
  const [note, setNote] = useState('')
  const [asking, setAsking] = useState(false)
  const [sending, setSending] = useState(false)
  const [job, setJob] = useState(null)

  useEffect(() => {
    let closed = false
    const made = []
    for (const shot of shots) {
      void (async () => {
        try {
          const res = await fetch(shot.url)
          if (!res.ok) return
          const blob = await res.blob()
          if (closed) return
          const url = URL.createObjectURL(blob)
          made.push(url)
          setFull((have) => ({ ...have, [shot.storageId]: { blob, url } }))
        } catch { /* the screen-sized copy stays; Share and Print wait */ }
      })()
    }
    return () => { closed = true; for (const url of made) URL.revokeObjectURL(url) }
  }, [shots])

  // Opens on the page that was tapped.
  useLayoutEffect(() => {
    const el = strip.current
    if (el) el.scrollLeft = start * el.clientWidth
  }, [start])

  const turn = (by) => {
    const el = strip.current
    if (el) el.scrollTo({ left: Math.min(shots.length - 1, Math.max(0, at + by)) * el.clientWidth, behavior: 'smooth' })
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

  const ready = shots.every((s) => full[s.storageId])
  const base = label.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Bill'
  const nameOf = (i) => (shots.length > 1 ? `${base} page ${i + 1}.jpg` : `${base}.jpg`)
  const pages = `${shots.length} ${shots.length === 1 ? 'page' : 'pages'}`
  /** Every page as a JPG, named in the bill's order. */
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
        <span className="count">{shots.length > 1 ? `${at + 1} of ${shots.length}` : ''}</span>
        <button type="button" className="text" onClick={share} disabled={!ready}><ShareIcon /> Share</button>
        <button type="button" className="text" onClick={() => setAsking(true)} disabled={!ready || sending}><PrintIcon /> Print</button>
      </div>
      <div className="vstrip" ref={strip}
        onScroll={(e) => setAt(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}>
        {shots.map((s, i) => (
          <div key={s.storageId} className="vslide" onClick={onClose}>
            {full[s.storageId]
              ? <img src={full[s.storageId].url} alt={`Bill, page ${i + 1}`} onClick={(e) => e.stopPropagation()} />
              : <Shot url={s.url} width={1200} alt={`Bill, page ${i + 1}`} onClick={(e) => e.stopPropagation()} />}
          </div>
        ))}
      </div>
      {shots.length > 1 && (
        <div className="vdots" aria-hidden="true">{shots.map((s, i) => <i key={s.storageId} className={i === at ? 'on' : ''} />)}</div>
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

/** A sent print job, followed live until the shop PC prints it or says why not. */
function PrintStatus({ id }) {
  const live = useQuery(api.printJobs.getById, { id })
  const status = live?.status
  return status === 'printed' ? 'Printed at the shop'
    : status === 'failed' ? `Not printed: ${live.error || 'the printer refused it'}`
    : status === 'claimed' || status === 'printing' ? 'Printing at the shop'
    : 'Sent. Waiting for the shop PC'
}

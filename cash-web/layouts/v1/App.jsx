import { useEffect, useMemo, useRef, useState } from 'react'
import { flush, queue, pendingCount } from './sync.js'

// Shiv Hardware cash book.
//
// One line per movement, written the way the paper register writes it: amount,
// then what it was for. The one thing the paper cannot do is done here — every
// line is tagged cash or online, so the drawer tally never has to have the
// online lines pulled back out of it by hand.
//
// Local-first on purpose: everything lives in this device's storage until the
// flow is settled in the shop, so no half-built table ever holds real money.

const CASH_PASSWORD = '2611'
const CASH_UNLOCK_MS = 10 * 60 * 1000 // an unlock stays open 10 min, in memory only

const ENTRIES_KEY = 'shiv-cash:entries'
const CLOSES_KEY = 'shiv-cash:closes'
const OPENINGS_KEY = 'shiv-cash:openings'
const LOG_KEY = 'shiv-cash:log'
const DEVICE_KEY = 'shiv-cash:device-id'
const LOG_MAX = 500 // the oldest fall off rather than filling the phone's storage
const DRAFT_KEY = 'shiv-cash:count-draft'
// Every note and coin still in circulation. One row per value, not per piece —
// a ten-rupee note and a ten-rupee coin are ten rupees either way, and counting
// them into one box is one job instead of two.
const DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1]
// The shop's accounts. Online money sits across several of them, so the opening
// balance is reached by reading each app rather than knowing one figure.
const BANKS = ['SBI CA', 'SBI CC', 'PNB', 'Union Bank']

function readCache(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback } catch { return fallback }
}
function writeCache(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* ignore */ }
}
// The book began as a tab inside the attendance app and used to carry that
// storage over on first run. Nothing was ever written there for real, so the
// import is gone — the shop starts from an empty book and fills it from Convex.
function loadCash(key) {
  return readCache(key, null) || {}
}

// ── Who made the change, and on what ────────────────────────────────────────
// Ported from the attendance app, which had to work this out the hard way:
// Android exposes the handset model right before "Build/" even when the newer
// client-hint APIs will not give it up.
function readText(key) {
  try { return localStorage.getItem(key) || '' } catch { return '' }
}
function browserName(ua) {
  if (/Edg\//.test(ua)) return 'Microsoft Edge'
  if (/OPR\//.test(ua)) return 'Opera'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/CriOS\//.test(ua)) return 'Chrome on iOS'
  if (/Chrome\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'Unknown browser'
}
function modelFromUserAgent(ua) {
  const match = ua.match(/;\s*([^;()]+?)\s+Build\/[^;)]+/i)
  if (!match) return ''
  const model = match[1].trim()
  return /^(android|linux|wv|mobile|k)$/i.test(model) ? '' : model
}
function deviceId() {
  const existing = readText(DEVICE_KEY)
  if (existing) return existing
  const next = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`
  try { localStorage.setItem(DEVICE_KEY, next) } catch { /* ignore */ }
  return next
}
function thisDevice() {
  if (typeof navigator === 'undefined') return { model: '', browser: '', platform: '', id: '' }
  const ua = navigator.userAgent || ''
  return {
    model: modelFromUserAgent(ua),
    browser: browserName(ua),
    platform: navigator.platform || '',
    id: deviceId().slice(0, 8),
  }
}

const pad = (n) => String(n).padStart(2, '0')
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const dateFromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d) }
const nextKey = (k) => { const d = dateFromKey(k); d.setDate(d.getDate() + 1); return dateKey(d) }
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`
// Figures here run into lakhs and beyond — ₹6,60,90,000 is thirteen characters
// against ₹6,609's six. The big readouts step down a size as they grow instead
// of spilling out of the card they sit in.
const fit = (text) => (text.length > 11 ? ' xs' : text.length > 9 ? ' s' : '')
// The shape the server stores a line in. updatedAt is stamped here, at the
// moment of the write, not when the queue eventually drains — otherwise a phone
// that was offline for a day would look like the most recent writer.
const entryOp = (e) => ({
  date: e.date, kind: e.kind, mode: e.mode, name: e.name,
  amount: e.amount, at: e.at, updatedAt: Date.now(),
})

// One line describing a movement, the way the register would read it.
const describeEntry = (e) => `${e.kind === 'in' ? 'Received' : 'Paid'} ${inr(e.amount)} ${e.mode} · ${e.name}`
// What actually changed, field by field — the reason to keep a log at all.
const diffEntry = (before, after) => {
  if (!before) return undefined
  const out = []
  if (before.amount !== after.amount) out.push(`${inr(before.amount)} → ${inr(after.amount)}`)
  if (before.kind !== after.kind) out.push(`${before.kind === 'in' ? 'Received' : 'Paid'} → ${after.kind === 'in' ? 'Received' : 'Paid'}`)
  if (before.mode !== after.mode) out.push(`${before.mode} → ${after.mode}`)
  if ((before.name || '') !== (after.name || '')) out.push(`"${before.name}" → "${after.name}"`)
  return out.length ? out : ['no change']
}

const fmtDay = (dateStr) => {
  const [, m, dd] = dateStr.split('-').map(Number)
  return `${dd} ${MON[m - 1]}`
}

export default function App() {
  const [mode, setMode] = useState('entry')
  const [cursor, setCursor] = useState(new Date())
  const [todayKey, setTodayKey] = useState(() => dateKey(new Date()))

  // A phone left open overnight would otherwise still think it is yesterday,
  // and the next morning's first entry would silently be a backdated one.
  useEffect(() => {
    const tick = setInterval(() => setTodayKey(dateKey(new Date())), 60 * 1000)
    return () => clearInterval(tick)
  }, [])

  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  )
  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('shiv-panel:theme', next ? 'dark' : 'light') } catch { /* ignore */ }
  }

  // The line being edited: the report hands it over, the entry form fills from it.
  const [editing, setEditing] = useState(null)

  // ── The log ───────────────────────────────────────────────────────────────
  // Every change to the book, in the order it happened, with the phone it was
  // made on. Nothing here can be edited from the app — it is the record that
  // says who changed what, so it only ever grows.
  // Oldest first, so it reads down the page the way the register does. Sorted
  // on load rather than trusted, so a log written by the earlier newest-first
  // version comes back in the right order too.
  const [log, setLog] = useState(() => {
    const v = readCache(LOG_KEY, [])
    return Array.isArray(v) ? v.slice().sort((a, b) => a.at - b.at) : []
  })
  const record = (kind, date, what, extra) => setLog((prev) => {
    const row = {
      id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(), kind, date, what, ...(extra || {}), device: thisDevice(),
    }
    queue({ t: 'log', logId: row.id, at: row.at, kind, date, what, changes: row.changes, device: row.device })
    const next = [...prev, row].slice(-LOG_MAX) // the oldest fall off the front
    writeCache(LOG_KEY, next)
    return next
  })

  const [store, setStore] = useState(() => loadCash(ENTRIES_KEY))
  const mutate = (fn) => setStore((prev) => {
    const next = fn(prev)
    writeCache(ENTRIES_KEY, next)
    return next
  })
  // Batches, because moving money between cash and online writes both halves
  // at once and deletes them the same way.
  const addEntries = (batch) => {
    mutate((prev) => {
      const next = { ...prev }
      for (const entry of batch) {
        const mo = entry.date.slice(0, 7)
        next[mo] = [...(next[mo] || []), entry]
      }
      return next
    })
    for (const entry of batch) {
      queue({ t: 'entry', entryId: entry.id, ...entryOp(entry) })
      record('add', entry.date, describeEntry(entry))
    }
  }
  const updateEntry = (entry) => {
    // Read the old row before it is replaced, so the log can say what changed
    // rather than only what it ended up as.
    const before = (store[entry.date.slice(0, 7)] || []).find((e) => e.id === entry.id)
    mutate((prev) => {
      const mo = entry.date.slice(0, 7)
      return { ...prev, [mo]: (prev[mo] || []).map((e) => (e.id === entry.id ? entry : e)) }
    })
    queue({ t: 'entry', entryId: entry.id, ...entryOp(entry) })
    record('edit', entry.date, describeEntry(entry), { changes: diffEntry(before, entry) })
  }
  const removeEntries = (batch) => {
    mutate((prev) => {
      const next = { ...prev }
      for (const entry of batch) {
        const mo = entry.date.slice(0, 7)
        next[mo] = (next[mo] || []).filter((e) => e.id !== entry.id)
      }
      return next
    })
    for (const entry of batch) {
      queue({ t: 'entry', entryId: entry.id, ...entryOp(entry), deleted: true })
      record('delete', entry.date, describeEntry(entry))
    }
    // Deleting a line from the report while the entry form still holds it would
    // leave a form that saves into nothing. Drop the edit with the line.
    setEditing((cur) => (cur && batch.some((e) => e.id === cur.id) ? null : cur))
  }

  const [closes, setCloses] = useState(() => loadCash(CLOSES_KEY))
  const closeDay = (date, counted) => {
    setCloses((prev) => {
      const next = { ...prev, [date]: { counted, at: Date.now() } }
      writeCache(CLOSES_KEY, next)
      return next
    })
    queue({ t: 'close', date, counted, at: Date.now(), updatedAt: Date.now() })
    const book = bookAtEnd(store, closes, openings, date, 'cash')
    const off = counted - book
    record('close', date, `Counted ${inr(counted)}, register ${inr(book)}`,
      { changes: off === 0 ? ['Tallied'] : [`${off < 0 ? 'Short' : 'Over'} ${inr(Math.abs(off))}`] })
  }
  const reopenDay = (date) => {
    setCloses((prev) => {
      const next = { ...prev }
      delete next[date]
      writeCache(CLOSES_KEY, next)
      return next
    })
    queue({ t: 'close', date, counted: 0, at: Date.now(), updatedAt: Date.now(), deleted: true })
    record('reopen', date, 'Day reopened')
  }

  // Touching an entry that already exists needs the password — including one
  // written ten minutes ago. The window is held in memory only, so closing the
  // app re-locks it.
  // What the shop was holding when the book was started, or on any day it needs
  // correcting. Both sides at once, because a day has one starting position.
  const [openings, setOpenings] = useState(() => loadCash(OPENINGS_KEY))
  const setOpening = (date, cash, online) => {
    const before = openings[date]
    setOpenings((prev) => {
      const next = { ...prev, [date]: { cash, online, at: Date.now() } }
      writeCache(OPENINGS_KEY, next)
      return next
    })
    queue({ t: 'opening', date, cash, online, at: Date.now(), updatedAt: Date.now() })
    record('opening', date, `Opening cash ${inr(cash)}, online ${inr(online)}`, {
      changes: before
        ? [`cash ${inr(before.cash)} → ${inr(cash)}`, `online ${inr(before.online)} → ${inr(online)}`]
            .filter((_, i) => (i ? before.online !== online : before.cash !== cash))
        : undefined,
    })
  }
  const removeOpening = (date) => {
    const before = openings[date]
    setOpenings((prev) => {
      const next = { ...prev }
      delete next[date]
      writeCache(OPENINGS_KEY, next)
      return next
    })
    queue({ t: 'opening', date, cash: 0, online: 0, at: Date.now(), updatedAt: Date.now(), deleted: true })
    record('opening-off', date, before
      ? `Opening removed — was cash ${inr(before.cash)}, online ${inr(before.online)}`
      : 'Opening removed')
  }

  // ── Sync ──────────────────────────────────────────────────────────────────
  // Anything the server has that this device does not, or has a newer version
  // of, is merged in. A local row only gives way to a strictly newer one, so a
  // change made here a moment ago is never undone by a stale pull.
  const applyPulled = (server) => {
    if (server.entries.length) setStore((prev) => {
      const next = { ...prev }
      for (const r of server.entries) {
        const mo = r.date.slice(0, 7)
        const list = (next[mo] || []).slice()
        const i = list.findIndex((e) => e.id === r.entryId)
        if (r.deleted) { if (i >= 0) list.splice(i, 1) }
        else {
          const row = { id: r.entryId, date: r.date, kind: r.kind, mode: r.mode, name: r.name, amount: r.amount, at: r.at, updatedAt: r.updatedAt }
          if (i < 0) list.push(row)
          else if (r.updatedAt > (list[i].updatedAt || 0)) list[i] = row
        }
        next[mo] = list
      }
      writeCache(ENTRIES_KEY, next)
      return next
    })

    if (server.closes.length) setCloses((prev) => {
      const next = { ...prev }
      for (const r of server.closes) {
        if (r.deleted) delete next[r.date]
        else if (r.updatedAt > (next[r.date]?.updatedAt || 0)) next[r.date] = { counted: r.counted, at: r.at, updatedAt: r.updatedAt }
      }
      writeCache(CLOSES_KEY, next)
      return next
    })

    if (server.openings.length) setOpenings((prev) => {
      const next = { ...prev }
      for (const r of server.openings) {
        if (r.deleted) delete next[r.date]
        else if (r.updatedAt > (next[r.date]?.updatedAt || 0)) next[r.date] = { cash: r.cash, online: r.online, at: r.at, updatedAt: r.updatedAt }
      }
      writeCache(OPENINGS_KEY, next)
      return next
    })

    if (server.log.length) setLog((prev) => {
      const seen = new Set(prev.map((r) => r.id))
      const add = server.log.filter((r) => !seen.has(r.logId))
        .map((r) => ({ id: r.logId, at: r.at, kind: r.kind, date: r.date, what: r.what, changes: r.changes, device: r.device }))
      if (!add.length) return prev
      const next = [...prev, ...add].sort((a, b) => a.at - b.at).slice(-LOG_MAX)
      writeCache(LOG_KEY, next)
      return next
    })
  }

  const [sync, setSync] = useState({ pending: pendingCount(), busy: false, at: 0, error: '' })
  const syncing = useRef(false)
  const runSync = async () => {
    if (syncing.current) return
    syncing.current = true
    setSync((p) => ({ ...p, busy: true }))
    const res = await flush(applyPulled)
    syncing.current = false
    setSync({ pending: pendingCount(), busy: false, at: res.ok ? Date.now() : 0, error: res.ok ? '' : res.reason })
  }

  // On open, whenever the network returns, when the app comes back to the
  // front, and on a slow heartbeat so a queue never sits forever unnoticed.
  useEffect(() => {
    runSync()
    const onBack = () => { if (document.visibilityState === 'visible') runSync() }
    window.addEventListener('online', runSync)
    document.addEventListener('visibilitychange', onBack)
    const beat = setInterval(runSync, 60 * 1000)
    return () => {
      window.removeEventListener('online', runSync)
      document.removeEventListener('visibilitychange', onBack)
      clearInterval(beat)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // A write should reach the server without waiting for the heartbeat, but not
  // one request per keystroke either.
  const nudge = useRef(null)
  useEffect(() => {
    const n = pendingCount()
    setSync((p) => (p.pending === n ? p : { ...p, pending: n }))
    if (!n) return
    clearTimeout(nudge.current)
    nudge.current = setTimeout(runSync, 2500)
    return () => clearTimeout(nudge.current)
  }, [store, closes, openings, log]) // eslint-disable-line react-hooks/exhaustive-deps

  const [historyOpen, setHistoryOpen] = useState(false)
  const [pw, setPw] = useState({ open: false, error: '' })
  const [pending, setPending] = useState(null)
  const [unlockedUntil, setUnlockedUntil] = useState(0)
  const guard = (action) => {
    if (Date.now() < unlockedUntil) { action && action(); return }
    setPending(() => action)
    setPw({ open: true, error: '' })
  }
  const submitPw = (value) => {
    if (value === CASH_PASSWORD) {
      setUnlockedUntil(Date.now() + CASH_UNLOCK_MS)
      setPw({ open: false, error: '' })
      const run = pending
      setPending(null)
      run && run()
    } else {
      setPw({ open: true, error: 'Wrong password' })
    }
  }
  const closePw = () => { setPending(null); setPw({ open: false, error: '' }) }

  // Tapping edit on a line hands it to the entry form and brings that screen up.
  const startEdit = (entry) => { setEditing(entry); setMode('entry') }

  const shared = {
    cursor, setCursor, todayKey, store, closes, openings, guard,
    editing, setEditing, onStartEdit: startEdit,
    onAdd: addEntries, onUpdate: updateEntry, onRemove: removeEntries,
    onClose: closeDay, onReopen: reopenDay,
    onSetOpening: setOpening, onRemoveOpening: removeOpening,
  }

  return (
    <div className={`wrap fit ${mode}`}>
      <header className="top">
        <div className="brandrow">
          <img className="logo" src="/logo.png" alt="Shiv Hardware" />
          <div>
            <div className="brand">Shiv Hardware</div>
            <div className="sub">Cashier</div>
          </div>
        </div>
        <div className="headbtns">
          <button
            className={`themebtn syncbtn ${sync.busy ? 'busy' : sync.pending ? 'pending' : sync.at ? 'ok' : 'off'}`}
            onClick={runSync}
            aria-label={sync.pending ? `${sync.pending} changes waiting to send` : 'Everything is saved online'}
            title={sync.pending ? `${sync.pending} waiting` : sync.error ? `Offline — ${sync.error}` : 'Saved online'}
          >
            <CloudIcon />
            {sync.pending > 0 && <span className="syncdot">{sync.pending > 99 ? '99+' : sync.pending}</span>}
          </button>
          <button className="themebtn" onClick={() => setHistoryOpen(true)} aria-label="Change history" title="Change history">
            <HistoryIcon />
          </button>
          <button className="themebtn" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme">
            {dark ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
            )}
          </button>
        </div>
      </header>

      <div className="card fitcard">
        {mode === 'entry' ? <CashEntry {...shared} />
          : mode === 'totals' ? <CashTotals {...shared} />
            : mode === 'report' ? <CashReport {...shared} />
              : <CashEdit {...shared} />}
      </div>

      <TabBar mode={mode} setMode={setMode} />

      {historyOpen && <HistoryModal log={log} onClose={() => setHistoryOpen(false)} />}

      {pw.open && (
        <PasswordModal
          error={pw.error}
          onSubmit={submitPw}
          onClose={closePw}
          title="Cash entry locked"
          sub="Enter the cash password to change an entry"
        />
      )}
    </div>
  )
}

// ── Bottom navigation ───────────────────────────────────────────────────────
// A floating glass pill, the way GradeX carries its mobile nav: fixed above the
// content rather than scrolling with it, so both destinations stay under the
// thumb on a phone that is being held one-handed at the counter.
//
// Every icon's FIRST child is a closed shape. That is what makes the active
// state work: the whole svg gets fill="currentColor", the first child becomes a
// solid brass silhouette, and the children after it are re-stroked in the ink
// colour so they read as knocked out of it instead of vanishing into the fill.
const NAV_ICONS = {
  entry: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3c4.42 0 8 1.34 8 3v12c0 1.66-3.58 3-8 3s-8-1.34-8-3V6c0-1.66 3.58-3 8-3z" />
      <path d="M20 6c0 1.66-3.58 3-8 3S4 7.66 4 6" />
      <path d="M20 12c0 1.66-3.58 3-8 3s-8-1.34-8-3" />
    </svg>
  ),
  totals: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 2h14v20l-2.33-1.6L14.33 22 12 20.4 9.67 22l-2.34-1.6L5 22z" />
      <path d="M9 7.5h6M9 11.5h6M9 15.5h3.5" />
    </svg>
  ),
  report: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 13.5h3.5V21H4zM10.25 8h3.5v13h-3.5zM16.5 3.5H20V21h-3.5z" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 20.5l1.2-4.4L16.4 4.4a2.2 2.2 0 0 1 3.2 3.2L7.9 19.3z" />
      <path d="M15 5.8l3.2 3.2" />
    </svg>
  ),
}

const NAV_ITEMS = [
  { id: 'entry', label: 'Entry' },
  { id: 'totals', label: 'Totals' },
  { id: 'report', label: 'Register' },
  { id: 'edit', label: 'Edit' },
]

function TabBar({ mode, setMode }) {
  return (
    <nav className="tabbar" aria-label="Sections" style={{ '--navcount': NAV_ITEMS.length }}>
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          className="tabitem"
          data-on={mode === item.id ? 'true' : undefined}
          aria-current={mode === item.id ? 'page' : undefined}
          onClick={() => setMode(item.id)}
        >
          {NAV_ICONS[item.id]}
          <span className="tablabel">{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

function PasswordModal({ error, onSubmit, onClose, title, sub }) {
  const [value, setValue] = useState('')
  const submit = () => onSubmit(value)
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheetlock"><LockIcon /></div>
        <div className="sheettitle">{title}</div>
        <div className="sheetsub">{sub}</div>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder="Password"
          className={error ? 'err' : ''}
        />
        {error && <div className="sheeterr">{error}</div>}
        <div className="sheetbtns">
          <button className="ghostbtn" onClick={onClose}>Cancel</button>
          <button className="primbtn" onClick={submit}>Unlock</button>
        </div>
      </div>
    </div>
  )
}

// Money arriving lands on the counter; money paid leaves it. The arrow points
// at the line either way, so the pair reads as one movement in two directions.
function InIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v11" /><path d="M7 9.5l5 5 5-5" /><path d="M4 20h16" /></svg>
  )
}
function OutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21V10" /><path d="M7 14.5l5-5 5 5" /><path d="M4 4h16" /></svg>
  )
}

// Cash is a note out of the drawer; online is a payment that came through a
// phone. They carry the colours the rest of the app already gives the two —
// brass for cash, amber for online.
function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.5" /><path d="M5.5 12h.01M18.5 12h.01" /></svg>
  )
}
function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10.5 5.5h3" /><path d="M10 12.5h4M12 10.5v4" /></svg>
  )
}
function LineModal({ entry, onEdit, onDelete, onClose }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="lineamt">{inr(entry.amount)}</div>
        <div className="sheetsub">
          {entry.kind === 'in' ? 'Received' : 'Paid'} · {entry.mode === 'online' ? 'Online' : 'Cash'} · {entry.name}
        </div>
        <div className="sheetbtns">
          <button className="ghostbtn" onClick={onClose}>Cancel</button>
          <button className="delbtn" onClick={onDelete}>Delete</button>
          <button className="primbtn" onClick={onEdit}>Edit</button>
        </div>
      </div>
    </div>
  )
}

function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.5 19H7a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.5 1.62A3.9 3.9 0 0 1 17.5 19z" /></svg>
  )
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 4v4h4" /><path d="M12 7.5V12l3 2" /></svg>
  )
}

const LOG_LABEL = {
  add: 'Added', edit: 'Edited', delete: 'Deleted',
  close: 'Day closed', reopen: 'Day reopened',
  opening: 'Opening balance', 'opening-off': 'Opening balance',
}
const fmtWhen = (ts) => {
  const d = new Date(ts)
  return `${d.getDate()} ${MON[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const deviceLine = (d) => {
  if (!d) return ''
  const parts = [d.model, d.browser, d.platform].filter(Boolean)
  return `${parts.join(' · ')}${d.id ? ` · ${d.id}` : ''}`
}

function HistoryModal({ log, onClose }) {
  // Chronological order puts the newest change at the bottom, so open there.
  const listRef = useRef(null)
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet histsheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheettitle">Change history</div>
        <div className="sheetsub">{log.length ? `${log.length} change${log.length === 1 ? '' : 's'} recorded` : 'Nothing changed yet'}</div>
        {log.length > 0 && (
          <div className="histlist" ref={listRef}>
            {log.map((r) => (
              <div className={`histrow ${r.kind}`} key={r.id}>
                <div className="histtop">
                  <span className="histkind">{LOG_LABEL[r.kind] || r.kind}</span>
                  <span className="histwhen">{fmtWhen(r.at)}</span>
                </div>
                <div className="histwhat">{r.what}</div>
                {r.changes && r.changes.map((c, i) => <div className="histchange" key={i}>{c}</div>)}
                <div className="histfoot">
                  <span>for {fmtDay(r.date)}</span>
                  <span className="histdev">{deviceLine(r.device)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="sheetbtns">
          <button className="ghostbtn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// Marks a field that can be reached by adding up its parts.
function SplitIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
  )
}

function PrintIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="7" rx="1" /></svg>
  )
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>
  )
}
function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
  )
}
function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
  )
}

// ── The register itself ─────────────────────────────────────────────────────

const fmtTime = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

const sumCash = (list, mode, kind) => (list || []).reduce(
  (s, e) => (e.mode === mode && e.kind === kind ? s + Number(e.amount || 0) : s), 0,
)
const allEntries = (store) => {
  const out = []
  for (const mo of Object.keys(store || {})) for (const e of store[mo] || []) out.push(e)
  return out
}
// Balances are counted forward from an anchor rather than from the first entry
// ever written, so the book can be started mid-life and a bad day absorbed once.
//
// Two kinds of anchor. An opening balance someone typed on the Edit screen sits
// at the START of its day, so that day's own entries still count on top of it.
// An evening count sits at the END of its day, so that day's entries are already
// inside it. Cash has both; online is never counted, so it only has openings.
// When a day carries both, the count wins — it happened later.
function anchorFor(closes, openings, date, mode) {
  let best = null
  for (const d of Object.keys(openings || {})) {
    if (d > date) continue
    if (!best || d > best.date) best = { date: d, value: Number(openings[d][mode] || 0), startOfDay: true }
  }
  if (mode === 'cash') {
    for (const d of Object.keys(closes || {})) {
      if (d >= date) continue
      if (!best || d >= best.date) best = { date: d, value: Number(closes[d].counted || 0), startOfDay: false }
    }
  }
  return best
}

// What this mode holds at the start of the given day.
function balanceOpen(store, closes, openings, date, mode) {
  const a = anchorFor(closes, openings, date, mode)
  let bal = a ? a.value : 0
  for (const e of allEntries(store)) {
    if (e.mode !== mode || e.date >= date) continue
    if (a && (a.startOfDay ? e.date < a.date : e.date <= a.date)) continue
    bal += e.kind === 'in' ? Number(e.amount || 0) : -Number(e.amount || 0)
  }
  return bal
}

// What the book says this mode holds at the end of the day, before any count.
function bookAtEnd(store, closes, openings, date, mode) {
  const day = (store[date.slice(0, 7)] || []).filter((e) => e.date === date)
  return balanceOpen(store, closes, openings, date, mode)
    + sumCash(day, mode, 'in') - sumCash(day, mode, 'out')
}

// The closing balance. A counted drawer is the truth for cash, whatever the
// book made it; online has nothing to count against, so the book stands.
function balanceClose(store, closes, openings, date, mode) {
  if (mode === 'cash' && closes[date]) return Number(closes[date].counted || 0)
  return bookAtEnd(store, closes, openings, date, mode)
}

function CashEntry({
  todayKey, store, closes, openings, editing, setEditing, onAdd, onUpdate,
}) {
  // Counting the drawer finishes the day, so the register moves on: whatever
  // comes in after that belongs to the next one, whatever the clock says. The
  // closed day stays one arrow behind, for a line that was missed.
  const closedToday = !!closes[todayKey]
  const base = closedToday ? nextKey(todayKey) : todayKey
  const [viewing, setViewing] = useState(null)
  const dk = viewing || base
  const onClosed = dk !== base
  useEffect(() => { setViewing(null) }, [todayKey]) // a real rollover starts clean
  const day = dateFromKey(dk)
  const dayEntries = useMemo(
    () => (store[dk.slice(0, 7)] || []).filter((e) => e.date === dk).slice().sort((a, b) => a.at - b.at),
    [store, dk],
  )

  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState('')      // '' until the cashier picks a side
  const [mode, setMode] = useState('cash')
  const [name, setName] = useState('')

  const reset = () => {
    setAmount(''); setKind(''); setMode('cash')
    setName(''); setEditing(null)
  }

  // The amount is typed on the pad below, not on the phone keyboard, so the
  // keyboard never slides up over the screen mid-entry.
  const tap = (d) => setAmount((a) => {
    if (!a && (d === '0' || d === '00')) return a // no leading zeros to strip later
    const next = a + d
    return next.length > 9 ? a : next             // nine digits is far past any till
  })
  const back = () => setAmount((a) => a.slice(0, -1))
  const wipe = () => setAmount('')
  // Only a rollover past midnight should clear a half-typed line. Resetting on
  // mount as well would wipe an edit the moment the report handed one over.
  const shownDay = useRef(dk)
  useEffect(() => {
    if (shownDay.current === dk) return
    shownDay.current = dk
    reset()
  }, [dk])

  // An edit arrives as a prop now, so the form fills itself from it.
  useEffect(() => {
    if (!editing) return
    setAmount(String(editing.amount)); setKind(editing.kind); setMode(editing.mode)
    setName(editing.name || '')
  }, [editing])

  // On a laptop the number row should drive the same pad. The name box owns the
  // keyboard while it has focus, so typing there is left alone.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = e.target && e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key >= '0' && e.key <= '9') { tap(e.key); e.preventDefault() }
      else if (e.key === 'Backspace') { back(); e.preventDefault() }
      else if (e.key === 'Escape') { wipe(); e.preventDefault() }
      else if (e.key === 'Enter' && ready) { commit(); e.preventDefault() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const hasWB = /(^|\s)W\/B$/i.test(name.trim())
  const toggleWB = () => setName((n) => {
    const t = n.trim()
    if (/(^|\s)W\/B$/i.test(t)) return t.replace(/(^|\s)W\/B$/i, '').trim()
    return t ? `${t} W/B` : 'W/B'
  })

  const value = Math.round(Number(amount) || 0)
  const ready = value > 0 && !!kind && !!name.trim()

  const commit = () => {
    if (!ready) return
    const clean = name.trim()
    if (editing) { // the password was already given when the edit started
      onUpdate({ ...editing, kind, mode, name: clean, amount: value })
      reset()
      return
    }
    const at = Date.now()
    const id = `c-${at}-${Math.random().toString(36).slice(2, 7)}`
    const batch = [{ id, date: dk, kind, mode, name: clean, amount: value, at }]
    // The log carries corrections now, so even a line added after the drawer was
    // counted goes straight in.
    onAdd(batch)
    reset()
  }

  return (
    <>
      <div className="datenav">
        {closedToday && !onClosed
          ? <button onClick={() => setViewing(todayKey)} aria-label="Back to the closed day">‹</button>
          : <span className="navspace" />}
        <div className="dcenter">
          <div className="dbig">{WD[day.getDay()]}, {day.getDate()} {MON[day.getMonth()]}</div>
          <div className="daysub">{onClosed ? 'Closed' : closedToday ? 'New day' : "Today's register"}</div>
        </div>
        {onClosed
          ? <button onClick={() => setViewing(null)} aria-label="Back to the new day">›</button>
          : <span className="navspace" />}
      </div>

      {editing && (
        <div className="editbanner">
          Editing the {fmtTime(editing.at)} entry
          <button onClick={reset}>Cancel</button>
        </div>
      )}

      <div className={`amtshow ${value ? '' : 'empty'}`} aria-live="polite">
        <span className="amtcur">₹</span>
        <span className={`amtnum${fit(value ? value.toLocaleString('en-IN') : '0')}`}>
          {value ? value.toLocaleString('en-IN') : '0'}
        </span>
      </div>

      <div className="dirrow">
        <button className={`dirbtn in ${kind === 'in' ? 'sel' : ''}`} onClick={() => setKind('in')}>
          <InIcon /> Received
        </button>
        <button className={`dirbtn out ${kind === 'out' ? 'sel' : ''}`} onClick={() => setKind('out')}>
          <OutIcon /> Paid
        </button>
      </div>

      <div className="dirrow">
        <button className={`modebtn cash ${mode === 'cash' ? 'sel' : ''}`} onClick={() => setMode('cash')}>
          <NoteIcon /> Cash
        </button>
        <button className={`modebtn online ${mode === 'online' ? 'sel' : ''}`} onClick={() => setMode('online')}>
          <PhoneIcon /> Online
        </button>
      </div>

      <div className="advrow">
        <input
          className="noteinput" value={name}
          onChange={(e) => setName(e.target.value)} placeholder="NOTE"
        />
        <button className={`wbbtn ${hasWB ? 'sel' : ''}`} onClick={toggleWB}>W/B</button>
      </div>

      <button
        className="tickbar" onClick={commit} disabled={!ready}
        aria-label={editing ? 'Update entry' : 'Save entry'}
      >
        ✓
      </button>

      {/* Backspace takes the twelfth cell now that the tick has its own bar.
          Clear went with it: holding a wrong amount is two taps from gone. */}
      <div className="pad">
        <div className="padkeys">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0'].map((d) => (
            <button key={d} className="padkey" onClick={() => tap(d)}>{d}</button>
          ))}
          <button className="padkey back" onClick={back} aria-label="Delete last digit">⌫</button>
        </div>
      </div>

    </>
  )
}

// ── Adding up in parts ──────────────────────────────────────────────────────
// Three places need the same thing: a figure that is easier to reach by adding
// up the pieces than by knowing it outright. The drawer is counted in notes and
// coins; the bank balance is however many accounts the shop keeps. One list,
// one running total, and every keystroke written down — because counting a
// drawer or reading four bank apps both get interrupted.
function SplitModal({ title, items, draftKey, compare, confirmLabel, onCancel, onConfirm }) {
  const [vals, setVals] = useState(() => readCache(DRAFT_KEY, {})[draftKey] || {})
  const setOne = (key, raw) => setVals((prev) => {
    const v = raw.replace(/[^0-9]/g, '')
    const next = { ...prev }
    if (v === '') delete next[key]
    else next[key] = v
    const all = readCache(DRAFT_KEY, {})
    all[draftKey] = next
    writeCache(DRAFT_KEY, all)
    return next
  })

  const n = (it) => parseInt(vals[it.key], 10) || 0
  const total = items.reduce((sum, it) => sum + it.mult * n(it), 0)
  const pieces = items.reduce((sum, it) => sum + (it.mult === 1 ? 0 : n(it)), 0)
  const ready = Object.keys(vals).length > 0
  const diff = compare == null ? 0 : total - compare

  const done = () => {
    const all = readCache(DRAFT_KEY, {})
    delete all[draftKey]           // the working-out is spent once it is committed
    writeCache(DRAFT_KEY, all)
    onConfirm(total)
  }

  return (
    <div className="modal top" onClick={onCancel}>
      <div className="sheet closesheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheettitle">{title}</div>

        <div className="denoms">
          {items.map((it, i) => (
            <div className={`denom ${n(it) ? 'has' : ''} ${it.mult === 1 ? 'plain' : ''}`} key={it.key}>
              <span className="dv">{it.label}</span>
              <span className="dx">{it.mult === 1 ? '₹' : '×'}</span>
              <input
                type="number" inputMode="numeric" min="0"
                autoFocus={i === 0}
                value={vals[it.key] ?? ''}
                onChange={(e) => setOne(it.key, e.target.value)}
              />
              <span className="dsub">{it.mult !== 1 && n(it) ? num(it.mult * n(it)) : ''}</span>
            </div>
          ))}
        </div>

        <div className="counttotal">
          <span className="pk">Total{pieces ? ` · ${pieces} piece${pieces === 1 ? '' : 's'}` : ''}</span>
          <b className={fit(inr(total)).trim()}>{inr(total)}</b>
        </div>

        {compare != null && ready && (
          <div className={`closediff ${diff === 0 ? 'ok' : ''}`}>
            {diff === 0 ? 'Tallies exactly ✓' : diff < 0
              ? `Short ${inr(Math.abs(diff))} · घट गया`
              : `Over ${inr(diff)} · बढ़ गया`}
          </div>
        )}

        <div className="sheetbtns">
          <button className="ghostbtn" onClick={onCancel}>Cancel</button>
          <button className="primbtn" disabled={!ready} onClick={done}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

const DENOM_ITEMS = DENOMS.map((d) => ({ key: String(d), label: `₹${d}`, mult: d }))
const BANK_ITEMS = BANKS.map((b) => ({ key: b, label: b, mult: 1 }))

function CloseDayModal({ date, bookCash, onCancel, onConfirm }) {
  return (
    <SplitModal
      title="Close the day" items={DENOM_ITEMS} draftKey={`close:${date}`}
      compare={bookCash} confirmLabel="Close the day"
      onCancel={onCancel} onConfirm={onConfirm}
    />
  )
}


// ── Totals ──────────────────────────────────────────────────────────────────
// The end-of-day glance, and the one screen anybody looks at when the shutters
// come down: what came in, what each side is left holding, and how the day sat
// against the ones before it. Paid out is here too, because without it the
// closing balance is a figure that cannot be checked against anything.
function CashTotals({ todayKey, store, closes, openings, guard, onClose, onReopen }) {
  const [asking, setAsking] = useState(false)
  // Null means today, so a phone left open overnight follows the date over
  // rather than being stuck on yesterday's totals.
  const [viewing, setViewing] = useState(null)
  const dk = viewing || todayKey
  const isToday = dk === todayKey
  const day = dateFromKey(dk)

  // Looking back is a deliberate act, so the step asks for the password. The
  // future is simply not reachable, and coming home to today never asks.
  const step = (n) => {
    const d = dateFromKey(dk)
    d.setDate(d.getDate() + n)
    const k = dateKey(d)
    if (k > todayKey) return
    guard(() => setViewing(k === todayKey ? null : k))
  }
  const lines = useMemo(
    () => (store[dk.slice(0, 7)] || []).filter((e) => e.date === dk),
    [store, dk],
  )

  const salesCash = sumCash(lines, 'cash', 'in')
  const salesOnline = sumCash(lines, 'online', 'in')
  const sales = salesCash + salesOnline
  const paidCash = sumCash(lines, 'cash', 'out')
  const paidOnline = sumCash(lines, 'online', 'out')

  const openCash = balanceOpen(store, closes, openings, dk, 'cash')
  const openOnline = balanceOpen(store, closes, openings, dk, 'online')
  const closeCash = balanceClose(store, closes, openings, dk, 'cash')
  const closeOnline = balanceClose(store, closes, openings, dk, 'online')
  const counted = !!closes[dk]
  // Once the drawer is counted the big figure is the count, not the sum — so
  // the line under it has to stop showing a sum that no longer reaches it.
  const bookCash = openCash + salesCash - paidCash
  const off = counted ? closeCash - bookCash : 0
  const carried = closeCash + closeOnline

  // The week behind today, so a good day is visibly a good day rather than a
  // number with nothing to sit against.
  const week = useMemo(() => {
    const out = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(day)
      d.setDate(d.getDate() - i)
      const k = dateKey(d)
      const list = (store[k.slice(0, 7)] || []).filter((e) => e.date === k)
      out.push({ key: k, wd: d.getDay(), sales: sumCash(list, 'cash', 'in') + sumCash(list, 'online', 'in') })
    }
    return out
  }, [store, dk]) // eslint-disable-line react-hooks/exhaustive-deps
  const peak = Math.max(1, ...week.map((w) => w.sales))
  const best = sales > 0 && sales >= peak
  const yesterday = week.length > 1 ? week[week.length - 2].sales : 0
  const delta = sales - yesterday
  const prev = isToday ? 'yesterday' : 'the day before'

  return (
    <>
      <div className="datenav">
        <button onClick={() => step(-1)} aria-label="Previous day">‹</button>
        <div className="dcenter">
          <div className="dbig">{WD[day.getDay()]}, {day.getDate()} {MON[day.getMonth()]}</div>
          {isToday
            ? <div className="daysub">Totals</div>
            : <button className="todaybtn" onClick={() => setViewing(null)}>Go to today</button>}
        </div>
        <button onClick={() => step(1)} aria-label="Next day" disabled={isToday}>›</button>
      </div>

      <div className="hero green">
        <div className="herolabel">{isToday ? 'Sales today' : 'Sales'}</div>
        <div className={`heronum${fit(inr(sales))}`}>{inr(sales)}</div>

        {sales === 0 ? (
          <div className="herodelta flat">{isToday ? 'Nothing yet today' : 'Nothing that day'}</div>
        ) : best && week.filter((w) => w.sales > 0).length > 1 ? (
          <div className="herodelta up">★ Best day of the week</div>
        ) : delta > 0 ? (
          <div className="herodelta up">▲ {inr(delta)} more than {prev}</div>
        ) : delta < 0 ? (
          <div className="herodelta down">▼ {inr(-delta)} less than {prev}</div>
        ) : (
          <div className="herodelta flat">Level with {prev}</div>
        )}

        <div className="week">
          {week.map((w) => (
            <div className={`weekcol ${w.key === dk ? 'now' : ''}`} key={w.key}>
              <div className="weekbarwrap">
                <div
                  className={`weekbar ${w.key === dk ? 'today' : ''}`}
                  style={{ height: `${Math.max(4, Math.round((w.sales / peak) * 100))}%` }}
                />
              </div>
              <span>{WD[w.wd][0]}</span>
            </div>
          ))}
        </div>

        <div className="herosplit">
          <span className="hs cash"><i />Cash {inr(salesCash)}</span>
          <span className="hs online"><i />Online {inr(salesOnline)}</span>
        </div>
      </div>

      <div className="paidline">
        <span className="pk">Paid out</span>
        <b>{inr(paidCash + paidOnline)}</b>
        <em>cash {inr(paidCash)} · online {inr(paidOnline)}</em>
      </div>

      <div className="hero gold">
        <div className="herolabel">Cash and online together</div>
        <div className={`heronum${fit(inr(carried))}`}>{inr(carried)}</div>
        <div className="herosplit">
          <span className="hs cash"><i />{inr(closeCash)}</span>
          <span className="hs online"><i />{inr(closeOnline)}</span>
        </div>
        <div className="herofoot">{isToday ? 'Tomorrow opens here' : 'Carried into the next day'}</div>
      </div>

      <div className="hero drawer">
        <div className="herolabel">In the drawer</div>
        <div className={`heronum${fit(inr(closeCash))}`}>{inr(closeCash)}</div>
        <div className="drawerrow">
          {counted ? (
            <>
              <span>register {inr(bookCash)}</span>
              <span className="off">
                {off === 0 ? 'tallied ✓' : `${off < 0 ? 'short' : 'over'} ${inr(Math.abs(off))}`}
              </span>
            </>
          ) : (
            <>
              <span>opened {inr(openCash)}</span>
              <span>+ {inr(salesCash)}</span>
              <span>− {inr(paidCash)}</span>
            </>
          )}
        </div>
        {counted && <div className="herofoot">counted and closed</div>}
      </div>

      {/* Directly under the figure it is counted against. */}
      {counted
        ? <button className="allbtn ghost" onClick={() => guard(() => onReopen(dk))}>Reopen this day</button>
        : <button className="allbtn danger" onClick={() => setAsking(true)}>Close the day</button>}

      {asking && (
        <CloseDayModal
          date={dk} bookCash={bookCash}
          onCancel={() => setAsking(false)}
          onConfirm={(c) => { onClose(dk, c); setAsking(false) }}
        />
      )}
    </>
  )
}

// ── Edit ────────────────────────────────────────────────────────────────────
// Where the book is told what the shop was already holding when it started.
// Every balance is counted forward from here, so it asks for the password the
// same way any correction does.
function CashEdit({ todayKey, openings, guard, onSetOpening, onRemoveOpening }) {
  const [date, setDate] = useState(todayKey)
  const [cash, setCash] = useState('')
  const [online, setOnline] = useState('')
  const [assist, setAssist] = useState(null)   // 'cash' | 'online'

  const existing = openings[date]
  // Show whatever that day already carries, so saving corrects rather than
  // silently replaces a figure the cashier cannot see.
  useEffect(() => {
    const cur = openings[date]
    setCash(cur ? String(cur.cash ?? '') : '')
    setOnline(cur ? String(cur.online ?? '') : '')
  }, [date, openings])

  const ready = !!date && (cash.trim() !== '' || online.trim() !== '')
  const save = () => {
    if (!ready) return
    guard(() => onSetOpening(date, Math.round(Number(cash) || 0), Math.round(Number(online) || 0)))
  }

  const list = useMemo(() => Object.keys(openings || {}).sort().reverse(), [openings])

  return (
    <>
      <div className="datenav solo">
        <div className="dcenter">
          <div className="dbig">Opening balance</div>
          <div className="daysub">What the shop already held</div>
        </div>
      </div>

      <div className="advrow">
        <input type="date" max={todayKey} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="dirrow">
        <label className="balfield cash">
          <span>
            Cash
            <button className="assistbtn" onClick={(e) => { e.preventDefault(); setAssist('cash') }} aria-label="Count the drawer">
              <SplitIcon />
            </button>
          </span>
          <input type="number" inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" />
        </label>
        <label className="balfield online">
          <span>
            Online
            <button className="assistbtn" onClick={(e) => { e.preventDefault(); setAssist('online') }} aria-label="Add up the bank accounts">
              <SplitIcon />
            </button>
          </span>
          <input type="number" inputMode="numeric" value={online} onChange={(e) => setOnline(e.target.value)} placeholder="0" />
        </label>
      </div>

      {assist === 'cash' && (
        <SplitModal
          title="Count the drawer" items={DENOM_ITEMS} draftKey={`open-cash:${date}`}
          confirmLabel="Use this total"
          onCancel={() => setAssist(null)}
          onConfirm={(t) => { setCash(String(t)); setAssist(null) }}
        />
      )}
      {assist === 'online' && (
        <SplitModal
          title="Bank balances" items={BANK_ITEMS} draftKey={`open-online:${date}`}
          confirmLabel="Use this total"
          onCancel={() => setAssist(null)}
          onConfirm={(t) => { setOnline(String(t)); setAssist(null) }}
        />
      )}

      <button className="allbtn" onClick={save} disabled={!ready}>
        {existing ? 'Update opening balance' : 'Set opening balance'}
      </button>

      {list.length > 0 && (
        <div className="totbox">
          <div className="mgttl">Set so far</div>
          <div className="openlist">
            {list.map((d) => (
              <div className={`openrow ${d === date ? 'sel' : ''}`} key={d}>
                <button className="openmain" onClick={() => setDate(d)}>
                  <span className="opendate">{fmtDay(d)}</span>
                  <span className="openvals">
                    <span className="ov cash"><i />{inr(openings[d].cash)}</span>
                    <span className="ov online"><i />{inr(openings[d].online)}</span>
                  </span>
                </button>
                <button className="openx" aria-label="Remove opening balance" onClick={() => guard(() => onRemoveOpening(d))}>
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}// ── Report ──────────────────────────────────────────────────────────────────
// The page from the copy, set in type. Same shape the register has been kept in
// for years: opening balance at the top, then one line per movement written
// "amount = particular", then the tally at the foot.
//
// The one job the highlighter was doing by hand — marking the online lines so
// they can be kept out of the drawer count — the app does on its own, because
// every line already knows which side it was taken on.
const num = (n) => Number(n || 0).toLocaleString('en-IN')

function CashReport({ todayKey, store, closes, openings, onRemove, onStartEdit }) {
  const [viewing, setViewing] = useState(null)
  const dk = viewing || todayKey
  const isToday = dk === todayKey
  const day = dateFromKey(dk)
  const [picked, setPicked] = useState(null)

  useEffect(() => { setPicked(null) }, [dk])

  const lines = useMemo(
    () => (store[dk.slice(0, 7)] || []).filter((e) => e.date === dk).slice().sort((a, b) => a.at - b.at),
    [store, dk],
  )

  const step = (n) => {
    const d = dateFromKey(dk)
    d.setDate(d.getDate() + n)
    const k = dateKey(d)
    if (k > todayKey) return
    setViewing(k === todayKey ? null : k)
  }

  const opening = balanceOpen(store, closes, openings, dk, 'cash')
  const cashIn = sumCash(lines, 'cash', 'in')
  const cashOut = sumCash(lines, 'cash', 'out')
  const book = opening + cashIn - cashOut
  // Kept apart from the tally on purpose: none of it is in the drawer, so it
  // can never join the arithmetic the count is checked against.
  const onlineIn = sumCash(lines, 'online', 'in')
  const onlineOut = sumCash(lines, 'online', 'out')
  const close = closes[dk]
  const diff = close ? Number(close.counted || 0) - book : 0

  const ins = useMemo(() => lines.filter((e) => e.kind === 'in'), [lines])
  const outs = useMemo(() => lines.filter((e) => e.kind === 'out'), [lines])

  const remove = (e) => { onRemove([e]); setPicked(null) }

  return (
    <>
      <div className="datenav">
        <button onClick={() => step(-1)} aria-label="Previous day">‹</button>
        <div className="dcenter">
          <div className="dbig">{WD[day.getDay()]}, {day.getDate()} {MON[day.getMonth()]}</div>
          {isToday
            ? <div className="daysub">Register</div>
            : <button className="todaybtn" onClick={() => setViewing(null)}>Go to today</button>}
        </div>
        <button onClick={() => step(1)} aria-label="Next day" disabled={isToday}>›</button>
      </div>

      <div className="page">
        <div className="pagetop">
          <div className="pagestamp">
            <span>Date</span>
            <b>{pad(day.getDate())}/{pad(day.getMonth() + 1)}/{String(day.getFullYear()).slice(2)}</b>
          </div>
        </div>

        <div className="pagehdr">
          <span>Received</span>
          <span>Paid</span>
        </div>

        <div className="pagerow">
          <div className="pcell">
            <span className="pentry">
              <span className="pamt">{num(opening)}</span>
              <span className="peq">=</span>
              <span className="pname ob">O/B</span>
            </span>
          </div>
          <div className="pcell" />
        </div>

        {Array.from({ length: Math.max(ins.length, outs.length, 3) }).map((_, i) => (
          <div className="pagerow" key={i}>
            {[ins[i], outs[i]].map((e, side) => (
              <div className="pcell" key={side}>
                {e && (
                  <button
                    className={`pentry ${side ? 'out' : ''} ${e.mode === 'online' ? 'on' : ''}`}
                    onClick={() => setPicked(e)}
                  >
                    <span className="pamt">{num(e.amount)}</span>
                    <span className="peq">=</span>
                    <span className="pname" title={e.name}>{e.name}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}

        <div className="tally">
          <div className="tline"><span>Opening</span><b>{num(opening)}</b></div>
          <div className="tline"><span>Cash in</span><b>+ {num(cashIn)}</b></div>
          <div className="tline rule"><span>Cash out</span><b>− {num(cashOut)}</b></div>
          <div className="tline"><span>Register</span><b>{num(book)}</b></div>
          {close && <div className="tline rule"><span>Counted</span><b>{num(close.counted)}</b></div>}
          {close && (
            <div className={`tline out ${diff === 0 ? 'ok' : ''}`}>
              <span>{diff === 0 ? 'Tallied' : diff < 0 ? 'घट गया' : 'बढ़ गया'}</span>
              <b>{diff === 0 ? '✓' : num(Math.abs(diff))}</b>
            </div>
          )}
          {(onlineIn > 0 || onlineOut > 0) && (
            <div className="tline online">
              <span>Online</span>
              <b>
                {onlineIn > 0 && `+ ${num(onlineIn)}`}
                {onlineIn > 0 && onlineOut > 0 && '  '}
                {onlineOut > 0 && `− ${num(onlineOut)}`}
              </b>
            </div>
          )}
        </div>
      </div>

      <button className="printbar" onClick={() => window.print()}>
        <PrintIcon /> Print
      </button>

      {picked && (
        <LineModal
          entry={picked}
          onEdit={() => { onStartEdit(picked); setPicked(null) }}
          onDelete={() => remove(picked)}
          onClose={() => setPicked(null)}
        />
      )}
    </>
  )
}

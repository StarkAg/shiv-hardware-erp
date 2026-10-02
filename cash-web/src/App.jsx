import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { convex, flush, queue, pendingCount } from './sync.js'
import { anyApi } from 'convex/server'
import { registerPdf } from './pdf.js'
import StaffPayments from './StaffPayments.jsx'
import CashSearch from './CashSearch.jsx'
import { enqueuePhotos, flushPhotos, pendingPhotos } from './photoQueue.js'

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
// When a name's count was last put back to zero.
//
// A key is earned by being typed three times, and some names cross that line
// without being worth a button — a dealer paid off, a note that happened to
// repeat for a week. Clearing one does not hide it for ever: it forgets what
// came before, so the name has to be written three more times to come back. A
// name still in daily use returns within the week; one that was a passing phase
// never does, and nobody had to decide which it was.
//
// Nothing about the entries changes. This is a mark in time, and the lines it
// stops counting are still in the book, on the register and in every total.
//
// It lives on the device rather than in the book: a preference about one
// person's keypad, not a fact about the shop's day, and two counters write
// different names often enough to want different keys.
const KEYRESET_KEY = 'shiv-cash:key-resets' 
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
function clearCountDraft(key) {
  const drafts = readCache(DRAFT_KEY, {})
  delete drafts[key]
  writeCache(DRAFT_KEY, drafts)
}

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
const shiftKey = (k, n) => { const d = dateFromKey(k); d.setDate(d.getDate() + n); return dateKey(d) }

// Tuesday is the shop's weekly holiday, so a past Tuesday with nothing written
// on it reads as closed on its own and nobody has to go back and mark last
// week's. Today is never assumed shut — trade may still be coming — and a day
// that was actually counted is whatever the count said it was.
const isShutDay = (closes, store, todayKey, date) => {
  const rec = closes[date]
  if (rec) return !!rec.shut
  if (date >= todayKey) return false
  if (dateFromKey(date).getDay() !== 2) return false
  return !(store[date.slice(0, 7)] || []).some((e) => e.date === date)
}
// Whether the register PAGE should be stamped closed, which is a looser
// question than whether the books count the day as shut. A Tuesday that is
// still running has nothing written on it to contradict the stamp, so it
// carries one; the first entry of the day takes it straight off again, which
// is what happens when the shutters go up after all. The books stay strict —
// the worked-day counts should not assume a holiday that may not happen.
const looksShut = (closes, store, todayKey, date) => {
  if (isShutDay(closes, store, todayKey, date)) return true
  if (closes[date]) return false
  if (dateFromKey(date).getDay() !== 2) return false
  return !(store[date.slice(0, 7)] || []).some((e) => e.date === date)
}
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
  amount: e.amount, at: e.at, updatedAt: Date.now(), dealer: !!e.dealer,
})

// One line describing a movement, the way the register would read it.
const describeEntry = (e) => `${e.kind === 'in' ? 'Received' : 'Paid'} ${inr(e.amount)} ${e.mode}${e.dealer ? ' dealer' : ''} · ${e.name}`
// What actually changed, field by field — the reason to keep a log at all.
const diffEntry = (before, after) => {
  if (!before) return undefined
  const out = []
  if (before.amount !== after.amount) out.push(`${inr(before.amount)} → ${inr(after.amount)}`)
  if (before.kind !== after.kind) out.push(`${before.kind === 'in' ? 'Received' : 'Paid'} → ${after.kind === 'in' ? 'Received' : 'Paid'}`)
  if (before.mode !== after.mode) out.push(`${before.mode} → ${after.mode}`)
  if ((before.name || '') !== (after.name || '')) out.push(`"${before.name}" → "${after.name}"`)
  if (!!before.dealer !== !!after.dealer) out.push(after.dealer ? '→ dealer' : 'dealer removed')
  return out.length ? out : ['no change']
}

const fmtDay = (dateStr) => {
  const [, m, dd] = dateStr.split('-').map(Number)
  return `${dd} ${MON[m - 1]}`
}

export default function App() {
  const [mode, setMode] = useState('entry')
  const [staffFocus, setStaffFocus] = useState('')
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

  // One date for the whole book. Entry, totals and register each used to hold
  // their own, so stepping back on one screen and switching to another put you
  // silently back on today — the past date was only ever on the screen it was
  // chosen on. Null means "the open register day", so a phone left open
  // overnight follows the date over instead of sticking to yesterday.
  const [viewing, setViewing] = useState(null)

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
    if (entry.staffPaymentId) { setStaffFocus(entry.name); setMode('staff'); return }
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
    const staffEntry = batch.find(e => e.staffPaymentId)
    if (staffEntry) { setStaffFocus(staffEntry.name); setMode('staff'); return }
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
  const closeDay = (date, counted, cashCounts) => {
    const at = Date.now()
    setCloses((prev) => {
      const next = { ...prev, [date]: { counted, cashCounts, at, updatedAt: at } }
      writeCache(CLOSES_KEY, next)
      return next
    })
    queue({ t: 'close', date, counted, cashCounts, at, updatedAt: at })
    clearCountDraft(`close:${date}`)
    const book = bookAtEnd(store, closes, openings, date, 'cash')
    const off = counted - book
    record('close', date, `Counted ${inr(counted)}, register ${inr(book)}`,
      { changes: [...(off === 0 ? ['Tallied'] : [`${off < 0 ? 'Short' : 'Over'} ${inr(Math.abs(off))}`]), ...describeCounts(cashCounts)] })
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

  // The shutters never went up, so there is no drawer to count: the day closes
  // on the figure it opened with, and the register moves on to the next one.
  const shutDay = (date) => {
    const book = bookAtEnd(store, closes, openings, date, 'cash')
    const at = Date.now()
    setCloses((prev) => {
      const next = { ...prev, [date]: { counted: book, at, updatedAt: at, shut: true } }
      writeCache(CLOSES_KEY, next)
      return next
    })
    queue({ t: 'close', date, counted: book, shut: true, at, updatedAt: at })
    record('shut', date, 'Shop closed — nothing traded')
  }

  // Touching an entry that already exists needs the password — including one
  // written ten minutes ago. The window is held in memory only, so closing the
  // app re-locks it.
  // What the shop was holding when the book was started, or on any day it needs
  // correcting. Both sides at once, because a day has one starting position.
  const [openings, setOpenings] = useState(() => loadCash(OPENINGS_KEY))
  const setOpening = (date, cash, online, cashCounts = null, bankBalances = null) => {
    const at = Date.now()
    const before = openings[date]
    setOpenings((prev) => {
      const next = { ...prev, [date]: { cash, online, cashCounts, bankBalances, at, updatedAt: at } }
      writeCache(OPENINGS_KEY, next)
      return next
    })
    queue({ t: 'opening', date, cash, online, cashCounts, bankBalances, at, updatedAt: at })
    clearCountDraft(`open-cash:${date}`)
    clearCountDraft(`open-online:${date}`)
    record('opening', date, `Opening cash ${inr(cash)}, online ${inr(online)}`, {
      changes: [...(before
        ? [`cash ${inr(before.cash)} → ${inr(cash)}`, `online ${inr(before.online)} → ${inr(online)}`]
            .filter((_, i) => (i ? before.online !== online : before.cash !== cash))
        : []), ...describeCounts(cashCounts), ...describeCounts(bankBalances, true)],
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
          const row = { id: r.entryId, date: r.date, kind: r.kind, mode: r.mode, name: r.name, amount: r.amount, at: r.at, updatedAt: r.updatedAt, dealer: !!r.dealer, staffPaymentId: r.staffPaymentId }
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
        else if (r.updatedAt > (next[r.date]?.updatedAt || 0)) next[r.date] = { counted: r.counted, cashCounts: r.cashCounts, at: r.at, updatedAt: r.updatedAt, shut: !!r.shut }
      }
      writeCache(CLOSES_KEY, next)
      return next
    })

    if (server.openings.length) setOpenings((prev) => {
      const next = { ...prev }
      for (const r of server.openings) {
        if (r.deleted) delete next[r.date]
        else if (r.updatedAt > (next[r.date]?.updatedAt || 0)) next[r.date] = { cash: r.cash, online: r.online, cashCounts: r.cashCounts, bankBalances: r.bankBalances, at: r.at, updatedAt: r.updatedAt }
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

  const [photoPending, setPhotoPending] = useState(0)
  const [sync, setSync] = useState({ pending: pendingCount(), busy: false, at: 0, error: '' })
  const syncing = useRef(false)
  const runSync = async () => {
    if (syncing.current) return
    syncing.current = true
    setSync((p) => ({ ...p, busy: true }))
    const res = await flush(applyPulled)
    if (res.ok) {
      try { await flushPhotos() } catch { /* photo pages remain queued */ }
    }
    try { setPhotoPending(await pendingPhotos()) } catch { /* storage unavailable */ }
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
  const startEdit = (entry) => {
    if (entry.staffPaymentId) { setStaffFocus(entry.name); setMode('staff'); return }
    setEditing(entry); setMode('entry')
  }

  /**
   * A saved line shows itself in the register, marked, for a few seconds.
   *
   * Writing a note and being returned to an empty keypad leaves nothing to look
   * at, and the only way to be sure it went in was to go and check. Now it
   * takes you to the page it landed on and points at the line.
   */
  const [flash, setFlash] = useState(null)
  const showInRegister = (id) => {
    setMode('report')
    setFlash(id)
  }
  useEffect(() => {
    if (!flash) return undefined
    const t = setTimeout(() => setFlash(null), 2600)
    return () => clearTimeout(t)
  }, [flash])

  const dealerNames = useMemo(() => {
    const names = new Set()
    for (const e of allEntries(store)) {
      if (e.dealer && e.name) names.add(e.name.trim().toLowerCase())
    }
    return names
  }, [store])

  // Counting the drawer finishes the day, so the register moves on: whatever
  // comes in after that belongs to the next one, whatever the clock says.
  const registerBase = closes[todayKey] ? nextKey(todayKey) : todayKey
  // Come home when the register itself moves — a real rollover past midnight,
  // or the drawer being counted — whichever screen happens to be open.
  useEffect(() => { setViewing(null) }, [registerBase])

  const shared = {
    cursor, setCursor, todayKey, store, closes, openings, guard,
    viewing, setViewing, base: registerBase,
    editing, setEditing, onStartEdit: startEdit,
    onAdd: addEntries, onUpdate: updateEntry, onRemove: removeEntries,
    onClose: closeDay, onReopen: reopenDay, onShut: shutDay,
    onSetOpening: setOpening, onRemoveOpening: removeOpening,
    dealerNames, onSaved: showInRegister, flash,
    onSync: runSync,
    onEditOpenings: () => setMode('edit'),
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
            {sync.pending + photoPending > 0 && <span className="syncdot">{sync.pending + photoPending > 99 ? '99+' : sync.pending + photoPending}</span>}
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
        {mode === 'staff' ? <StaffPayments today={todayKey} date={viewing || todayKey} onDate={setViewing} onSaved={runSync} guard={guard} initialStaff={staffFocus} />
          : mode === 'search' ? <CashSearch store={store} onPick={(entry) => {
            setViewing(entry.date)
            showInRegister(entry.id)
          }} />
          : mode === 'entry' ? <CashEntry {...shared} />
          : mode === 'totals' ? <CashTotals {...shared} />
            : mode === 'report' ? <CashReport {...shared} />
              : mode === 'analytics' ? <CashAnalytics {...shared} />
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
  search: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" /><path d="m15 15 6 6" />
    </svg>
  ),
  staff: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="7" r="4" /><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 4a4 4 0 0 1 0 8M22 21v-2a7 7 0 0 0-4-6" />
    </svg>
  ),
  analytics: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M7.5 15.8V12M12 15.8V8.6M16.5 15.8v-2.4" />
    </svg>
  ),
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
  { id: 'search', label: 'Search' },
  { id: 'staff', label: 'Staff' },
  { id: 'analytics', label: 'Analytics' },
]

function TabBar({ mode, setMode }) {
  return (
    <nav className="tabbar" aria-label="Sections" style={{ '--navcount': NAV_ITEMS.length }}>
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          className="tabitem"
          data-on={mode === item.id || (mode === 'edit' && item.id === 'totals') ? 'true' : undefined}
          aria-current={mode === item.id || (mode === 'edit' && item.id === 'totals') ? 'page' : undefined}
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
function LineModal({ entry, onEdit, onDelete, onReverse, onClose }) {
  const staff = !!entry.staffPaymentId
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /**
   * A staff payment cannot simply be struck out of the register.
   *
   * It is one of three records written together — the drawer line, the wage or
   * advance against that person, and a voucher in the books — so deleting the
   * line alone would leave the other two saying money went out that the drawer
   * says never did. Reversing undoes all three, which is why this asks rather
   * than just doing it, and why it does not go through the ordinary delete.
   */
  const reverse = async () => {
    setBusy(true)
    setError('')
    try {
      await convex().mutation(anyApi.staffPay.reverse, { requestId: entry.staffPaymentId })
      await onReverse?.()
      onClose()
    } catch (e) {
      setError(String(e?.data ?? e?.message ?? e).split('\n')[0])
      setBusy(false)
    }
  }

  return (
    <div className="modal" onClick={busy ? undefined : onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="lineamt">{inr(entry.amount)}</div>
        <div className="sheetsub">
          {entry.kind === 'in' ? 'Received' : 'Paid'} · {entry.mode === 'online' ? 'Online' : 'Cash'}
          {entry.dealer ? ' · Dealer' : ''} · {entry.name}
        </div>

        {staff && asking && (
          <p className="sheetnote">
            This also takes back {entry.name}’s wage or advance and removes its voucher from
            the books. It cannot be undone from here.
          </p>
        )}
        {error && <p className="sheetnote bad">{error}</p>}

        <div className="sheetbtns">
          <button className="ghostbtn" disabled={busy} onClick={asking ? () => setAsking(false) : onClose}>
            {asking ? 'Keep it' : 'Cancel'}
          </button>
          {staff ? (
            <button className="delbtn" disabled={busy} onClick={asking ? reverse : () => setAsking(true)}>
              {busy ? 'Deleting…' : asking ? 'Yes, delete' : 'Delete'}
            </button>
          ) : (
            <button className="delbtn" onClick={onDelete}>Delete</button>
          )}
          {!asking && (
            <button className="primbtn" onClick={onEdit}>{staff ? 'Staff payments' : 'Edit'}</button>
          )}
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
  todayKey, store, closes, openings, guard, viewing, setViewing, base,
  editing, setEditing, onAdd, onUpdate, dealerNames, onSaved, onSync,
}) {
  const closedToday = !!closes[todayKey]
  const dk = viewing || base
  const onClosed = dk !== base
  // The arrows reach any day, back or forward. Looking is free; writing into a
  // day that is not the open register is what asks for the password.
  const step = (n) => {
    const k = shiftKey(dk, n)
    setViewing(k === base ? null : k)
  }
  const shut = isShutDay(closes, store, todayKey, dk)
  const dayLabel = shut
    ? 'Shop closed'
    : !onClosed
      ? (closedToday ? 'New day' : "Today's register")
      : dk < base
        ? (closes[dk] ? 'Closed day' : 'Past day')
        : 'Future day'
  const day = dateFromKey(dk)
  const dayEntries = useMemo(
    () => (store[dk.slice(0, 7)] || []).filter((e) => e.date === dk).slice().sort((a, b) => a.at - b.at),
    [store, dk],
  )

  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState('')      // '' until the cashier picks a side
  const [mode, setMode] = useState('cash')
  const [name, setName] = useState('')
  const [dealer, setDealer] = useState(false)
  const [photoFiles, setPhotoFiles] = useState([])
  const [photoError, setPhotoError] = useState('')
  const [photoRetryId, setPhotoRetryId] = useState(null)
  const [savingPhoto, setSavingPhoto] = useState(false)
  const photoInput = useRef(null)
  const photoBatchId = useRef(crypto.randomUUID())

  const reset = () => {
    setAmount(''); setKind(''); setMode('cash')
    setName(''); setDealer(false); setEditing(null)
    setPhotoFiles([]); setPhotoError(''); setPhotoRetryId(null)
    photoBatchId.current = crypto.randomUUID()
    setNaming(false); noteRef.current?.blur()
  }

  /**
   * Which keyboard the bottom of the screen is showing.
   *
   * A line is written in one direction — figure, then which way it went, then
   * who it was — and the keyboard needed changes twice on the way. So it
   * changes itself: the pad is up for the amount, and choosing Received or Paid
   * hands over to the phone's own keyboard for the name.
   *
   * The phone's keyboard rather than a QWERTY drawn in here, because it is the
   * one that already knows this person's autocorrect, their Hindi, and where
   * their thumbs expect the letters to be.
   *
   * Touching either box overrides all of it. The amount box takes the pad back,
   * the name box brings the letters up, and nothing is ever more than one tap
   * from the keys you want.
   */
  const noteRef = useRef(null)
  const [naming, setNaming] = useState(false)

  const toName = () => {
    // The Note field is already mounted. Focus during the tap itself so the
    // PWA can open the software keyboard; a timer loses that user gesture.
    // onFocus hides the number pad only once focus actually reaches the field.
    noteRef.current?.focus()
  }
  const toAmount = () => {
    setNaming(false)
    noteRef.current?.blur()
  }

  // Only a payment can be to a dealer. Switching to Received takes the mark off
  // rather than hiding a flag that is still set underneath.
  const pickKind = (k) => {
    setKind(k)
    if (k !== 'out') setDealer(false)
    // The figure is in and the direction is settled; what is left is the name.
    if (value > 0) toName()
  }

  // The amount is typed on the pad, not on the phone keyboard, so a half-typed
  // figure is never hidden behind one.
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
    setName(editing.name || ''); setDealer(!!editing.dealer)
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

  // Typing a name the book already knows as a dealer marks the line without
  // being asked. It runs on the name and the direction changing, not on every
  // render, so a cashier who unticks it keeps it unticked.
  useEffect(() => {
    const n = name.trim().toLowerCase()
    if (n && kind === 'out' && dealerNames?.has(n)) setDealer(true)
  }, [name, kind, dealerNames])

  const value = Math.round(Number(amount) || 0)
  const ready = value > 0 && !!kind && !!name.trim()

  /**
   * The names this counter writes again and again, as buttons.
   *
   * Three is the threshold: twice is a coincidence, three times is a habit —
   * a majduri, a tempo, a regular. Nobody maintains this list; a name earns its
   * button by being typed, and loses it by not being.
   *
   * Kept to the direction being written, because "Bhabhi ji" is always money
   * out and offering her under Received would only be in the way. The spelling
   * shown is the most recent one, so correcting a name once corrects the chip.
   */
  const [resets, setResets] = useState(() => readCache(KEYRESET_KEY, {}))
  const [askClear, setAskClear] = useState(null)

  /**
   * Hold a key down to clear its count.
   *
   * There is nowhere else to offer this — the keys have no settings screen and
   * should not grow one — and a long press is what a phone already means by
   * "do something to this thing rather than with it". Half a second, and
   * sliding a thumb off cancels it, because these keys sit right above a keypad
   * that is being tapped at speed.
   */
  const holdTimer = useRef(null)
  const heldOpen = useRef(false)
  const holdStart = (f) => {
    heldOpen.current = false
    clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(() => {
      heldOpen.current = true
      setAskClear(f)
    }, 500)
  }
  const holdEnd = () => clearTimeout(holdTimer.current)
  useEffect(() => () => clearTimeout(holdTimer.current), [])
  const clearCount = (key) => setResets((prev) => {
    const next = { ...prev, [`${kind}:${key}`]: Date.now() }
    writeCache(KEYRESET_KEY, next)
    return next
  })

  const frequent = useMemo(() => {
    const seen = new Map()
    for (const e of allEntries(store)) {
      const written = (e.name || '').trim()
      if (!written || e.kind !== kind) continue
      const key = written.toLowerCase()
      // A bill number is not a payee. "10" turns up constantly and means a
      // different bill every time, so a key for it would be a key for nothing.
      if (/^[0-9\s/-]+$/.test(key)) continue
      // W/B has its own button an inch away; a second one is just a second one.
      if (key === 'w/b' || key === 'wb') continue
      // Written before this key's count was cleared, so it does not go towards
      // earning it back. The entry itself is untouched and still in the book.
      if (e.at <= (resets[`${kind}:${key}`] || 0)) continue
      const row = seen.get(key) || { key, name: written, n: 0, last: 0 }
      row.n += 1
      if (e.at >= row.last) { row.last = e.at; row.name = written }
      seen.set(key, row)
    }
    return [...seen.values()]
      .filter((r) => r.n >= 3)
      .sort((a, b) => b.n - a.n || b.last - a.last)
      .slice(0, 12)
  }, [store, kind, resets])

  const savePages = async (id) => {
    if (!photoFiles.length) { reset(); onSaved?.(id); return }
    setSavingPhoto(true)
    try {
      await enqueuePhotos(id, photoFiles, photoBatchId.current)
      // Cash sync may already have started while the camera compressed these
      // pages. Give that pass time to finish, then send the durable photo queue.
      setTimeout(() => { void onSync?.() }, 2000)
      reset()
      onSaved?.(id)
    } catch (error) {
      setPhotoRetryId(id)
      setPhotoError(error?.message || 'Could not keep the photo on this phone. Try again.')
    } finally { setSavingPhoto(false) }
  }

  const commit = () => {
    if (!ready || savingPhoto) return
    if (photoRetryId) { void savePages(photoRetryId); return }
    const clean = name.trim()
    if (editing) { // the password was already given when the edit started
      onUpdate({ ...editing, kind, mode, name: clean, amount: value, dealer })
      void savePages(editing.id)
      return
    }
    const at = Date.now()
    const id = `c-${at}-${Math.random().toString(36).slice(2, 7)}`
    const batch = [{ id, date: dk, kind, mode, name: clean, amount: value, at, dealer }]
    const done = () => { onAdd(batch); setPhotoRetryId(id); void savePages(id) }
    // The log carries corrections, so a line added to the open register goes
    // straight in. Writing into any other day — behind or ahead — asks first.
    if (!onClosed) done(); else guard(done)
  }

  return (
    <>
      <div className="datenav">
        <button onClick={() => step(-1)} aria-label="Previous day">‹</button>
        <div className="dcenter">
          <div className="dbig">{WD[day.getDay()]}, {day.getDate()} {MON[day.getMonth()]}</div>
          <div className={`daysub ${onClosed ? 'away' : ''}`}>{dayLabel}</div>
        </div>
        <button onClick={() => step(1)} aria-label="Next day">›</button>
      </div>

      {onClosed && (
        <button className="backtoday" onClick={() => setViewing(null)}>
          Back to {closedToday ? 'the new day' : 'today'}
        </button>
      )}

      {editing && (
        <div className="editbanner">
          Editing the {fmtTime(editing.at)} entry
          <button onClick={reset}>Cancel</button>
        </div>
      )}

      <button
        type="button"
        className={`amtshow ${value ? '' : 'empty'}${naming ? '' : ' live'}`}
        aria-live="polite"
        aria-label="Edit the amount"
        onClick={toAmount}
      >
        <span className="amtcur">₹</span>
        <span className={`amtnum${fit(value ? value.toLocaleString('en-IN') : '0')}`}>
          {value ? value.toLocaleString('en-IN') : '0'}
        </span>
      </button>

      <div className="dirrow">
        <button className={`dirbtn in ${kind === 'in' ? 'sel' : ''}`} onClick={() => pickKind('in')}>
          <InIcon /> Received
        </button>
        <button className={`dirbtn out ${kind === 'out' ? 'sel' : ''}`} onClick={() => pickKind('out')}>
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

      {frequent.length > 0 && (
        <div className="freqrow">
          {frequent.map((f) => (
            <button
              key={f.key}
              className={`freqchip${name.trim().toLowerCase() === f.key ? ' sel' : ''}`}
              onPointerDown={() => holdStart(f)}
              onPointerUp={holdEnd}
              onPointerLeave={holdEnd}
              onPointerCancel={holdEnd}
              onContextMenu={(e) => { e.preventDefault(); setAskClear(f) }}
              onClick={() => {
                // A press long enough to open the menu already did its job; the
                // click the browser sends afterwards must not also fill the name.
                if (heldOpen.current) { heldOpen.current = false; return }
                setName((cur) => (cur.trim().toLowerCase() === f.key ? '' : f.name))
              }}
            >
              {f.name}
            </button>
          ))}
        </div>
      )}

      <div className="advrow">
        <input
          ref={noteRef}
          className={`noteinput${naming ? ' live' : ''}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={() => setNaming(true)}
          onBlur={() => setNaming(false)}
          placeholder="NOTE"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          enterKeyHint={ready ? 'done' : 'next'}
          onKeyDown={(e) => { if (e.key === 'Enter' && ready) commit() }}
        />
        <button className={`wbbtn ${hasWB ? 'sel' : ''}`} onClick={toggleWB}>W/B</button>
        {kind === 'out' && (
          <button
            className={`wbbtn dealerbtn ${dealer ? 'sel' : ''}`}
            onClick={() => setDealer((d) => !d)}
          >
            Dealer
          </button>
        )}
      </div>

      <div className="billphoto-row">
        <input ref={photoInput} type="file" accept="image/*" capture="environment" multiple hidden
          onChange={(event) => {
            const picked = [...(event.target.files || [])]
            setPhotoFiles((current) => [...current, ...picked])
            setPhotoError('')
            event.target.value = ''
          }} />
        <button type="button" className="billphoto-button" onClick={() => photoInput.current?.click()}>
          📷 Bill photo{photoFiles.length ? ` · ${photoFiles.length} page${photoFiles.length === 1 ? '' : 's'}` : ''}
        </button>
        {photoFiles.map((file, index) => (
          <div className="billphoto-page" key={`${file.name}-${index}`}>
            <span>Page {index + 1} · {file.name || 'Photo'}</span>
            <button type="button" aria-label={`Remove page ${index + 1}`} onClick={() =>
              setPhotoFiles((current) => current.filter((_, at) => at !== index))}>×</button>
          </div>
        ))}
        {photoError && <div className="billphoto-error" role="alert">Cash saved. {photoError}</div>}
      </div>

      <button
        className="tickbar" onClick={commit} disabled={!ready || savingPhoto}
        aria-label={photoRetryId ? 'Retry bill photo' : editing ? 'Update entry' : 'Save entry'}
      >
        {savingPhoto ? '…' : photoRetryId ? 'Retry photo' : '✓'}
      </button>

      {/* Backspace takes the twelfth cell now that the tick has its own bar.
          Clear went with it: holding a wrong amount is two taps from gone. */}
      {askClear && (
        <div className="modal" onClick={() => setAskClear(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="lineamt small">{askClear.name}</div>
            <div className="sheetsub">
              Written {askClear.n} times. Clearing puts the count back to nil and
              takes the key away — write it three more times and it comes back.
              Every one of those entries stays exactly where it is.
            </div>
            <div className="sheetbtns">
              <button className="ghostbtn" onClick={() => setAskClear(null)}>Cancel</button>
              <button
                className="delbtn"
                onClick={() => { clearCount(askClear.key); setAskClear(null) }}
              >
                Clear the count
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="pad" hidden={naming}>
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
function SplitModal({ title, items, draftKey, initialValues, compare, confirmLabel, onCancel, onConfirm }) {
  const [vals, setVals] = useState(() => readCache(DRAFT_KEY, {})[draftKey] ?? initialValues ?? {})
  const setOne = (key, raw) => setVals((prev) => {
    if (raw !== '' && !/^\d+$/.test(raw)) return prev
    const v = raw
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
  const pieces = items.reduce((sum, it) => sum + (it.plain ? 0 : n(it)), 0)
  const ready = Object.keys(vals).length > 0 && items.every((it) => Number.isSafeInteger(n(it)) && n(it) >= 0) && Number.isSafeInteger(total)
  const diff = compare == null ? 0 : total - compare

  const done = () => {
    // Opening counts remain a draft until the opening balance itself is saved.
    onConfirm(total, Object.fromEntries(items.map((it) => [it.key, n(it)])))
  }

  return (
    <div className="modal top" onClick={onCancel}>
      <div className="sheet closesheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheettitle">{title}</div>

        <div className="denoms">
          {items.map((it, i) => (
            <div className={`denom ${n(it) ? 'has' : ''} ${it.plain ? 'plain' : ''}`} key={it.key}>
              <span className="dv">{it.label}</span>
              <span className="dx">{it.plain ? '₹' : '×'}</span>
              <input
                type="number" inputMode="numeric" min="0"
                aria-label={it.plain ? `${it.label} balance` : `${it.label} count`}
                autoFocus={i === 0}
                value={vals[it.key] ?? ''}
                onChange={(e) => setOne(it.key, e.target.value)}
              />
              <span className="dsub">{!it.plain && n(it) ? num(it.mult * n(it)) : ''}</span>
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
// `plain` rows take a rupee figure read off an app, not a count of pieces.
const BANK_ITEMS = BANKS.map((b) => ({ key: b, label: b, mult: 1, plain: true }))

function describeCounts(counts, bank = false) {
  if (!counts) return []
  return (bank ? BANKS : DENOMS.map(String)).map((key) => bank
    ? `${key}: ${inr(counts[key] || 0)}`
    : `₹${key} × ${counts[key] || 0} = ${inr(Number(key) * (counts[key] || 0))}`)
}

function CountBreakdown({ cashCounts, bankBalances }) {
  if (!cashCounts && !bankBalances) return null
  return (
    <details className="saved-counts">
      <summary>Denominations and bank breakdown</summary>
      {describeCounts(cashCounts).map((line) => <div key={line}>{line}</div>)}
      {describeCounts(bankBalances, true).map((line) => <div key={line}>{line}</div>)}
    </details>
  )
}

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
function CashTotals({
  todayKey, store, closes, openings, guard, viewing, setViewing, base, onClose, onReopen, onShut, onEditOpenings,
}) {
  const [asking, setAsking] = useState(false)
  const dk = viewing || base
  const isToday = dk === base
  const day = dateFromKey(dk)

  // Looking is free and reaches any day, back or forward; it is writing that
  // asks for the password. The arrows match the entry screen's, and move the
  // same cursor, so all three screens stay on the day you chose.
  const step = (n) => {
    const k = shiftKey(dk, n)
    setViewing(k === base ? null : k)
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
  const closeCash = balanceClose(store, closes, openings, dk, 'cash')
  const counted = !!closes[dk]
  // Once the drawer is counted the big figure is the count, not the sum — so
  // the line under it has to stop showing a sum that no longer reaches it.
  const bookCash = openCash + salesCash - paidCash
  const off = counted ? closeCash - bookCash : 0

  /**
   * What online did today, which is a movement and not a balance.
   *
   * There used to be a figure here called the online closing balance, worked
   * out as opening + in − out and added to the drawer under the heading "cash
   * and online together". Nobody has ever typed an online opening, so that sum
   * started from zero every time and what it actually showed was the day's
   * online in minus its online out — a number that is neither the money in the
   * bank nor the money taken online, sitting in the one place on the screen
   * that is supposed to say what the shop is holding.
   *
   * The bank balance is not knowable from this book: money reaches and leaves
   * those accounts without passing the counter. So the book says what it knows
   * — what came in, what went out — and stops.
   */
  const onlineNet = salesOnline - paidOnline

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

      <button className="sp-button sp-secondary sp-opening" onClick={onEditOpenings}>Edit opening balances</button>
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

      <div className="hero onlinehero">
        <div className="herolabel">Online today</div>
        <div className={`heronum${fit(inr(Math.abs(onlineNet)))}`}>
          {onlineNet < 0 ? '−' : '+'}{inr(Math.abs(onlineNet))}
        </div>
        <div className="herosplit">
          <span className="hs in"><i />Received {inr(salesOnline)}</span>
          <span className="hs out"><i />Paid {inr(paidOnline)}</span>
        </div>
        <div className="herofoot">bank and UPI — none of this is in the drawer</div>
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
        <div className="herofoot">
          {counted
            ? closes[dk].shut
              ? 'shop closed — nothing traded'
              : `counted and closed · ${isToday ? 'tomorrow opens here' : 'carried into the next day'}`
            : isToday
              ? 'tomorrow opens here'
              : 'carried into the next day'}
        </div>
      </div>

      {counted && <CountBreakdown cashCounts={closes[dk].cashCounts} />}

      {/* Directly under the figure it is counted against. */}
      {counted
        ? (
          <button className="allbtn ghost" onClick={() => guard(() => onReopen(dk))}>
            {closes[dk].shut ? 'Shop was open — undo' : 'Reopen this day'}
          </button>
        )
        : (
          <div className="closerow">
            <button className="allbtn danger" onClick={() => setAsking(true)}>Close the day</button>
            {/* Marking the live day shut is as ordinary as closing it; doing it
                to a day already gone is a change to the past, so it asks. */}
            <button
              className="allbtn ghost"
              onClick={() => (dk === base ? onShut(dk) : guard(() => onShut(dk)))}
            >
              Shop closed
            </button>
          </div>
        )}

      {asking && (
        <CloseDayModal
          date={dk} bookCash={bookCash}
          onCancel={() => setAsking(false)}
          onConfirm={(c, counts) => { onClose(dk, c, counts); setAsking(false) }}
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
  const [cashCounts, setCashCounts] = useState(null)
  const [bankBalances, setBankBalances] = useState(null)
  const [assist, setAssist] = useState(null)   // 'cash' | 'online'

  const existing = openings[date]
  // Show whatever that day already carries, so saving corrects rather than
  // silently replaces a figure the cashier cannot see.
  useEffect(() => {
    const cur = openings[date]
    setCash(cur ? String(cur.cash ?? '') : '')
    setOnline(cur ? String(cur.online ?? '') : '')
    setCashCounts(cur?.cashCounts ?? null)
    setBankBalances(cur?.bankBalances ?? null)
  }, [date, openings])

  const ready = !!date && (cash.trim() !== '' || online.trim() !== '')
  const save = () => {
    if (!ready) return
    guard(() => onSetOpening(date, Math.round(Number(cash) || 0), Math.round(Number(online) || 0), cashCounts, bankBalances))
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
          <input type="number" inputMode="numeric" value={cash} onChange={(e) => { setCash(e.target.value); setCashCounts(null); clearCountDraft(`open-cash:${date}`) }} placeholder="0" />
        </label>
        <label className="balfield online">
          <span>
            Online
            <button className="assistbtn" onClick={(e) => { e.preventDefault(); setAssist('online') }} aria-label="Add up the bank accounts">
              <SplitIcon />
            </button>
          </span>
          <input type="number" inputMode="numeric" value={online} onChange={(e) => { setOnline(e.target.value); setBankBalances(null); clearCountDraft(`open-online:${date}`) }} placeholder="0" />
        </label>
      </div>

      {assist === 'cash' && (
        <SplitModal
          title="Count the drawer" items={DENOM_ITEMS} draftKey={`open-cash:${date}`} initialValues={cashCounts}
          confirmLabel="Use this total"
          onCancel={() => setAssist(null)}
          onConfirm={(t, counts) => { setCash(String(t)); setCashCounts(counts); setAssist(null) }}
        />
      )}
      {assist === 'online' && (
        <SplitModal
          title="Bank balances" items={BANK_ITEMS} draftKey={`open-online:${date}`} initialValues={bankBalances}
          confirmLabel="Use this total"
          onCancel={() => setAssist(null)}
          onConfirm={(t, balances) => { setOnline(String(t)); setBankBalances(balances); setAssist(null) }}
        />
      )}

      <CountBreakdown cashCounts={cashCounts} bankBalances={bankBalances} />
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

// ── Printing from a home-screen app on iOS ──────────────────────────────────
// window.print() is not implemented in an iOS home-screen app: the call returns
// having done nothing, with no error to catch, which is why the button looks
// dead there and works everywhere else. The way out is the browser, whose share
// menu has AirPrint on it.
//
// The sheet is carried across as markup rather than left to be rebuilt from
// storage in the new tab. A home-screen app and the browser do not necessarily
// share a storage container on iOS, so a tab told to render "today" could open
// on an empty book — whereas the page that is already on screen is the page
// that was asked for.
// The day as a PDF, handed to the system share sheet. On iOS that sheet has
// AirPrint on it, which is the way out of a home-screen app being unable to
// print at all; it is also how the sheet reaches WhatsApp or Files, which is
// where a day's register usually ends up anyway.
async function shareSheet(data, filename) {
  const bytes = registerPdf(data)
  const file = new File([bytes], filename, { type: 'application/pdf' })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch (err) {
      // Dismissing the sheet is not a failure and must not fall through to a
      // download the cashier did not ask for.
      if (err?.name === 'AbortError') return
    }
  }

  // A desktop browser has no share sheet but does have a working print dialog.
  if (window.navigator.standalone !== true) { window.print(); return }

  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

function CashReport({
  todayKey, store, closes, openings, viewing, setViewing, base,
  onRemove, onStartEdit, dealerNames, flash, onSync,
}) {
  // Counting the drawer finishes the day, so the register moves on with the
  // entry screen: once today is closed, the day the book is open at is
  // tomorrow, and that is as far forward as it goes. Without this the report
  // stayed on the closed day while entries were already being written on the
  // next one, with no way to reach them.
  const closedToday = !!closes[todayKey]
  const dk = viewing || base
  const isToday = dk === base
  const day = dateFromKey(dk)
  const [picked, setPicked] = useState(null)
  // Tuesday, or any day marked shut, is stamped across the page rather than
  // left looking like a day somebody forgot to write up.
  const shut = looksShut(closes, store, todayKey, dk)

  useEffect(() => { setPicked(null) }, [dk])
  useEffect(() => {
    if (!flash) return
    const frame = requestAnimationFrame(() => document.querySelector('.justsaved')?.scrollIntoView({ block: 'center' }))
    return () => cancelAnimationFrame(frame)
  }, [flash, dk])

  const lines = useMemo(
    () => (store[dk.slice(0, 7)] || []).filter((e) => e.date === dk).slice().sort((a, b) => a.at - b.at),
    [store, dk],
  )

  const step = (n) => {
    const k = shiftKey(dk, n)
    setViewing(k === base ? null : k)
  }

  // A day closed while the report is open should carry it forward too, rather
  // than leaving it sitting on the day that was just finished.

  const opening = balanceOpen(store, closes, openings, dk, 'cash')
  // The bank side of the book, for the printed sheet. The screen does not show
  // a bank balance — nobody types an opening for it, so it would be a running
  // total wearing a balance's clothes — but the cash book on paper has a Bank
  // column and a column has to close somewhere.
  const openingBank = balanceOpen(store, closes, openings, dk, 'online')

  // This is a cash register, and online money never reaches the drawer.
  //
  // It used to be written on BOTH sides — once where it happened, once against
  // itself — so that the columns still subtracted to cash. That is a bookkeeping
  // trick, and it read as one: every online receipt appeared as a payment out,
  // every online payment as a receipt in, and both totals were inflated by money
  // nobody could count. The columns are cash now. Online is a section of its own
  // with its own total, below.
  //
  // The cash figure is unchanged by this — the mirrored copies only ever
  // cancelled each other — so a day closed under the old page still tallies.
  //
  // A line written before the name was known to be a dealer still belongs to
  // that dealer, so the page reads the name rather than only the flag.
  const isDealer = useCallback(
    (e) => !!e.dealer || !!dealerNames?.has((e.name || '').trim().toLowerCase()),
    [dealerNames],
  )

  const { ins, outs, onlineIn, onlineOut } = useMemo(() => {
    const ins = []
    const outs = []
    const onlineIn = []
    const onlineOut = []
    for (const e of lines) {
      if (e.mode === 'online') (e.kind === 'in' ? onlineIn : onlineOut).push(e)
      else (e.kind === 'in' ? ins : outs).push(e)
    }
    return { ins, outs, onlineIn, onlineOut }
  }, [lines])

  const sum = (list) => list.reduce((t, e) => t + Number(e.amount || 0), 0)
  const received = opening + sum(ins)
  const paid = sum(outs)
  // Opening + cash in − cash out. Nothing else can reach the drawer, so nothing
  // else belongs in the figure the evening count is checked against.
  const book = received - paid
  const onlineInTotal = sum(onlineIn)
  const onlineOutTotal = sum(onlineOut)
  const onlineNet = onlineInTotal - onlineOutTotal
  const close = closes[dk]
  const diff = close ? Number(close.counted || 0) - book : 0

  const remove = (e) => { onRemove([e]); setPicked(null) }

  /**
   * The day handed to the printer.
   *
   * The screen is the shop's bahi; the sheet is a double column cash book, which
   * is what anybody outside the shop expects to be given. Both are the same day
   * and the same figures — the receipts and payments go across whole, each line
   * carrying whether it was bank or drawer, and the sheet puts it in its column.
   * Nothing is added up twice in two places.
   */
  const asRow = (e) => ({
    name: e.name,
    amount: Number(e.amount || 0),
    bank: e.mode === 'online',
    dealer: isDealer(e),
  })
  const sheetData = () => ({
    shut,
    dateLabel: `${pad(day.getDate())}/${pad(day.getMonth() + 1)}/${String(day.getFullYear()).slice(2)}`,
    dayLabel: `${WD[day.getDay()]}, ${day.getDate()} ${MON[day.getMonth()]} ${day.getFullYear()}`,
    openCash: opening,
    openBank: openingBank,
    receipts: lines.filter((e) => e.kind === 'in').map(asRow),
    payments: lines.filter((e) => e.kind === 'out').map(asRow),
    closeCash: book,
    closeBank: openingBank + onlineInTotal - onlineOutTotal,
    counted: close ? Number(close.counted || 0) : null,
    diff: {
      amount: Math.abs(diff),
      word: diff === 0 ? 'TALLIED' : diff < 0 ? 'SHORT' : 'OVER',
      ok: diff === 0,
    },
  })

  return (
    <>
      <div className="datenav">
        <button onClick={() => step(-1)} aria-label="Previous day">‹</button>
        <div className="dcenter">
          <div className="dbig">{WD[day.getDay()]}, {day.getDate()} {MON[day.getMonth()]}</div>
          {isToday
            ? <div className={`daysub ${shut ? 'away' : ''}`}>
                {shut ? 'Shop closed' : closedToday ? 'New day' : 'Register'}
              </div>
            : <button className="todaybtn" onClick={() => setViewing(null)}>Go to today</button>}
        </div>
        <button onClick={() => step(1)} aria-label="Next day" disabled={isToday}>›</button>
      </div>

      <div className="page">
        {/* Angled across the sheet like a rubber stamp, because a closed day
            and a day nobody has written up yet look identical otherwise. */}
        {shut && (
          <div className="shutstamp">
            <div className="ssbox">
              <span className="ssmain">SHOP CLOSED</span>
              <span className="sssub">दुकान बंद</span>
            </div>
          </div>
        )}
        <div className="pagetop">
          <div className="pagestamp">
            <span>Date</span>
            <b>{pad(day.getDate())}/{pad(day.getMonth() + 1)}/{String(day.getFullYear()).slice(2)}</b>
          </div>
        </div>

        {/* The page names no columns — the cashier knows which side is which.
            What stands above the rule is what was carried in from last night. */}
        <div className="pagehdr">
          <span className="pentry">
            <span className="pamt">{num(opening)}</span>
            <span className="peq">=</span>
            <span className="pname ob">O/B</span>
          </span>
          <span />
        </div>

        {/* Each side is its own column of lines, not two halves of a shared
            row. The book totals a column under its own last entry, and pairing
            the sides row by row left the shorter one waiting on the longer
            before it could be added up. */}
        <div className="pagebody">
          <div className="pcol">
            {ins.map((e) => (
              <div className="pline" key={e.id}>
                <button
                  className={`pentry ${isDealer(e) ? 'dealer' : ''}${e.id === flash ? ' justsaved' : ''}`}
                  onClick={() => setPicked(e)}
                >
                  <span className="pamt">{num(e.amount)}</span>
                  <span className="peq">=</span>
                  <span className="pname" title={e.name}>{e.name}</span>
                </button>
              </div>
            ))}

            {/* This side carries on into the subtraction. */}
            <div className="tally">
              <div className="tnum top">{num(received)}</div>
              <div className="tnum rule">{num(paid)}</div>
              <div className="tnum">{num(book)}</div>
              {close && <div className="tnum rule">{num(close.counted)}</div>}
              {close && (
                <div className={`tnum ans ${diff === 0 ? 'ok' : ''}`}>
                  {num(Math.abs(diff))}
                  <span>{diff === 0 ? 'बराबर' : diff < 0 ? 'घट गया' : 'बढ़ गया'}</span>
                </div>
              )}
            </div>
          </div>

          <div className="pcol right">
            {outs.map((e) => (
              <div className="pline" key={e.id}>
                <button
                  className={`pentry out ${isDealer(e) ? 'dealer' : ''}${e.id === flash ? ' justsaved' : ''}`}
                  onClick={() => setPicked(e)}
                >
                  <span className="pamt">{num(e.amount)}</span>
                  <span className="peq">=</span>
                  <span className="pname" title={e.name}>{e.name}</span>
                </button>
              </div>
            ))}

            {/* And this one stops at its total — the figure the left takes off. */}
            <div className="tally">
              <div className="tnum top out">{num(paid)}</div>
            </div>

          </div>
        </div>

        {/* Online money, kept out of the columns above and totalled on its own.
            It is written here because it happened and has to be findable, not
            because the drawer has anything to do with it. */}
        {(onlineIn.length > 0 || onlineOut.length > 0) && (
          <div className="onlineblk">
            <div className="onlinehdr">
              <span>Online</span>
              <em>bank and UPI — never in the drawer</em>
            </div>

            <div className="pagebody">
              <div className="pcol">
                {onlineIn.map((e) => (
                  <div className="pline" key={e.id}>
                    <button
                      className={`pentry on${e.id === flash ? ' justsaved' : ''}`}
                      onClick={() => setPicked(e)}
                    >
                      <span className="pamt">{num(e.amount)}</span>
                      <span className="peq">=</span>
                      <span className="pname" title={e.name}>{e.name}</span>
                    </button>
                  </div>
                ))}
                {onlineIn.length > 0 && (
                  <div className="tally">
                    <div className="tnum top">{num(onlineInTotal)}</div>
                  </div>
                )}
              </div>

              <div className="pcol right">
                {onlineOut.map((e) => (
                  <div className="pline" key={e.id}>
                    <button
                      className={`pentry out on ${isDealer(e) ? 'dealer' : ''}${e.id === flash ? ' justsaved' : ''}`}
                      onClick={() => setPicked(e)}
                    >
                      <span className="pamt">{num(e.amount)}</span>
                      <span className="peq">=</span>
                      <span className="pname" title={e.name}>{e.name}</span>
                    </button>
                  </div>
                ))}
                {onlineOut.length > 0 && (
                  <div className="tally">
                    <div className="tnum top out">{num(onlineOutTotal)}</div>
                  </div>
                )}
              </div>
            </div>

            <div className="onlinenet">
              <span>Received {num(onlineInTotal)}</span>
              <span>Paid {num(onlineOutTotal)}</span>
              <b className={onlineNet < 0 ? 'neg' : ''}>
                {onlineNet < 0 ? '−' : '+'}{num(Math.abs(onlineNet))}
              </b>
            </div>
          </div>
        )}
      </div>

      <button className="printbar" onClick={() => shareSheet(sheetData(), `register-${dk}.pdf`)}>
        <PrintIcon /> Print
      </button>

      {picked && (
        <LineModal
          entry={picked}
          onEdit={() => { onStartEdit(picked); setPicked(null) }}
          onDelete={() => remove(picked)}
          onReverse={onSync}
          onClose={() => setPicked(null)}
        />
      )}
    </>
  )
}

// ── Analytics ───────────────────────────────────────────────────────────────
// The long view. Everything else in the book answers "what happened today"; this
// answers "how is the shop doing". Charts are plain divs rather than a charting
// library: a handful of bars is not worth 60kB on a phone, and they inherit the
// app's own colours instead of fighting them.

const monthLabel = (mo) => {
  const [y, m] = mo.split('-').map(Number)
  return `${MON[m - 1]} ${y}`
}
const daysInMonth = (mo) => {
  const [y, m] = mo.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}
// One pass, because a month of entries gets walked several times over otherwise.
const tally = (list) => (list || []).reduce((a, e) => {
  const amt = Number(e.amount || 0)
  if (e.kind === 'in') { a.in += amt; if (e.mode === 'cash') a.cashIn += amt; else a.onIn += amt }
  else { a.out += amt; if (e.mode === 'cash') a.cashOut += amt; else a.onOut += amt }
  return a
}, { in: 0, out: 0, cashIn: 0, onIn: 0, cashOut: 0, onOut: 0 })

function CashAnalytics({ todayKey, store, closes, viewing, setViewing, base }) {
  const dk = viewing || base
  const monthStr = dk.slice(0, 7)
  const stepM = (n) => {
    const [y, m] = monthStr.split('-').map(Number)
    const d = new Date(y, m - 1 + n, 1)
    const k = dateKey(d)
    setViewing(k.slice(0, 7) === base.slice(0, 7) ? null : k)
  }

  const month = useMemo(() => tally(store[monthStr]), [store, monthStr])
  const prevMonthStr = useMemo(() => {
    const [y, m] = monthStr.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    return dateKey(d).slice(0, 7)
  }, [monthStr])
  const prev = useMemo(() => tally(store[prevMonthStr]), [store, prevMonthStr])

  // Turnover per day, so a month reads as a shape rather than a number. A day
  // the shop was shut is drawn as a gap, not a zero-height bar, so a holiday
  // does not look like a day that traded nothing.
  const daily = useMemo(() => {
    const dim = daysInMonth(monthStr)
    const rows = (store[monthStr] || [])
    const out = []
    for (let n = 1; n <= dim; n++) {
      const key = `${monthStr}-${pad(n)}`
      let sum = 0
      for (const e of rows) if (e.date === key && e.kind === 'in') sum += Number(e.amount || 0)
      out.push({ n, key, sum, shut: isShutDay(closes, store, todayKey, key), future: key > todayKey })
    }
    return out
  }, [store, closes, todayKey, monthStr])
  const dailyMax = Math.max(1, ...daily.map((d) => d.sum))


  /**
   * Run rate — the month-end turnover the shop is on pace for.
   *
   * Averaged over trading days actually worked, not calendar days: a month with
   * four Sundays and a festival closure would otherwise read as a bad month
   * rather than a short one. Days the shop was shut are excluded from both the
   * days worked and the days remaining.
   */
  const pace = useMemo(() => {
    const isCurrent = monthStr === todayKey.slice(0, 7)
    const worked = daily.filter((d) => !d.future && !d.shut).length
    const remaining = daily.filter((d) => d.future && !d.shut).length
    const perDay = worked ? month.in / worked : 0
    const projected = isCurrent ? month.in + perDay * remaining : month.in
    return { isCurrent, worked, remaining, perDay, projected }
  }, [daily, month.in, monthStr, todayKey])

  const [aim, setAim] = useState(() => {
    try { return Number(localStorage.getItem('shiv-cash:aim')) || 0 } catch { return 0 }
  })
  const [editAim, setEditAim] = useState(false)
  const saveAim = (v) => {
    const n = Math.max(0, Number(v) || 0)
    setAim(n)
    try { localStorage.setItem('shiv-cash:aim', String(n)) } catch { /* private mode */ }
  }
  const aimPct = aim ? Math.round((pace.projected / aim) * 100) : null

  const lifetime = useMemo(() => {
    const all = tally(allEntries(store))
    const days = new Set(allEntries(store).map((e) => e.date))
    return { ...all, days: days.size }
  }, [store])


  // The last six months up to the one being viewed, including empty ones — a
  // gap in trade is itself worth seeing.
  const months = useMemo(() => {
    const [y, m] = monthStr.split('-').map(Number)
    const out = []
    for (let i = 5; i >= 0; i--) {
      const mo = dateKey(new Date(y, m - 1 - i, 1)).slice(0, 7)
      out.push({ mo, ...tally(store[mo]) })
    }
    return out
  }, [store, monthStr])
  const monthsMax = Math.max(1, ...months.map((r) => Math.max(r.in, r.out)))

  const delta = prev.in > 0 ? Math.round(((month.in - prev.in) / prev.in) * 100) : null
  const totalSplit = month.cashIn + month.onIn
  const cashPct = totalSplit > 0 ? Math.round((month.cashIn / totalSplit) * 100) : 0

  return (
    <>
      <div className="datenav">
        <button onClick={() => stepM(-1)} aria-label="Previous month">‹</button>
        <div className="dcenter">
          <div className="dbig">{monthLabel(monthStr)}</div>
          <div className="daysub">Turnover</div>
        </div>
        <button onClick={() => stepM(1)} aria-label="Next month">›</button>
      </div>

      <div className="hero">
        <div className="herolabel">Turnover this month</div>
        <div className={`heronum${fit(inr(month.in))}`}>{inr(month.in)}</div>
        {delta === null
          ? <div className="herodelta flat">Nothing to compare with {monthLabel(prevMonthStr)}</div>
          : (
            <div className={`herodelta ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}`}>
              {delta === 0 ? 'Level with' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}% on`} {monthLabel(prevMonthStr)}
            </div>
          )}
      </div>

      <div className="anblock">
        <div className="mgttl">Run rate</div>
        <div className="paceline">
          <span className="pk">Monthly aim</span>
          {editAim ? (
            <input
              className="aimin"
              type="number"
              autoFocus
              defaultValue={aim || ''}
              placeholder="0"
              onBlur={(e) => { saveAim(e.target.value); setEditAim(false) }}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            />
          ) : (
            <button className="aimbtn" onClick={() => setEditAim(true)}>
              {aim ? inr(aim) : 'Set an aim'}
            </button>
          )}
        </div>

        <div className="paceline">
          <span className="pk">{pace.isCurrent ? 'On pace for' : 'Finished at'}</span>
          <b>{inr(Math.round(pace.projected))}</b>
        </div>

        {aim > 0 && (
          <>
            <div className="pacebar">
              <span
                className={aimPct >= 100 ? 'pf ahead' : 'pf'}
                style={{ width: `${Math.min(100, aimPct)}%` }}
              />
            </div>
            <div className={`herodelta ${aimPct >= 100 ? 'up' : 'down'}`}>
              {aimPct >= 100
                ? `\u25b2 ${aimPct}% of aim — ahead by ${inr(Math.round(pace.projected - aim))}`
                : `\u25bc ${aimPct}% of aim — short by ${inr(Math.round(aim - pace.projected))}`}
            </div>
          </>
        )}

        <div className="pacefoot">
          {inr(Math.round(pace.perDay))} a day over {pace.worked} day{pace.worked === 1 ? '' : 's'} worked
          {pace.isCurrent && pace.remaining > 0 ? ` \u00b7 ${pace.remaining} left` : ''}
        </div>
      </div>

      <div className="cashtotals">
        <div className="ct"><span className="pk">Received</span><b className="in">{inr(month.in)}</b></div>
        <div className="ct"><span className="pk">Paid out</span><b className="out">{inr(month.out)}</b></div>
        <div className="ct"><span className="pk">Net</span><b>{inr(month.in - month.out)}</b></div>
      </div>

      <div className="anblock">
        <div className="mgttl">Day by day</div>
        <div className="chart" role="img" aria-label={`Daily turnover for ${monthLabel(monthStr)}`}>
          {daily.map((d) => (
            <div className="chcol" key={d.n} title={`${d.n} — ${d.shut ? 'shop closed' : inr(d.sum)}`}>
              {d.shut
                ? <span className="chshut" />
                : <span className="chbar" style={{ height: `${(d.sum / dailyMax) * 100}%` }} />}
            </div>
          ))}
        </div>
        <div className="chaxis">
          <span>1</span><span>{Math.round(daily.length / 2)}</span><span>{daily.length}</span>
        </div>
        <div className="chnote">Tallest bar {inr(dailyMax)} · grey marks a day the shop was shut</div>
      </div>

      <div className="anblock">
        <div className="mgttl">Cash against online</div>
        <div className="splitbar">
          <span className="sp cash" style={{ width: `${cashPct}%` }} />
          <span className="sp online" style={{ width: `${100 - cashPct}%` }} />
        </div>
        <div className="splitkeys">
          <span><i className="dot cash" /> Cash {cashPct}% · {inr(month.cashIn)}</span>
          <span><i className="dot online" /> Online {100 - cashPct}% · {inr(month.onIn)}</span>
        </div>
      </div>

      <div className="anblock">
        <div className="mgttl">Last six months</div>
        <div className="chart tall" role="img" aria-label="Received and paid out by month">
          {months.map((r) => (
            <div className="chcol pair" key={r.mo}>
              <span className="chbar" style={{ height: `${(r.in / monthsMax) * 100}%` }} title={`in ${inr(r.in)}`} />
              <span className="chbar out" style={{ height: `${(r.out / monthsMax) * 100}%` }} title={`out ${inr(r.out)}`} />
            </div>
          ))}
        </div>
        <div className="chaxis months">
          {months.map((r) => <span key={r.mo}>{MON[Number(r.mo.split('-')[1]) - 1]}</span>)}
        </div>
      </div>

      <div className="anblock">
        <div className="mgttl">All time</div>
        <div className="paygrid">
          <div><span className="pk">Turnover</span><span className="pv">{inr(lifetime.in)}</span></div>
          <div><span className="pk">Paid out</span><span className="pv neg">{inr(lifetime.out)}</span></div>
          <div><span className="pk">Days traded</span><span className="pv">{lifetime.days}</span></div>
          <div><span className="pk">Average a day</span><span className="pv">{inr(lifetime.days ? Math.round(lifetime.in / lifetime.days) : 0)}</span></div>
          <div className="netrow"><span className="pk">Kept</span><span className="pv strong">{inr(lifetime.in - lifetime.out)}</span></div>
        </div>
      </div>
    </>
  )
}

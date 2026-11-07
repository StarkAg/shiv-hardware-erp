import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useConvex } from 'convex/react'
import { anyApi } from 'convex/server'
import { PinGate } from './deviceTrust/PinGate.jsx'
import { deviceToken } from './deviceTrust/deviceTrust.js'

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL || 'https://sensible-panther-176.convex.cloud'

/** Mounted once the PIN screen lets the Pay tab through: the money figures load then. */
function OnTrusted({ onTrusted }) {
  useEffect(() => { onTrusted() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
import { PayView } from './PayView.jsx'
import { BonusView } from './Bonus.jsx'
import { useAttendanceTheme, useWords, WordsProvider } from './cricket/theme.jsx'
import { cricketEvent } from './cricket/bus.js'
import { ThemeSwitch } from './cricket/ThemeSwitch.jsx'
import { CricketKey, CricketLayer, CricketTabIcon, PointsTable } from './cricket/lazy.jsx'
import { monthScores } from './cricket/score.js'
import { monthPay } from './pay.js'

const api = anyApi
const EDIT_PASSWORD = '262003'
const UNLOCK_MS = 10 * 60 * 60 * 1000 // an unlocked day stays editable for 10 hours
const UNLOCK_KEY = 'shiv-attendance:unlocked'

function loadUnlocked() {
  try {
    const raw = JSON.parse(localStorage.getItem(UNLOCK_KEY) || '{}')
    const now = Date.now()
    const out = {}
    for (const k in raw) if (typeof raw[k] === 'number' && raw[k] > now) out[k] = raw[k]
    return out
  } catch {
    return {}
  }
}
function saveUnlocked(m) {
  try { localStorage.setItem(UNLOCK_KEY, JSON.stringify(m)) } catch { /* ignore */ }
}

// Local cache so the app renders instantly (today first) and refreshes in the background.
const MONTH_CACHE_KEY = 'shiv-attendance:months'
const STAFF_CACHE_KEY = 'shiv-attendance:staff'
const BOARD_CACHE_KEY = 'shiv-attendance:pay-register'
const HISTORY_SEEN_KEY = 'shiv-attendance:history-seen'
const DEVICE_ID_KEY = 'shiv-attendance:device-id'
function readCache(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback } catch { return fallback }
}
function writeCache(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* ignore */ }
}
function readText(key) {
  try { return localStorage.getItem(key) || '' } catch { return '' }
}
function getDeviceId() {
  const existing = readText(DEVICE_ID_KEY)
  if (existing) return existing
  const next = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`
  try { localStorage.setItem(DEVICE_ID_KEY, next) } catch { /* ignore */ }
  return next
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
  // Android WebView and older Chrome versions often expose the handset model
  // immediately before "Build/..." even when UA client hints omit it.
  const match = ua.match(/;\s*([^;()]+?)\s+Build\/[^;)]+/i)
  if (!match) return ''
  const model = match[1].trim()
  return /^(android|linux|wv|mobile|k)$/i.test(model) ? '' : model
}
async function getDeviceDetails() {
  const ua = navigator.userAgent || ''
  const fallbackPlatform = navigator.platform || 'Unknown platform'
  const details = { deviceModel: '', platform: fallbackPlatform, browser: browserName(ua) }
  // Chromium browsers only reveal an Android device model after explicit
  // high-entropy client-hint access. Other browsers may leave it blank.
  try {
    const hints = navigator.userAgentData
    if (hints?.getHighEntropyValues) {
      const high = await hints.getHighEntropyValues(['model', 'platform', 'platformVersion'])
      details.deviceModel = high.model?.trim() || ''
      details.platform = [high.platform, high.platformVersion].filter(Boolean).join(' ') || fallbackPlatform
    }
  } catch { /* browser does not support client hints */ }
  if (!details.deviceModel) details.deviceModel = modelFromUserAgent(ua)
  return details
}

const pad = (n) => String(n).padStart(2, '0')
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const isTue = (d) => d.getDay() === 2
const daysInMonth = (y, m1) => new Date(y, m1, 0).getDate()
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const STATUS = {
  P: { label: 'Present', cls: 'p' },
  N: { label: 'Absent', cls: 'n' },
  H: { label: 'Half', cls: 'h' },
  C: { label: 'Closed', cls: 'c' },
}

export default function App() {
  const [mode, setMode] = useState('day')
  const [cursor, setCursor] = useState(new Date())
  const [unlockedDates, setUnlockedDates] = useState(loadUnlocked) // per-day unlock, persisted 10h
  useEffect(() => { saveUnlocked(unlockedDates) }, [unlockedDates])
  const convex = useConvex()
  // Staff pay is money: read only on a phone given the
  // PIN, and read again the moment the Pay tab's PIN screen lets it through.
  const [trustTick, setTrustTick] = useState(0)
  const theme = useAttendanceTheme(convex)
  const [refreshTick, setRefreshTick] = useState(0) // the theme's pull to refresh
  const [freshTick, setFreshTick] = useState(0) // month marks just came from Convex, not the cache
  const goTo = (next) => {
    if (next !== mode) cricketEvent('tab', { from: mode, to: next })
    setMode(next)
  }

  const [openingsOpen, setOpeningsOpen] = useState(false)
  const [openings, setOpenings] = useState(null)
  const historyTapRef = useRef({ count: 0, timer: null })
  const recordOpening = async () => {
    const device = await getDeviceDetails()
    convex.mutation(api.attendance.recordOpening, {
      deviceId: getDeviceId(),
      ...device,
      locationStatus: 'unavailable',
    }).catch(() => {})
  }
  useEffect(() => {
    recordOpening()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const openOpeningLog = () => {
    setOpeningsOpen(true)
    setOpenings(null)
    convex.query(api.attendance.getOpenings, { limit: 100 })
      .then((rows) => setOpenings(rows || []))
      .catch(() => setOpenings([]))
  }
  const openHistoryOrOpenings = () => {
    const taps = historyTapRef.current
    taps.count += 1
    if (taps.timer) clearTimeout(taps.timer)
    taps.timer = setTimeout(() => {
      const openDetails = taps.count >= 5
      taps.count = 0
      taps.timer = null
      if (openDetails) openOpeningLog()
      else openHistory()
    }, 450)
  }
  useEffect(() => () => {
    if (historyTapRef.current.timer) clearTimeout(historyTapRef.current.timer)
  }, [])

  // Change history — fetched on demand when the panel opens.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [log, setLog] = useState(null)
  const [historyAlert, setHistoryAlert] = useState(false)
  // A "suspicious" entry = a locked past day that was altered after its date.
  const isSusEntry = (e) => !!e.date && e.date < dateKey(new Date(e.at))
  useEffect(() => {
    let off = false
    convex.query(api.attendance.getLog, { limit: 200 }).then((rows) => {
      if (off || !rows) return
      const seen = Number(localStorage.getItem(HISTORY_SEEN_KEY) || 0)
      setHistoryAlert(rows.some((e) => isSusEntry(e) && e.at > seen))
    }).catch(() => {})
    return () => { off = true }
  }, [convex])
  const openHistory = () => {
    setHistoryOpen(true)
    setLog(null)
    convex.query(api.attendance.getLog, { limit: 200 })
      .then((rows) => {
        setLog(rows || [])
        try { localStorage.setItem(HISTORY_SEEN_KEY, String(Date.now())) } catch { /* ignore */ }
        setHistoryAlert(false)
      })
      .catch(() => setLog([]))
  }

  // Staff — cache-first; one-shot refresh (no live subscription).
  const [staff, setStaff] = useState(() => readCache(STAFF_CACHE_KEY, []) || [])
  useEffect(() => {
    let off = false
    convex.query(api.attendance.getStaff, {}).then((s) => {
      if (off || !s) return
      setStaff(s); writeCache(STAFF_CACHE_KEY, s)
    }).catch(() => {})
    return () => { off = true }
  }, [convex, refreshTick])

  // Month data — cache-first. Past (immutable) months are served from the device
  // cache with ZERO Convex reads; only the current month is fetched on open.
  const month = ym(cursor)
  const currentMonth = ym(new Date())
  const [days, setDays] = useState(() => readCache(MONTH_CACHE_KEY, {})[ym(cursor)])
  useEffect(() => {
    const cache = readCache(MONTH_CACHE_KEY, {})
    setDays(cache[month])
    if (cache[month] && month !== currentMonth) return // past month cached → skip the read
    let off = false
    convex.query(api.attendance.getMonth, { month }).then((rows) => {
      if (off || !rows) return
      setDays(rows)
      writeCache(MONTH_CACHE_KEY, { ...readCache(MONTH_CACHE_KEY, {}), [month]: rows })
      setFreshTick((t) => t + 1)
    }).catch(() => {})
    return () => { off = true }
  }, [month, currentMonth, convex, refreshTick])

  // The month before, for the cricket theme only: a run of presents carries over
  // the 1st, so a six on the first days needs the last days of the month before.
  // The month just ended is read fresh once per open, because this phone may have
  // cached it before its last days were marked; older months come from the cache.
  const prevMonth = ym(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))
  const lastMonth = ym(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1))
  const [prevDays, setPrevDays] = useState(undefined)
  const prevRead = useRef({})
  useEffect(() => {
    if (!theme.on) return undefined
    const cache = readCache(MONTH_CACHE_KEY, {})
    setPrevDays(cache[prevMonth])
    if (prevRead.current[prevMonth] || (cache[prevMonth] && prevMonth !== lastMonth)) return undefined
    let off = false
    convex.query(api.attendance.getMonth, { month: prevMonth }).then((rows) => {
      if (off || !rows) return
      prevRead.current[prevMonth] = true
      setPrevDays(rows)
      writeCache(MONTH_CACHE_KEY, { ...readCache(MONTH_CACHE_KEY, {}), [prevMonth]: rows })
    }).catch(() => {})
    return () => { off = true }
  }, [prevMonth, lastMonth, convex, theme.on])

  /**
   * The Staff Payments register, for the Pay tab. Read only when Pay is open on a
   * phone given the PIN, as of the month's last day (today for this month), and
   * the last one read is kept so the tab opens on figures while it refreshes.
   */
  const indiaToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
  const payAsOf = (() => {
    const end = `${month}-${pad(daysInMonth(cursor.getFullYear(), cursor.getMonth() + 1))}`
    const t = indiaToday()
    return end < t ? end : t
  })()
  const [board, setBoard] = useState(() => readCache(BOARD_CACHE_KEY, null))
  const [boardLoading, setBoardLoading] = useState(false)
  const [boardFailed, setBoardFailed] = useState(false)
  const [payTick, setPayTick] = useState(0)
  // Today's wages from the Pay tab: the register's own payment, then a fresh read.
  const payStaff = (payload) => convex.mutation(anyApi.staffPay.pay, payload).then((r) => { setPayTick((t) => t + 1); return r })
  useEffect(() => {
    if (mode !== 'pay' || !deviceToken()) return undefined
    let off = false
    setBoardLoading(true); setBoardFailed(false)
    convex.query(anyApi.staffPay.board, { date: payAsOf })
      .then((b) => {
        if (off || !b?.rows) return
        setBoard(b); writeCache(BOARD_CACHE_KEY, b)
      })
      .catch(() => { if (!off) setBoardFailed(true) })
      .finally(() => { if (!off) setBoardLoading(false) })
    return () => { off = true }
  }, [mode, payAsOf, convex, trustTick, refreshTick, payTick])

  // Optimistic local write + cache, then fire the Convex mutation (write only).
  const applyLocal = (dateStr, patchFn) => {
    setDays((prev) => {
      const list = (prev || []).map((d) => ({ ...d, marks: { ...d.marks } }))
      let day = list.find((d) => d.date === dateStr)
      if (!day) { day = { date: dateStr, marks: {}, locked: false }; list.push(day) }
      patchFn(day)
      writeCache(MONTH_CACHE_KEY, { ...readCache(MONTH_CACHE_KEY, {}), [dateStr.slice(0, 7)]: list })
      return list
    })
  }
  const setMark = (date, name, status) => {
    cricketEvent('mark', { name, status })
    applyLocal(date, (day) => { if (status) day.marks[name] = status; else delete day.marks[name] })
    convex.mutation(api.attendance.setMark, { date, staff: name, status }).catch(() => {})
  }
  const setDayAll = (date, marks) => {
    applyLocal(date, (day) => { day.marks = { ...marks } })
    convex.mutation(api.attendance.setDay, { date, marks }).catch(() => {})
  }
  const lockDay = (date, marks) => {
    applyLocal(date, (day) => { day.locked = true; if (marks) day.marks = { ...marks } })
    convex.mutation(api.attendance.lockDay, { date, marks }).catch(() => {})
  }

  // The month before is in here too when the cricket theme has read it, for the
  // six count only; every view walks its own month's days, so nothing else sees it.
  const marksByDate = useMemo(() => {
    const m = {}
    for (const d of [...(prevDays || []), ...(days || [])]) m[d.date] = d.marks || {}
    return m
  }, [days, prevDays])
  // Tuesdays the shop opened after all (marked open on the Day Paper).
  const shopOpenByDate = useMemo(() => {
    const m = {}
    for (const d of [...(prevDays || []), ...(days || [])]) if (d.shopOpen) m[d.date] = true
    return m
  }, [days, prevDays])
  // The weekly day off: a Tuesday, unless the shop opened on it.
  const dayOff = (d) => isTue(d) && !shopOpenByDate[dateKey(d)]
  const lockedByDate = useMemo(() => {
    const m = {}
    for (const d of days || []) m[d.date] = !!d.locked
    return m
  }, [days])

  const todayKey = dateKey(new Date())
  const isFuture = (d) => dateKey(d) > todayKey
  // Past days are always locked. Today stays open for marking, password-free,
  // until it's explicitly saved & locked for the day.
  const isLockedDate = (d) => dateKey(d) < todayKey || lockedByDate[dateKey(d)] === true
  const isUnlockedNow = (dk) => { const e = unlockedDates[dk]; return !!e && e > Date.now() }
  const canEdit = (d) => !isFuture(d) && (isUnlockedNow(dateKey(d)) || !isLockedDate(d))

  // Password modal — unlocks a specific day (or a passwordless admin action).
  const [pw, setPw] = useState({ open: false, error: '' })
  const pendingRef = useRef(null) // { action, date }
  const unlockThen = (action, date) => {
    if (date && isUnlockedNow(date)) { action && action(); return }
    pendingRef.current = { action: action || null, date: date || null }
    setPw({ open: true, error: '' })
  }
  const submitPw = (value) => {
    if (value === EDIT_PASSWORD) {
      const p = pendingRef.current
      pendingRef.current = null
      if (p && p.date) setUnlockedDates((prev) => ({ ...prev, [p.date]: Date.now() + UNLOCK_MS }))
      setPw({ open: false, error: '' })
      if (p && p.date) cricketEvent('overturned')
      if (p && p.action) p.action()
    } else {
      cricketEvent('notout')
      setPw({ open: true, error: 'Wrong password. Try again.' })
    }
  }
  const closePw = () => { pendingRef.current = null; setPw({ open: false, error: '' }) }
  const relock = (date) => setUnlockedDates((prev) => { const n = { ...prev }; delete n[date]; return n })

  const statusFor = (d, name) => {
    const rec = marksByDate[dateKey(d)]?.[name]
    if (rec) return rec
    if (dayOff(d)) return 'C'
    return ''
  }

  const loading = days === undefined

  return (
    <WordsProvider on={theme.on}>
    <div className={`wrap ${theme.on ? 'ck' : ''}`}>
      <header className="top">
        <div className="brandrow">
          <img className="logo" src="/logo.png" alt="Shiv Hardware" />
          <div>
            <div className="brand">Shiv Hardware</div>
            <div className="sub">Attendance{theme.on && ' · Under lights'}</div>
          </div>
        </div>
        <div className="headbtns">
          {theme.on && <CricketKey />}
          <button className="themebtn histbtn" onClick={openHistoryOrOpenings} aria-label="Change history" title="Change history">
            <HistoryIcon />
            {historyAlert && <span className="alertdot" aria-label="Past date changed">!</span>}
          </button>
        </div>
      </header>

      {theme.on && (
        <CricketLayer
          staff={staff} statusFor={statusFor} cursor={cursor} todayKey={todayKey} mode={mode} loading={loading}
          freshTick={freshTick} todaySaved={lockedByDate[todayKey] === true}
          onRefresh={() => setRefreshTick((t) => t + 1)}
        />
      )}

      <TabBar mode={mode} setMode={goTo} cricket={theme.on} />

      {mode === 'day' ? (
        <DailyView
          cursor={cursor}
          setCursor={setCursor}
          staff={staff}
          statusFor={statusFor}
          loading={loading}
          todayKey={todayKey}
          isSaved={lockedByDate[dateKey(cursor)] === true}
          editable={canEdit(cursor)}
          unlockThen={unlockThen}
          onLockAgain={() => relock(dateKey(cursor))}
          onMark={(name, status) => setMark(dateKey(cursor), name, status)}
          onAllPresent={() => {
            const marks = {}
            for (const s of staff) marks[s] = 'P'
            cricketEvent('allin')
            setDayAll(dateKey(cursor), marks)
          }}
          onAllClosed={() => {
            const marks = {}
            for (const s of staff) marks[s] = 'C'
            cricketEvent('rain')
            setDayAll(dateKey(cursor), marks)
          }}
          onSave={() => {
            const marks = {}
            for (const s of staff) marks[s] = statusFor(cursor, s) || 'P'
            cricketEvent('stumps')
            lockDay(dateKey(cursor), marks)
            relock(dateKey(cursor)) // saving re-locks the day
          }}
        />
      ) : mode === 'month' ? (
        <MonthView
          cursor={cursor} setCursor={setCursor} staff={staff} statusFor={statusFor} loading={loading}
          canEdit={canEdit} unlockThen={unlockThen} todayKey={todayKey} dayOff={dayOff}
          unlockedDays={Object.keys(unlockedDates).filter((k) => k < todayKey && isUnlockedNow(k) && k.slice(0, 7) === dateKey(cursor).slice(0, 7))}
          onLockAgain={(keys) => setUnlockedDates((prev) => { const n = { ...prev }; for (const k of keys) delete n[k]; return n })}
          onCycle={(d, name) => {
            const cur = marksByDate[dateKey(d)]?.[name] || (dayOff(d) ? 'C' : '')
            const order = ['P', 'N', 'H', 'C', '']
            const next = order[(order.indexOf(cur) + 1) % order.length]
            setMark(dateKey(d), name, next)
          }}
        />
      ) : mode === 'stats' ? (
        <StatsView
          cursor={cursor} setCursor={setCursor} staff={staff} statusFor={statusFor} loading={loading} dayOff={dayOff}
          unlockThen={unlockThen} theme={theme} todayKey={todayKey}
        />
      ) : mode === 'bonus' ? (
        <BonusView
          cursor={cursor} setCursor={setCursor} staff={staff} statusFor={statusFor} loading={loading} todayKey={todayKey}
        />
      ) : (
        // Pay is money: the shop PIN, once on this phone, before it opens.
        <PinGate convexUrl={CONVEX_URL} app="Attendance" client={convex}>
          <OnTrusted onTrusted={() => setTrustTick((t) => t + 1)} />
          <PayView
            cursor={cursor} setCursor={setCursor} staff={staff} statusFor={statusFor} loading={loading}
            board={board} boardLoading={boardLoading} boardFailed={boardFailed} asOf={payAsOf} cricket={theme.on} onPay={payStaff}
          />
        </PinGate>
      )}

      {pw.open && (
        <PasswordModal error={pw.error} onSubmit={submitPw} onClose={closePw} />
      )}
      {historyOpen && <HistoryModal log={log} onClose={() => setHistoryOpen(false)} />}
      {openingsOpen && <OpeningLogModal openings={openings} onClose={() => setOpeningsOpen(false)} />}
    </div>
    </WordsProvider>
  )
}

function DailyView({ cursor, setCursor, staff, statusFor, loading, todayKey, isSaved, editable, unlockThen, onLockAgain, onMark, onAllPresent, onAllClosed, onSave }) {
  const step = (n) => {
    const d = new Date(cursor)
    d.setDate(d.getDate() + n)
    if (dateKey(d) > todayKey) return // no future dates
    setCursor(d)
  }
  const isToday = dateKey(cursor) === todayKey
  const tue = isTue(cursor)
  const words = useWords()

  const guarded = (fn) => () => { if (editable) fn(); else unlockThen(fn, dateKey(cursor)) }

  return (
    <div className="card">
      <div className="datenav">
        <button onClick={() => step(-1)} aria-label="Previous day">‹</button>
        <div className="dcenter">
          <div className="dbig">{WD[cursor.getDay()]}, {cursor.getDate()} {MON[cursor.getMonth()]}</div>
          <button className="todaybtn" onClick={() => setCursor(new Date())} disabled={isToday}>
            {isToday ? 'Today' : 'Go to today'}
          </button>
        </div>
        <button onClick={() => step(1)} aria-label="Next day" disabled={isToday}>›</button>
      </div>

      {tue && <div className="banner">Shop closed (Tuesday) — mark only if it was open</div>}
      {!editable && (
        <button className="lockbar" onClick={() => unlockThen(undefined, dateKey(cursor))}>
          <LockIcon /> {isSaved ? 'Saved & locked' : isToday ? 'Locked' : 'Past day — locked'} · tap to edit
        </button>
      )}

      {loading ? (
        <div className="muted center">Loading…</div>
      ) : (
        <>
          <div className="rows">
            {staff.map((name) => {
              const st = statusFor(cursor, name)
              return (
                <div className="prow" key={name}>
                  <div className="pname">{name}</div>
                  <div className="seg">
                    {['P', 'H', 'N'].map((s) => (
                      <button
                        key={s}
                        className={`segb ${STATUS[s].cls} ${st === s ? 'sel' : ''} ${!editable ? 'ro' : ''}`}
                        onClick={guarded(() => onMark(name, st === s ? '' : s))}
                      >
                        {s === 'H' ? '½' : s}
                      </button>
                    ))}
                    {st === 'C' && <span className="closedchip">Closed</span>}
                  </div>
                </div>
              )
            })}
          </div>

          {editable && (
            <div className="quickrow">
              <button className="allbtn ghost" onClick={onAllPresent}>All present</button>
              <button className="allbtn ghost" onClick={onAllClosed}>Shop closed</button>
            </div>
          )}

          {isToday && editable && (
            <button className="allbtn" onClick={onSave}>{isSaved ? words.relock : words.save}</button>
          )}

          {!isToday && editable && (
            <button className="allbtn" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }} onClick={onLockAgain}><LockIcon /> {words.lockAgain}</button>
          )}

          <Summary staff={staff} statusFor={statusFor} cursor={cursor} />
        </>
      )}
    </div>
  )
}

function Summary({ staff, statusFor, cursor }) {
  let p = 0, n = 0, h = 0
  for (const s of staff) {
    const st = statusFor(cursor, s)
    if (st === 'P') p++
    else if (st === 'N') n++
    else if (st === 'H') h++
  }
  return (
    <div className="summary">
      <span className="pill p">{p} present</span>
      <span className="pill n">{n} absent</span>
      {h > 0 && <span className="pill h">{h} half</span>}
    </div>
  )
}

const ROW_MIN = 41
const ROW_MAX = 84
const CARD_GAP = 12

function MonthView({ cursor, setCursor, staff, statusFor, loading, canEdit, unlockThen, unlockedDays = [], onLockAgain, onCycle, todayKey, dayOff }) {
  const y = cursor.getFullYear()
  const m0 = cursor.getMonth()
  const dim = daysInMonth(y, m0 + 1)
  const days = Array.from({ length: dim }, (_, i) => new Date(y, m0, i + 1))
  const stepM = (n) => setCursor(new Date(y, m0 + n, 1))
  const { legend } = useWords()
  // A Tuesday the shop was shut is one box down the whole column, with the
  // day written in it. Tapping the box opens that column, for the Tuesday the
  // shop did work; a Tuesday with any mark on it is shown as an ordinary day.
  const [opened, setOpened] = useState(() => new Set())
  useEffect(() => { setOpened(new Set()) }, [y, m0])
  // A day the shop was shut is one column for everyone: every Tuesday that
  // nobody was marked on, and any other day marked Shop closed for all staff.
  const shut = (d) => !opened.has(dateKey(d)) && staff.length > 0
    && staff.every((name) => (statusFor(d, name) || (dayOff(d) ? 'C' : '')) === 'C')

  // The rows share whatever room is left above the tab bar, so the card fills
  // the screen. With no room left they stay at their normal height and it scrolls.
  const cardRef = useRef(null)
  const [rowH, setRowH] = useState(ROW_MIN)
  useLayoutEffect(() => {
    const fit = () => {
      const card = cardRef.current
      const nav = document.querySelector('.tabbar')
      if (!card || !nav || staff.length === 0) return
      const spare = nav.getBoundingClientRect().top - CARD_GAP - (card.getBoundingClientRect().bottom + window.scrollY)
      setRowH((h) => Math.max(ROW_MIN, Math.min(ROW_MAX, h + Math.floor(spare / staff.length))))
    }
    fit()
    const seen = new ResizeObserver(fit)
    seen.observe(cardRef.current)
    window.addEventListener('resize', fit)
    // The cricket header and fonts arrive late and move the card without resizing it.
    const later = setTimeout(fit, 400)
    document.fonts?.ready.then(fit)
    return () => { seen.disconnect(); window.removeEventListener('resize', fit); clearTimeout(later) }
  }, [staff.length, loading])

  return (
    <div className="card" ref={cardRef}>
      <div className="datenav">
        <button onClick={() => stepM(-1)} aria-label="Previous month">‹</button>
        <div className="dbig">{MON[m0]} {y}</div>
        <button onClick={() => stepM(1)} aria-label="Next month">›</button>
      </div>
      {unlockedDays.length > 0 && (
        <button className="lockbar" onClick={() => onLockAgain(unlockedDays)}>
          <LockIcon /> {unlockedDays.length === 1 ? `${Number(unlockedDays[0].slice(8))} ${MON[m0]} is open` : `${unlockedDays.length} days open`} · tap to lock
        </button>
      )}
      {loading ? (
        <div className="muted center">Loading…</div>
      ) : (
        <div className="gridscroll">
          <table className="grid" style={{ '--rowh': `${rowH}px`, '--cellfs': rowH >= 56 ? '24px' : '19px' }}>
            <thead>
              <tr>
                <th className="stick">Staff</th>
                {days.map((d) => (
                  <th key={d.getDate()} className={`${isTue(d) ? 'tue' : shut(d) ? 'closedday' : ''} ${d.getDay() === 0 ? 'sun' : ''}`}>
                    <span className="dnum">{d.getDate()}</span>
                    <span className="dwd">{WD[d.getDay()][0]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((name, row) => (
                <tr key={name}>
                  <td className="stick nm">{name}</td>
                  {days.map((d) => {
                    const st = statusFor(d, name)
                    const future = dateKey(d) > todayKey
                    if (shut(d)) {
                      if (row > 0) return null
                      return (
                        <td key={d.getDate()} rowSpan={staff.length} className={isTue(d) ? 'tuecol' : 'tuecol closedcol'}>
                          <button
                            className="tuecell"
                            style={{ '--rows': staff.length }}
                            disabled={future}
                            aria-label={`${WD[d.getDay()]} ${d.getDate()} ${MON[m0]}, shop closed${future ? '' : '. Open to mark it'}`}
                            onClick={() => setOpened((prev) => new Set(prev).add(dateKey(d)))}
                          >
                            {(() => {
                              const word = isTue(d) ? (staff.length >= 3 ? 'Tuesday' : 'Tue') : 'Closed'
                              // Each upright letter takes a line; shrink them only if the column is too short.
                              const fit = Math.floor((staff.length * rowH - 12) / (word.length * 1.3))
                              return (
                                <span className="word" style={{ '--fs': `${Math.max(9, Math.min(rowH >= 56 ? 19 : 15, fit))}px` }} aria-hidden="true">
                                  {[...word].map((ch, i) => <span key={i}>{ch}</span>)}
                                </span>
                              )
                            })()}
                          </button>
                        </td>
                      )
                    }
                    return (
                      <td key={d.getDate()}>
                        <button
                          className={`cell ${st ? STATUS[st].cls : ''} ${future ? 'future' : ''}`}
                          aria-label={`${name}, ${d.getDate()} ${MON[m0]}: ${future ? 'to come' : st ? STATUS[st].label : 'not marked'}`}
                          disabled={future}
                          onClick={() => {
                            if (future) return
                            if (canEdit(d)) onCycle(d, name)
                            else unlockThen(() => onCycle(d, name), dateKey(d))
                          }}
                        >
                          {future ? '' : st === 'H' ? '½' : st}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="legend">
        <span className="pill p">{legend.p}</span>
        <span className="pill n">{legend.n}</span>
        <span className="pill h">{legend.h}</span>
        <span className="pill c">{legend.c}</span>
      </div>
    </div>
  )
}

function StatsView({ cursor, setCursor, staff, statusFor, loading, unlockThen, theme, todayKey, dayOff }) {
  const y = cursor.getFullYear()
  const m0 = cursor.getMonth()
  const dim = daysInMonth(y, m0 + 1)
  const days = Array.from({ length: dim }, (_, i) => new Date(y, m0, i + 1))
  const stepM = (n) => setCursor(new Date(y, m0 + n, 1))

  // Per-staff tally for the month, the % out of open days as the ladder counts
  // it (pay.js; the Bonus tab shows the steps). Today counts once it is marked.
  const stats = staff.map((name) => {
    let p = 0, n = 0, h = 0
    for (const d of days) {
      const st = statusFor(d, name)
      if (st === 'P') p++
      else if (st === 'N') n++
      else if (st === 'H') h++
    }
    const counted = p + n + h
    const ladder = monthPay({ entries: days.map((d) => {
      const status = statusFor(d, name)
      return { date: d, status, future: dateKey(d) > todayKey || (dateKey(d) === todayKey && !status) }
    }) })
    const pct = Math.round(ladder.share * 100)
    return { name, p, n, h, counted, pct, ladder }
  })
  let closed = 0
  for (const d of days) if (statusFor(d, staff[0]) === 'C' || dayOff(d)) closed++
  const workingDays = dim - closed


  return (
    <div className="card">
      <div className="datenav">
        <button onClick={() => stepM(-1)} aria-label="Previous month">‹</button>
        <div className="dbig">{MON[m0]} {y}</div>
        <button onClick={() => stepM(1)} aria-label="Next month">›</button>
      </div>

      {loading ? (
        <div className="muted center">Loading…</div>
      ) : (
        <>
          <div className="summary">
            <span className="pill">{workingDays} working days</span>
            <span className="pill c">{closed} closed</span>
          </div>

          {theme.on && <PointsTable rows={monthScores(staff, days, statusFor, todayKey, dateKey)} />}

          <div className="stats">
            {stats.map((s) => (
              <div className="statrow" key={s.name}>
                <div className="stathead">
                  <span className="pname">{s.name}</span>
                  <span className={`pct ${s.pct >= 85 ? 'good' : s.pct >= 77 ? 'ok' : 'bad'}`}>{s.pct}%</span>
                </div>
                <div className="bar">
                  <span className="b p" style={{ flex: s.p }} />
                  <span className="b h" style={{ flex: s.h }} />
                  <span className="b n" style={{ flex: s.n }} />
                  {s.counted === 0 && <span className="b empty" style={{ flex: 1 }} />}
                </div>
                <div className="statmeta">
                  <span className="mp">{s.p} present</span>
                  {s.h > 0 && <span className="mh">{s.h} half</span>}
                  <span className="mn">{s.n} absent</span>
                  <span>of {s.ladder.open} open days</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <ThemeSwitch theme={theme} unlockThen={unlockThen} />
    </div>
  )
}

function PasswordModal({ error, onSubmit, onClose, title, sub }) {
  const [value, setValue] = useState('')
  const words = useWords()
  const submit = () => onSubmit(value)
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheetlock"><LockIcon /></div>
        <div className="sheettitle">{title || words.lockedTitle}</div>
        <div className="sheetsub">{sub || words.lockedSub}</div>
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

const statusLabel = (s) => (s === 'H' ? '½' : s || '—')
const fmtWhen = (ts) => {
  const d = new Date(ts)
  return `${d.getDate()} ${MON[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fmtDay = (dateStr) => {
  const [, m, dd] = dateStr.split('-').map(Number)
  return `${dd} ${MON[m - 1]}`
}

function HistoryModal({ log, onClose }) {
  const todayK = dateKey(new Date())
  const words = useWords()
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet histsheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheettitle">{words.historyTitle}</div>
        <div className="sheetsub">When and what was edited</div>
        {log === null ? (
          <div className="muted center">Loading…</div>
        ) : log.length === 0 ? (
          <div className="muted center">No changes recorded yet.</div>
        ) : (
          <div className="histlist">
            {log.map((e, i) => {
              const editDay = dateKey(new Date(e.at))
              const isToday = editDay === todayK
              const isSus = !!e.date && e.date < editDay
              return (
                <div className={`histrow ${isSus ? 'sus' : isToday ? 'today' : ''}`} key={i}>
                  <div className="histtop">
                    <span className="histwhen">{fmtWhen(e.at)}</span>
                    {e.date && <span className="histday">for {fmtDay(e.date)}</span>}
                  </div>
                  <div className="histsum">{e.summary}</div>
                  {isSus && <span className="susflag">Past date changed</span>}
                  {e.changes && e.changes.length > 0 && (
                    <div className="histchanges">
                      {e.changes.map((c, j) => (
                        <span className="histchip" key={j}>
                          {c.staff}: {statusLabel(c.from)}→{statusLabel(c.to)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <div className="sheetbtns">
          <button className="primbtn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function OpeningLogModal({ openings, onClose }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet histsheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheettitle">Opening check-ins</div>
        <div className="sheetsub">Latest app openings and the location choice made for each one</div>
        {openings === null ? (
          <div className="muted center">Loading…</div>
        ) : openings.length === 0 ? (
          <div className="muted center">No opening check-ins recorded yet.</div>
        ) : (
          <div className="histlist">
            {openings.map((entry, i) => (
              <div className="histrow" key={`${entry.openedAt}-${entry.deviceId}-${i}`}>
                <div className="histtop">
                  <span className="histwhen">{fmtWhen(entry.openedAt)}</span>
                  <span className="histday">Device {entry.deviceId.slice(0, 8)}</span>
                </div>
                <div className="deviceinfo">
                  <span>{entry.deviceModel || 'Model unavailable'}</span>
                  <span>{entry.platform || 'Platform unavailable'}</span>
                  <span>{entry.browser || 'Browser unavailable'}</span>
                </div>
                {entry.locationStatus === 'shared' ? (
                  <div className="histsum">
                    <a className="locationlink" href={`https://www.google.com/maps?q=${entry.latitude},${entry.longitude}`} target="_blank" rel="noreferrer">
                      View location on map
                    </a>
                    <span className="coordtext">{Number(entry.latitude).toFixed(5)}, {Number(entry.longitude).toFixed(5)}{entry.accuracyMeters !== null ? ` · ±${Math.round(entry.accuracyMeters)} m` : ''}</span>
                  </div>
                ) : (
                  <div className="histsum muted">Location {entry.locationStatus === 'declined' ? 'not shared' : 'unavailable'}</div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="sheetbtns"><button className="primbtn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}

// ── Bottom navigation ───────────────────────────────────────────────────────
// A floating glass pill, the way GradeX carries its mobile nav: fixed above the
// content rather than scrolling with it, so the five destinations stay under
// the thumb on a phone that is being held one-handed at the counter.
//
// Every icon's FIRST child is a closed shape. That is what makes the active
// state work: the whole svg gets fill="currentColor", the first child becomes a
// solid brass silhouette, and the children after it are re-stroked in the page
// colour so they read as knocked out of it instead of vanishing into the fill.
const NAV_ICONS = {
  day: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M8 12.4l2.6 2.6L16 9.6" />
    </svg>
  ),
  month: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="4" />
      <path d="M3 9.5h18" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" />
    </svg>
  ),
  stats: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 13.5h3.5V21H4zM10.25 8h3.5v13h-3.5zM16.5 3.5H20V21h-3.5z" />
    </svg>
  ),
  bonus: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="14.5" r="6.5" />
      <path d="M8.5 2.5l2.2 5.3M15.5 2.5l-2.2 5.3" />
      <path d="M12 11.3l1 2 2.2.3-1.6 1.5.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.5 2.2-.3z" />
    </svg>
  ),
  pay: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 8.5A3.5 3.5 0 0 1 6 5h12a3.5 3.5 0 0 1 3.5 3.5v7A3.5 3.5 0 0 1 18 19H6a3.5 3.5 0 0 1-3.5-3.5z" />
      <path d="M9.5 9.5h5M9.5 12h4" />
      <path d="M13 9.6c0 2.4-1.4 2.4-3.5 2.4l3.6 3.5" />
    </svg>
  ),
}

const NAV_ITEMS = [
  { id: 'day', label: 'Daily' },
  { id: 'month', label: 'Month' },
  { id: 'stats', label: 'Stats' },
  { id: 'bonus', label: 'Bonus' },
  { id: 'pay', label: 'Pay' },
]

function TabBar({ mode, setMode, cricket }) {
  const words = useWords()
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
          {cricket ? <CricketTabIcon id={item.id} fallback={NAV_ICONS[item.id]} /> : NAV_ICONS[item.id]}
          <span className="tablabel">{words.tabs[item.id]}</span>
        </button>
      ))}
    </nav>
  )
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useConvex } from 'convex/react'
import { anyApi } from 'convex/server'

const api = anyApi
const EDIT_PASSWORD = '5454'
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
const RATES_CACHE_KEY = 'shiv-attendance:rates'
const ADV_CACHE_KEY = 'shiv-attendance:advances'
const HISTORY_SEEN_KEY = 'shiv-attendance:history-seen'
const DEVICE_ID_KEY = 'shiv-attendance:device-id'
const ATTEND_THRESHOLD = 20 // min attended days to unlock Tuesday pay
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`
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
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  )
  const toggleTheme = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('shiv-panel:theme', next ? 'dark' : 'light') } catch { /* ignore */ }
  }

  const convex = useConvex()

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
  }, [convex])

  // Per-staff daily rates — cache-first; one-shot refresh.
  const [rates, setRates] = useState(() => readCache(RATES_CACHE_KEY, {}) || {})
  useEffect(() => {
    let off = false
    convex.query(api.attendance.getRates, {}).then((r) => {
      if (off || !r) return
      setRates(r); writeCache(RATES_CACHE_KEY, r)
    }).catch(() => {})
    return () => { off = true }
  }, [convex])
  const setRate = (name, rate) => {
    setRates((prev) => { const n = { ...prev, [name]: rate }; writeCache(RATES_CACHE_KEY, n); return n })
    convex.mutation(api.attendance.setRate, { staff: name, rate }).catch(() => {})
  }

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
    }).catch(() => {})
    return () => { off = true }
  }, [month, currentMonth, convex])

  // Advances for the month — cache-first (past months skip the read).
  const [advances, setAdvances] = useState(() => readCache(ADV_CACHE_KEY, {})[ym(cursor)])
  const refetchAdvances = (mo) => {
    convex.query(api.attendance.getAdvances, { month: mo }).then((rows) => {
      if (!rows) return
      setAdvances(rows)
      writeCache(ADV_CACHE_KEY, { ...readCache(ADV_CACHE_KEY, {}), [mo]: rows })
    }).catch(() => {})
  }
  useEffect(() => {
    const cache = readCache(ADV_CACHE_KEY, {})
    setAdvances(cache[month])
    if (cache[month] && month !== currentMonth) return
    refetchAdvances(month)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, currentMonth, convex])
  const addAdvance = (name, amount, note, date) => {
    if (!date) date = month === currentMonth ? dateKey(new Date()) : `${month}-01`
    const optimistic = { _id: `tmp-${Date.now()}`, staff: name, date, amount, note: note || '' }
    setAdvances((prev) => { const n = [...(prev || []), optimistic]; writeCache(ADV_CACHE_KEY, { ...readCache(ADV_CACHE_KEY, {}), [month]: n }); return n })
    convex.mutation(api.attendance.addAdvance, { staff: name, date, amount, note: note || undefined })
      .then(() => refetchAdvances(month)).catch(() => {})
  }
  const removeAdvance = (id) => {
    setAdvances((prev) => { const n = (prev || []).filter((a) => a._id !== id); writeCache(ADV_CACHE_KEY, { ...readCache(ADV_CACHE_KEY, {}), [month]: n }); return n })
    if (String(id).startsWith('tmp-')) return
    convex.mutation(api.attendance.removeAdvance, { id }).then(() => refetchAdvances(month)).catch(() => {})
  }

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
  const changeStaff = (newStaff) => {
    setStaff(newStaff); writeCache(STAFF_CACHE_KEY, newStaff)
    convex.mutation(api.attendance.setStaff, { staff: newStaff }).catch(() => {})
  }

  const marksByDate = useMemo(() => {
    const m = {}
    for (const d of days || []) m[d.date] = d.marks || {}
    return m
  }, [days])
  const lockedByDate = useMemo(() => {
    const m = {}
    for (const d of days || []) m[d.date] = !!d.locked
    return m
  }, [days])

  const todayKey = dateKey(new Date())
  const isFuture = (d) => dateKey(d) > todayKey
  // Every non-future day (including today) is locked and needs the password to edit.
  const isLockedDate = (d) => dateKey(d) <= todayKey || lockedByDate[dateKey(d)] === true
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
      if (p && p.action) p.action()
    } else {
      setPw({ open: true, error: 'Wrong password. Try again.' })
    }
  }
  const closePw = () => { pendingRef.current = null; setPw({ open: false, error: '' }) }
  const relock = (date) => setUnlockedDates((prev) => { const n = { ...prev }; delete n[date]; return n })

  const statusFor = (d, name) => {
    const rec = marksByDate[dateKey(d)]?.[name]
    if (rec) return rec
    if (isTue(d)) return 'C'
    return ''
  }

  const loading = days === undefined

  return (
    <div className="wrap">
      <header className="top">
        <div className="brandrow">
          <img className="logo" src="/logo.png" alt="Shiv Hardware" />
          <div>
            <div className="brand">Shiv Hardware</div>
            <div className="sub">Attendance</div>
          </div>
        </div>
        <div className="headbtns">
          <button className="themebtn histbtn" onClick={openHistoryOrOpenings} aria-label="Change history" title="Change history">
            <HistoryIcon />
            {historyAlert && <span className="alertdot" aria-label="Past date changed">!</span>}
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

      <div className="tabs">
        <button className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>Daily</button>
        <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Month</button>
        <button className={mode === 'stats' ? 'on' : ''} onClick={() => setMode('stats')}>Stats</button>
        <button className={mode === 'pay' ? 'on' : ''} onClick={() => setMode('pay')}>Pay</button>
      </div>

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
          onMark={(name, status) => setMark(dateKey(cursor), name, status)}
          onAllPresent={() => {
            const marks = {}
            for (const s of staff) marks[s] = 'P'
            setDayAll(dateKey(cursor), marks)
          }}
          onAllClosed={() => {
            const marks = {}
            for (const s of staff) marks[s] = 'C'
            setDayAll(dateKey(cursor), marks)
          }}
          onSave={() => {
            const marks = {}
            for (const s of staff) marks[s] = statusFor(cursor, s) || 'P'
            lockDay(dateKey(cursor), marks)
            relock(dateKey(cursor)) // saving re-locks the day
          }}
        />
      ) : mode === 'month' ? (
        <MonthView
          cursor={cursor} setCursor={setCursor} staff={staff} statusFor={statusFor} loading={loading}
          canEdit={canEdit} unlockThen={unlockThen} todayKey={todayKey}
          onCycle={(d, name) => {
            const cur = marksByDate[dateKey(d)]?.[name] || (isTue(d) ? 'C' : '')
            const order = ['P', 'N', 'H', 'C', '']
            const next = order[(order.indexOf(cur) + 1) % order.length]
            setMark(dateKey(d), name, next)
          }}
        />
      ) : mode === 'stats' ? (
        <StatsView
          cursor={cursor} setCursor={setCursor} staff={staff} statusFor={statusFor} loading={loading}
          unlockThen={unlockThen}
          onAddStaff={(name) => changeStaff([...staff, name])}
          onRemoveStaff={(name) => changeStaff(staff.filter((s) => s !== name))}
        />
      ) : (
        <PayView
          cursor={cursor} setCursor={setCursor} staff={staff} statusFor={statusFor} loading={loading}
          rates={rates} advances={advances} unlockThen={unlockThen}
          onSetRate={setRate} onAddAdvance={addAdvance} onRemoveAdvance={removeAdvance}
        />
      )}

      {pw.open && <PasswordModal error={pw.error} onSubmit={submitPw} onClose={closePw} />}
      {historyOpen && <HistoryModal log={log} onClose={() => setHistoryOpen(false)} />}
      {openingsOpen && <OpeningLogModal openings={openings} onClose={() => setOpeningsOpen(false)} />}
      <footer className="foot">Live sync • {Object.values(unlockedDates).some((e) => e > Date.now()) ? 'edit unlocked (10h)' : 'past days locked'} • {month}</footer>
    </div>
  )
}

function DailyView({ cursor, setCursor, staff, statusFor, loading, todayKey, isSaved, editable, unlockThen, onMark, onAllPresent, onAllClosed, onSave }) {
  const step = (n) => {
    const d = new Date(cursor)
    d.setDate(d.getDate() + n)
    if (dateKey(d) > todayKey) return // no future dates
    setCursor(d)
  }
  const isToday = dateKey(cursor) === todayKey
  const tue = isTue(cursor)

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
            <button className="allbtn" onClick={onSave}>{isSaved ? 'Re-lock this day' : 'Save & lock this day'}</button>
          )}
          {isSaved && !editable && (
            <div className="savednote">Saved. Tap “tap to edit” and enter the password to change today.</div>
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

function MonthView({ cursor, setCursor, staff, statusFor, loading, canEdit, unlockThen, onCycle, todayKey }) {
  const y = cursor.getFullYear()
  const m0 = cursor.getMonth()
  const dim = daysInMonth(y, m0 + 1)
  const days = Array.from({ length: dim }, (_, i) => new Date(y, m0, i + 1))
  const stepM = (n) => setCursor(new Date(y, m0 + n, 1))

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
        <div className="gridscroll">
          <table className="grid">
            <thead>
              <tr>
                <th className="stick">Staff</th>
                {days.map((d) => (
                  <th key={d.getDate()} className={`${isTue(d) ? 'tue' : ''} ${d.getDay() === 0 ? 'sun' : ''}`}>
                    <span className="dnum">{d.getDate()}</span>
                    <span className="dwd">{WD[d.getDay()][0]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.map((name) => (
                <tr key={name}>
                  <td className="stick nm">{name}</td>
                  {days.map((d) => {
                    const st = statusFor(d, name)
                    const future = dateKey(d) > todayKey
                    return (
                      <td key={d.getDate()}>
                        <button
                          className={`cell ${st ? STATUS[st].cls : ''} ${future ? 'future' : ''}`}
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
        <span className="pill p">P present</span>
        <span className="pill n">N absent</span>
        <span className="pill h">½ half</span>
        <span className="pill c">C closed</span>
      </div>
    </div>
  )
}

function PayView({ cursor, setCursor, staff, statusFor, loading, rates, advances, unlockThen, onSetRate, onAddAdvance, onRemoveAdvance }) {
  const y = cursor.getFullYear()
  const m0 = cursor.getMonth()
  const dim = daysInMonth(y, m0 + 1)
  const days = Array.from({ length: dim }, (_, i) => new Date(y, m0, i + 1))
  const stepM = (n) => setCursor(new Date(y, m0 + n, 1))
  const tuesdays = days.filter((d) => isTue(d)).length
  const monthStr = ym(cursor)
  const isCurMonth = monthStr === ym(new Date())

  const [sel, setSel] = useState(staff[0] || '')
  useEffect(() => { if (!staff.includes(sel)) setSel(staff[0] || '') }, [staff, sel])
  const [ratesOpen, setRatesOpen] = useState(false)
  const [amt, setAmt] = useState('')
  const [note, setNote] = useState('')
  const [advDate, setAdvDate] = useState(isCurMonth ? dateKey(new Date()) : `${monthStr}-01`)
  useEffect(() => { setAdvDate(isCurMonth ? dateKey(new Date()) : `${monthStr}-01`) }, [monthStr, isCurMonth])

  const advByStaff = useMemo(() => {
    const m = {}
    for (const a of advances || []) (m[a.staff] ||= []).push(a)
    return m
  }, [advances])

  const computeRow = (name) => {
    const rate = Number(rates?.[name] || 0)
    let attended = 0
    let paidDays = 0
    for (const d of days) {
      const st = statusFor(d, name)
      const w = st === 'P' ? 1 : st === 'H' ? 0.5 : 0
      if (!w) continue
      attended += w
      if (!isTue(d)) paidDays += w
    }
    const unlocked = attended >= ATTEND_THRESHOLD
    const base = paidDays * rate
    const tueBonus = unlocked ? tuesdays * rate : 0
    const list = (advByStaff[name] || []).slice().sort((a, b) => a.date.localeCompare(b.date))
    const advTotal = list.reduce((s, a) => s + Number(a.amount || 0), 0)
    const net = base + tueBonus - advTotal
    return { name, rate, attended, paidDays, unlocked, base, tueBonus, advTotal, advList: list, net }
  }

  const r = sel ? computeRow(sel) : null

  const addAdv = () => {
    const v = Math.round(Number(amt) || 0)
    if (!sel || v <= 0) return
    unlockThen(() => { onAddAdvance(sel, v, note.trim(), advDate); setAmt(''); setNote('') })
  }
  const remAdv = (id) => unlockThen(() => onRemoveAdvance(id))
  const openRates = () => unlockThen(() => setRatesOpen(true))

  const progress = r ? Math.min(r.attended / ATTEND_THRESHOLD, 1) : 0
  const remaining = r ? Math.max(0, Math.ceil(ATTEND_THRESHOLD - r.attended)) : 0

  return (
    <div className="card">
      <div className="payhdr">
        <span className="mgttl">Wages</span>
        <button className="iconbtn" aria-label="Set daily income" title="Set daily income" onClick={openRates}>
          <EditIcon />
        </button>
      </div>

      <div className="datenav">
        <button onClick={() => stepM(-1)} aria-label="Previous month">‹</button>
        <div className="dbig">{MON[m0]} {y}</div>
        <button onClick={() => stepM(1)} aria-label="Next month">›</button>
      </div>

      {loading || !r ? (
        <div className="muted center">Loading…</div>
      ) : (
        <>
          <div className="payselect">
            <label>Worker</label>
            <select value={sel} onChange={(e) => setSel(e.target.value)}>
              {staff.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div className="motcard">
            <div className="motlabel">{sel}&rsquo;s earnings this month</div>
            <div className="motnet">{inr(r.net)}</div>
            <div className="motdays">{r.attended} / {ATTEND_THRESHOLD} days present</div>
            <div className="progress"><span className={r.unlocked ? 'full' : ''} style={{ width: `${progress * 100}%` }} /></div>
            <div className={`motmsg ${r.unlocked ? 'good' : ''}`}>
              {r.rate <= 0
                ? 'Daily income not set yet.'
                : r.unlocked
                  ? `Well done! You unlocked Tuesday pay — an extra ${inr(r.tueBonus)} this month.`
                  : `Attend ${remaining} more day${remaining === 1 ? '' : 's'} to unlock ${inr(tuesdays * r.rate)} Tuesday pay.`}
            </div>

            <div className="paygrid">
              <div><span className="pk">Daily income</span><span className="pv">{inr(r.rate)}</span></div>
              <div><span className="pk">Base ({r.paidDays}d)</span><span className="pv">{inr(r.base)}</span></div>
              <div><span className="pk">Tuesdays ({tuesdays})</span><span className="pv">{r.unlocked ? inr(r.tueBonus) : '—'}</span></div>
              <div><span className="pk">Advances</span><span className="pv neg">{r.advTotal ? `- ${inr(r.advTotal)}` : inr(0)}</span></div>
              <div className="netrow"><span className="pk">Take-home</span><span className="pv strong">{inr(r.net)}</span></div>
            </div>
          </div>

          <div className="advbox">
            <div className="mgttl">Add advance</div>
            <div className="advrow">
              <input type="date" value={advDate} onChange={(e) => setAdvDate(e.target.value)} />
              <input type="number" inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="Amount ₹" />
            </div>
            <div className="advrow">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (optional)" />
              <button className="advbtn" onClick={addAdv}>Add</button>
            </div>

            {r.advList.length > 0 && (
              <div className="advlist">
                {r.advList.map((a) => (
                  <div className="advchip" key={a._id}>
                    <span>{inr(a.amount)}{a.note ? ` · ${a.note}` : ''} <em>{fmtDay(a.date)}</em></span>
                    <button aria-label="Remove advance" onClick={() => remAdv(a._id)}><TrashIcon /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {ratesOpen && (
        <PayRatesModal staff={staff} rates={rates} onSetRate={onSetRate} onClose={() => setRatesOpen(false)} />
      )}
    </div>
  )
}

function PayRatesModal({ staff, rates, onSetRate, onClose }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet histsheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheettitle">Set daily income</div>
        <div className="sheetsub">₹ paid per working day, per worker</div>
        <div className="ratelist">
          {staff.map((n) => (
            <div className="raterow" key={n}>
              <span className="pname">{n}</span>
              <div className="rateinput">
                <span>₹</span>
                <input
                  type="number" inputMode="numeric" defaultValue={rates?.[n] || ''}
                  placeholder="0"
                  onBlur={(e) => {
                    const v = Math.max(0, Math.round(Number(e.target.value) || 0))
                    if (v !== Number(rates?.[n] || 0)) onSetRate(n, v)
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="sheetbtns">
          <button className="primbtn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

function StatsView({ cursor, setCursor, staff, statusFor, loading, unlockThen, onAddStaff, onRemoveStaff }) {
  const y = cursor.getFullYear()
  const m0 = cursor.getMonth()
  const dim = daysInMonth(y, m0 + 1)
  const days = Array.from({ length: dim }, (_, i) => new Date(y, m0, i + 1))
  const stepM = (n) => setCursor(new Date(y, m0 + n, 1))
  const [newName, setNewName] = useState('')

  // Per-staff tally for the month.
  const stats = staff.map((name) => {
    let p = 0, n = 0, h = 0
    for (const d of days) {
      const st = statusFor(d, name)
      if (st === 'P') p++
      else if (st === 'N') n++
      else if (st === 'H') h++
    }
    const counted = p + n + h
    const pct = counted ? Math.round(((p + 0.5 * h) / counted) * 100) : 0
    return { name, p, n, h, counted, pct }
  })
  let closed = 0
  for (const d of days) if (statusFor(d, staff[0]) === 'C' || isTue(d)) closed++
  const workingDays = dim - closed

  const addStaff = () => {
    const nm = newName.trim()
    if (!nm) return
    if (staff.includes(nm)) { window.alert('That name already exists.'); return }
    unlockThen(() => { onAddStaff(nm); setNewName('') })
  }
  const removeStaff = (name) => {
    unlockThen(() => {
      if (window.confirm(`Remove ${name} from the staff list?\n(Past records are kept.)`)) onRemoveStaff(name)
    })
  }

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

          <div className="stats">
            {stats.map((s) => (
              <div className="statrow" key={s.name}>
                <div className="stathead">
                  <span className="pname">{s.name}</span>
                  <span className={`pct ${s.pct >= 90 ? 'good' : s.pct >= 75 ? 'ok' : 'bad'}`}>{s.pct}%</span>
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
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Manage staff */}
      <div className="manage">
        <div className="mgttl">Manage staff</div>
        <div className="stafflist">
          {staff.map((name) => (
            <div className="staffchip" key={name}>
              <span>{name}</span>
              <button aria-label={`Remove ${name}`} onClick={() => removeStaff(name)}><TrashIcon /></button>
            </div>
          ))}
        </div>
        <div className="addrow">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addStaff() }}
            placeholder="New worker name"
          />
          <button onClick={addStaff}>Add</button>
        </div>
        <div className="savednote">Adding or removing staff needs the password.</div>
      </div>
    </div>
  )
}

function PasswordModal({ error, onSubmit, onClose }) {
  const [value, setValue] = useState('')
  const submit = () => onSubmit(value)
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheetlock"><LockIcon /></div>
        <div className="sheettitle">This day is locked</div>
        <div className="sheetsub">Enter the password to edit past attendance</div>
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
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet histsheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheettitle">Change history</div>
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

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" /><path d="M12 7v5l4 2" /></svg>
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

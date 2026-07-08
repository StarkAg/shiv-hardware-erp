import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
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

// ── Optimistic cache patch: update getMonth query instantly on a click ────────
function patchMonth(store, date, patch) {
  const month = date.slice(0, 7)
  const cur = store.getQuery(api.attendance.getMonth, { month })
  if (!cur) return
  const next = cur.map((d) => ({ ...d, marks: { ...d.marks } }))
  let day = next.find((d) => d.date === date)
  if (!day) {
    day = { date, marks: {}, locked: false }
    next.push(day)
  }
  patch(day)
  store.setQuery(api.attendance.getMonth, { month }, next)
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

  const staff = useQuery(api.attendance.getStaff) || []
  const month = ym(cursor)
  const days = useQuery(api.attendance.getMonth, { month })

  const setMark = useMutation(api.attendance.setMark).withOptimisticUpdate((store, { date, staff: s, status }) =>
    patchMonth(store, date, (day) => {
      if (status) day.marks[s] = status
      else delete day.marks[s]
    }),
  )
  const setDayM = useMutation(api.attendance.setDay).withOptimisticUpdate((store, { date, marks }) =>
    patchMonth(store, date, (day) => { day.marks = { ...marks } }),
  )
  const lockDayM = useMutation(api.attendance.lockDay).withOptimisticUpdate((store, { date, marks }) =>
    patchMonth(store, date, (day) => { day.locked = true; if (marks) day.marks = { ...marks } }),
  )
  const setStaffM = useMutation(api.attendance.setStaff).withOptimisticUpdate((store, { staff: s }) => {
    store.setQuery(api.attendance.getStaff, {}, s)
  })

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
        <button className="themebtn" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme">
          {dark ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
          )}
        </button>
      </header>

      <div className="tabs">
        <button className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>Daily</button>
        <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Month</button>
        <button className={mode === 'stats' ? 'on' : ''} onClick={() => setMode('stats')}>Stats</button>
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
          onMark={(name, status) => setMark({ date: dateKey(cursor), staff: name, status })}
          onAllPresent={() => {
            const marks = {}
            for (const s of staff) marks[s] = 'P'
            setDayM({ date: dateKey(cursor), marks })
          }}
          onAllClosed={() => {
            const marks = {}
            for (const s of staff) marks[s] = 'C'
            setDayM({ date: dateKey(cursor), marks })
          }}
          onSave={() => {
            const marks = {}
            for (const s of staff) marks[s] = statusFor(cursor, s) || 'P'
            lockDayM({ date: dateKey(cursor), marks })
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
            setMark({ date: dateKey(d), staff: name, status: next })
          }}
        />
      ) : (
        <StatsView
          cursor={cursor} setCursor={setCursor} staff={staff} statusFor={statusFor} loading={loading}
          unlockThen={unlockThen}
          onAddStaff={(name) => setStaffM({ staff: [...staff, name] })}
          onRemoveStaff={(name) => setStaffM({ staff: staff.filter((s) => s !== name) })}
        />
      )}

      {pw.open && <PasswordModal error={pw.error} onSubmit={submitPw} onClose={closePw} />}
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
          <LockIcon /> {isSaved ? 'Saved & locked' : 'Past day — locked'} · tap to edit
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

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6M14 11v6" /></svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
  )
}

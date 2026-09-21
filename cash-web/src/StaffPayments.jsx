import { useCallback, useEffect, useRef, useState } from 'react'
import { anyApi } from 'convex/server'
import { convex } from './sync.js'
import './staff-payments.css'

const api = anyApi.staffPay
const PENDING = 'shiv-cash:staff-payment-pending'
const money = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const read = key => { try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null } }
const cache = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* optional read cache */ } }
const labelDate = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const shift = (date, step) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + step); return d.toISOString().slice(0, 10) }
const errorText = error => String(error?.message || error).split('Uncaught Error:').pop().split('\n')[0].replace(/^\[CONVEX[^\]]*\]\s*/, '').trim()
const STATUS = [['P', 'Present'], ['H', 'Half-day'], ['N', 'Absent'], ['L', 'Leave · unpaid'], ['C', 'Closed']]
const round = n => Math.round(n * 100) / 100

function Modal({ title, onClose, busy, children }) {
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    ref.current?.querySelector('input,select,button')?.focus()
    return () => previous?.focus?.()
  }, [])
  const keys = e => {
    if (e.key === 'Escape' && !busy) onClose()
    if (e.key !== 'Tab') return
    const items = [...ref.current.querySelectorAll('input:not(:disabled),select:not(:disabled),button:not(:disabled)')]
    const first = items[0], last = items.at(-1)
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
  }
  return <div className="sp-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <section className="sp-modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="sp-modal-title" onKeyDown={keys}>
      <div className="sp-modal-head"><h2 id="sp-modal-title">{title}</h2><button type="button" aria-label="Close dialog" disabled={busy} className="sp-button sp-secondary" onClick={onClose}>×</button></div>
      {children}
    </section>
  </div>
}

export default function StaffPayments({ today, date: selectedDate, onDate, onSaved, guard, initialStaff }) {
  const date = selectedDate > today ? today : selectedDate
  const key = `shiv-cash:staff-board:${date}`
  const [data, setData] = useState(() => read(key))
  const [selected, setSelected] = useState(initialStaff || '')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [online, setOnline] = useState(false)
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState(null)
  const [pending, setPending] = useState(() => read(PENDING))
  const sequence = useRef(0)
  const load = useCallback(async () => {
    const seq = ++sequence.current
    try {
      const next = await convex().query(api.board, { date })
      if (sequence.current !== seq) return
      setData(next); cache(key, next); setOnline(true); setError('')
    } catch (e) {
      if (sequence.current !== seq) return
      setOnline(false); setError(navigator.onLine === false ? 'Offline. Reconnect to record staff attendance or payments.' : errorText(e))
    } finally { if (sequence.current === seq) setLoading(false) }
  }, [date, key])
  useEffect(() => {
    setData(read(key)); setLoading(true); setOnline(false); load()
    const refresh = () => { if (document.visibilityState === 'visible') load() }
    const offline = () => { setOnline(false); setError('Offline. Reconnect to record staff attendance or payments.') }
    window.addEventListener('online', load); window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', refresh)
    const timer = setInterval(refresh, 30_000)
    return () => { sequence.current++; clearInterval(timer); window.removeEventListener('online', load); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', refresh) }
  }, [load, key])
  useEffect(() => { if (initialStaff) setSelected(initialStaff) }, [initialStaff])
  const rows = data?.date === date ? data.rows : []
  const row = rows?.find(r => r.staff === selected) ?? rows?.[0]
  const ready = online && !busy && !loading
  const tracked = row?.profile && date >= row.profile.startDate

  const changeMark = async (staff, status) => {
    setBusy(true); setError(''); setNotice('')
    try { await convex().mutation(api.mark, { staff, date, status }); await load(); setNotice('Attendance saved.') }
    catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }
  const reverse = async payment => {
    setBusy(true); setError('')
    try {
      await convex().mutation(api.reverse, { requestId: payment.requestId })
      setDialog(null); await load(); await onSaved(); setNotice('Payment reversed in staff records and the cash register.')
    } catch (e) { setError(errorText(e)); setDialog(null) }
    finally { setBusy(false) }
  }
  const done = async () => { setDialog(null); setPending(read(PENDING)); await load(); await onSaved(); setNotice('Saved.') }
  const totals = (rows || []).filter(r => r.profile).reduce((a, r) => ({ due: round(a.due + r.due), advance: round(a.advance + r.advance) }), { due: 0, advance: 0 })

  return <section className="staff-payments">
    <div className="sp-title"><div><h1>Staff payments</h1><p>Daily wages, attendance & advances</p></div><button className="sp-button sp-secondary" onClick={load} disabled={busy || loading}>Refresh</button></div>
    <div className="sp-date">
      <button className="sp-button sp-secondary" aria-label="Previous staff day" disabled={busy} onClick={() => onDate(shift(date, -1))}>‹</button>
      <label><span>As of</span><input type="date" aria-label="Staff payment date" value={date} max={today} disabled={busy} onChange={e => { if (e.target.value) onDate(e.target.value) }} /></label>
      <button className="sp-button sp-secondary" aria-label="Next staff day" disabled={busy || date >= today} onClick={() => onDate(shift(date, 1))}>›</button>
    </div>
    {date !== today && <button className="sp-text-button" onClick={() => onDate(today)}>Back to today</button>}
    {error && <div className="sp-error" role="alert">{error}</div>}
    {notice && <div className="sp-notice" role="status">{notice}</div>}
    {pending && <div className="sp-pending"><p>A payment needs confirmation. Retry with the same reference to avoid paying twice.</p><button className="sp-button" disabled={!ready} onClick={() => setDialog({ type: 'payment', pending })}>Check payment</button></div>}
    {loading && !data && <p role="status">Loading staff…</p>}
    {rows?.length > 0 && <>
      <div className="sp-summary"><div><span>Total payable</span><strong>{money(totals.due)}</strong></div><div><span>Advances out</span><strong>{money(totals.advance)}</strong></div></div>

      {/* The whole team on one screen. Marking a day, seeing what is owed and
          paying it are the three things done here all afternoon, and they were
          behind a dropdown that showed one person at a time — so the shop could
          not answer "who is left" without clicking through everybody. */}
      <div className="sp-board" role="table" aria-label="Staff">
        <div className="sp-board-head" role="row">
          <span role="columnheader">Staff</span>
          <span role="columnheader">{labelDate(date)}</span>
          <span role="columnheader" className="sp-num">Today</span>
          <span role="columnheader" className="sp-num">Payable</span>
          <span role="columnheader" className="sp-num">Advance</span>
          <span role="columnheader" />
        </div>
        {rows.map(r => {
          const on = r.staff === row?.staff
          const live = r.profile && date >= r.profile.startDate
          return <div key={r.staff} role="row" className={`sp-row${on ? ' is-on' : ''}`}
            tabIndex={0} aria-selected={on}
            onClick={() => { setSelected(r.staff); setNotice(''); setError('') }}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(r.staff); return }
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
              e.preventDefault()
              const at = rows.findIndex(x => x.staff === r.staff) + (e.key === 'ArrowDown' ? 1 : -1)
              const next = rows[Math.max(0, Math.min(rows.length - 1, at))]
              setSelected(next.staff)
              e.currentTarget.parentElement.querySelectorAll('.sp-row')[rows.indexOf(next)]?.focus()
            }}>
            <span role="cell" className="sp-who">
              <b>{r.staff}</b>
              <small>{r.rate ? `${money(r.rate)}/day` : 'no rate'}{r.profile?.monthly ? ` + ${money(r.profile.monthly)}/mo` : ''}</small>
            </span>
            <span role="cell" className="sp-marks">
              {live ? STATUS.map(([value, label]) => <button key={value} type="button" title={label}
                className={`sp-mark${r.status === value ? ' is-on' : ''} m-${value}`}
                aria-label={`${label} — ${r.staff}`} aria-pressed={r.status === value}
                disabled={!ready || data.attendanceLocked || !!pending}
                onClick={e => { e.stopPropagation(); changeMark(r.staff, value) }}>{value}</button>)
                : <button type="button" className="sp-button sp-secondary sp-tiny" disabled={!ready || !!pending}
                    onClick={e => { e.stopPropagation(); guard(() => setDialog({ type: 'setup', row: r })) }}>Set up</button>}
            </span>
            <span role="cell" className="sp-num" data-label="Today">{live ? money(r.earnedToday) : '—'}</span>
            <span role="cell" className="sp-num sp-due" data-label="Payable">{live ? money(r.due) : '—'}</span>
            <span role="cell" className="sp-num sp-adv" data-label="Advance">{live && r.advance > 0 ? money(r.advance) : '—'}</span>
            <span role="cell" className="sp-row-acts">
              {live && <>
                <button className="sp-button sp-tiny" disabled={!ready || !r.due || !!pending}
                  onClick={e => { e.stopPropagation(); setDialog({ type: 'payment', row: r, kind: 'wage' }) }}>Pay</button>
                <button className="sp-button sp-secondary sp-tiny" disabled={!ready || !!pending}
                  onClick={e => { e.stopPropagation(); setDialog({ type: 'payment', row: r, kind: 'advance' }) }}>Advance</button>
              </>}
            </span>
          </div>
        })}
      </div>

      {row && tracked && <div className="sp-detail">
        <div className="sp-person">
          <div><h2>{row.staff}</h2><p>{money(row.month.earned)} this month · {row.month.present}P {row.month.half}H {row.month.absent}N {row.month.leave}L</p></div>
          <button className="sp-button sp-secondary" disabled={!ready || !!pending}
            onClick={() => guard(() => setDialog({ type: 'rate', row }))}>Rate &amp; monthly</button>
        </div>
        <details className="sp-history"><summary>Daily wage statement</summary><div className="sp-statement">{row.daily.map(d => <div key={d.date}><div><b>{labelDate(d.date)}</b><span>{STATUS.find(s => s[0] === d.status)?.[1] || 'Not marked'} · {money(d.rate)}/day{d.monthly ? ` + ${money(d.monthly)}` : ''}</span></div><div><b>Earned {money(d.earned)}</b><span>{d.balance < 0 ? `Advance ${money(-d.balance)}` : `Due ${money(d.balance)}`}</span>{d.recovered > 0 && <span>Recovered {money(d.recovered)}</span>}</div></div>)}</div></details>
        <section className="sp-history"><h3>Payments</h3>{!row.payments.length ? <p className="sp-muted">None yet.</p> : row.payments.map(p => <div key={p._id} className={`sp-payment ${p.voided ? 'is-void' : ''}`}><div><b>{p.kind === 'advance' ? 'Advance' : 'Wages'} · {money(p.amount)}</b><span>{labelDate(p.date)}{p.mode && ` · ${p.mode === 'cash' ? 'Cash' : 'Online'}`}{p.legacy && ' · Attendance record'}{p.voided && ' · Reversed'}</span>{p.note && <span>{p.note}</span>}</div>{!p.voided && !p.legacy && <button className="sp-text-button sp-danger" disabled={!ready || !!pending} onClick={() => guard(() => setDialog({ type: 'reverse', payment: p }))}>Reverse</button>}</div>)}</section>
      </div>}
    </>}
    {!loading && rows?.length === 0 && !error && <p className="sp-empty">Add staff in the attendance app to start tracking payments.</p>}
    {(dialog?.type === 'setup' || dialog?.type === 'rate') && <RateDialog dialog={dialog} date={date} today={today} onClose={() => setDialog(null)} onDone={done} />}
    {dialog?.type === 'payment' && <PaymentDialog dialog={dialog} date={date} onClose={() => { setDialog(null); setPending(read(PENDING)) }} onDone={done} />}
    {dialog?.type === 'reverse' && <Modal title="Reverse this payment?" busy={busy} onClose={() => setDialog(null)}><p>{dialog.payment.staff} · {money(dialog.payment.amount)}</p><div className="sp-form-actions"><button className="sp-button sp-secondary" disabled={busy} onClick={() => setDialog(null)}>Cancel</button><button className="sp-button sp-danger-fill" disabled={busy} onClick={() => reverse(dialog.payment)}>{busy ? 'Reversing…' : 'Reverse payment'}</button></div></Modal>}
  </section>
}

function RateDialog({ dialog, date, today, onClose, onDone }) {
  const setup = dialog.type === 'setup'
  const [rate, setRate] = useState(String(dialog.row.rate || ''))
  const [from, setFrom] = useState(date)
  const [due, setDue] = useState('0'), [advance, setAdvance] = useState('0')
  // The standing amount on top of the days. One man is on it; the rest are on
  // days alone, so it sits beside the rate rather than on the board.
  const [monthly, setMonthly] = useState(String(dialog.row.profile?.monthly || ''))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('')
    try {
      await convex().mutation(setup ? api.setup : api.changeRate, setup
        ? { staff: dialog.row.staff, rate: Number(rate), startDate: from, openingDue: Number(due), openingAdvance: Number(advance) }
        : { staff: dialog.row.staff, rate: Number(rate), from })
      if (!setup) await convex().mutation(api.setMonthly, { staff: dialog.row.staff, monthly: Number(monthly) || 0 })
      await onDone()
    } catch (e) { setError(errorText(e)); setBusy(false) }
  }
  return <Modal title={`${setup ? 'Set up' : 'Daily rate'} · ${dialog.row.staff}`} busy={busy} onClose={onClose}><form onSubmit={submit}>
    <label>Daily wage<input required autoFocus type="number" inputMode="decimal" min="0.01" max="10000000" step="0.01" value={rate} disabled={busy} onChange={e => setRate(e.target.value)} /></label>
    <label>{setup ? 'Track from' : 'New rate effective from'}<input required type="date" value={from} min={setup ? undefined : dialog.row.profile.startDate} max={setup ? today : undefined} disabled={busy} onChange={e => setFrom(e.target.value)} /></label>
    {!setup && <label>Monthly, on top<input type="number" min="0" max="10000000" step="0.01" inputMode="decimal" placeholder="0" value={monthly} disabled={busy} onChange={e => setMonthly(e.target.value)} /></label>}
    {setup && <><label>Unpaid wages brought forward<input required type="number" min="0" max="10000000" step="0.01" inputMode="decimal" value={due} disabled={busy} onChange={e => setDue(e.target.value)} /></label><label>Advance outstanding brought forward<input required type="number" min="0" max="10000000" step="0.01" inputMode="decimal" value={advance} disabled={busy} onChange={e => setAdvance(e.target.value)} /></label></>}
    {error && <p className="sp-error" role="alert">{error}</p>}<div className="sp-form-actions"><button type="button" className="sp-button sp-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="sp-button" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
  </form></Modal>
}

function PaymentDialog({ dialog, date, onClose, onDone }) {
  const [attempt, setAttempt] = useState(dialog.pending || null)
  const [value, setValue] = useState(String(dialog.pending?.amount ?? (dialog.kind === 'wage' ? dialog.row.due : '')))
  const [mode, setMode] = useState(dialog.pending?.mode || 'cash')
  const [note, setNote] = useState(dialog.pending?.note || '')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const kind = dialog.pending?.kind || dialog.kind
  const staff = dialog.pending?.staff || dialog.row.staff
  const paymentDate = dialog.pending?.date || date
  const submit = async e => {
    e.preventDefault(); setError('')
    const payload = attempt || { requestId: crypto.randomUUID(), staff, date: paymentDate, kind, amount: Number(value), mode, note: note.trim() }
    try {
      // This reference must survive a reload or a lost response. Do not send
      // money if the browser cannot retain it for a safe retry.
      localStorage.setItem(PENDING, JSON.stringify(payload))
    } catch { setError('Could not save the payment reference on this device. Free some browser storage and retry.'); return }
    setAttempt(payload); setBusy(true)
    try {
      await convex().mutation(api.pay, payload)
      localStorage.removeItem(PENDING)
      await onDone()
    } catch (e) {
      const message = String(e?.message || e)
      if (message.includes('Uncaught Error:')) { localStorage.removeItem(PENDING); setAttempt(null) }
      setError(errorText(e)); setBusy(false)
    }
  }
  return <Modal title={`${kind === 'advance' ? 'Give advance' : 'Pay wages'} · ${staff}`} busy={busy} onClose={onClose}><form onSubmit={submit}>
    <p className="sp-policy">{labelDate(paymentDate)}</p>
    <label>Amount to hand over<input required autoFocus type="number" inputMode="decimal" min="0.01" max={kind === 'wage' && dialog.row ? dialog.row.due : 10000000} step="0.01" value={value} disabled={busy || !!attempt} onChange={e => setValue(e.target.value)} /></label>
    <label>Pay from<select value={mode} disabled={busy || !!attempt} onChange={e => setMode(e.target.value)}><option value="cash">Cash drawer</option><option value="online">Online / bank</option></select></label>
    <label>Note (optional)<input maxLength={500} value={note} disabled={busy || !!attempt} onChange={e => setNote(e.target.value)} /></label>
    {attempt && !busy && <p className="sp-policy">Confirmation pending. Retry uses the same payment reference and cannot create a second payout.</p>}
    {error && <p className="sp-error" role="alert">{error}</p>}
    <div className="sp-form-actions"><button type="button" className="sp-button sp-secondary" disabled={busy} onClick={onClose}>{attempt ? 'Close' : 'Cancel'}</button><button className="sp-button" disabled={busy}>{busy ? 'Confirming…' : attempt ? 'Retry confirmation' : `Confirm ${money(value)}`}</button></div>
  </form></Modal>
}

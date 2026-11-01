import { useState } from 'react'

/*
 * Pay a worker today's wages, any amount, from the Pay tab.
 *
 * It is the very same payment as Cashier, Staff Payments (`staffPay.pay`): it
 * goes into the register and the cash book, and is reversed there. Only wages,
 * and only up to what has been earned and not yet paid; money ahead of that is
 * an advance, given in Cashier.
 *
 * Like Cashier, the payment's reference is kept on the phone until the server
 * confirms it, so a lost answer is retried with the same reference and can never
 * pay twice.
 */

const PENDING = 'shiv-attendance:staff-payment-pending'
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const fmtDay = (s) => { const [, m, d] = s.split('-').map(Number); return `${d} ${MON[m - 1]}` }
const errorText = (e) => String(e?.message || e).split('Uncaught Error:').pop().split('\n')[0].replace(/^\[CONVEX[^\]]*\]\s*/, '').trim()
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`)

export function readPending() {
  try { return JSON.parse(localStorage.getItem(PENDING) || 'null') } catch { return null }
}

export function PaySheet({ row, date, onPay, onClose, onDone }) {
  const pending = readPending()
  const resume = pending && pending.staff === row.staff ? pending : null
  const due = Math.max(0, row.due || 0)
  // The most that may go as wages: every wage earned less what was handed over,
  // advance or no advance. Cutting the advance is the shop's choice.
  const most = Math.max(due, row.payableMax ?? due)
  // Staff are paid at the end of each day, so the box opens on today's wage:
  // what today's mark earned, or a full day at the rate while today is unmarked.
  // With an advance running, the register's cut (`due`) comes first, as in Cashier.
  const marked = !!row.status
  const today = Math.min(marked ? row.earnedToday || 0 : row.rate || 0, most)
  const advanceOut = (row.advance || 0) > 0
  const start = advanceOut ? Math.min(due, today) : today
  const picks = [
    today > 0 && { label: marked ? "Today's wage" : 'A full day', amount: today },
    advanceOut && due !== today && { label: 'Cut advance', amount: due },
    most > Math.max(today, due) && { label: 'Everything owed', amount: most },
  ].filter(Boolean)
  const [attempt, setAttempt] = useState(resume)
  const [value, setValue] = useState(String(resume?.amount ?? (start || '')))
  const [mode, setMode] = useState(resume?.mode || 'cash')
  const [note, setNote] = useState(resume?.note || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = busy || !!attempt
  const amount = Number(value)

  const submit = async () => {
    setError('')
    if (!attempt) {
      if (!(amount > 0)) { setError('Type the amount handed over.'); return }
      if (Math.round(amount * 100) !== amount * 100) { setError('Use at most two decimal places.'); return }
      if (amount > most) { setError(`Only ${inr(most)} is earned and not yet paid. Give more than that as an advance in Cashier.`); return }
    }
    const payload = attempt || { requestId: newId(), staff: row.staff, date, kind: 'wage', amount, mode, note: note.trim() }
    try { localStorage.setItem(PENDING, JSON.stringify(payload)) } catch {
      setError('This phone could not keep the payment reference. Free some space and try again.'); return
    }
    setAttempt(payload); setBusy(true)
    try {
      await onPay(payload)
      try { localStorage.removeItem(PENDING) } catch { /* ignore */ }
      onDone(payload)
    } catch (e) {
      // A refusal from the server means nothing was paid: start clean. Anything
      // else (no answer) keeps the reference for a safe retry.
      if (String(e?.message || e).includes('Uncaught Error:')) {
        try { localStorage.removeItem(PENDING) } catch { /* ignore */ }
        setAttempt(null)
      }
      setError(errorText(e)); setBusy(false)
    }
  }

  const close = () => { if (!busy) onClose() }

  return (
    <div className="modal" onClick={close}>
      <div className="sheet paysheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheettitle">Pay {row.staff}</div>
        <div className="sheetsub">Wages, {fmtDay(attempt?.date || date)}. Saved in Staff Payments and the cash book.</div>
        {!marked && !attempt && <div className="sheetsub">Today is not marked yet, so this is a full day at {inr(row.rate)}.</div>}

        {most <= 0 && !attempt ? (
          <div className="sheeterr">Nothing earned is left to pay. Money ahead of wages is an advance, given in Cashier.</div>
        ) : (
          <>
            <label className="paylabel" htmlFor="payamt">Amount handed over</label>
            <div className="payamt">
              <span>₹</span>
              <input id="payamt" autoFocus type="number" inputMode="decimal" min="0" step="0.01" value={value}
                disabled={locked} onChange={(e) => setValue(e.target.value)} />
            </div>
            {picks.length > 1 && !attempt && (
              <div className="paypicks">
                {picks.map((p) => (
                  <button type="button" key={p.label} className={amount === p.amount ? 'on' : ''} disabled={locked} onClick={() => setValue(String(p.amount))}>
                    {p.label}<b>{inr(p.amount)}</b>
                  </button>
                ))}
              </div>
            )}

            <div className="paylabel">Paid by</div>
            <div className="paymode">
              <button type="button" className={mode === 'cash' ? 'on' : ''} disabled={locked} onClick={() => setMode('cash')}>Cash</button>
              <button type="button" className={mode === 'online' ? 'on' : ''} disabled={locked} onClick={() => setMode('online')}>Online</button>
            </div>

            <label className="paylabel" htmlFor="paynote">Note (optional)</label>
            <input id="paynote" className="paynoteinput" maxLength={500} value={note} disabled={locked} onChange={(e) => setNote(e.target.value)} />

            {attempt && !busy && <div className="sheetsub">Waiting for the server to confirm. Retry uses the same reference, so it cannot pay twice.</div>}
          </>
        )}
        {error && <div className="sheeterr" role="alert">{error}</div>}

        <div className="sheetbtns">
          <button className="ghostbtn" disabled={busy} onClick={close}>{attempt ? 'Close' : 'Cancel'}</button>
          {(most > 0 || attempt) && (
            <button className="primbtn" disabled={busy} onClick={submit}>
              {busy ? 'Saving…' : attempt ? 'Retry' : `Pay ${inr(amount || 0)}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { monthPay, ATTEND_THRESHOLD } from './pay.js'
import { monthBook } from './payBook.js'
import { RunChase } from './cricket/lazy.jsx'
import { PaySheet, readPending } from './PaySheet.jsx'

/*
 * The Pay tab, straight from the Staff Payments register.
 *
 * Money goes through one register, Staff Payments, which writes the cash book
 * too. The Pay button here (PaySheet.jsx) pays today's wages into that same
 * register; advances, rates and reversals stay in Cashier. This tab used to work out its own take-home and take its own
 * advances, so it could disagree with the register and an advance typed here was
 * refused by the server without a word. Now it shows the register's own figures
 * for the month and the sum that gets there, line by line, and the Pay button
 * is the only thing on it that writes.
 *
 * Tuesday pay is the one figure the register does not hold; it is shown apart,
 * worked out by pay.js, and kept out of the sum.
 */

const pad = (n) => String(n).padStart(2, '0')
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const ym = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const fmtDay = (s) => { const [, m, d] = s.split('-').map(Number); return `${d} ${MON[m - 1]}` }
const wdOf = (s) => WD[new Date(`${s}T12:00:00`).getDay()]
const MARK = { P: 'Present', H: 'Half day', N: 'Absent', L: 'Leave, unpaid', C: 'Closed', '': 'Not marked' }
const MARK_SHORT = { P: 'P', H: '½', N: 'A', L: 'L', C: 'Shut', '': '-' }

/** A balance in words: the shop owes wages, or an advance is still out. */
function balanceSay(n) {
  if (n > 0) return { word: 'To pay', amount: n, kind: 'due' }
  if (n < 0) return { word: 'Advance left', amount: -n, kind: 'adv' }
  return { word: 'Settled', amount: 0, kind: 'zero' }
}

export function PayView({ cursor, setCursor, staff, statusFor, loading, board, boardLoading, boardFailed, asOf, cricket, onPay }) {
  const y = cursor.getFullYear()
  const m0 = cursor.getMonth()
  const month = ym(cursor)
  const stepM = (n) => setCursor(new Date(y, m0 + n, 1))
  const todayKey = dateKey(new Date())
  const future = month > todayKey.slice(0, 7)

  const [sel, setSel] = useState(staff[0] || '')
  useEffect(() => { if (!staff.includes(sel)) setSel(staff[0] || '') }, [staff, sel])

  const row = board?.date === asOf ? board.rows.find((r) => r.staff === sel) : null
  const book = row ? monthBook(row, month) : null
  const [paying, setPaying] = useState(false)
  const [paid, setPaid] = useState(null)
  useEffect(() => { setPaid(null) }, [sel, month])
  // Pay is for today only: this month's figures are as of today.
  const isThisMonth = month === todayKey.slice(0, 7)
  const canPay = isThisMonth && !!book && asOf >= row.profile.startDate
  const pendingHere = canPay && readPending()?.staff === sel

  let body
  if (future) body = <div className="paynote">Nothing yet for {MON[m0]} {y}.</div>
  else if (!board || board.date !== asOf) {
    body = <div className="paynote">{boardLoading ? 'Loading the register…' : boardFailed ? 'Could not reach the register. Check the internet and open Pay again.' : 'Loading…'}</div>
  } else if (!row || !row.profile) {
    body = <div className="paynote">{sel}&rsquo;s pay is not kept in the register yet. Set it up in Cashier, Staff Payments.</div>
  } else if (asOf < row.profile.startDate) {
    body = <div className="paynote">{sel}&rsquo;s pay is kept from {fmtDay(row.profile.startDate)} {row.profile.startDate.slice(0, 4)}.</div>
  } else {
    body = <Book name={sel} book={book} asOf={asOf} cursor={cursor} statusFor={statusFor} loading={loading} cricket={cricket} todayKey={todayKey} />
  }

  return (
    <div className="card">
      <div className="payhdr"><span className="mgttl">Wages</span></div>
      <div className="payread">Advances, rates and reversals are done in Cashier, Staff Payments.</div>

      <div className="datenav">
        <button onClick={() => stepM(-1)} aria-label="Previous month">‹</button>
        <div className="dbig">{MON[m0]} {y}</div>
        <button onClick={() => stepM(1)} aria-label="Next month">›</button>
      </div>

      <div className="payselect">
        <label htmlFor="payworker">Worker</label>
        <select id="payworker" value={sel} onChange={(e) => setSel(e.target.value)}>
          {staff.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {canPay && (
        <button className="allbtn paybtn" onClick={() => { setPaid(null); setPaying(true) }}>
          {pendingHere ? `Finish paying ${sel}` : `Pay ${sel}`}
        </button>
      )}
      {paid && <div className="paydone" role="status">Paid {sel} {inr(paid.amount)} {paid.mode === 'online' ? 'online' : 'in cash'}. It is in Staff Payments and the cash book.</div>}

      {body}

      {paying && row && (
        <PaySheet row={row} date={asOf} onPay={onPay} onClose={() => setPaying(false)}
          onDone={(p) => { setPaying(false); setPaid(p) }} />
      )}
    </div>
  )
}

function Book({ name, book, asOf, cursor, statusFor, loading, cricket, todayKey }) {
  const now = balanceSay(book.closing)
  const carried = balanceSay(book.opening)
  const rateText = book.rates.map(inr).join(' then ')
  const daysToClear = now.kind === 'adv' && book.rate > 0 ? Math.ceil(now.amount / book.rate) : 0

  return (
    <>
      <div className="paybig" data-kind={now.kind}>
        <div className="motlabel">{now.word} on {fmtDay(asOf)}</div>
        <div className="motnet">{inr(now.amount)}</div>
        <div className="paysub">
          {now.kind === 'due' && `The shop owes ${name} this much in wages.`}
          {now.kind === 'adv' && `${name} still has this much advance to work off${daysToClear ? `, about ${daysToClear} working day${daysToClear === 1 ? '' : 's'} at ${inr(book.rate)} a day` : ''}.`}
          {now.kind === 'zero' && `Nothing owed either way.`}
        </div>
      </div>

      <div className="paysum" aria-label="How it adds up">
        <div className="mgttl">How it adds up</div>
        <div className="sumrow">
          <span>{book.startedThisMonth ? `At the start, ${fmtDay(book.startDate)}` : 'Carried in from last month'}<small>{carried.word}</small></span>
          <b>{carried.kind === 'adv' ? '- ' : ''}{inr(carried.amount)}</b>
        </div>
        <div className="sumrow">
          <span>Earned<small>{book.worked} day{book.worked === 1 ? '' : 's'} at {rateText}{book.monthly ? `, plus ${inr(book.monthly)} monthly` : ''}</small></span>
          <b className="plus">+ {inr(book.earned)}</b>
        </div>
        <div className="sumrow">
          <span>Wages paid</span>
          <b className="minus">- {inr(book.paid)}</b>
        </div>
        <div className="sumrow">
          <span>Advances given</span>
          <b className="minus">- {inr(book.advanced)}</b>
        </div>
        <div className="sumrow total" data-kind={now.kind}>
          <span>{now.word}</span>
          <b>{now.kind === 'adv' ? '- ' : ''}{inr(now.amount)}</b>
        </div>
        <div className="paydays">
          Present {book.present} · Half {book.half} · Absent {book.absent}{book.leave ? ` · Leave ${book.leave}` : ''}
        </div>
      </div>

      <div className="paygiven">
        <div className="mgttl">Money given in {MON[cursor.getMonth()]}</div>
        {book.payments.length === 0 ? (
          <div className="paynote">None this month.</div>
        ) : book.payments.map((p) => (
          <div className="givenrow" key={p._id}>
            <span>
              <b>{p.kind === 'advance' ? 'Advance' : 'Wages'}</b>
              <small>{wdOf(p.date)} {fmtDay(p.date)}{p.mode ? ` · ${p.mode === 'online' ? 'Online' : 'Cash'}` : ''}{p.note ? ` · ${p.note}` : ''}</small>
            </span>
            <b>{inr(p.amount)}</b>
          </div>
        ))}
      </div>

      <TuesdayNote name={name} rate={book.rate} cursor={cursor} statusFor={statusFor} loading={loading} cricket={cricket} todayKey={todayKey} />

      <details className="paydaily">
        <summary>Every day of {MON[cursor.getMonth()]}</summary>
        <table>
          <thead><tr><th>Day</th><th>Mark</th><th>Earned</th><th>Given</th><th>Balance</th></tr></thead>
          <tbody>
            {book.days.slice().reverse().map((d) => {
              const bal = balanceSay(d.balance)
              const given = (d.paid || 0) + (d.advanced || 0)
              return (
                <tr key={d.date}>
                  <td>{wdOf(d.date)} {Number(d.date.slice(8))}</td>
                  <td title={MARK[d.status] ?? d.status}>{MARK_SHORT[d.status] ?? d.status}</td>
                  <td>{d.earned ? inr(d.earned) : '-'}</td>
                  <td>{given ? inr(given) : '-'}</td>
                  <td data-kind={bal.kind}>{bal.kind === 'zero' ? '0' : `${inr(bal.amount)} ${bal.kind === 'due' ? 'due' : 'adv'}`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="paynote">Balance: "due" is wages the shop owes, "adv" is advance still to be worked off.</div>
      </details>
    </>
  )
}

/** Tuesday pay: the shop's rule from pay.js, not in the register, so shown apart. */
function TuesdayNote({ name, rate, cursor, statusFor, loading, cricket, todayKey }) {
  if (loading) return null
  const y = cursor.getFullYear()
  const m0 = cursor.getMonth()
  const dim = new Date(y, m0 + 1, 0).getDate()
  const days = Array.from({ length: dim }, (_, i) => new Date(y, m0, i + 1))
  const r = monthPay({ entries: days.map((d) => ({ date: d, status: statusFor(d, name), future: dateKey(d) > todayKey })), rate })
  const remaining = Math.max(0, Math.ceil(ATTEND_THRESHOLD - r.attended))
  const worth = r.tuesdays * rate
  return (
    <div className="paytue">
      <div className="mgttl">Tuesday pay, not in the sum above</div>
      {cricket && <RunChase name={name} attended={r.attended} threshold={ATTEND_THRESHOLD} unlocked={r.unlocked} missedCount={r.missed.length} />}
      <div className="motdays">{r.attended} / {ATTEND_THRESHOLD} days present</div>
      <div className="progress"><span className={r.unlocked ? 'full' : ''} style={{ width: `${Math.min(r.attended / ATTEND_THRESHOLD, 1) * 100}%` }} /></div>
      <div className={`motmsg ${r.unlocked ? 'good' : ''}`}>
        {r.unlocked
          ? `Earned: ${inr(worth)} for ${r.tuesdays} Tuesdays. Not added by the register.`
          : r.missed.length > 0
            ? `Lost this month: ${r.missed.map((d) => `${WD[d.getDay()]} ${d.getDate()}`).join(', ')} ${r.missed.length === 1 ? 'was' : 'were'} not a full day.`
            : `${remaining} more day${remaining === 1 ? '' : 's'}, with every Monday and Wednesday present, earns ${inr(worth)}.`}
      </div>
    </div>
  )
}

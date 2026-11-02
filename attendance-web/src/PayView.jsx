import { useEffect, useState } from 'react'
import { monthPay, ladderLine, halves } from './pay.js'
import { monthBook, monthEvents } from './payBook.js'
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
 * Tuesday pay and the attendance bonus are the figures the register does not
 * hold; they are shown apart, worked out by pay.js, and kept out of the sum.
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
  // Pay is for today only: this month's figures are as of today.
  const isThisMonth = month === todayKey.slice(0, 7)

  const [open, setOpen] = useState('')
  const [paying, setPaying] = useState('')
  const [paid, setPaid] = useState(null)
  useEffect(() => { setPaid(null); setOpen('') }, [month])

  const ready = !future && board?.date === asOf
  // Every worker on one screen, in the staff list's order, plus anybody the
  // register keeps who has since left the list.
  const names = ready ? [...new Set([...staff, ...board.rows.filter((r) => r.profile).map((r) => r.staff)])] : staff
  const lines = ready ? names.map((name) => {
    const row = board.rows.find((r) => r.staff === name) || null
    const kept = !!row?.profile && asOf >= row.profile.startDate
    return { name, row, kept, book: kept ? monthBook(row, month) : null }
  }) : []
  const totalDue = lines.reduce((n, l) => n + (l.book && l.book.closing > 0 ? l.book.closing : 0), 0)
  const totalAdv = lines.reduce((n, l) => n + (l.book && l.book.closing < 0 ? -l.book.closing : 0), 0)
  const pending = readPending()
  const payingLine = lines.find((l) => l.name === paying)

  return (
    <div className="card">
      <div className="payhdr"><span className="mgttl">Wages</span></div>
      <div className="payread">Advances, rates and reversals are done in Cashier, Staff Payments.</div>

      <div className="datenav">
        <button onClick={() => stepM(-1)} aria-label="Previous month">‹</button>
        <div className="dbig">{MON[m0]} {y}</div>
        <button onClick={() => stepM(1)} aria-label="Next month">›</button>
      </div>

      {future ? (
        <div className="paynote">Nothing yet for {MON[m0]} {y}.</div>
      ) : !ready ? (
        <div className="paynote">{boardLoading ? 'Loading the register…' : boardFailed ? 'Could not reach the register. Check the internet and open Pay again.' : 'Loading…'}</div>
      ) : (
        <>
          <div className="paytotals">
            <div data-kind="due"><small>To pay, all staff</small><b>{inr(totalDue)}</b></div>
            <div data-kind="adv"><small>Advance out</small><b>{inr(totalAdv)}</b></div>
            <span>on {fmtDay(asOf)}</span>
          </div>

          <div className="paylist">
            {lines.map(({ name, row, kept, book }) => {
              const now = book ? balanceSay(book.closing) : null
              const isOpen = open === name && !!book
              const canPay = isThisMonth && kept
              return (
                <div className="spitem" key={name} data-open={isOpen || undefined}>
                  <div className="sprow" data-kind={now?.kind}>
                    <button className="spmain" disabled={!book} aria-expanded={book ? isOpen : undefined}
                      onClick={() => setOpen(isOpen ? '' : name)}>
                      <span className="spname">{name}</span>
                      <span className="spsub">
                        {!row?.profile ? 'Not in the register yet'
                          : !kept ? `Kept from ${fmtDay(row.profile.startDate)}`
                            : `${book.worked} day${book.worked === 1 ? '' : 's'} · earned ${inr(book.earned)} · given ${inr(book.paid + book.advanced)}`}
                      </span>
                    </button>
                    {now && (
                      <div className="spfig">
                        <small>{now.word}</small>
                        <b>{now.kind === 'zero' ? inr(0) : inr(now.amount)}</b>
                      </div>
                    )}
                    {canPay && (
                      <button className="sppay" onClick={() => { setPaid(null); setPaying(name) }}>
                        {pending?.staff === name ? 'Finish' : 'Pay'}
                      </button>
                    )}
                  </div>
                  {paid?.staff === name && (
                    <div className="paydone" role="status">Paid {name} {inr(paid.amount)} {paid.mode === 'online' ? 'online' : 'in cash'}. It is in Staff Payments and the cash book.</div>
                  )}
                  {isOpen && (
                    <div className="spdetail">
                      <Book name={name} book={book} asOf={asOf} cursor={cursor} statusFor={statusFor} loading={loading} cricket={cricket} todayKey={todayKey} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {!isThisMonth && <div className="paynote">Pay is only for today, on this month.</div>}

          <PayHistory events={monthEvents(board.rows, month)} monthName={MON[m0]} />
        </>
      )}

      {payingLine?.row && (
        <PaySheet row={payingLine.row} date={asOf} onPay={onPay} onClose={() => setPaying('')}
          onDone={(p) => { setPaying(''); setPaid(p) }} />
      )}
    </div>
  )
}

// Shop time, whatever the phone's clock is set to.
const fmtTime = (ms) => {
  const d = new Date(ms + 330 * 60_000)
  const h = d.getUTCHours()
  return `${(h % 12) || 12}:${pad(d.getUTCMinutes())} ${h < 12 ? 'am' : 'pm'}`
}

/** Every pay event of the month, all staff, newest first (payBook.js monthEvents). */
function PayHistory({ events, monthName }) {
  const say = (e) => {
    if (e.type === 'wage') return 'Wages'
    if (e.type === 'advance') return e.legacy ? 'Advance (old attendance record)' : 'Advance'
    if (e.type === 'reversed') return `Reversed ${e.of} paid ${fmtDay(e.paidOn)}`
    if (e.type === 'rate') return `Rate now ${inr(e.rate)} a day`
    return `Pay tracking started at ${inr(e.rate)} a day${e.openingDue ? `, wages owed ${inr(e.openingDue)}` : ''}${e.openingAdvance ? `, advance ${inr(e.openingAdvance)}` : ''}`
  }
  return (
    <div className="payhist">
      <div className="mgttl">History, {monthName}</div>
      {events.length === 0 ? (
        <div className="paynote">Nothing paid or changed this month.</div>
      ) : events.map((e) => (
        <div className="histline" key={e.key} data-type={e.type} data-reversed={e.reversed || undefined}>
          <span>
            <em><b>{e.staff}</b> {say(e)}</em>
            <small>
              {wdOf(e.date)} {fmtDay(e.date)}{e.at ? `, ${fmtTime(e.at)}` : ''}
              {e.mode ? ` · ${e.mode === 'online' ? 'Online' : 'Cash'}` : ''}
              {e.note ? ` · ${e.note}` : ''}
              {e.reversed ? ' · reversed' : ''}
            </small>
          </span>
          {e.amount != null && <b className="histamt">{e.type === 'reversed' ? '+ ' : ''}{inr(e.amount)}</b>}
        </div>
      ))}
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
      {daysToClear > 0 && <div className="paynote">About {daysToClear} working day{daysToClear === 1 ? '' : 's'} to work the advance off at {inr(book.rate)} a day.</div>}

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

/** Tuesday pay and the bonus ladder: the shop's rule from pay.js, not in the register, so shown apart. */
function TuesdayNote({ name, rate, cursor, statusFor, loading, cricket, todayKey }) {
  if (loading) return null
  const y = cursor.getFullYear()
  const m0 = cursor.getMonth()
  const dim = new Date(y, m0 + 1, 0).getDate()
  const days = Array.from({ length: dim }, (_, i) => new Date(y, m0, i + 1))
  const r = monthPay({ entries: days.map((d) => {
    const status = statusFor(d, name)
    return { date: d, status, future: dateKey(d) > todayKey || (dateKey(d) === todayKey && !status) }
  }), rate })
  const top = r.steps[r.steps.length - 1].need
  const rungs = [
    { need: r.need, say: `Tuesday pay, ${inr(r.tuesdays * rate)} for ${r.tuesdays} Tuesdays`, reached: r.enough },
    ...r.steps.map((s) => ({ need: s.need, say: `+ ${inr(s.amount)} bonus`, reached: s.reached })),
  ]
  const ahead = r.best > r.attended
  return (
    <div className="paytue">
      <div className="mgttl">Tuesday pay and bonus, not in the sum above</div>
      {cricket && <RunChase name={name} attended={r.attended} threshold={r.need} unlocked={r.unlocked} missedCount={r.missed.length} />}
      <div className="motdays">{halves(r.attended)} days of {r.open} open</div>
      <div className="progress"><span className={r.unlocked ? 'full' : ''} style={{ width: `${Math.min(r.attended / top, 1) * 100}%` }} /></div>
      <div className="ladder">
        {rungs.map((g) => (
          <div className="rung" key={g.need + g.say} data-on={(g.reached && !r.missed.length) || undefined}>
            <b>{halves(g.need)} days</b><span>{g.say}</span>
          </div>
        ))}
      </div>
      <div className={`motmsg ${r.unlocked ? 'good' : ''}`}>
        {r.missed.length > 0
          ? `Lost this month: ${r.missed.map((d) => `${WD[d.getDay()]} ${d.getDate()}`).join(', ')} ${r.missed.length === 1 ? 'was' : 'were'} not a full day. No Tuesday pay or bonus.`
          : r.unlocked
            ? `Earned: ${inr(r.tueBonus + r.bonus)}${ahead ? ' so far, if every Monday and Wednesday left is a full day' : ''}. Not added by the register.`
            : ahead
              ? `${ladderLine(r)}, with every Monday and Wednesday a full day.`
              : `Not earned: ${halves(r.attended)} days, Tuesday pay needed ${halves(r.need)}.`}
      </div>
    </div>
  )
}

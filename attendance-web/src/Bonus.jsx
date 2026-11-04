import { monthPay, ladderFor, ladderLine, halves, TUESDAY_SHARE, BONUS_STEPS } from './pay.js'

/*
 * The Bonus tab: the attendance ladder (pay.js) for every phone, no PIN.
 *
 * Staff see the month's three steps in days, how far each of them has climbed,
 * and every Monday and Wednesday of the month, because one of those missed
 * loses the Tuesday beside it and the bonus. Nothing here shows a wage or a rate: only days and the fixed
 * bonus amounts everybody is told. Rupees for Tuesday pay stay behind the PIN.
 */

const pad = (n) => String(n).padStart(2, '0')
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function BonusView({ cursor, setCursor, staff, statusFor, loading, todayKey }) {
  const y = cursor.getFullYear()
  const m0 = cursor.getMonth()
  const dim = new Date(y, m0 + 1, 0).getDate()
  const days = Array.from({ length: dim }, (_, i) => new Date(y, m0, i + 1))
  const stepM = (n) => setCursor(new Date(y, m0 + n, 1))
  // Today counts once it is marked.
  const isAhead = (d, status) => dateKey(d) > todayKey || (dateKey(d) === todayKey && !status)

  const rows = staff.map((name) => {
    const entries = days.map((d) => {
      const status = statusFor(d, name)
      return { date: d, status, future: isAhead(d, status) }
    })
    const guards = entries.filter((e) => e.date.getDay() === 1 || e.date.getDay() === 3)
    return { name, r: monthPay({ entries }), guards }
  })
  // The steps are the same for everyone while nobody has a closed day of their own.
  const ladder = ladderFor(rows[0]?.r.open ?? 0)

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
          <div className="bnrules">
            <div className="mgttl">{rows[0]?.r.open ?? 0} open days this month</div>
            <div className="bnstep"><b>{halves(ladder.tuesday)} days</b><i>{Math.round(TUESDAY_SHARE * 100)}%</i><span>Tuesday pay</span></div>
            {ladder.bonus.map((s, i) => (
              <div className="bnstep" key={s.amount}><b>{halves(s.need)} days</b><i>{Math.round(BONUS_STEPS[i].share * 100)}%</i><span>Tuesday pay + ₹{s.amount}</span></div>
            ))}
            <p>And a full day on the Monday and Wednesday beside each Tuesday. Miss one and that Tuesday is not paid, and the month has no bonus.</p>
          </div>

          <div className="bnlist">
            {rows.map(({ name, r, guards }) => {
              const top = r.steps[r.steps.length - 1].need
              const lost = r.missed.length > 0
              const marks = [r.need, ...r.steps.map((s) => s.need)]
              // Tuesday pay can survive a miss; the bonus steps cannot.
              const earned = [r.unlocked, ...r.steps.map((s) => !lost && s.reached)]
              const reached = earned.filter(Boolean).length
              return (
                <div className="bnrow" key={name} data-state={lost ? 'lost' : reached ? 'on' : undefined}>
                  <div className="bnhead">
                    <span className="pname">{name}</span>
                    <span className="bndays">{halves(r.attended)}<small> days</small></span>
                  </div>
                  <div className="bntrack" aria-hidden="true">
                    <span className="bnfill" style={{ width: `${Math.min(r.attended / top, 1) * 100}%` }} />
                    {marks.map((m, i) => (
                      <span className="bntick" key={i} data-on={earned[i] || undefined} style={{ left: `${(m / top) * 100}%` }} />
                    ))}
                  </div>
                  <div className="bnsay">{ladderLine(r)}</div>
                  <div className="bnguards" aria-label="Mondays and Wednesdays">
                    {guards.map((g) => {
                      const state = g.future ? 'ahead' : g.status === 'P' ? 'ok' : g.status === 'C' ? 'shut' : 'miss'
                      return (
                        <span className="bnguard" key={g.date.getDate()} data-state={state}>
                          {g.date.getDay() === 1 ? 'Mon' : 'Wed'} {g.date.getDate()}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

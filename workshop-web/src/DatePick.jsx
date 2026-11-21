import { useState } from 'react'
import { Sheet } from './ui.jsx'

/**
 * A date by touch, for the counter's screen (Tony, 21 Nov 2026). The phone's
 * own date box is small and fiddly with a finger, so the date is one big key
 * showing the day; tapped, it opens quick keys (Today, Tomorrow, a few days
 * on) and a month of big day squares. `value` and `onChange` are 'YYYY-MM-DD',
 * '' for none, which only a picker with `noneLabel` offers.
 */

const keyOf = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const dateOf = (key) => { const [y, m, d] = String(key).split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }

/** "Sat 21 Nov", and the year only when it is not this one. */
export const dayLabel = (key) => {
  if (!key) return ''
  const d = dateOf(key)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

const QUICK = [['Today', 0], ['Tomorrow', 1], ['In 2 days', 2], ['In 3 days', 3], ['In a week', 7]]
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function DateSheet({ title, value, noneLabel, onClose, onPick }) {
  const start = value ? dateOf(value) : today()
  const [month, setMonth] = useState(new Date(start.getFullYear(), start.getMonth(), 1))
  const now = keyOf(today())
  // The month's days in weeks from Monday, blank squares before the 1st.
  const lead = (month.getDay() + 6) % 7
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))]
  const turn = (by) => setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1))

  return (
    <Sheet label={title} wide onClose={onClose}>
      <b className="sheettitle">{title}</b>
      <div className="datepanel">
        <div className="datequick">
          {QUICK.map(([label, n]) => {
            const k = keyOf(addDays(today(), n))
            return (
              <button key={label} type="button" className={value === k ? 'on' : ''} aria-pressed={value === k} onClick={() => onPick(k)}>
                <b>{label}</b><small>{dayLabel(k)}</small>
              </button>
            )
          })}
          {noneLabel && (
            <button type="button" className={!value ? 'on' : ''} aria-pressed={!value} onClick={() => onPick('')}><b>{noneLabel}</b></button>
          )}
        </div>
        <div className="datemonth">
          <div className="datehead">
            <button type="button" onClick={() => turn(-1)} aria-label="Month before">‹</button>
            <b>{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b>
            <button type="button" onClick={() => turn(1)} aria-label="Month after">›</button>
          </div>
          <div className="dategrid">
            {WEEK.map((w) => <span key={w} className="dow">{w}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={`b${i}`} />
              const k = keyOf(d)
              return (
                <button key={k} type="button" className={`${value === k ? 'on' : ''} ${k === now ? 'today' : ''}`} aria-pressed={value === k} onClick={() => onPick(k)}>
                  {d.getDate()}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </Sheet>
  )
}

/** The big key that shows the date and opens the picker. */
export function DatePick({ label, value, onChange, noneLabel }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="datekey" onClick={() => setOpen(true)}>
        <span>{label}</span><b className={value ? '' : 'none'}>{value ? dayLabel(value) : (noneLabel || 'Pick a day')}</b>
      </button>
      {open && <DateSheet title={label} value={value} noneLabel={noneLabel} onClose={() => setOpen(false)} onPick={(k) => { onChange(k); setOpen(false) }} />}
    </>
  )
}

/**
 * One worker's month, read out of the Staff Payments register.
 *
 * Display only. The register (convex/lib/staffPay.ts, `account`) decides every
 * figure: what a day earned, what was paid, what an advance still stands at.
 * This only picks one month out of it and lines the sum up so it can be checked
 * by eye on the Pay tab, the same sum the register itself does:
 *
 *   carried in + earned - wages paid - advances given = balance now
 *
 * The register keeps one running balance per worker. Above zero the shop owes
 * wages; below zero an advance is still to be worked off.
 */

const round2 = (n) => Math.round(n * 100) / 100
const byDate = (a, b) => a.date.localeCompare(b.date)

/** @param row a `staffPay.board` row  @param month 'YYYY-MM' */
export function monthBook(row, month) {
  if (!row?.profile) return null
  const start = `${month}-01`
  const all = [...(row.daily || [])].sort(byDate)
  const days = all.filter((d) => d.date.startsWith(month))
  const before = all.filter((d) => d.date < start)
  const opening = before.length
    ? before.at(-1).balance
    : round2((row.profile.openingDue || 0) - (row.profile.openingAdvance || 0))

  const sum = (key) => round2(days.reduce((n, d) => n + (d[key] || 0), 0))
  const earned = sum('earned')
  const monthly = sum('monthly')
  const paid = sum('paid')
  const advanced = sum('advanced')
  const recovered = sum('recovered')
  const closing = days.length ? days.at(-1).balance : opening

  const count = (s) => days.filter((d) => d.status === s).length
  const present = count('P')
  const half = count('H')
  const rates = [...new Set(days.filter((d) => d.status === 'P' || d.status === 'H').map((d) => d.rate))]

  const payments = (row.payments || [])
    .filter((p) => !p.voided && p.date.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.at || 0) - (b.at || 0))

  return {
    startDate: row.profile.startDate,
    startedThisMonth: row.profile.startDate >= start,
    rate: row.rate || 0,
    rates: rates.length ? rates : [row.rate || 0],
    opening,
    earned,
    monthly,
    paid,
    advanced,
    recovered,
    closing,
    worked: present + half / 2,
    present,
    half,
    absent: count('N'),
    leave: count('L'),
    days,
    payments,
  }
}

/**
 * Every pay event in a month, for all staff, newest first: wages and advances
 * handed over, payments reversed, rate changes and the day tracking began.
 * Read from the same register rows, so it shows exactly what the register holds.
 */
export function monthEvents(rows, month) {
  const out = []
  const inMonth = (date) => !!date && date.startsWith(month)
  for (const row of rows || []) {
    if (!row?.profile) continue
    const staff = row.staff
    for (const p of row.payments || []) {
      if (inMonth(p.date)) {
        out.push({ key: `p-${p._id}`, staff, date: p.date, at: p.at, type: p.kind === 'advance' ? 'advance' : 'wage',
          amount: p.amount, mode: p.mode, note: p.note, reversed: !!p.voided, legacy: !!p.legacy })
      }
      if (p.voided && p.voidedAt && inMonth(p.date)) {
        // Shown on the day it was reversed (India time), not the day it was paid.
        const on = new Date(p.voidedAt + 330 * 60_000).toISOString().slice(0, 10)
        out.push({ key: `r-${p._id}`, staff, date: on, at: p.voidedAt, type: 'reversed',
          amount: p.amount, of: p.kind === 'advance' ? 'advance' : 'wages', paidOn: p.date })
      }
    }
    const pr = row.profile
    if (inMonth(pr.startDate)) {
      out.push({ key: `s-${staff}`, staff, date: pr.startDate, at: pr.createdAt, type: 'start',
        rate: pr.rates?.[0]?.rate ?? 0, openingDue: pr.openingDue || 0, openingAdvance: pr.openingAdvance || 0 })
    }
    for (const r of (pr.rates || []).slice(1)) {
      if (inMonth(r.from)) out.push({ key: `c-${staff}-${r.from}`, staff, date: r.from, type: 'rate', rate: r.rate })
    }
  }
  const when = (e) => e.at ?? Date.parse(`${e.date}T23:59:00+05:30`)
  return out.sort((a, b) => when(b) - when(a))
}

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

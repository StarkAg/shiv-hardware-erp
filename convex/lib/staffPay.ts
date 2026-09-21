import type { QueryCtx } from '../_generated/server'
import type { Doc } from '../_generated/dataModel'
import { round2 } from './money'

export const indiaToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('Choose a valid date.')
}
export function amount(value: number, allowZero = false) {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0) || value > 10_000_000 || Math.abs(round2(value) - value) > 0.000001) {
    throw new Error('Enter a valid amount with at most two decimal places.')
  }
  return round2(value)
}
export const dayWeight = (status: string) => status === 'P' ? 1 : status === 'H' ? 0.5 : 0
export const rateOn = (profile: Pick<Doc<'staffPayProfiles'>, 'rates'>, date: string) =>
  [...profile.rates].reverse().find(r => r.from <= date)?.rate ?? 0

/** A change before a recorded payout needs that payout reversed first. */
export async function assertUnsettled(ctx: QueryCtx, staff: string, date: string) {
  const payments = await ctx.db.query('staffPayments').withIndex('by_staff_date', q => q.eq('staff', staff).gte('date', date)).collect()
  if (payments.some(p => !p.voided)) throw new Error('Reverse the staff payments on or after this date before changing it.')
}

export async function account(ctx: QueryCtx, profile: Doc<'staffPayProfiles'>, asOf: string) {
  const [days, payments, advances] = await Promise.all([
    ctx.db.query('attendanceDays').withIndex('by_date', q => q.gte('date', profile.startDate).lte('date', asOf)).collect(),
    ctx.db.query('staffPayments').withIndex('by_staff_date', q => q.eq('staff', profile.staff).lte('date', asOf)).collect(),
    ctx.db.query('attendanceAdvances').withIndex('by_date', q => q.gte('date', profile.startDate).lte('date', asOf)).collect(),
  ])
  const active = payments.filter(p => !p.voided)
  // New advances are already in the payments list. Old attendance advances
  // remain visible, without being written to the cash register a second time.
  const legacy = advances.filter(a => a.staff === profile.staff && !a.staffPaymentId)
  const dates = [...new Set([...days.map(d => d.date), ...active.map(p => p.date), ...legacy.map(a => a.date), asOf])]
    .filter(d => d >= profile.startDate).sort()
  let balance = asOf >= profile.startDate ? round2(profile.openingDue - profile.openingAdvance) : 0
  let earned = 0, paid = 0, advanced = 0, recovered = 0
  const daily = dates.map(date => {
    const attendance = days.find(d => d.date === date)
    const mark = String(attendance?.marks?.[profile.staff] ?? '')
    const status = mark === 'N' && attendance?.unpaidLeaves?.[profile.staff] ? 'L' : mark
    const rate = rateOn(profile, date)
    const wage = round2(dayWeight(status) * rate)
    const deduction = round2(Math.min(wage, Math.max(0, -balance)))
    const entries = active.filter(p => p.date === date)
    const old = legacy.filter(a => a.date === date)
    const wagePaid = round2(entries.filter(p => p.kind === 'wage').reduce((n, p) => n + p.amount, 0))
    const advancePaid = round2(entries.filter(p => p.kind === 'advance').reduce((n, p) => n + p.amount, 0) + old.reduce((n, a) => n + a.amount, 0))
    balance = round2(balance + wage - wagePaid - advancePaid)
    earned = round2(earned + wage); paid = round2(paid + wagePaid); advanced = round2(advanced + advancePaid); recovered = round2(recovered + deduction)
    return { date, status, rate, earned: wage, recovered: deduction, paid: wagePaid, advanced: advancePaid, balance }
  })
  const today = daily.find(d => d.date === asOf)
  const month = daily.filter(d => d.date.startsWith(asOf.slice(0, 7)))
  return {
    staff: profile.staff, profile, rate: rateOn(profile, asOf), status: today?.status ?? '',
    earnedToday: today?.earned ?? 0, recoveredToday: today?.recovered ?? 0,
    due: Math.max(0, balance), advance: Math.max(0, -balance), earned, paid, advanced, recovered,
    month: {
      earned: round2(month.reduce((n, d) => n + d.earned, 0)),
      present: month.filter(d => d.status === 'P').length,
      half: month.filter(d => d.status === 'H').length,
      absent: month.filter(d => d.status === 'N').length,
      leave: month.filter(d => d.status === 'L').length,
    },
    daily: daily.reverse(),
    payments: [...payments.map(p => ({ ...p, legacy: false })), ...legacy.map(a => ({
      _id: a._id, requestId: '', staff: a.staff, date: a.date, kind: 'advance' as const,
      amount: a.amount, mode: '' as const, note: a.note ?? '', at: a.at, voided: false, legacy: true,
    }))].sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at),
  }
}

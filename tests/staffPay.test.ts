/// <reference types="vite/client" />
import { convexTest } from './trustedConvex'
import { describe, expect, it, vi, afterEach } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'
const modules = import.meta.glob('../convex/**/*.ts')

afterEach(() => vi.useRealTimers())
async function shop() {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-18T12:00:00Z'))
  const t = convexTest(schema, modules)
  await t.run(async ctx => {
    await ctx.db.insert('attendanceMeta', { staff: ['Vijay', 'Anup'], rates: { Vijay: 500, Anup: 400 }, updatedAt: 1 })
    const groupId = await ctx.db.insert('groups', { name: 'Cash-in-Hand', nature: 'asset', normalSide: 'Dr', sort: 1 })
    for (const name of ['Cash', 'Bank']) await ctx.db.insert('ledgers', { name, groupId, openingBalance: 0, openingSide: 'Dr', openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('voucherTypes', { name: 'Payment', abbr: 'PAY', sort: 1 })
  })
  return t
}
const setup = (t: ReturnType<typeof convexTest>, extra = {}) => t.mutation(api.staffPay.setup, { staff: 'Vijay', startDate: '2026-09-01', rate: 500, openingDue: 0, openingAdvance: 0, ...extra })
const mark = (t: ReturnType<typeof convexTest>, date: string, status: 'P' | 'H' | 'N' | 'L' | 'C' | '') => t.mutation(api.staffPay.mark, { staff: 'Vijay', date, status })
const pay = (t: ReturnType<typeof convexTest>, extra = {}) => t.mutation(api.staffPay.pay, { requestId: 'payment-0001', staff: 'Vijay', date: '2026-09-01', kind: 'wage', amount: 500, mode: 'cash', note: '', ...extra })
async function balance(t: ReturnType<typeof convexTest>, date = '2026-09-18') {
  const b = await t.query(api.staffPay.board, { date })
  return b.rows.find(r => r.staff === 'Vijay') as Extract<typeof b.rows[number], { profile: object }>
}

describe('cashier daily staff payments', () => {
  it('starts from existing staff and rates without creating pay records', async () => {
    const t = await shop()
    expect((await t.query(api.staffPay.board, { date: '2026-09-18' })).rows).toEqual([
      { staff: 'Vijay', profile: null, rate: 500 }, { staff: 'Anup', profile: null, rate: 400 },
    ])
  })
  it('earns full and half days; absence, leave and closed days are unpaid', async () => {
    const t = await shop(); await setup(t)
    for (const [i, status] of ['P', 'H', 'N', 'L', 'C'].entries()) await mark(t, `2026-09-0${i + 1}`, status as any)
    expect(await balance(t)).toMatchObject({ due: 750, earned: 750, advance: 0, month: { present: 1, half: 1, absent: 1, leave: 1 } })
    const day = await t.run(ctx => ctx.db.query('attendanceDays').withIndex('by_date', q => q.eq('date', '2026-09-04')).unique())
    expect(day).toMatchObject({ marks: { Vijay: 'N' }, unpaidLeaves: { Vijay: true } })
  })
  it('automatically uses the whole wage until an advance clears, including partial final day', async () => {
    const t = await shop(); await setup(t, { openingAdvance: 1200 })
    await mark(t, '2026-09-01', 'P')
    expect(await balance(t, '2026-09-01')).toMatchObject({ due: 0, advance: 700, recoveredToday: 500 })
    await mark(t, '2026-09-02', 'L')
    expect(await balance(t, '2026-09-02')).toMatchObject({ due: 0, advance: 700, recoveredToday: 0 })
    await mark(t, '2026-09-03', 'P'); await mark(t, '2026-09-04', 'P')
    expect(await balance(t, '2026-09-04')).toMatchObject({ due: 300, advance: 0, recoveredToday: 200, recovered: 1200 })
  })
  it('clears unpaid leave flags when bulk attendance changes a day', async () => {
    const t = await shop(); await setup(t); await mark(t, '2026-09-01', 'L')
    await t.mutation(api.attendance.setDay, { date: '2026-09-01', marks: { Vijay: 'P' } })
    await t.mutation(api.attendance.lockDay, { date: '2026-09-01', marks: { Vijay: 'N' } })
    expect(await balance(t)).toMatchObject({ month: { absent: 1, leave: 0 }, due: 0 })
  })
  it('carries debt across months without retroactively counting pre-start attendance', async () => {
    const t = await shop()
    await t.mutation(api.attendance.setMark, { staff: 'Vijay', date: '2026-08-20', status: 'P' })
    await setup(t, { startDate: '2026-08-31', openingAdvance: 1000 })
    await mark(t, '2026-08-31', 'P'); await mark(t, '2026-09-01', 'H')
    expect(await balance(t)).toMatchObject({ due: 0, advance: 250, earned: 750 })
    expect(await balance(t, '2026-08-30')).toMatchObject({ due: 0, advance: 0 })
  })
  // The cash book stays out of the books (2026-10-04): a wage is one cash row
  // and nothing in the ledger.
  it('writes one cash row and no voucher for a wage; retries never pay twice', async () => {
    const t = await shop(); await setup(t); await mark(t, '2026-09-01', 'P')
    await pay(t); await pay(t)
    const rows = await t.run(async ctx => ({ cash: await ctx.db.query('cashEntries').collect(), vouchers: await ctx.db.query('vouchers').collect(), lines: await ctx.db.query('voucherEntries').collect(), payments: await ctx.db.query('staffPayments').collect() }))
    expect(rows.cash).toHaveLength(1); expect(rows.vouchers).toHaveLength(0); expect(rows.payments).toHaveLength(1)
    expect(rows.lines).toHaveLength(0)
    expect(rows.cash[0]).toMatchObject({ amount: 500, kind: 'out' })
    expect(await balance(t)).toMatchObject({ due: 0, paid: 500 })
    await expect(pay(t, { amount: 100 })).rejects.toThrow('reference already used')
  })
  it('records an advance once in attendance and cash; future wages offset it without another cash row', async () => {
    const t = await shop(); await setup(t)
    await pay(t, { kind: 'advance', amount: 800 }); await pay(t, { kind: 'advance', amount: 800 })
    await mark(t, '2026-09-02', 'P'); await mark(t, '2026-09-03', 'P')
    expect(await balance(t)).toMatchObject({ advanced: 800, advance: 0, due: 200, recovered: 800 })
    expect(await t.run(ctx => ctx.db.query('attendanceAdvances').collect())).toHaveLength(1)
    expect(await t.run(ctx => ctx.db.query('cashEntries').collect())).toHaveLength(1)
    await pay(t, { requestId: 'payment-0002', date: '2026-09-03', amount: 200, mode: 'online' })
    expect(await balance(t)).toMatchObject({ due: 0, advance: 0 })
    const [cash] = (await t.query(api.cash.pull, {})).entries.filter(e => e.mode === 'online')
    expect(cash).toMatchObject({ amount: 200, staffPaymentId: 'payment-0002' })
  })
  /**
   * The cap is what has been EARNED and not yet handed over, not what is `due`
   * after an advance has eaten into it — taking that cut is the shop's choice.
   * What can never happen is paying out more wages than were worked for.
   */
  it('cannot pay out more wages than have been earned', async () => {
    const t = await shop(); await setup(t, { openingAdvance: 500 }); await mark(t, '2026-09-01', 'P')
    // One day worked, so one day may be paid — even though an advance stands
    // and `due` is nil because of it.
    expect((await balance(t, '2026-09-01')).due).toBe(0)
    await pay(t)
    // Nothing further has been earned, so nothing further can be paid.
    await expect(pay(t, { requestId: 'payment-0002' })).rejects.toThrow('earned and not yet paid')
    await mark(t, '2026-09-02', 'P')
    await pay(t, { requestId: 'payment-0002', date: '2026-09-02' })
    await expect(pay(t, { requestId: 'payment-0003', date: '2026-09-02' })).rejects.toThrow('earned and not yet paid')
  })
  it('reads old advances from the tracking period but never posts them again', async () => {
    const t = await shop()
    await t.mutation(api.attendance.addAdvance, { staff: 'Vijay', date: '2026-08-01', amount: 4000 })
    await t.mutation(api.attendance.addAdvance, { staff: 'Vijay', date: '2026-09-01', amount: 600 })
    await setup(t); await mark(t, '2026-09-02', 'P')
    expect(await balance(t)).toMatchObject({ advance: 100, advanced: 600 })
    expect(await t.run(ctx => ctx.db.query('cashEntries').collect())).toHaveLength(0)
  })
  it('keeps dated wage rates and blocks changes after payments', async () => {
    const t = await shop(); await setup(t); await mark(t, '2026-09-01', 'P')
    await t.mutation(api.staffPay.changeRate, { staff: 'Vijay', rate: 600, from: '2026-09-02' })
    await mark(t, '2026-09-02', 'P')
    expect(await balance(t)).toMatchObject({ earned: 1100, due: 1100 })
    await pay(t, { date: '2026-09-02', amount: 1100 })
    await expect(t.mutation(api.staffPay.changeRate, { staff: 'Vijay', rate: 400, from: '2026-09-02' })).rejects.toThrow('Reverse')
    await expect(mark(t, '2026-09-01', 'N')).rejects.toThrow('Reverse')
    await expect(t.mutation(api.attendance.setMark, { staff: 'Vijay', date: '2026-09-01', status: 'N' })).rejects.toThrow('Reverse')
    await expect(t.mutation(api.attendance.setDay, { date: '2026-09-01', marks: { Vijay: 'N' } })).rejects.toThrow('Reverse')
    await expect(t.mutation(api.attendance.lockDay, { date: '2026-09-01', marks: { Vijay: 'N' } })).rejects.toThrow('Reverse')
  })
  it('respects locked attendance and closed cashier days', async () => {
    const t = await shop(); await setup(t); await mark(t, '2026-09-01', 'P')
    await t.mutation(api.attendance.lockDay, { date: '2026-09-01' })
    await expect(mark(t, '2026-09-01', 'N')).rejects.toThrow('locked')
    await t.mutation(api.cash.push, { ops: [{ t: 'close', date: '2026-09-01', counted: 100 }] })
    await expect(pay(t)).rejects.toThrow('closed')
  })
  it('reverses wages atomically and retains the audit history', async () => {
    const t = await shop(); await setup(t); await mark(t, '2026-09-01', 'P'); await pay(t)
    await t.mutation(api.staffPay.reverse, { requestId: 'payment-0001' })
    await t.mutation(api.staffPay.reverse, { requestId: 'payment-0001' })
    expect(await balance(t)).toMatchObject({ due: 500, paid: 0 })
    expect((await balance(t)).payments[0]).toMatchObject({ voided: true })
    expect((await t.run(ctx => ctx.db.query('cashEntries').collect()))[0]).toMatchObject({ deleted: true })
    expect(await t.run(ctx => ctx.db.query('vouchers').collect())).toHaveLength(0)
    expect(await t.run(ctx => ctx.db.query('voucherEntries').collect())).toHaveLength(0)
  })
  it('reverses advances without leaving an attendance advance behind', async () => {
    const t = await shop(); await setup(t); await pay(t, { kind: 'advance' })
    await t.mutation(api.staffPay.reverse, { requestId: 'payment-0001' })
    expect(await balance(t)).toMatchObject({ due: 0, advance: 0, advanced: 0 })
    expect(await t.run(ctx => ctx.db.query('attendanceAdvances').collect())).toHaveLength(0)
  })
  it('requires later payments reversed first and rejects backdated payments', async () => {
    const t = await shop(); await setup(t); await pay(t, { kind: 'advance' })
    vi.setSystemTime(new Date('2026-09-18T12:01:00Z'))
    await pay(t, { requestId: 'payment-0002', date: '2026-09-02', kind: 'advance' })
    await expect(t.mutation(api.staffPay.reverse, { requestId: 'payment-0001' })).rejects.toThrow('later payments')
    await expect(pay(t, { requestId: 'payment-0003', date: '2026-09-01', kind: 'advance' })).rejects.toThrow('date order')
  })
  it('prevents edits in other screens from separating staff and cash records', async () => {
    const t = await shop(); await setup(t); await pay(t, { kind: 'advance' })
    const [cash] = await t.run(ctx => ctx.db.query('cashEntries').collect())
    await expect(t.mutation(api.cash.push, { ops: [{ t: 'entry', entryId: cash.entryId, date: cash.date, kind: cash.kind, mode: cash.mode, name: cash.name, amount: 1, at: cash.at, updatedAt: Date.now() }] })).rejects.toThrow('Staff Payments')
    const [advance] = await t.run(ctx => ctx.db.query('attendanceAdvances').collect())
    await expect(t.mutation(api.attendance.removeAdvance, { id: advance._id })).rejects.toThrow('Staff Payments')
    await expect(t.mutation(api.attendance.addAdvance, { staff: 'Vijay', date: '2026-09-01', amount: 100 })).rejects.toThrow('Staff Payments')
  })
  it('pays with no account set up in the books, since the cash book does not post', async () => {
    const t = await shop(); await setup(t)
    await t.run(async ctx => { for (const type of await ctx.db.query('voucherTypes').collect()) await ctx.db.delete(type._id) })
    await pay(t, { kind: 'advance' })
    expect(await t.run(ctx => ctx.db.query('staffPayments').collect())).toHaveLength(1)
    expect(await t.run(ctx => ctx.db.query('cashEntries').collect())).toHaveLength(1)
  })
  it.each([0, -1, NaN, Infinity, 1.001, 10000001])('rejects invalid amounts (%s)', async value => {
    const t = await shop(); await setup(t)
    await expect(pay(t, { kind: 'advance', amount: value })).rejects.toThrow()
  })
  it('rejects bad dates, future payments and duplicate setup', async () => {
    const t = await shop(); await setup(t)
    await expect(pay(t, { kind: 'advance', date: '2026-02-30' })).rejects.toThrow('valid date')
    await expect(pay(t, { kind: 'advance', date: '2026-09-19' })).rejects.toThrow('future')
    await expect(setup(t)).rejects.toThrow('already set up')
  })
})

/**
 * A standing amount on top of the days.
 *
 * One man is on a daily rate plus a fixed sum at month end. It was being
 * remembered and paid by hand, which is a thing that gets forgotten.
 */
describe('the monthly amount', () => {
  const setMonthly = (t: ReturnType<typeof convexTest>, monthly: number) =>
    t.mutation(api.staffPay.setMonthly, { staff: 'Vijay', monthly })

  it('is earned on the last day of the month, on top of that day', async () => {
    const t = await shop()
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))
    await setup(t)
    await setMonthly(t, 1200)
    await mark(t, '2026-09-30', 'P')

    const v = await balance(t, '2026-09-30')
    const last = v.daily.find(d => d.date === '2026-09-30')!
    expect(last.monthly).toBe(1200)
    expect(last.earned).toBe(1700)   // 500 for the day + 1200 standing
    expect(v.month.monthly).toBe(1200)
    expect(v.due).toBe(1700)
  })

  it('is not earned on any other day', async () => {
    const t = await shop()
    await setup(t)
    await setMonthly(t, 1200)
    await mark(t, '2026-09-18', 'P')

    const v = await balance(t, '2026-09-18')
    expect(v.daily.find(d => d.date === '2026-09-18')!.monthly).toBe(0)
    expect(v.due).toBe(500)
  })

  it('lands even when nobody marked the sheet that day', async () => {
    const t = await shop()
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))
    await setup(t)
    await setMonthly(t, 1200)
    // No attendance at all in September.
    const v = await balance(t, '2026-09-30')
    expect(v.due).toBe(1200)
  })

  it('is paid for each month already tracked, not just the current one', async () => {
    const t = await shop()
    vi.setSystemTime(new Date('2026-11-30T12:00:00Z'))
    await setup(t)          // tracking from 2026-09-01
    await setMonthly(t, 1200)
    const v = await balance(t, '2026-11-30')
    // September, October and November ends.
    expect(v.due).toBe(3600)
  })

  it('comes off again when set to zero', async () => {
    const t = await shop()
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))
    await setup(t)
    await setMonthly(t, 1200)
    await setMonthly(t, 0)
    const v = await balance(t, '2026-09-30')
    expect(v.profile.monthly).toBeUndefined()
    expect(v.due).toBe(0)
  })
})

/**
 * Cutting an advance out of a day's wage is the shop's choice, not a rule.
 *
 * A man with an advance running still turns up and still eats. Some days he is
 * given his day's money and the advance is left where it is.
 */
describe('taking the advance cut, or not', () => {
  const advance = (t: ReturnType<typeof convexTest>, amount: number) =>
    t.mutation(api.staffPay.pay, { requestId: 'adv-0001', staff: 'Vijay', date: '2026-09-01', kind: 'advance', amount, mode: 'cash', note: '' })

  it('still recovers by default — due is nil while an advance stands', async () => {
    const t = await shop()
    await setup(t)
    await advance(t, 2000)
    await mark(t, '2026-09-02', 'P')
    const v = await balance(t, '2026-09-02')
    expect(v.due).toBe(0)
    expect(v.advance).toBe(1500)     // 2000 advance, 500 earned against it
    expect(v.payableMax).toBe(500)   // but a full day is there to be paid
  })

  it('lets the day be paid in full, leaving the advance untouched', async () => {
    const t = await shop()
    await setup(t)
    await advance(t, 2000)
    await mark(t, '2026-09-02', 'P')
    await t.mutation(api.staffPay.pay, { requestId: 'wage-0002', staff: 'Vijay', date: '2026-09-02', kind: 'wage', amount: 500, mode: 'cash', note: '' })

    const v = await balance(t, '2026-09-02')
    expect(v.paid).toBe(500)
    expect(v.advance).toBe(2000)     // back where it was — nothing was cut
    expect(v.payableMax).toBe(0)
  })

  it('refuses more than has actually been earned', async () => {
    const t = await shop()
    await setup(t)
    await advance(t, 2000)
    await mark(t, '2026-09-02', 'P')
    await expect(t.mutation(api.staffPay.pay, { requestId: 'wage-0003', staff: 'Vijay', date: '2026-09-02', kind: 'wage', amount: 600, mode: 'cash', note: '' }))
      .rejects.toThrow(/earned and not yet paid/)
  })

  it('wages owed from before tracking can still be paid', async () => {
    const t = await shop()
    await setup(t, { openingDue: 1000 })
    const v = await balance(t, '2026-09-01')
    expect(v.due).toBe(1000)
    expect(v.payableMax).toBe(1000)
  })
})

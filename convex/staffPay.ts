import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { account, amount, assertUnsettled, indiaToday, validDate } from './lib/staffPay'
import { foldName } from './lib/text'
import { postCashEntry } from './cash'

const DEFAULT_STAFF = ['Vijay', 'Anup', 'Sonu', 'Anand', 'Vicky', 'Dharmendra']
const statusArg = v.union(v.literal('P'), v.literal('H'), v.literal('N'), v.literal('L'), v.literal('C'), v.literal(''))

export const board = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    validDate(date)
    const meta = await ctx.db.query('attendanceMeta').first()
    const profiles = await ctx.db.query('staffPayProfiles').collect()
    const names = [...new Set([...(meta?.staff ?? DEFAULT_STAFF), ...profiles.map(p => p.staff)])]
    const rows = await Promise.all(names.map(async staff => {
      const profile = profiles.find(p => p.staff === staff)
      if (!profile) return { staff, profile: null, rate: Number(meta?.rates?.[staff] ?? 0) }
      return account(ctx, profile, date)
    }))
    const attendance = await ctx.db.query('attendanceDays').withIndex('by_date', q => q.eq('date', date)).unique()
    return { date, rows, attendanceLocked: !!attendance?.locked }
  },
})

export const setup = mutation({
  args: { staff: v.string(), startDate: v.string(), rate: v.number(), openingDue: v.number(), openingAdvance: v.number() },
  handler: async (ctx, args) => {
    validDate(args.startDate)
    if (args.startDate > indiaToday()) throw new Error('Tracking cannot start in the future.')
    amount(args.rate); amount(args.openingDue, true); amount(args.openingAdvance, true)
    if (args.openingDue && args.openingAdvance) throw new Error('Enter either wages owed or an outstanding advance, not both.')
    const meta = await ctx.db.query('attendanceMeta').first()
    if (!(meta?.staff ?? DEFAULT_STAFF).includes(args.staff)) throw new Error('Choose an existing staff member.')
    const existing = await ctx.db.query('staffPayProfiles').withIndex('by_staff', q => q.eq('staff', args.staff)).unique()
    if (existing) throw new Error('Staff tracking is already set up. Refresh this page.')
    const now = Date.now()
    let group = await ctx.db.query('groups').filter(q => q.eq(q.field('name'), 'Staff')).first()
    if (!group) {
      const id = await ctx.db.insert('groups', { name: 'Staff', nature: 'expense', normalSide: 'Dr', sort: 8 })
      group = (await ctx.db.get(id))!
    }
    const ledgers = await ctx.db.query('ledgers').collect()
    const matches = ledgers.filter(l => l.groupId === group!._id && foldName(l.name) === foldName(args.staff))
    if (matches.length > 1) throw new Error('There are duplicate staff accounts. Merge them in Account Masters first.')
    const ledgerId = matches[0]?._id ?? await ctx.db.insert('ledgers', {
      name: args.staff, groupId: group._id, openingBalance: 0, openingSide: 'Dr',
      openingAsOf: Date.parse(args.startDate), active: true, createdAt: now, updatedAt: now,
    })
    await ctx.db.insert('staffPayProfiles', {
      staff: args.staff, startDate: args.startDate, openingDue: args.openingDue,
      openingAdvance: args.openingAdvance, rates: [{ from: args.startDate, rate: args.rate }], ledgerId, createdAt: now,
    })
    const rates = { ...(meta?.rates ?? {}), [args.staff]: args.rate }
    if (meta) await ctx.db.patch(meta._id, { rates, updatedAt: now })
    else await ctx.db.insert('attendanceMeta', { staff: DEFAULT_STAFF, rates, updatedAt: now })
    await ctx.db.insert('attendanceLog', { at: now, action: 'payroll-setup', date: args.startDate, summary: `${args.staff}: daily pay tracking started at ₹${args.rate}/day; wages owed ₹${args.openingDue}, advance ₹${args.openingAdvance}` })
  },
})

export const changeRate = mutation({
  args: { staff: v.string(), rate: v.number(), from: v.string() },
  handler: async (ctx, { staff, rate, from }) => {
    validDate(from); amount(rate)
    const profile = await ctx.db.query('staffPayProfiles').withIndex('by_staff', q => q.eq('staff', staff)).unique()
    if (!profile) throw new Error('Set up staff tracking first.')
    if (from < profile.startDate || from < profile.rates.at(-1)!.from) throw new Error('Choose a date on or after the latest rate change.')
    await assertUnsettled(ctx, staff, from)
    const rates = [...profile.rates.filter(r => r.from !== from), { from, rate }]
    await ctx.db.patch(profile._id, { rates })
    const meta = await ctx.db.query('attendanceMeta').first()
    if (meta && from <= indiaToday()) await ctx.db.patch(meta._id, { rates: { ...(meta.rates ?? {}), [staff]: rate }, updatedAt: Date.now() })
    await ctx.db.insert('attendanceLog', { at: Date.now(), action: 'rate', date: from, summary: `${staff}: ₹${rate}/day from ${from}` })
  },
})

/**
 * The standing monthly amount, on top of the days.
 *
 * Zero takes it off. Earned on the last day of each month from here on and
 * for every month already tracked — it is what the arrangement has always
 * been, so the account should read as though it was recorded all along.
 */
export const setMonthly = mutation({
  args: { staff: v.string(), monthly: v.number() },
  handler: async (ctx, { staff, monthly }) => {
    amount(monthly, true)
    const profile = await ctx.db.query('staffPayProfiles').withIndex('by_staff', q => q.eq('staff', staff)).unique()
    if (!profile) throw new Error('Set up staff tracking first.')
    await assertUnsettled(ctx, staff, profile.startDate)
    await ctx.db.patch(profile._id, { monthly: monthly || undefined })
    await ctx.db.insert('attendanceLog', {
      at: Date.now(), action: 'monthly', date: indiaToday(),
      summary: monthly ? `${staff}: ₹${monthly} a month on top of the days` : `${staff}: monthly amount removed`,
    })
  },
})

/**
 * Move where a staff member's tracking begins.
 *
 * For a profile opened on the wrong day: Vijay was set up on the 20th when the
 * shop had been paying him from the 1st, and a rate cannot start before
 * tracking does — so correcting the rate alone leaves the first nineteen days
 * earning nothing at all.
 *
 * Internal on purpose. This rewrites where a man's wages begin, which is not a
 * thing any screen at the counter should offer; it is a correction, made
 * deliberately, by somebody who has checked what is already paid. Refuses
 * outright if anything is settled on or after the new start.
 */
export const retrackFrom = internalMutation({
  args: { staff: v.string(), startDate: v.string(), rate: v.optional(v.number()) },
  handler: async (ctx, { staff, startDate, rate }) => {
    validDate(startDate)
    if (startDate > indiaToday()) throw new Error('Tracking cannot start in the future.')
    const profile = await ctx.db.query('staffPayProfiles').withIndex('by_staff', q => q.eq('staff', staff)).unique()
    if (!profile) throw new Error('Set up staff tracking first.')
    await assertUnsettled(ctx, staff, startDate)
    const first = rate ?? profile.rates[0].rate
    amount(first)
    // Later rate changes stand; only the opening one moves with the start.
    const rates = [{ from: startDate, rate: first }, ...profile.rates.filter(r => r.from > startDate)]
    await ctx.db.patch(profile._id, { startDate, rates })
    await ctx.db.insert('attendanceLog', {
      at: Date.now(), action: 'payroll-retrack', date: startDate,
      summary: `${staff}: tracking moved to start ${startDate} at ₹${first}/day`,
    })
  },
})

export const mark = mutation({
  args: { staff: v.string(), date: v.string(), status: statusArg },
  handler: async (ctx, { staff, date, status }) => {
    validDate(date)
    if (date > indiaToday()) throw new Error('Attendance cannot be marked in the future.')
    const profile = await ctx.db.query('staffPayProfiles').withIndex('by_staff', q => q.eq('staff', staff)).unique()
    if (!profile || date < profile.startDate) throw new Error('Choose a date within the staff tracking period.')
    const day = await ctx.db.query('attendanceDays').withIndex('by_date', q => q.eq('date', date)).unique()
    const mark = String(day?.marks?.[staff] ?? '')
    const before = mark === 'N' && day?.unpaidLeaves?.[staff] ? 'L' : mark
    if (before === status) return
    if (day?.locked) throw new Error('This attendance day is locked. Correct it in the attendance app first.')
    await assertUnsettled(ctx, staff, date)
    const marks = { ...(day?.marks ?? {}), [staff]: status === 'L' ? 'N' : status }
    const unpaidLeaves = { ...(day?.unpaidLeaves ?? {}), [staff]: status === 'L' }
    if (day) await ctx.db.patch(day._id, { marks, unpaidLeaves, updatedAt: Date.now() })
    else await ctx.db.insert('attendanceDays', { date, marks, unpaidLeaves, updatedAt: Date.now() })
    await ctx.db.insert('attendanceLog', { at: Date.now(), action: 'mark', date, summary: `${staff}: ${before || '—'} → ${status || '—'}`, changes: [{ staff, from: before, to: status }] })
  },
})

export const pay = mutation({
  args: {
    requestId: v.string(), staff: v.string(), date: v.string(),
    kind: v.union(v.literal('wage'), v.literal('advance')), amount: v.number(),
    mode: v.union(v.literal('cash'), v.literal('online')), note: v.string(),
  },
  handler: async (ctx, args) => {
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(args.requestId)) throw new Error('Invalid payment reference.')
    const existing = await ctx.db.query('staffPayments').withIndex('by_request', q => q.eq('requestId', args.requestId)).unique()
    if (existing) {
      if (existing.voided) throw new Error('This payment was reversed. Start a new payment.')
      if (['staff', 'date', 'kind', 'amount', 'mode', 'note'].some(k => (existing as any)[k] !== (args as any)[k])) throw new Error('Payment reference already used. Refresh and try again.')
      return { requestId: args.requestId }
    }
    validDate(args.date); amount(args.amount)
    if (args.date > indiaToday()) throw new Error('Payments cannot be dated in the future.')
    if (args.note.length > 500) throw new Error('Keep the note under 500 characters.')
    const profile = await ctx.db.query('staffPayProfiles').withIndex('by_staff', q => q.eq('staff', args.staff)).unique()
    if (!profile || args.date < profile.startDate) throw new Error('Set up staff tracking for this date first.')
    const later = await ctx.db.query('staffPayments').withIndex('by_staff_date', q => q.eq('staff', args.staff).gt('date', args.date)).collect()
    if (later.some(p => !p.voided)) throw new Error('A later staff payment exists. Record payments in date order.')
    const closed = await ctx.db.query('cashCloses').withIndex('by_date', q => q.eq('date', args.date)).unique()
    if (closed && !closed.deleted) throw new Error('The cash register is closed for this date. Reopen it before paying.')
    const balance = await account(ctx, profile, args.date)
    // Capped at the wages actually earned and not yet handed over — NOT at
    // `due`. Cutting an advance out of a day's wage is the shop's choice, so
    // paying the full day and leaving the advance standing has to be allowed;
    // the balance takes care of itself, since the wage paid puts the advance
    // straight back where it was.
    if (args.kind === 'wage' && args.amount > balance.payableMax) {
      throw new Error(`Only ₹${balance.payableMax} of wages has been earned and not yet paid. Use Advance for money paid ahead.`)
    }
    const now = Date.now()
    await ctx.db.insert('staffPayments', { ...args, at: now })
    if (args.kind === 'advance') await ctx.db.insert('attendanceAdvances', {
      staff: args.staff, date: args.date, amount: args.amount, note: args.note || undefined, at: now, staffPaymentId: args.requestId,
    })
    const entryId = `staff-pay-${args.requestId}`
    const cashId = await ctx.db.insert('cashEntries', {
      entryId, date: args.date, kind: 'out', mode: args.mode, name: args.staff, amount: args.amount,
      at: now, updatedAt: now, ledgerId: profile.ledgerId, staffPaymentId: args.requestId,
    })
    await postCashEntry(ctx, entryId)
    if (!(await ctx.db.get(cashId))?.voucherId) throw new Error('Cash/Bank or Payment account is missing. Set up Account Masters before paying.')
    const what = `${args.staff}: ${args.kind === 'advance' ? 'advance' : 'daily wages'} ₹${args.amount} · ${args.mode}${args.note ? ` · ${args.note}` : ''}`
    await ctx.db.insert('cashLog', { logId: `staff-pay-${args.requestId}`, at: now, kind: 'staff-pay', date: args.date, what })
    await ctx.db.insert('attendanceLog', { at: now, action: 'payment', date: args.date, summary: what })
    return { requestId: args.requestId }
  },
})

export const reverse = mutation({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) => {
    const payment = await ctx.db.query('staffPayments').withIndex('by_request', q => q.eq('requestId', requestId)).unique()
    if (!payment || payment.voided) return
    const closed = await ctx.db.query('cashCloses').withIndex('by_date', q => q.eq('date', payment.date)).unique()
    if (closed && !closed.deleted) throw new Error('Reopen this cash register day before reversing its payment.')
    const later = await ctx.db.query('staffPayments').withIndex('by_staff_date', q => q.eq('staff', payment.staff).gte('date', payment.date)).collect()
    if (later.some(p => !p.voided && p._id !== payment._id && (p.date > payment.date || p.at > payment.at))) throw new Error('Reverse this staff member’s later payments first.')
    const now = Date.now()
    await ctx.db.patch(payment._id, { voided: true, voidedAt: now })
    const cash = await ctx.db.query('cashEntries').withIndex('by_entry_id', q => q.eq('entryId', `staff-pay-${requestId}`)).unique()
    if (cash) {
      await ctx.db.patch(cash._id, { deleted: true, updatedAt: now })
      await postCashEntry(ctx, cash.entryId)
    }
    const advances = await ctx.db.query('attendanceAdvances').withIndex('by_date', q => q.eq('date', payment.date)).collect()
    for (const advance of advances) if (advance.staffPaymentId === requestId) await ctx.db.delete(advance._id)
    const what = `${payment.staff}: reversed ${payment.kind} ₹${payment.amount}`
    await ctx.db.insert('cashLog', { logId: `staff-reverse-${requestId}`, at: now, kind: 'staff-reverse', date: payment.date, what })
    await ctx.db.insert('attendanceLog', { at: now, action: 'payment-reversed', date: payment.date, summary: what })
  },
})

import { convexTest } from './trustedConvex'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'

const modules = import.meta.glob('../convex/**/*.ts')
const MIN = 60_000

describe('sale bills to the customer\'s WhatsApp', () => {
  it('sends final sales made after it was switched on, once each, after they have rested', async () => {
    const t = convexTest(schema, modules)
    const photo = () => t.run((ctx) => ctx.storage.store(new Blob(['photo'], { type: 'image/jpeg' })))
    const { sale, purchase, sanjay, nophone, supplier } = await t.run(async (ctx) => {
      const groupId = await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 1 })
      const ledger = (name: string, phone?: string) => ctx.db.insert('ledgers', { name, groupId, openingBalance: 0, openingSide: 'Dr', openingAsOf: 0, active: true, createdAt: 1, updatedAt: 1, ...(phone ? { phone } : {}) } as never)
      return {
        sale: await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 1 }),
        purchase: await ctx.db.insert('voucherTypes', { name: 'Purchase', abbr: 'PUR', sort: 2 }),
        sanjay: await ledger('M/s Sanjay Mahto Ji', '83407 85465'),
        nophone: await ledger('Walk-in'),
        supplier: await ledger('Sri Ram Trading', '9000000000'),
      }
    })
    const voucher = (typeId: Id<'voucherTypes'>, party: Id<'ledgers'>, no: number, at: number, extra: Record<string, unknown> = {}) =>
      t.run((ctx) => ctx.db.insert('vouchers', { typeId, voucherNo: no, fy: '2026-27', date: at, partyLedgerId: party, status: 'final', amount: 4500, attachments: [], createdAt: at, updatedAt: at, ...extra } as never))
    const now = Date.now()

    // A bill from before the sending was switched on is not sent by it.
    const before = await voucher(sale, sanjay, 40, now - 60 * MIN, { attachments: [await photo()] })
    expect(await t.query(api.billWhatsApp.due, { before: now })).toMatchObject({ on: false, items: [] })
    await t.mutation(api.billWhatsApp.setOn, { on: true })
    const from = (await t.query(api.billWhatsApp.status, {})).from!
    const at = (ms: number) => from + ms

    const withPhoto = await voucher(sale, sanjay, 41, at(MIN), { attachments: [{ storageId: await photo(), kind: 'bill' }] })
    await voucher(sale, nophone, 42, at(2 * MIN), { attachments: [await photo()] })
    await voucher(purchase, supplier, 7, at(3 * MIN), { attachments: [await photo()] })
    await voucher(sale, sanjay, 43, at(4 * MIN), { status: 'pending', amount: undefined, attachments: [await photo()] })
    // Typed in the panel, no photo: it goes as the printed bill.
    const typed = await voucher(sale, sanjay, 44, at(5 * MIN))
    await t.run((ctx) => ctx.db.insert('bills', { billId: 'b44', number: '44', updatedAt: at(5 * MIN), bill: { voucherId: typed, number: '44', total: 4500 } }))

    // Not yet rested: a bill saved a moment ago waits.
    expect((await t.query(api.billWhatsApp.due, { before: at(30 * 1000) })).items).toEqual([])
    // Rested: only the final sales to a customer with a phone, the oldest first.
    let due = await t.query(api.billWhatsApp.due, { before: at(20 * MIN), limit: 10 })
    expect(due.items.map((i) => [i.label, i.name, i.photos.length, i.bill ? 'printed' : 'photo'])).toEqual([
      ['SAL-0041', 'Sanjay Mahto Ji', 1, 'photo'],
      ['SAL-0044', 'Sanjay Mahto Ji', 0, 'printed'],
    ])
    expect(due.items.map((i) => i.voucherId)).not.toContain(before)

    // Sent once. A failure is tried again, three times in all.
    await t.mutation(api.billWhatsApp.record, { voucherId: withPhoto, status: 'sent', to: '918340785465@s.whatsapp.net' })
    for (let i = 0; i < 2; i++) {
      await t.mutation(api.billWhatsApp.record, { voucherId: typed, status: 'failed', reason: 'timed out' })
      expect((await t.query(api.billWhatsApp.due, { before: at(20 * MIN), limit: 10 })).items.map((x) => x.label)).toEqual(['SAL-0044'])
    }
    await t.mutation(api.billWhatsApp.record, { voucherId: typed, status: 'failed', reason: 'timed out' })
    due = await t.query(api.billWhatsApp.due, { before: at(20 * MIN), limit: 10 })
    expect(due.items).toEqual([])
    expect(due.sentToday).toBe(1)

    // An edit makes it wait again before it goes.
    const edited = await voucher(sale, sanjay, 45, at(6 * MIN), { updatedAt: at(19 * MIN), attachments: [await photo()] })
    expect((await t.query(api.billWhatsApp.due, { before: at(15 * MIN), limit: 10 })).items).toEqual([])
    expect((await t.query(api.billWhatsApp.due, { before: at(20 * MIN), limit: 10 })).items.map((x) => x.voucherId)).toEqual([edited])

    // The panel's page: what still waits and why, what happened lately, and a send again.
    const q = await t.query(api.billWhatsApp.queue, {})
    expect(q.waiting.map((w) => [w.label, w.held])).toEqual([
      ['SAL-0045', null],
      ['SAL-0043', 'Waiting for its amount'],
      ['SAL-0042', 'No mobile number on the account'],
    ])
    expect(q.recent.map((r) => [r.label, r.status])).toEqual([['SAL-0044', 'failed'], ['SAL-0041', 'sent']])
    await t.mutation(api.billWhatsApp.sendAgain, { voucherId: withPhoto })
    expect((await t.query(api.billWhatsApp.due, { before: at(20 * MIN), limit: 10 })).items.map((x) => x.label)).toContain('SAL-0041')

    // Switched off, nothing goes; switched on again, it keeps its first start.
    await t.mutation(api.billWhatsApp.setOn, { on: false })
    expect((await t.query(api.billWhatsApp.due, { before: at(20 * MIN), limit: 10 })).items).toEqual([])
    await t.mutation(api.billWhatsApp.setOn, { on: true })
    expect((await t.query(api.billWhatsApp.status, {})).from).not.toBeNull()
  })
})

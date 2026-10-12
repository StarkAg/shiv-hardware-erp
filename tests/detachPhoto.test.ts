import { convexTest } from './trustedConvex'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

/**
 * Detaching a photo from a posted bill takes it off the bill, its voucher and
 * its flow at once, and puts it back in the phone's waiting queue. Saving the
 * bill again never removes a photo (posting only adds), which is why a photo
 * "detached" by saving alone stayed on the voucher.
 */
describe('detaching a photo from a bill', () => {
  const books = async (t: ReturnType<typeof convexTest>) => t.run(async ctx => {
    await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
    const sales = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 1 })
    await ctx.db.insert('ledgers', { name: 'Sales', groupId: sales, openingBalance: 0, openingSide: 'Cr', openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 })
    await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
  })
  const sale = { id: 'sale-with-photos', number: '', kind: 'sale', date: '2026-10-11', customerName: 'Example Customer',
    items: [{ id: 'line-1', description: 'Goods', qty: 1, unit: 'Pc', amount: 100 }], total: 100, paid: false, paymentMode: 'cash' }

  it('takes it off the bill, the voucher and the flow, and back into the queue', async () => {
    const t = convexTest(schema, modules)
    await books(t)
    const [one, two] = await t.run(async ctx => [
      await ctx.storage.store(new Blob(['one'], { type: 'image/jpeg' })),
      await ctx.storage.store(new Blob(['two'], { type: 'image/jpeg' })),
    ])
    const papers = [{ storageId: one, kind: 'bill' as const }, { storageId: two, kind: 'bill' as const }]
    const posted = await t.mutation(api.billLedger.postBill, { bill: sale, attachments: papers, keepAsBill: true })

    // Saving the bill again without the photo does not take it off the voucher.
    await t.mutation(api.billLedger.postBill, { bill: { ...sale, number: posted.number }, attachments: [papers[0]], keepAsBill: true })
    expect((await t.query(api.vouchers.detail, { id: posted.voucherId! }))?.attachments).toHaveLength(2)

    expect(await t.mutation(api.bills.removeImage, { billId: sale.id, storageId: two })).toEqual({ removed: true, requeued: true })
    const bill = (await t.query(api.bills.get, {}))?.bills.find((row: any) => row.id === sale.id)
    expect(bill?.attachments).toEqual([papers[0]])
    expect((await t.query(api.vouchers.detail, { id: posted.voucherId! }))?.attachments).toEqual([expect.objectContaining({ storageId: one })])
    const [flow] = await t.run(ctx => ctx.db.query('billFlows').collect())
    expect(flow.photos).toEqual([one])
    // The photo is kept, waiting to be put on the right voucher.
    expect((await t.query(api.voucherInbox.list, {})).map((row: any) => row.storageId)).toEqual([two])
    expect(await t.run(ctx => ctx.db.system.get(two))).not.toBeNull()
    // Asked again, there is nothing left to take off, and the queue holds it once.
    expect(await t.mutation(api.bills.removeImage, { billId: sale.id, storageId: two })).toEqual({ removed: false, requeued: false })
    expect(await t.query(api.voucherInbox.list, {})).toHaveLength(1)
  })

  it('works on a voucher that has no bill behind it', async () => {
    const t = convexTest(schema, modules)
    await books(t)
    const photo = await t.run(ctx => ctx.storage.store(new Blob(['photo'], { type: 'image/jpeg' })))
    const posted = await t.mutation(api.billLedger.postBill, { bill: sale, attachments: [{ storageId: photo, kind: 'bill' }], keepAsBill: true })
    expect(await t.mutation(api.bills.removeImage, { voucherId: posted.voucherId!, storageId: photo })).toEqual({ removed: true, requeued: true })
    expect((await t.query(api.vouchers.detail, { id: posted.voucherId! }))?.attachments).toEqual([])
    expect(await t.query(api.voucherInbox.list, {})).toHaveLength(1)
  })
})

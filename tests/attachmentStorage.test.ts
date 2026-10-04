import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'
import { attachmentName, isPdfAttachment } from '../src/lib/attachments'

const modules = import.meta.glob('../convex/**/*.ts')

describe('attachment persistence and previews', () => {
  it('adds a phone image to the bill, voucher and flow once', async () => {
    const t = convexTest(schema, modules)
    await t.run(async ctx => {
      await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
      const sales = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 1 })
      await ctx.db.insert('ledgers', { name: 'Sales', groupId: sales, openingBalance: 0, openingSide: 'Cr', openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
    })
    const original = await t.run(ctx => ctx.storage.store(new Blob(['original'], { type: 'image/jpeg' })))
    const posted = await t.mutation(api.billLedger.postBill, {
      bill: { id: 'phone-photo-sale', number: '', kind: 'sale', date: '2026-10-05', customerName: 'Example Customer',
        items: [{ id: 'line-1', description: 'Goods', qty: 1, unit: 'Pc', amount: 100 }], total: 100,
        paid: false, paymentMode: 'cash' }, attachments: [{ storageId: original, kind: 'bill' }], keepAsBill: true,
    })
    const photo = await t.run(ctx => ctx.storage.store(new Blob(['photo'], { type: 'image/jpeg' })))
    expect(await t.mutation(api.bills.addImages, { billId: 'phone-photo-sale', storageIds: [photo] })).toEqual({ added: 1, total: 2 })
    expect(await t.mutation(api.bills.addImages, { billId: 'phone-photo-sale', storageIds: [photo] })).toEqual({ added: 0, total: 2 })
    const bill = (await t.query(api.bills.get, {}))?.bills.find((row: any) => row.id === 'phone-photo-sale')
    expect(bill?.attachments).toEqual([{ storageId: original, kind: 'bill' }, { storageId: photo, kind: 'bill' }])
    const voucher = await t.query(api.vouchers.detail, { id: posted.voucherId! })
    expect(voucher?.attachments).toEqual([expect.objectContaining({ storageId: original }), expect.objectContaining({ storageId: photo })])
    const [flow] = await t.run(ctx => ctx.db.query('billFlows').collect())
    expect(flow.photos).toEqual([original, photo])
    await expect(t.mutation(api.bills.addImages, { billId: 'missing-bill', storageIds: [photo] })).rejects.toThrow('posted bill')
  })

  it('keeps quotation photos through reopen and conversion to sale', async () => {
    const t = convexTest(schema, modules)
    const photo = await t.run(ctx => ctx.storage.store(new Blob(['bill'], { type: 'image/jpeg' })))
    const queue = await t.mutation(api.voucherInbox.add, { storageId: photo, groupId: 'quote' })
    const quote = { id: 'photo-quote', kind: 'quotation', number: 'Q-1', date: '2026-10-01',
      customerName: 'Photo Customer', total: 100, items: [], updatedAt: 1,
      attachments: [{ storageId: photo, kind: 'bill' }] }
    await t.mutation(api.bills.save, { bills: [quote], billSeq: 0 })
    expect((await t.query(api.bills.get, {}))?.bills[0].attachments).toEqual(quote.attachments)
    expect(await t.run(ctx => ctx.db.query('voucherEntries').collect())).toEqual([])
    expect(await t.query(api.files.describe, { storageIds: [photo] })).toEqual([
      expect.objectContaining({ storageId: photo, url: expect.any(String) }),
    ])
    // A failed queue claim must not let a later queue deletion break the quote.
    await t.mutation(api.voucherInbox.discard, { id: queue })
    expect(await t.run(ctx => ctx.db.system.get(photo))).not.toBeNull()

    await t.run(async ctx => {
      await ctx.db.insert('groups', { name: 'Sundry Debtors', nature: 'asset', normalSide: 'Dr', sort: 0 })
      const sales = await ctx.db.insert('groups', { name: 'Sales Accounts', nature: 'income', normalSide: 'Cr', sort: 1 })
      await ctx.db.insert('ledgers', { name: 'Sales', groupId: sales, openingBalance: 0, openingSide: 'Cr', openingAsOf: 1, active: true, createdAt: 1, updatedAt: 1 })
      await ctx.db.insert('voucherTypes', { name: 'Sale', abbr: 'SAL', sort: 0 })
    })
    const posted = await t.mutation(api.billLedger.postBill, {
      bill: { ...quote, kind: 'sale', number: '1', fromQuote: 'Q-1', updatedAt: 2 },
      attachments: quote.attachments as never, keepAsBill: true,
    })
    const detail = await t.query(api.vouchers.detail, { id: posted.voucherId! })
    expect(detail?.attachments).toEqual([expect.objectContaining({ storageId: photo, url: expect.any(String) })])
    expect((await t.query(api.bills.get, {}))?.bills[0].attachments).toEqual(quote.attachments)
  })

  it('keeps a legacy queue file used by a saved bill, but deletes a loose file', async () => {
    const t = convexTest(schema, modules)
    const photo = await t.run(ctx => ctx.storage.store(new Blob(['bill'], { type: 'image/jpeg' })))
    const row = await t.mutation(api.inbox.add, { storageId: photo })
    await t.mutation(api.bills.save, { bills: [{ id: 'shared', updatedAt: 1, attachments: [{ storageId: photo }] }], billSeq: 0 })
    await t.mutation(api.inbox.discard, { id: row })
    expect(await t.run(ctx => ctx.db.system.get(photo))).not.toBeNull()
    const loose = await t.run(ctx => ctx.storage.store(new Blob(['loose'])))
    const looseRow = await t.mutation(api.voucherInbox.add, { storageId: loose, groupId: 'loose' })
    await t.mutation(api.voucherInbox.discard, { id: looseRow })
    expect(await t.run(ctx => ctx.db.system.get(loose))).toBeNull()
  })

  it('recognizes PDFs without filename extensions and names downloads correctly', () => {
    expect(isPdfAttachment({ url: 'https://storage.test/opaque', contentType: 'application/pdf' })).toBe(true)
    expect(isPdfAttachment({ url: 'https://storage.test/bill.PDF?token=1' })).toBe(true)
    expect(attachmentName({ label: 'Bill/123', contentType: 'application/pdf' })).toBe('Bill-123.pdf')
  })
})

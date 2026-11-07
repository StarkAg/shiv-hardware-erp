import { convexTest } from './trustedConvex'
import { describe, expect, it } from 'vitest'
import schema from '../convex/schema'
import { api, internal } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.ts')

describe('voucher shooter queue', () => {
  it('keeps voucher photos out of the sorting inbox and keeps a claimed file', async () => {
    const t = convexTest(schema, modules)
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['bill'], { type: 'image/jpeg' })))
    const id = await t.mutation(api.voucherInbox.add, { storageId, groupId: 'one-bill' })

    expect((await t.query(api.voucherInbox.list, {})).map((row) => [row._id, row.groupId, row.queueNo]))
      .toEqual([[id, 'one-bill', 1]])
    expect(await t.query(api.inbox.list, {})).toEqual([])

    await t.mutation(api.voucherInbox.claim, { id })
    expect(await t.query(api.voucherInbox.list, {})).toEqual([])
    expect(await t.run((ctx) => ctx.db.system.get(storageId))).toBeTruthy()
  })

  it('destroys a loose photo when it is discarded', async () => {
    const t = convexTest(schema, modules)
    const image = await t.run((ctx) => ctx.storage.store(new Blob(['bill'], { type: 'image/jpeg' })))
    const id = await t.mutation(api.voucherInbox.add, { storageId: image, groupId: 'remove' })
    await t.mutation(api.voucherInbox.discard, { id })
    expect(await t.run((ctx) => ctx.db.system.get(image))).toBeNull()
  })

  it('keeps what the AI read on the waiting bill, matched to an account, and drops it once filed', async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const groupId = await ctx.db.insert('groups', { name: 'Sundry Creditors', nature: 'liability', normalSide: 'Cr', sort: 1 })
      await ctx.db.insert('ledgers', {
        name: 'Ramesh Traders', place: 'Ramgarh', groupId, openingBalance: 0, openingSide: 'Cr',
        openingAsOf: 0, active: true, createdAt: 0, updatedAt: 0,
      })
    })
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['bill'], { type: 'image/jpeg' })))
    const id = await t.mutation(api.voucherInbox.add, { storageId, groupId: 'pur-1' })

    // Too soon after the page landed: another page may still be coming.
    expect(await t.mutation(internal.voucherInbox.startRead, { groupId: 'pur-1' })).toBeNull()
    expect((await t.mutation(internal.voucherInbox.startRead, { groupId: 'pur-1', force: true }))?.pages).toHaveLength(1)
    expect((await t.query(api.voucherInbox.list, {}))[0].read).toMatchObject({ status: 'reading' })

    await t.mutation(internal.voucherInbox.saveRead, {
      groupId: 'pur-1', pages: 1,
      draft: { kind: 'purchase', party: 'Ramesh Traders (Ramgarh)', date: '2026-11-02', refNo: ' 345 ', total: 12340, paid: null, settlement: 'unknown', confidence: 0.9 },
    })
    expect((await t.query(api.voucherInbox.list, {}))[0].read).toMatchObject({
      status: 'ready', kind: 'purchase', party: 'Ramesh Traders', account: 'supplier', refNo: '345', total: 12340, paid: null,
    })
    // Read with every page it has: not read again by itself.
    expect(await t.mutation(internal.voucherInbox.startRead, { groupId: 'pur-1' })).toBeNull()

    await t.mutation(api.voucherInbox.claimAll, { ids: [id] })
    expect(await t.run((ctx) => ctx.db.query('voucherReads').collect())).toEqual([])
  })

  it('keeps a name that is not an account as written', async () => {
    const t = convexTest(schema, modules)
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['bill'], { type: 'image/jpeg' })))
    await t.mutation(api.voucherInbox.add, { storageId, groupId: 'sale-1' })
    await t.mutation(internal.voucherInbox.startRead, { groupId: 'sale-1', force: true })
    await t.mutation(internal.voucherInbox.saveRead, {
      groupId: 'sale-1', pages: 1, draft: { kind: 'odd', party: 'Vishal Prasad', total: 'x' },
    })
    const read = (await t.query(api.voucherInbox.list, {}))[0].read
    expect(read).toMatchObject({ kind: 'unclear', party: 'Vishal Prasad', total: null })
    expect(read?.account).toBeUndefined()
  })

  it('numbers older waiting photos and continues the sequence across phone queues', async () => {
    const t = convexTest(schema, modules)
    const oldPhoto = await t.run((ctx) => ctx.storage.store(new Blob(['old'], { type: 'image/jpeg' })))
    const oldId = await t.run((ctx) => ctx.db.insert('voucherInbox', {
      storageId: oldPhoto, groupId: 'old-bill', at: 1,
    }))
    expect(await t.mutation(internal.voucherInbox.numberExisting, {})).toBe(1)
    expect(await t.mutation(internal.voucherInbox.numberExisting, {})).toBe(0)
    expect((await t.query(api.voucherInbox.list, {}))[0]).toMatchObject({ _id: oldId, queueNo: 1 })

    const newPhoto = await t.run((ctx) => ctx.storage.store(new Blob(['new'], { type: 'image/jpeg' })))
    await t.mutation(api.voucherInbox.add, { storageId: newPhoto, groupId: 'new-bill' })
    const legacyPhoto = await t.run((ctx) => ctx.storage.store(new Blob(['legacy'], { type: 'image/jpeg' })))
    await t.mutation(api.inbox.add, { storageId: legacyPhoto })
    expect((await t.query(api.voucherInbox.list, {})).map((row) => row.queueNo)).toEqual([2, 1])
    expect((await t.query(api.inbox.list, {}))[0].queueNo).toBe(3)
  })
})

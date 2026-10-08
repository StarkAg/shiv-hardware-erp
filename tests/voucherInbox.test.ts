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

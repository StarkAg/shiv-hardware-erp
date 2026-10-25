/**
 * The phone's bill photos, filed the moment a bill saves. One at a time, each
 * its own round trip, a bill of several pages left the last of them under From
 * the phone for seconds after Save; now every photo the bill took comes off
 * both queues in one call, and the screen leaves them out at once.
 */
import { convexTest } from './trustedConvex'
import { describe, expect, test } from 'vitest'
import schema from '../convex/schema'
import { api } from '../convex/_generated/api'
import { withoutHidden } from '../src/lib/phonePhotos'

const modules = import.meta.glob('../convex/**/*.ts')

async function queued() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const file = () => ctx.storage.store(new Blob(['bill'], { type: 'image/jpeg' }))
    return {
      page1: await ctx.db.insert('voucherInbox', { storageId: await file(), at: 1, groupId: 'g1', queueNo: 1 }),
      page2: await ctx.db.insert('voucherInbox', { storageId: await file(), at: 2, groupId: 'g1', queueNo: 2 }),
      other: await ctx.db.insert('voucherInbox', { storageId: await file(), at: 3, groupId: 'g2', queueNo: 3 }),
      legacy: await ctx.db.insert('inbox', { storageId: await file(), at: 4 }),
    }
  })
  const left = () => t.run(async (ctx) => ({
    voucher: (await ctx.db.query('voucherInbox').collect()).map((r) => r._id),
    legacy: (await ctx.db.query('inbox').collect()).map((r) => r._id),
  }))
  return { t, ids, left }
}

describe('claimAll', () => {
  test('takes a bill\'s photos off both queues in one call, and nothing else', async () => {
    const { t, ids, left } = await queued()
    await t.mutation(api.voucherInbox.claimAll, { ids: [ids.page1, ids.page2], legacyIds: [ids.legacy] })
    expect(await left()).toEqual({ voucher: [ids.other], legacy: [] })
  })

  test('a photo already claimed from another counter is no failure', async () => {
    const { t, ids, left } = await queued()
    await t.mutation(api.voucherInbox.claimAll, { ids: [ids.page1] })
    await t.mutation(api.voucherInbox.claimAll, { ids: [ids.page1, ids.page2] })
    expect((await left()).voucher).toEqual([ids.other])
  })

  test('keeps the file: the bill owns it now', async () => {
    const { t, ids } = await queued()
    const storageId = await t.run(async (ctx) => (await ctx.db.get(ids.page1))!.storageId)
    await t.mutation(api.voucherInbox.claimAll, { ids: [ids.page1] })
    expect(await t.run((ctx) => ctx.db.system.get(storageId))).not.toBeNull()
  })
})

describe('withoutHidden', () => {
  const rows = [{ _id: 'a' }, { _id: 'b' }, { _id: 'c' }]
  test('leaves out what was filed or discarded, even from a kept copy', () => {
    expect(withoutHidden(rows, new Set(['b']))).toEqual([{ _id: 'a' }, { _id: 'c' }])
  })
  test('still loading stays loading', () => {
    expect(withoutHidden(undefined, new Set(['b']))).toBeUndefined()
  })
})

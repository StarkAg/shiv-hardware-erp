import { internalMutation } from './_generated/server'
import { mutation, query } from './lib/guarded'
import { v } from 'convex/values'
import { nextVoucherPhotoNo } from './lib/numbering'
import { deleteUnreferencedFiles } from './lib/attachmentFiles'

/** Photos waiting for the voucher editor, separate from the sorting backlog. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('voucherInbox').withIndex('by_at').order('desc').collect()
    return Promise.all(rows.map(async (row) => ({
      _id: row._id,
      storageId: row.storageId,
      groupId: row.groupId,
      queueNo: row.queueNo,
      at: row.at,
      url: await ctx.storage.getUrl(row.storageId),
    })))
  },
})

export const add = mutation({
  args: { storageId: v.id('_storage'), groupId: v.string() },
  handler: async (ctx, { storageId, groupId }) => {
    if (!groupId.trim()) throw new Error('This bill photo needs a bill group.')
    const file = await ctx.db.system.get(storageId)
    if (!file) throw new Error('The uploaded bill photo was not found.')
    if (file.contentType && !file.contentType.startsWith('image/')) {
      throw new Error('Upload a bill photo as an image.')
    }
    const queueNo = await nextVoucherPhotoNo(ctx)
    return ctx.db.insert('voucherInbox', { storageId, groupId, queueNo, at: Date.now() })
  },
})

/** Assign numbers to photos that arrived before queue numbering was added. */
export const numberExisting = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('voucherInbox').withIndex('by_at').order('asc').collect()
    let numbered = 0
    for (const row of rows) {
      if (row.queueNo !== undefined) continue
      await ctx.db.patch(row._id, { queueNo: await nextVoucherPhotoNo(ctx) })
      numbered += 1
    }
    return numbered
  },
})

/** The bill now owns the stored file; remove only its waiting row. */
export const claim = mutation({
  args: { id: v.id('voucherInbox') },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id)
  },
})

export const discard = mutation({
  args: { id: v.id('voucherInbox') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (!row) return
    await ctx.db.delete(id)
    await deleteUnreferencedFiles(ctx, [row.storageId])
  },
})

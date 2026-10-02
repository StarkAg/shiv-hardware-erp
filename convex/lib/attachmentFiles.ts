import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { readBills } from './billRows'

type StoredAttachment = Id<'_storage'> | { storageId: Id<'_storage'>; previewStorageId?: Id<'_storage'>; kind?: string }

export const attachmentIds = (docs: StoredAttachment[] = []) => docs.flatMap(doc =>
  typeof doc === 'string' ? [doc] : [doc.storageId, ...(doc.previewStorageId ? [doc.previewStorageId] : [])],
)

export async function describeAttachments(ctx: QueryCtx, docs: StoredAttachment[] = []) {
  return Promise.all(docs.map(async doc => {
    const file = typeof doc === 'string' ? { storageId: doc, kind: 'bill' } : doc
    const meta = await ctx.db.system.get(file.storageId)
    return {
      ...file,
      url: meta ? await ctx.storage.getUrl(file.storageId) : null,
      previewUrl: file.previewStorageId ? await ctx.storage.getUrl(file.previewStorageId) : null,
      contentType: meta?.contentType ?? null,
    }
  }))
}

/** Call after detaching/deleting the owner. Other bills may still use the file. */
export async function deleteUnreferencedFiles(ctx: MutationCtx, ids: Id<'_storage'>[]) {
  if (!ids.length) return
  const [vouchers, trash, bills, deletedBills, papers, inbox, voucherInbox] = await Promise.all([
    ctx.db.query('vouchers').collect(), ctx.db.query('trash').collect(), readBills(ctx),
    ctx.db.query('billsTrash').collect(), ctx.db.query('papers').collect(),
    ctx.db.query('inbox').collect(), ctx.db.query('voucherInbox').collect(),
  ])
  const used = new Set([
    ...vouchers.flatMap(row => attachmentIds(row.attachments)),
    ...trash.flatMap(row => attachmentIds(row.attachments)),
    ...bills.flatMap(row => attachmentIds(row.attachments ?? [])),
    ...deletedBills.flatMap(row => attachmentIds(row.bill?.attachments ?? [])),
    ...papers.flatMap(row => attachmentIds(row.documents)),
    ...inbox.map(row => row.storageId),
    ...voucherInbox.map(row => row.storageId),
  ])
  for (const id of new Set(ids)) {
    if (!used.has(id)) await ctx.storage.delete(id).catch(() => {})
  }
}

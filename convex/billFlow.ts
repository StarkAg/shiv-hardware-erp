import { v } from 'convex/values'
import { mutation, query, internalMutation, internalQuery } from './_generated/server'
import { ensureCashFlow } from './lib/billFlow'
import { flowStage, requiredTasksDone, type FlowRoute } from './lib/billFlowStages'
import { postCashEntry } from './cash'

export const list = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('billFlows').withIndex('by_updated_at').order('desc').collect()
    return Promise.all(rows.map(async row => ({
      ...row,
      photoUrls: await Promise.all(row.photos.map(id => ctx.storage.getUrl(id))),
    })))
  },
})

/** Called only after the cash entry has synced. Repeating the upload response
 * cannot create another card or add the same page twice. */
export const attachCashPhoto = mutation({
  args: { entryId: v.string(), storageId: v.id('_storage'), batchId: v.string(), pageCount: v.number() },
  handler: async (ctx, { entryId, storageId, batchId, pageCount }) => {
    const entry = await ctx.db.query('cashEntries').withIndex('by_entry_id', q => q.eq('entryId', entryId)).unique()
    if (!entry || entry.deleted) throw new Error('Save the cash entry before attaching its photo.')
    const file = await ctx.db.system.get(storageId)
    if (!file || (file.contentType && !file.contentType.startsWith('image/'))) throw new Error('Choose a bill photo.')
    const flowId = await ensureCashFlow(ctx, entry)
    const flow = (await ctx.db.get(flowId))!
    let ready = false
    if (!flow.photos.includes(storageId)) {
      const now = Date.now()
      const expectedPhotos = flow.photoBatchId === batchId
        ? flow.expectedPhotos ?? pageCount : flow.photos.length + pageCount
      const photos = [...flow.photos, storageId]
      ready = photos.length >= expectedPhotos
      await ctx.db.patch(flowId, {
        photos, expectedPhotos, photoBatchId: batchId,
        intakeStatus: ready ? 'waiting' : 'uploading', updatedAt: now,
        history: [...flow.history, { at: now, action: 'Bill photo captured' }],
      })
    }
    return { id: flowId, ready }
  },
})

export const photoUrls = internalQuery({
  args: { id: v.id('billFlows') },
  handler: async (ctx, { id }) => {
    const flow = await ctx.db.get(id)
    if (!flow || !flow.photos.length) throw new Error('No photo is attached to this card.')
    return Promise.all(flow.photos.map(async storageId => {
      const url = await ctx.storage.getUrl(storageId)
      if (!url) throw new Error('A bill photo is missing.')
      return url
    }))
  },
})

export const saveReading = internalMutation({
  args: { id: v.id('billFlows'), draft: v.optional(v.any()), error: v.optional(v.string()) },
  handler: async (ctx, { id, draft, error }) => {
    const flow = await ctx.db.get(id)
    if (!flow) return
    await ctx.db.patch(id, {
      intakeStatus: error ? 'failed' : 'ready',
      readDraft: draft, readError: error, updatedAt: Date.now(),
    })
  },
})

export const beginReading = internalMutation({
  args: { id: v.id('billFlows') },
  handler: async (ctx, { id }) => {
    const flow = await ctx.db.get(id)
    if (!flow) throw new Error('This intake card is missing.')
    if (flow.intakeStatus === 'uploading') throw new Error('Wait for every page to upload before reading.')
    await ctx.db.patch(id, { intakeStatus: 'reading', readError: undefined, updatedAt: Date.now() })
  },
})

/** The document may have been entered before its cashier photograph was
 * reviewed. Join its two cards without writing either transaction again. */
export const linkExisting = mutation({
  args: { cashFlowId: v.id('billFlows'), billFlowId: v.id('billFlows') },
  handler: async (ctx, { cashFlowId, billFlowId }) => {
    if (cashFlowId === billFlowId) throw new Error('Choose another bill card.')
    const source = await ctx.db.get(cashFlowId)
    const target = await ctx.db.get(billFlowId)
    if (!source?.cashEntryId || source.billId || !target?.voucherId || !['sale', 'purchase', 'grn'].includes(target.documentKind)) {
      throw new Error('Choose a cashier photo and an existing sale, purchase, or GRN.')
    }
    if (target.cashEntryId) throw new Error('That bill is already linked to a cashier entry.')
    const cash = await ctx.db.query('cashEntries').withIndex('by_entry_id', q => q.eq('entryId', source.cashEntryId!)).unique()
    if (!cash || cash.deleted || (cash.kind === 'in') !== (target.documentKind === 'sale')) {
      throw new Error('The cash direction does not match this bill.')
    }
    const bill = target.billId ? await ctx.db.query('bills').withIndex('by_bill', q => q.eq('billId', target.billId!)).unique() : null
    const recorded = bill?.bill as { paid?: boolean; paidAmount?: number; total?: number } | undefined
    if (recorded && Number(recorded.paidAmount ?? (recorded.paid ? recorded.total : 0)) > 0) {
      throw new Error('This bill already includes money paid. Remove that inline payment before linking its cashier entry.')
    }
    const voucher = await ctx.db.get(target.voucherId)
    if (!voucher) throw new Error('The bill voucher is missing.')
    if (cash.ledgerId !== voucher.partyLedgerId) {
      await ctx.db.patch(cash._id, { ledgerId: voucher.partyLedgerId })
      await postCashEntry(ctx, cash.entryId)
    }
    const refreshed = await ctx.db.get(cash._id)
    const existingPhotos = new Set((voucher.attachments ?? []).map(a => typeof a === 'string' ? a : a.storageId))
    const added = source.photos.filter(id => !existingPhotos.has(id))
    const now = Date.now()
    if (added.length) await ctx.db.patch(voucher._id, {
      attachments: [...voucher.attachments, ...added.map(storageId => ({ storageId, kind: 'bill' as const }))],
      updatedAt: now,
    })
    await ctx.db.patch(target._id, {
      cashEntryId: cash.entryId, cashVoucherId: refreshed?.voucherId,
      photos: [...new Set([...target.photos, ...source.photos])],
      intakeStatus: 'converted', updatedAt: now,
      history: [...source.history, ...target.history, { at: now, action: 'Cashier photo linked to existing bill' }]
        .sort((a, b) => a.at - b.at),
    })
    await ctx.db.delete(source._id)
    return target._id
  },
})

const routeArg = v.union(v.literal('unset'), v.literal('handover'), v.literal('rack'),
  v.literal('order'), v.literal('fabrication'), v.literal('mixed'))

export const setRoute = mutation({
  args: { id: v.id('billFlows'), route: routeArg },
  handler: async (ctx, { id, route }) => {
    const flow = await ctx.db.get(id)
    if (!flow || !['sale', 'receipt'].includes(flow.documentKind)) throw new Error('Choose a customer card.')
    const tasks = { ...(flow.tasks as Record<string, boolean>) }
    if (route !== flow.route) { tasks.delivered = false; tasks.outForDelivery = false }
    const now = Date.now()
    await ctx.db.patch(id, {
      route, tasks, stage: flowStage(flow.documentKind, route as FlowRoute, tasks), updatedAt: now,
      history: [...flow.history, { at: now, action: `Route: ${route}` }],
    })
  },
})

const taskArg = v.union(v.literal('ordered'), v.literal('picked'), v.literal('mechanicSent'),
  v.literal('measurementsReturned'), v.literal('materialsHanded'), v.literal('made'),
  v.literal('outForDelivery'), v.literal('delivered'), v.literal('goodsOrdered'),
  v.literal('goodsReceived'), v.literal('purchaseLinked'))

export const mark = mutation({
  args: { id: v.id('billFlows'), task: taskArg, done: v.boolean(),
    measurements: v.optional(v.any()), jobId: v.optional(v.string()) },
  handler: async (ctx, { id, task, done, measurements, jobId }) => {
    const flow = await ctx.db.get(id)
    if (!flow) throw new Error('This Bill Flow card is missing.')
    const tasks = { ...(flow.tasks as Record<string, boolean>), [task]: done }
    if (done && task === 'picked' && flow.route === 'order' && !tasks.ordered) {
      throw new Error('Mark the items ordered before picking them.')
    }
    if (done && task === 'measurementsReturned' && !tasks.mechanicSent) {
      throw new Error('Mark the bill sent to the mechanic first.')
    }
    if (done && task === 'materialsHanded' && !tasks.measurementsReturned) {
      throw new Error('Save the measurements before handing over raw materials.')
    }
    if (done && task === 'made' && !tasks.materialsHanded) {
      throw new Error('Mark raw materials handed over first.')
    }
    if (!done && !['outForDelivery', 'delivered'].includes(task)) {
      tasks.outForDelivery = false
      tasks.delivered = false
    }
    if ((task === 'outForDelivery' || task === 'delivered') && done &&
        !requiredTasksDone(flow.route as FlowRoute, tasks)) {
      throw new Error('Finish ordering, picking and workshop work before delivery.')
    }
    if (task === 'delivered' && done && !tasks.outForDelivery && flow.route !== 'handover') {
      throw new Error('Mark out for delivery first.')
    }
    const now = Date.now()
    await ctx.db.patch(id, {
      tasks, stage: flowStage(flow.documentKind, flow.route as FlowRoute, tasks),
      ...(measurements !== undefined ? { measurements } : {}),
      ...(jobId !== undefined ? { jobId } : {}),
      updatedAt: now, history: [...flow.history, { at: now, action: `${done ? 'Done' : 'Reopened'}: ${task}` }],
    })
  },
})

export const linkJob = mutation({
  args: { id: v.id('billFlows'), jobId: v.string() },
  handler: async (ctx, { id, jobId }) => {
    const flow = await ctx.db.get(id)
    if (!flow) throw new Error('This Bill Flow card is missing.')
    const now = Date.now()
    await ctx.db.patch(id, { jobId: jobId.trim() || undefined, updatedAt: now,
      history: [...flow.history, { at: now, action: `Mechanic job linked: ${jobId}` }] })
  },
})

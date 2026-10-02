import type { MutationCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { flowStage } from './billFlowStages'

type Flow = Doc<'billFlows'>
type Kind = Flow['documentKind']

const initialStage = (kind: Kind) => kind === 'sale' || kind === 'receipt'
  ? 'routing' : kind === 'purchase' ? 'goods-due' : kind === 'grn' ? 'bill-to-come' : 'complete'

export async function flowForVoucher(ctx: MutationCtx, voucherId: Id<'vouchers'>) {
  return ctx.db.query('billFlows').withIndex('by_voucher', q => q.eq('voucherId', voucherId)).unique()
}

export async function flowForCash(ctx: MutationCtx, entryId: string) {
  return ctx.db.query('billFlows').withIndex('by_cash_entry', q => q.eq('cashEntryId', entryId)).unique()
}

/** A source can be replayed without making another card. An explicit flow id
 * lets a photographed cash entry and the bill made from it share one card. */
export async function ensureVoucherFlow(ctx: MutationCtx, args: {
  voucherId: Id<'vouchers'>; kind: Kind; party: string; date: string;
  amount?: number; billId?: string; cashEntryId?: string; flowId?: Id<'billFlows'>;
  photos?: Id<'_storage'>[]
}) {
  const byVoucher = await flowForVoucher(ctx, args.voucherId)
  const byCash = args.cashEntryId ? await flowForCash(ctx, args.cashEntryId) : null
  const chosen = args.flowId ? await ctx.db.get(args.flowId) : null
  const flow = chosen ?? byCash ?? byVoucher
  if (byVoucher && flow && byVoucher._id !== flow._id) throw new Error('This voucher is already on another Bill Flow card.')
  if (byCash && flow && byCash._id !== flow._id) throw new Error('This cash entry is already on another Bill Flow card.')
  const now = Date.now()
  if (flow) {
    const tasks = { ...(flow.tasks as Record<string, boolean>),
      ...(flow.documentKind === 'grn' && args.kind === 'purchase' ? { goodsReceived: true, purchaseLinked: true } : {}) }
    const photos = [...new Set([...(flow.photos ?? []), ...(args.photos ?? [])])]
    await ctx.db.patch(flow._id, {
      documentKind: args.kind, party: args.party, date: args.date, amount: args.amount,
      voucherId: args.voucherId, billId: args.billId ?? flow.billId,
      cashVoucherId: flow.cashEntryId && flow.voucherId && flow.voucherId !== args.voucherId
        ? flow.voucherId : flow.cashVoucherId,
      cashEntryId: args.cashEntryId ?? flow.cashEntryId, photos,
      intakeStatus: flow.intakeStatus === 'none' ? 'none' : 'converted',
      tasks, stage: args.kind !== flow.documentKind
        ? flowStage(args.kind, flow.route, tasks) : flow.stage,
      updatedAt: now,
      history: [...flow.history, { at: now, action: 'Accounting entry linked' }],
    })
    return flow._id
  }
  return ctx.db.insert('billFlows', {
    flowKey: `voucher:${args.voucherId}`, documentKind: args.kind,
    party: args.party, date: args.date, amount: args.amount,
    voucherId: args.voucherId, billId: args.billId,
    cashEntryId: args.cashEntryId, photos: args.photos ?? [],
    intakeStatus: 'none', route: 'unset', tasks: {}, stage: initialStage(args.kind),
    history: [{ at: now, action: 'Accounting entry saved' }],
    createdAt: now, updatedAt: now,
  })
}

export async function ensureCashFlow(ctx: MutationCtx, entry: Doc<'cashEntries'>) {
  const existing = await flowForCash(ctx, entry.entryId)
  if (existing) {
    await ctx.db.patch(existing._id, {
      voucherId: existing.billId ? existing.voucherId : entry.voucherId ?? existing.voucherId,
      cashVoucherId: entry.voucherId ?? existing.cashVoucherId,
      party: entry.name, amount: entry.amount, updatedAt: Date.now(),
    })
    return existing._id
  }
  const now = Date.now()
  return ctx.db.insert('billFlows', {
    flowKey: `cash:${entry.entryId}`,
    documentKind: entry.kind === 'out' ? 'payment' : 'receipt',
    party: entry.name, date: entry.date, amount: entry.amount,
    cashEntryId: entry.entryId, voucherId: entry.voucherId, cashVoucherId: entry.voucherId,
    photos: [], intakeStatus: 'none', route: 'unset', tasks: {},
    stage: entry.kind === 'out' ? 'complete' : 'routing',
    history: [{ at: now, action: 'Cash entry saved' }], createdAt: now, updatedAt: now,
  })
}

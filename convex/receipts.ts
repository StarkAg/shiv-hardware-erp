import { v } from 'convex/values'
import { internalMutation, query } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { fyOf } from './lib/money'
import { nextVoucherNo } from './lib/numbering'
import { record } from './lib/history'
import {
  GRN_ABBR, GRN_TYPE, allBills, billOf, estimate, grnType, isGoods, isOpen, itemKey, lastRates, usualItems,
} from './lib/receipts'

/**
 * Goods that came in ahead of their bill.
 *
 * A delivery is a Goods Received Note: a voucher with the supplier, the lines
 * the staff counted, who counted them and the challan photo — and no entries,
 * because nothing is owed on paper until the bill comes. This file answers the
 * two questions the shop asks of them: what is still waiting for a bill, and
 * what is this supplier likely to have sent.
 */

const label = (no: number) => `${GRN_ABBR}-${String(no).padStart(4, '0')}`
const DAY = 86_400_000

/** Bills to Come: every delivery with no bill yet, oldest first, with its estimate. */
export const open = query({
  args: {
    ledgerId: v.optional(v.id('ledgers')),
    // A purchase being edited still needs to see the deliveries it already bills.
    alsoFor: v.optional(v.string()),
  },
  handler: async (ctx, { ledgerId, alsoFor }) => {
    const type = await grnType(ctx)
    if (!type) return { rows: [], total: 0, count: 0 }
    const received = await ctx.db
      .query('vouchers')
      .withIndex('by_status', (q) => q.eq('status', 'received'))
      .collect()
    const bills = await allBills(ctx)
    const ratesFor = new Map<string, ReturnType<typeof lastRates>>()
    const rows = []
    const now = Date.now()

    for (const grn of received) {
      if (grn.typeId !== type._id) continue
      if (ledgerId && grn.partyLedgerId !== ledgerId) continue
      const mine = Boolean(alsoFor) && String(grn.billedIn ?? '') === alsoFor
      if (!mine && !(await isOpen(ctx, grn))) continue
      const party = await ctx.db.get(grn.partyLedgerId)
      if (!party) continue
      if (!ratesFor.has(party._id)) ratesFor.set(party._id, lastRates(bills, party))
      const bill = billOf(bills, grn)
      const est = estimate(bill, ratesFor.get(party._id)!)
      rows.push({
        voucherId: grn._id,
        vchLabel: label(grn.voucherNo),
        date: grn.date,
        days: Math.max(0, Math.floor((now - grn.date) / DAY)),
        partyLedgerId: party._id,
        party: party.name,
        refNo: grn.refNo ?? '',
        narration: grn.narration ?? '',
        receivedBy: grn.receivedBy ?? '',
        billedHere: mine,
        billId: bill?.id ?? null,
        items: est.items,
        estimate: est.total,
        unpricedLines: est.unpriced,
        photos: await Promise.all(
          grn.attachments.map(async (a) => {
            const id = typeof a === 'string' ? a : a.storageId
            return (await ctx.storage.getUrl(id)) ?? ''
          }),
        ),
      })
    }
    rows.sort((a, b) => a.date - b.date)
    const waiting = rows.filter((r) => !r.billedHere)
    return {
      rows,
      count: waiting.length,
      total: Math.round(waiting.reduce((t, r) => t + r.estimate, 0) * 100) / 100,
    }
  },
})

/** How many deliveries are waiting, for the sidebar and Home. */
export const openCount = query({
  args: {},
  handler: async (ctx) => {
    const type = await grnType(ctx)
    if (!type) return { count: 0, late: 0 }
    const received = await ctx.db
      .query('vouchers')
      .withIndex('by_status', (q) => q.eq('status', 'received'))
      .collect()
    let count = 0
    let late = 0
    for (const grn of received) {
      if (grn.typeId !== type._id || !(await isOpen(ctx, grn))) continue
      count += 1
      if (Date.now() - grn.date >= 7 * DAY) late += 1
    }
    return { count, late }
  },
})

/**
 * What the phone offers when a supplier is picked: the things they usually
 * send, most often first, with the unit and the last quantity; and the
 * shop's whole item list for anything else.
 */
export const forSupplier = query({
  args: { ledgerId: v.id('ledgers') },
  handler: async (ctx, { ledgerId }) => {
    const party = await ctx.db.get(ledgerId)
    if (!party) return null
    const bills = await allBills(ctx)
    const rates = lastRates(bills, party)
    const usual = usualItems(bills, party).slice(0, 40).map((i) => ({
      ...i,
      lastRate: rates.get(itemKey(i.name))?.rate ?? null,
    }))
    const catalog = await ctx.db.query('catalogStore').first()
    const items = ((catalog as any)?.customCatalog ?? [])
      .filter((e: any) => e && typeof e.name === 'string' && e.name.trim())
      .map((e: any) => ({ id: String(e.id ?? ''), name: String(e.name).trim(), unit: String(e.unit ?? 'Pc') }))
    return { party: { _id: party._id, name: party.name, place: party.place ?? '' }, usual, items }
  },
})

/**
 * Suppliers for the phone's picker: the ones who delivered or billed most
 * recently first, since the one at the door is usually a regular.
 */
export const suppliers = query({
  args: {},
  handler: async (ctx) => {
    const group = await ctx.db
      .query('groups')
      .withIndex('by_name', (q) => q.eq('name', 'Sundry Creditors'))
      .unique()
    if (!group) return []
    const ledgers = await ctx.db
      .query('ledgers')
      .withIndex('by_group', (q) => q.eq('groupId', group._id))
      .collect()
    const vouchers = await ctx.db.query('vouchers').collect()
    const lastSeen = new Map<string, number>()
    for (const vch of vouchers) {
      const k = String(vch.partyLedgerId)
      lastSeen.set(k, Math.max(lastSeen.get(k) ?? 0, vch.date))
    }
    return ledgers
      .filter((l) => l.active)
      .map((l) => ({ _id: l._id, name: l.name, place: l.place ?? '', phone: l.phone ?? '', last: lastSeen.get(String(l._id)) ?? 0 }))
      .sort((a, b) => b.last - a.last || a.name.localeCompare(b.name))
  },
})

/**
 * Every unpriced supplier bill, as a delivery.
 *
 * Before deliveries existed, goods that came without a bill were filed as a
 * purchase with no amount. That is what a Goods Received Note is, so each one
 * becomes one — same date, lines, photos and account — and waits on Bills to
 * Come. Nothing it touches has any entries, so no balance moves.
 *
 *   npx convex run --prod receipts:convertPending '{"dryRun": true}'
 */
export const convertPending = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const purchase = await ctx.db
      .query('voucherTypes')
      .withIndex('by_name', (q) => q.eq('name', 'Purchase'))
      .unique()
    if (!purchase) return { converted: [] }
    let type = await grnType(ctx)
    if (!type && !dryRun) {
      const id = await ctx.db.insert('voucherTypes', { name: GRN_TYPE, abbr: GRN_ABBR, sort: 11 })
      type = await ctx.db.get(id)
    }

    const pending = (
      await ctx.db.query('vouchers').withIndex('by_status', (q) => q.eq('status', 'pending')).collect()
    ).filter((vch) => vch.typeId === purchase._id)

    const store = await ctx.db.query('billsStore').first()
    const bills: any[] = (store?.bills ?? []) as any[]
    const converted: Array<{ from: string; to: string; party: string; lines: number; date: number }> = []
    let billsChanged = false

    for (const vch of pending) {
      const lines = await ctx.db
        .query('voucherEntries')
        .withIndex('by_voucher', (q) => q.eq('voucherId', vch._id))
        .first()
      // A pending voucher has no entries by definition; one that somehow does
      // is not safe to move, and is left for a person to look at.
      if (lines) continue
      const party = (await ctx.db.get(vch.partyLedgerId)) as Doc<'ledgers'> | null
      const bill = billOf(bills, vch)
      const from = `PUR-${String(vch.voucherNo).padStart(4, '0')}`
      if (dryRun || !type) {
        converted.push({ from, to: 'GRN-?', party: party?.name ?? '—', lines: (bill?.items ?? []).filter(isGoods).length, date: vch.date })
        continue
      }
      const fy = fyOf(vch.date)
      const voucherNo = await nextVoucherNo(ctx, type, fy)
      await ctx.db.patch(vch._id, {
        typeId: type._id,
        voucherNo,
        fy,
        status: 'received',
        updatedAt: Date.now(),
      })
      if (bill) {
        bill.kind = 'grn'
        bill.updatedAt = Date.now()
        billsChanged = true
      }
      converted.push({ from, to: label(voucherNo), party: party?.name ?? '—', lines: (bill?.items ?? []).filter(isGoods).length, date: vch.date })
    }

    if (billsChanged && store) await ctx.db.patch(store._id, { bills, savedAt: Date.now() })
    if (!dryRun && converted.length) {
      await record(
        ctx,
        'grn.convert',
        `Filed ${converted.length} unpriced supplier bills as deliveries: ${converted.map((c) => `${c.from} → ${c.to}`).join(', ')}`,
        { entity: 'voucher', detail: converted },
      )
    }
    return { converted }
  },
})

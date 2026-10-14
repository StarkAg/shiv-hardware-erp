import { v } from 'convex/values'
import { mutation, query } from './lib/guarded'
import type { QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'

/**
 * Each sale bill to the customer's own WhatsApp chat, from the shop's number.
 *
 * The shop has always kept its bills on WhatsApp, each in the party's chat.
 * The books keep every bill too, so the books stay the record and WhatsApp is
 * where a copy goes: the shop PC (print-server, signed in to the shop's
 * WhatsApp) asks here for the sales that are due, sends each one, and says
 * how it went.
 *
 * - Only sales, and only once a bill has its amount (final, not pending). A
 *   supplier's bill came from the supplier; it stays in the books.
 * - Only bills made after the sending was switched on: older ones are shared
 *   by hand, a party at a time (Share all bills in Shiv Accounts), because
 *   sending hundreds at once is what gets a WhatsApp number blocked.
 * - A bill waits a while after it was last saved (the shop PC says how long),
 *   so one typed wrong can be put right or deleted before it goes. A deleted
 *   bill is in the trash, not in the vouchers, and is never sent.
 * - The bill's own photos go as they are. A bill typed in the panel with no
 *   photo goes as a picture of the printed bill, drawn on the shop PC.
 *
 * Sent once: a row here per bill says it went, or why it did not (no mobile,
 * not on WhatsApp), and a failed one is tried again a few times.
 */

const SETTINGS_KEY = 'shop'
const TRIES = 3
const DAY = 86_400_000
const IST = 19_800_000
/** Midnight in India, before a moment. */
const dayStart = (ms: number) => Math.floor((ms + IST) / DAY) * DAY - IST

const bare = (name: string | undefined) => String(name ?? '').replace(/^m\/s\.?\s+/i, '').trim()
const label = (abbr: string, no: number) => `${abbr}-${String(no).padStart(4, '0')}`

type Attachment = Doc<'vouchers'>['attachments'][number]
async function photosOf(ctx: QueryCtx, docs: Attachment[]) {
  const out = []
  for (const d of docs) {
    const storageId = typeof d === 'string' ? d : d.storageId
    const meta = await ctx.db.system.get(storageId)
    const url = await ctx.storage.getUrl(storageId)
    if (url) out.push({ url, contentType: meta?.contentType ?? null, kind: typeof d === 'string' ? 'bill' : d.kind })
  }
  return out
}

async function settingsOf(ctx: QueryCtx) {
  return await ctx.db.query('settings').withIndex('by_key', (q) => q.eq('key', SETTINGS_KEY)).unique()
}

/**
 * The sales due to go, for the shop PC: final sales saved after the sending
 * was switched on and not touched since `before`, to a customer with a phone,
 * not yet sent. With them, whether sending is on and how many went today.
 */
export const due = query({
  args: { before: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { before, limit = 1 }) => {
    const settings = await settingsOf(ctx)
    const on = settings?.billWhatsAppOn === true
    const from = settings?.billWhatsAppFrom ?? 0
    const sentToday = (
      await ctx.db.query('billWhatsApp').withIndex('by_at', (q) => q.gte('at', dayStart(before))).collect()
    ).filter((r) => r.status === 'sent').length
    if (!on || !from) return { on, sentToday, items: [] }

    const sale = await ctx.db.query('voucherTypes').withIndex('by_name', (q) => q.eq('name', 'Sale')).unique()
    if (!sale) return { on, sentToday, items: [] }
    // A bill's date can be set back a day or two from when it was typed.
    const candidates = (
      await ctx.db.query('vouchers').withIndex('by_date', (q) => q.gte('date', from - 7 * DAY)).collect()
    ).filter((vch) => vch.typeId === sale._id && vch.status === 'final' && vch.createdAt >= from && Math.max(vch.createdAt, vch.updatedAt) <= before)
      .sort((a, b) => a.createdAt - b.createdAt)

    const items = []
    let snapshots: Map<string, unknown> | null = null
    for (const vch of candidates) {
      if (items.length >= limit) break
      const done = await ctx.db.query('billWhatsApp').withIndex('by_voucher', (q) => q.eq('voucherId', vch._id)).unique()
      if (done && (done.status !== 'failed' || done.attempts >= TRIES)) continue
      const party = await ctx.db.get(vch.partyLedgerId)
      if (!party?.phone || !/\d{10}/.test(party.phone.replace(/\D/g, ''))) continue
      const photos = await photosOf(ctx, vch.attachments)
      // A bill typed in the panel has no photo: the shop PC draws the bill itself.
      let bill: unknown = null
      if (!photos.length) {
        snapshots ??= new Map((await ctx.db.query('bills').collect()).map((row) => [String((row.bill as { voucherId?: string })?.voucherId ?? ''), row.bill]))
        bill = snapshots.get(String(vch._id)) ?? null
        if (!bill) continue
      }
      items.push({
        voucherId: vch._id,
        label: label(sale.abbr, vch.voucherNo),
        date: vch.date,
        amount: vch.amount ?? null,
        name: bare(party.name),
        phone: party.phone,
        photos,
        bill,
        tries: done?.attempts ?? 0,
      })
    }
    return { on, sentToday, items }
  },
})

/** How a bill's sending went, from the shop PC. */
export const record = mutation({
  args: {
    voucherId: v.id('vouchers'),
    status: v.union(v.literal('sent'), v.literal('skipped'), v.literal('failed')),
    to: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { voucherId, status, to, reason }) => {
    const row = await ctx.db.query('billWhatsApp').withIndex('by_voucher', (q) => q.eq('voucherId', voucherId)).unique()
    const at = Date.now()
    const fields = { status, at, ...(to ? { to } : {}), reason: reason?.slice(0, 300) }
    if (row) await ctx.db.patch(row._id, { ...fields, attempts: row.attempts + 1 })
    else await ctx.db.insert('billWhatsApp', { voucherId, ...fields, attempts: 1 })
  },
})

/**
 * Sending switched on or off. Switched on, it sends the bills made from that
 * moment: the ones before it are not sent by this.
 */
export const setOn = mutation({
  args: { on: v.boolean() },
  handler: async (ctx, { on }) => {
    const row = await settingsOf(ctx)
    const now = Date.now()
    const fields = on
      ? { billWhatsAppOn: true, billWhatsAppFrom: row?.billWhatsAppOn ? row.billWhatsAppFrom ?? now : now }
      : { billWhatsAppOn: false }
    if (row) await ctx.db.patch(row._id, { ...fields, updatedAt: now })
    else await ctx.db.insert('settings', { key: SETTINGS_KEY, ...fields, updatedAt: now })
  },
})

/** Where the sending stands: switched on since when, and what went lately. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const settings = await settingsOf(ctx)
    const recent = await ctx.db.query('billWhatsApp').withIndex('by_at').order('desc').take(30)
    return {
      on: settings?.billWhatsAppOn === true,
      from: settings?.billWhatsAppFrom ?? null,
      recent: await Promise.all(recent.map(async (r) => {
        const vch = await ctx.db.get(r.voucherId)
        const party = vch ? await ctx.db.get(vch.partyLedgerId) : null
        return { voucherId: r.voucherId, status: r.status, at: r.at, to: r.to ?? '', reason: r.reason ?? '', attempts: r.attempts, name: bare(party?.name), voucherNo: vch?.voucherNo ?? null }
      })),
    }
  },
})

/**
 * The panel's WhatsApp page: whether sending is on, the sales still to go
 * (and why one cannot), and what was sent, skipped or failed lately.
 */
export const queue = query({
  args: {},
  handler: async (ctx) => {
    const settings = await settingsOf(ctx)
    const from = settings?.billWhatsAppFrom ?? null
    const sale = await ctx.db.query('voucherTypes').withIndex('by_name', (q) => q.eq('name', 'Sale')).unique()
    const waiting = []
    if (from && sale) {
      const candidates = (
        await ctx.db.query('vouchers').withIndex('by_date', (q) => q.gte('date', from - 7 * DAY)).collect()
      ).filter((vch) => vch.typeId === sale._id && vch.createdAt >= from).sort((a, b) => b.createdAt - a.createdAt)
      for (const vch of candidates) {
        const done = await ctx.db.query('billWhatsApp').withIndex('by_voucher', (q) => q.eq('voucherId', vch._id)).unique()
        if (done && (done.status !== 'failed' || done.attempts >= TRIES)) continue
        const party = await ctx.db.get(vch.partyLedgerId)
        const mobile = !!party?.phone && /\d{10}/.test(party.phone.replace(/\D/g, ''))
        waiting.push({
          voucherId: vch._id,
          label: label(sale.abbr, vch.voucherNo),
          name: bare(party?.name),
          phone: party?.phone ?? '',
          amount: vch.amount ?? null,
          savedAt: Math.max(vch.createdAt, vch.updatedAt),
          // Why it is not going yet, when something stops it.
          held: vch.status !== 'final' ? 'Waiting for its amount' : !mobile ? 'No mobile number on the account' : null,
          tries: done?.attempts ?? 0,
          lastError: done?.status === 'failed' ? done.reason ?? '' : '',
        })
      }
    }
    const recent = await ctx.db.query('billWhatsApp').withIndex('by_at').order('desc').take(60)
    return {
      on: settings?.billWhatsAppOn === true,
      from,
      waiting,
      recent: await Promise.all(recent.map(async (r) => {
        const vch = await ctx.db.get(r.voucherId)
        const party = vch ? await ctx.db.get(vch.partyLedgerId) : null
        return {
          voucherId: r.voucherId, status: r.status, at: r.at, reason: r.reason ?? '', attempts: r.attempts,
          name: bare(party?.name), label: vch && sale ? label(sale.abbr, vch.voucherNo) : 'Deleted bill',
          amount: vch?.amount ?? null,
        }
      })),
    }
  },
})

/** A bill sent, skipped or given up on, put back to go again. */
export const sendAgain = mutation({
  args: { voucherId: v.id('vouchers') },
  handler: async (ctx, { voucherId }) => {
    const row = await ctx.db.query('billWhatsApp').withIndex('by_voucher', (q) => q.eq('voucherId', voucherId)).unique()
    if (row) await ctx.db.delete(row._id)
  },
})

/** The bills sent lately, voucher and when: the panel's day book marks them. */
export const sent = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query('billWhatsApp').withIndex('by_at').order('desc').take(3000)
    return rows.filter((r) => r.status === 'sent').map((r) => ({ voucherId: r.voucherId, at: r.at }))
  },
})

/** When each of these vouchers went to WhatsApp, for the screens that show a bill. */
export async function sentAt(ctx: QueryCtx, voucherIds: Id<'vouchers'>[]) {
  const out = new Map<string, number>()
  for (const id of new Set(voucherIds)) {
    const row = await ctx.db.query('billWhatsApp').withIndex('by_voucher', (q) => q.eq('voucherId', id)).unique()
    if (row?.status === 'sent') out.set(String(id), row.at)
  }
  return out
}

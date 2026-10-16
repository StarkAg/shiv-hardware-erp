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
// W/B is the walk-in account: it represents many people, not one WhatsApp
// contact. It must always ask for the buyer's number at the time of sending.
const needsRecipient = (name: string | undefined) => bare(name).toUpperCase() === 'WB' || bare(name).toUpperCase() === 'W/B'
const mobile = (phone: string | undefined) => String(phone ?? '').replace(/\D/g, '')

type Attachment = Doc<'vouchers'>['attachments'][number]

/** "QTN-4" for quotation Q-4, as the bill screen's quotation list labels it. */
const quoteLabel = (number: unknown) => `QTN-${String(number ?? '').replace(/^Q-/, '')}`

type QuoteBill = { id: string; kind?: string; number?: string; date: string; total?: number; customerName?: string; customerPhone?: string; attachments?: unknown[]; deleted?: boolean }
/** An open quotation, by its bill id; null once it is deleted or sold. */
async function quoteBill(ctx: QueryCtx, billId: string): Promise<QuoteBill | null> {
  const row = await ctx.db.query('bills').withIndex('by_bill', (q) => q.eq('billId', billId)).unique()
  const bill = row?.bill as QuoteBill | undefined
  return bill && bill.kind === 'quotation' && !bill.deleted ? bill : null
}
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

/**
 * The papers a customer can be sent by hand: a sale and the receipts, refunds
 * and returns that go with it. The automatic sender stays with sales only. A
 * purchase or a payment out is the shop's own paper with a supplier.
 */
const SENDABLE = new Set(['Sale', 'Receipt', 'Refund', 'Goods Return', 'Discount'])
async function typesOf(ctx: QueryCtx) {
  return new Map((await ctx.db.query('voucherTypes').collect()).map((t) => [String(t._id), t]))
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
    // A person may choose one waiting bill to go now without enabling the
    // automatic sender. The request lives in the same one-row-per-voucher log
    // that records an actual send, so every device and the service see it.
    const requested = new Set((await ctx.db.query('billWhatsApp').collect())
      .filter((row) => row.status === 'requested')
      .map((row) => String(row.voucherId)))
    // Quotations asked for by hand go first, in the order they were asked.
    const quoteAsks = (await ctx.db.query('quoteWhatsApp').collect())
      .filter((row) => row.status === 'requested')
      .sort((a, b) => a.at - b.at)

    if ((!on || !from) && requested.size === 0 && !quoteAsks.length) return { on, sentToday, items: [] }

    const items = []
    for (const ask of quoteAsks) {
      if (items.length >= limit) break
      const bill = await quoteBill(ctx, ask.billId)
      if (!bill || !/\d{10}/.test(mobile(ask.requestedPhone))) continue
      const photos = await photosOf(ctx, (bill.attachments ?? []) as Attachment[])
      items.push({
        billId: ask.billId,
        label: quoteLabel(bill.number),
        kind: 'Quotation',
        date: Date.parse(bill.date),
        amount: typeof bill.total === 'number' ? bill.total : null,
        name: bare(bill.customerName),
        phone: ask.requestedPhone,
        photos,
        bill: photos.length ? null : bill,
        tries: ask.attempts,
        onDemand: true,
        newChat: ask.greet === true,
        shared: false,
      })
    }

    const types = await typesOf(ctx)
    const sale = [...types.values()].find((t) => t.name === 'Sale')
    if (!sale) return { on, sentToday, items: [] }
    // Asked for by hand: looked up one by one, so a sale from before the
    // sending was switched on can go too, and a receipt (Older bills on the
    // panel's page).
    const asked = (await Promise.all([...requested].map((id) => ctx.db.get(id as Id<'vouchers'>))))
      .filter((vch): vch is Doc<'vouchers'> => !!vch && SENDABLE.has(types.get(String(vch.typeId))?.name ?? '') && vch.status === 'final')
      .sort((a, b) => a.createdAt - b.createdAt)
    // The automatic queue: only sales made after it was switched on. A bill's
    // date can be set back a day or two from when it was typed.
    const automatic = on && from ? (
      await ctx.db.query('vouchers').withIndex('by_date', (q) => q.gte('date', from - 7 * DAY)).collect()
    ).filter((vch) => vch.typeId === sale._id && vch.status === 'final' && vch.createdAt >= from &&
      !requested.has(String(vch._id)) && Math.max(vch.createdAt, vch.updatedAt) <= before)
      .sort((a, b) => a.createdAt - b.createdAt) : []
    // A specifically requested bill comes before the automatic queue.
    const candidates = [...asked, ...automatic]

    let snapshots: Map<string, unknown> | null = null
    for (const vch of candidates) {
      if (items.length >= limit) break
      const done = await ctx.db.query('billWhatsApp').withIndex('by_voucher', (q) => q.eq('voucherId', vch._id)).unique()
      const onDemand = done?.status === 'requested'
      if (done && !onDemand && (done.status !== 'failed' || done.attempts >= TRIES)) continue
      const party = await ctx.db.get(vch.partyLedgerId)
      const phone = onDemand ? done?.requestedPhone ?? party?.phone : party?.phone
      // A shared walk-in account is never sent automatically. Its one-off
      // request has the actual buyer's number supplied from the panel.
      if (!party || (needsRecipient(party.name) && !onDemand) || !/\d{10}/.test(mobile(phone))) continue
      const photos = await photosOf(ctx, vch.attachments)
      // A bill typed in the panel has no photo: the shop PC draws the bill itself.
      let bill: unknown = null
      if (!photos.length) {
        snapshots ??= new Map((await ctx.db.query('bills').collect()).map((row) => [String((row.bill as { voucherId?: string })?.voucherId ?? ''), row.bill]))
        bill = snapshots.get(String(vch._id)) ?? null
        if (!bill) continue
      }
      const type = types.get(String(vch.typeId))!
      items.push({
        voucherId: vch._id,
        label: label(type.abbr, vch.voucherNo),
        // Sale, Receipt…: the note under it says which.
        kind: type.name,
        date: vch.date,
        amount: vch.amount ?? null,
        name: bare(party.name),
        phone,
        photos,
        bill,
        tries: done?.attempts ?? 0,
        onDemand,
        // Only when the counter said so for this send: the sender cannot see
        // which numbers the owner already has a chat with.
        newChat: onDemand && done?.greet === true,
        shared: needsRecipient(party.name),
      })
    }
    return { on, sentToday, items }
  },
})

/** How a bill's sending went, from the shop PC: a voucher's, or a quotation's by its bill. */
export const record = mutation({
  args: {
    voucherId: v.optional(v.id('vouchers')),
    billId: v.optional(v.string()),
    status: v.union(v.literal('sent'), v.literal('skipped'), v.literal('failed')),
    to: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { voucherId, billId, status, to, reason }) => {
    const at = Date.now()
    const fields = { status, at, ...(to ? { to } : {}), reason: reason?.slice(0, 300) }
    if (billId) {
      const row = await ctx.db.query('quoteWhatsApp').withIndex('by_bill', (q) => q.eq('billId', billId)).unique()
      if (row) await ctx.db.patch(row._id, { ...fields, attempts: row.attempts + 1 })
      else await ctx.db.insert('quoteWhatsApp', { billId, ...fields, attempts: 1 })
      return
    }
    if (!voucherId) throw new Error('Say which bill this was.')
    const row = await ctx.db.query('billWhatsApp').withIndex('by_voucher', (q) => q.eq('voucherId', voucherId)).unique()
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
    const types = await typesOf(ctx)
    const sale = [...types.values()].find((t) => t.name === 'Sale')
    const labelOf = (vch: Doc<'vouchers'>) => label(types.get(String(vch.typeId))?.abbr ?? '', vch.voucherNo)
    const waiting = []
    if (sale) {
      const recent = from ? (
        await ctx.db.query('vouchers').withIndex('by_date', (q) => q.gte('date', from - 7 * DAY)).collect()
      ).filter((vch) => vch.typeId === sale._id && vch.createdAt >= from) : []
      // An older bill asked for by hand waits here too until it has gone.
      const seen = new Set(recent.map((vch) => String(vch._id)))
      const asked = (await Promise.all(
        (await ctx.db.query('billWhatsApp').collect())
          .filter((row) => row.status === 'requested' && !seen.has(String(row.voucherId)))
          .map((row) => ctx.db.get(row.voucherId)),
      )).filter((vch): vch is Doc<'vouchers'> => !!vch && SENDABLE.has(types.get(String(vch.typeId))?.name ?? ''))
      const candidates = [...recent, ...asked].sort((a, b) => b.createdAt - a.createdAt)
      for (const vch of candidates) {
        const done = await ctx.db.query('billWhatsApp').withIndex('by_voucher', (q) => q.eq('voucherId', vch._id)).unique()
        if (done && done.status !== 'requested' && (done.status !== 'failed' || done.attempts >= TRIES)) continue
        const party = await ctx.db.get(vch.partyLedgerId)
        const shared = needsRecipient(party?.name)
        const hasMobile = !!party?.phone && /\d{10}/.test(mobile(party.phone))
        waiting.push({
          voucherId: vch._id,
          partyLedgerId: vch.partyLedgerId,
          label: labelOf(vch),
          name: bare(party?.name),
          phone: shared ? '' : party?.phone ?? '',
          amount: vch.amount ?? null,
          savedAt: Math.max(vch.createdAt, vch.updatedAt),
          // Why it is not going yet, when something stops it.
          held: vch.status !== 'final' ? 'Waiting for its amount' : !shared && !hasMobile ? 'No mobile number on the account' : null,
          needsRecipient: shared,
          tries: done?.attempts ?? 0,
          lastError: done?.status === 'failed' ? done.reason ?? '' : '',
          requested: done?.status === 'requested',
        })
      }
    }
    const recent = (await ctx.db.query('billWhatsApp').withIndex('by_at').order('desc').take(60))
      .filter((row) => row.status !== 'requested')
    return {
      on: settings?.billWhatsAppOn === true,
      from,
      waiting,
      recent: await Promise.all(recent.map(async (r) => {
        const vch = await ctx.db.get(r.voucherId)
        const party = vch ? await ctx.db.get(vch.partyLedgerId) : null
        return {
          voucherId: r.voucherId, status: r.status, at: r.at, reason: r.reason ?? '', attempts: r.attempts, markedSent: r.markedSent === true,
          name: bare(party?.name), label: vch ? labelOf(vch) : 'Deleted bill',
          amount: vch?.amount ?? null,
        }
      })),
    }
  },
})

/**
 * What one bill will go as, to look at before pressing Send: its own photos,
 * or for a bill typed in the panel the bill itself, drawn as it prints.
 */
export const preview = query({
  args: { voucherId: v.id('vouchers') },
  handler: async (ctx, { voucherId }) => {
    const vch = await ctx.db.get(voucherId)
    if (!vch) return null
    const photos = await photosOf(ctx, vch.attachments)
    const bill = photos.length ? null
      : (await ctx.db.query('bills').collect())
          .find((row) => String((row.bill as { voucherId?: string })?.voucherId ?? '') === String(voucherId))?.bill ?? null
    return { photos, bill }
  },
})

/**
 * One customer's sales, newest first, for sending a bill from before the
 * automatic sending began, one at a time: each with what happened to it on
 * WhatsApp, if anything.
 */
export const older = query({
  args: { partyLedgerId: v.id('ledgers') },
  handler: async (ctx, { partyLedgerId }) => {
    const types = await typesOf(ctx)
    const party = await ctx.db.get(partyLedgerId)
    const papers = (await ctx.db.query('vouchers').withIndex('by_party', (q) => q.eq('partyLedgerId', partyLedgerId)).collect())
      .filter((vch) => SENDABLE.has(types.get(String(vch.typeId))?.name ?? ''))
      .sort((a, b) => b.date - a.date || b.createdAt - a.createdAt)
    // A paper typed in the panel goes as the bill drawn; one with neither that
    // nor a photo has nothing to send.
    const drawn = papers.some((vch) => !vch.attachments.length)
      ? new Set((await ctx.db.query('bills').collect()).map((row) => String((row.bill as { voucherId?: string })?.voucherId ?? '')))
      : new Set<string>()
    return await Promise.all(papers.map(async (vch) => {
      const done = await ctx.db.query('billWhatsApp').withIndex('by_voucher', (q) => q.eq('voucherId', vch._id)).unique()
      const type = types.get(String(vch.typeId))!
      return {
        voucherId: vch._id,
        label: label(type.abbr, vch.voucherNo),
        kind: type.name,
        hasPicture: vch.attachments.length > 0 || drawn.has(String(vch._id)),
        date: vch.date,
        amount: vch.amount ?? null,
        name: bare(party?.name),
        phone: party?.phone ?? '',
        needsRecipient: needsRecipient(party?.name),
        final: vch.status === 'final',
        status: done?.status ?? null,
        at: done?.at ?? null,
        markedSent: done?.markedSent === true,
      }
    }))
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

/**
 * Explicitly send one eligible waiting sale, without enabling automatic
 * WhatsApp bills. The linked service picks this request up immediately.
 */
export const requestNow = mutation({
  args: { voucherId: v.id('vouchers'), phone: v.optional(v.string()), newNumber: v.optional(v.boolean()) },
  handler: async (ctx, { voucherId, phone, newNumber }) => {
    // Any sale or receipt, however old: a person asked for this one. Only the
    // automatic sender is held to the sales made after it was switched on.
    const voucher = await ctx.db.get(voucherId)
    const type = voucher ? await ctx.db.get(voucher.typeId) : null
    if (!voucher || !SENDABLE.has(type?.name ?? '')) throw new Error('Only a customer\'s bill or receipt can be sent on WhatsApp.')
    if (voucher.status !== 'final') throw new Error('Enter the final amount before sending this bill.')
    const party = await ctx.db.get(voucher.partyLedgerId)
    const shared = needsRecipient(party?.name)
    const requestedPhone = mobile(phone)
    const recipient = shared ? requestedPhone : mobile(party?.phone)
    if (shared && !/\d{10}/.test(requestedPhone)) throw new Error('Enter this customer\'s 10-digit WhatsApp number.')
    if (!shared && !/\d{10}/.test(recipient)) throw new Error('Add the customer\'s mobile number before sending this bill.')

    const row = await ctx.db.query('billWhatsApp').withIndex('by_voucher', (q) => q.eq('voucherId', voucherId)).unique()
    if (row?.status === 'requested') throw new Error('This bill is already being sent.')
    // A bill already sent goes again only when asked: an older bill picked
    // from its party's list is asked for on purpose, so the earlier row gives way.
    const fields = { status: 'requested' as const, attempts: 0, at: Date.now(), greet: newNumber === true, ...(shared ? { requestedPhone } : {}) }
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert('billWhatsApp', { voucherId, ...fields })
  },
})

/** Records a bill shared outside this sender, so it leaves the waiting list. */
export const markSent = mutation({
  args: { voucherId: v.id('vouchers') },
  handler: async (ctx, { voucherId }) => {
    const settings = await settingsOf(ctx)
    const from = settings?.billWhatsAppFrom
    const [sale, voucher] = await Promise.all([
      ctx.db.query('voucherTypes').withIndex('by_name', (q) => q.eq('name', 'Sale')).unique(),
      ctx.db.get(voucherId),
    ])
    if (!from || !sale || !voucher || voucher.typeId !== sale._id || voucher.createdAt < from || voucher.status !== 'final') throw new Error('This bill is not in the WhatsApp sending list.')
    const row = await ctx.db.query('billWhatsApp').withIndex('by_voucher', (q) => q.eq('voucherId', voucherId)).unique()
    if (row?.status === 'sent') return
    const fields = { status: 'sent' as const, attempts: row?.attempts ?? 0, at: Date.now(), reason: 'Marked as already sent', markedSent: true }
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert('billWhatsApp', { voucherId, ...fields })
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

/**
 * The open quotations, newest first, for sending one by hand: each with the
 * customer's number and what happened to it on WhatsApp, if anything. A
 * quotation is never sent on its own.
 */
export const quotes = query({
  args: {},
  handler: async (ctx) => {
    const open = (await ctx.db.query('bills').collect())
      .map((row) => row.bill as QuoteBill)
      .filter((bill) => bill?.kind === 'quotation' && !bill.deleted)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    return await Promise.all(open.map(async (bill) => {
      const done = await ctx.db.query('quoteWhatsApp').withIndex('by_bill', (q) => q.eq('billId', bill.id)).unique()
      return {
        billId: bill.id,
        label: quoteLabel(bill.number),
        name: bare(bill.customerName),
        phone: bill.customerPhone ?? '',
        date: bill.date,
        amount: typeof bill.total === 'number' ? bill.total : null,
        status: done?.status ?? null,
        at: done?.at ?? null,
        reason: done?.reason ?? '',
        markedSent: done?.markedSent === true,
      }
    }))
  },
})

/** Records a quotation shared outside this sender, so it shows as sent. */
export const markQuoteSent = mutation({
  args: { billId: v.string() },
  handler: async (ctx, { billId }) => {
    if (!(await quoteBill(ctx, billId))) throw new Error('This quotation is no longer open: it was deleted or sold.')
    const row = await ctx.db.query('quoteWhatsApp').withIndex('by_bill', (q) => q.eq('billId', billId)).unique()
    if (row?.status === 'requested') throw new Error('This quotation is being sent now.')
    if (row?.status === 'sent') return
    const fields = { status: 'sent' as const, attempts: row?.attempts ?? 0, at: Date.now(), reason: 'Marked as already sent', markedSent: true }
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert('quoteWhatsApp', { billId, ...fields })
  },
})

/** What one quotation will go as: its photos, or the quotation drawn as it prints. */
export const quotePreview = query({
  args: { billId: v.string() },
  handler: async (ctx, { billId }) => {
    const bill = await quoteBill(ctx, billId)
    if (!bill) return null
    const photos = await photosOf(ctx, (bill.attachments ?? []) as Attachment[])
    return { photos, bill: photos.length ? null : bill }
  },
})

/** Send one quotation to the customer's WhatsApp: the number typed, else the one on it. */
export const requestQuote = mutation({
  args: { billId: v.string(), phone: v.optional(v.string()), newNumber: v.optional(v.boolean()) },
  handler: async (ctx, { billId, phone, newNumber }) => {
    const bill = await quoteBill(ctx, billId)
    if (!bill) throw new Error('This quotation is no longer open: it was deleted or sold.')
    const requestedPhone = mobile(phone) || mobile(bill.customerPhone)
    if (!/\d{10}/.test(requestedPhone)) throw new Error('Enter the customer\'s 10-digit WhatsApp number.')
    const row = await ctx.db.query('quoteWhatsApp').withIndex('by_bill', (q) => q.eq('billId', billId)).unique()
    if (row?.status === 'requested') throw new Error('This quotation is already being sent.')
    const fields = { status: 'requested' as const, attempts: 0, at: Date.now(), greet: newNumber === true, requestedPhone, reason: undefined, markedSent: undefined }
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert('quoteWhatsApp', { billId, ...fields })
  },
})

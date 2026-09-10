import { v } from 'convex/values'
import { action, internalQuery, internalMutation } from './_generated/server'
import { internal } from './_generated/api'

/**
 * WhatsApp Cloud API — "guarantee card ready" notification.
 *
 * The shop finalises a guarantee card, and the customer gets a WhatsApp
 * message telling them to collect it. Utility template, pickup-only, so no
 * media header and nothing to upload.
 *
 * Required Convex env vars (Dashboard → Settings → Environment Variables):
 *   WHATSAPP_TOKEN            permanent system-user token
 *   WHATSAPP_PHONE_NUMBER_ID  the *ID* under "From", not the phone number
 *   WHATSAPP_TEMPLATE_NAME    defaults to guarantee_card_ready
 *   WHATSAPP_TEMPLATE_LANG    defaults to en_US — must match the approved
 *                             template's language exactly or Meta returns
 *                             132001 (template does not exist).
 */

const GRAPH_VERSION = 'v25.0'

/**
 * Meta wants E.164 digits with no '+', no spaces and no leading zero.
 * Shop staff type mobiles every possible way, so normalise defensively and
 * assume India when no country code is present.
 */
export function toE164(raw: string): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (!digits) return null

  // 10-digit local number → prefix 91
  if (digits.length === 10) return `91${digits}`
  // 0XXXXXXXXXX → drop the trunk prefix, then prefix 91
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`
  // already 91XXXXXXXXXX
  if (digits.length === 12 && digits.startsWith('91')) return digits
  // 0091XXXXXXXXXX
  if (digits.length === 14 && digits.startsWith('0091')) return digits.slice(2)

  // Anything else is either already international or unusable — let Meta judge.
  return digits.length >= 11 && digits.length <= 15 ? digits : null
}

/**
 * A card can cover several brands, but the template has one Product slot and
 * one Guarantee slot. Listing every brand gets unreadable past a couple, so
 * spell out one or two and summarise beyond that.
 *
 * Template parameters may not contain newlines or tabs — Meta rejects the send
 * outright — so everything stays on one line.
 */
export function summariseItems(items: Array<{ brandName?: string; guaranteeYears?: number }>) {
  const clean = (items ?? []).filter(i => i && i.brandName)
  if (clean.length === 0) return { product: 'Item', guarantee: 'As per card' }

  if (clean.length <= 2) {
    return {
      product: clean.map(i => String(i.brandName).trim()).join(', '),
      guarantee: clean.map(i => `${i.guaranteeYears ?? 0} years`).join(', '),
    }
  }

  const maxYears = Math.max(...clean.map(i => Number(i.guaranteeYears) || 0))
  return {
    product: `${clean.length} items`,
    guarantee: `up to ${maxYears} years`,
  }
}

export const guaranteeByNumber = internalQuery({
  args: { number: v.string() },
  handler: async (ctx, args) => {
    const clean = String(args.number ?? '').trim()
    if (!clean) return null
    return await ctx.db
      .query('guaranteeDocuments')
      .withIndex('by_number', q => q.eq('number', clean))
      .first()
  },
})

export const recordSend = internalMutation({
  args: {
    number: v.string(),
    to: v.string(),
    status: v.union(v.literal('sent'), v.literal('failed')),
    messageId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('whatsappSends', { ...args, createdAt: Date.now() })
  },
})

export const sendGuaranteeCard = action({
  args: {
    number: v.string(),
    /** Override the customer's stored mobile (staff correcting a bad number). */
    to: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; messageId?: string; error?: string }> => {
    const token = process.env.WHATSAPP_TOKEN
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID
    if (!token || !phoneNumberId) {
      return { ok: false, error: 'WhatsApp not configured (missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID)' }
    }

    const row = await ctx.runQuery(internal.whatsapp.guaranteeByNumber, { number: args.number })
    if (!row) return { ok: false, error: `Guarantee ${args.number} not found` }

    const doc = (row.document ?? {}) as any
    const customer = (row.customer ?? doc.customer ?? {}) as any

    const to = toE164(args.to ?? customer.mobile ?? '')
    if (!to) return { ok: false, error: 'Customer has no usable mobile number' }

    // Trailing whitespace breaks the *{{1}}* bold in the template — WhatsApp
    // only renders the asterisks when they touch non-space characters.
    const name = String(customer.name ?? '').trim() || 'Customer'
    const { product, guarantee } = summariseItems(doc.items ?? [])

    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: process.env.WHATSAPP_TEMPLATE_NAME ?? 'guarantee_card_ready',
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? 'en_US' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: name },
              { type: 'text', text: String(row.number ?? '').trim() },
              { type: 'text', text: product },
              { type: 'text', text: guarantee },
            ],
          },
        ],
      },
    }

    let res: Response
    try {
      res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      await ctx.runMutation(internal.whatsapp.recordSend, { number: row.number, to, status: 'failed', error })
      return { ok: false, error }
    }

    const json = (await res.json().catch(() => ({}))) as any

    if (!res.ok || json?.error) {
      // Meta's own message is far more useful than a generic HTTP status —
      // 132001 means template/language mismatch, 131030 means the recipient
      // isn't on the test number's allow-list.
      const error = json?.error?.message ?? `HTTP ${res.status}`
      await ctx.runMutation(internal.whatsapp.recordSend, { number: row.number, to, status: 'failed', error })
      return { ok: false, error }
    }

    const messageId = json?.messages?.[0]?.id as string | undefined
    await ctx.runMutation(internal.whatsapp.recordSend, { number: row.number, to, status: 'sent', messageId })
    return { ok: true, messageId }
  },
})

/** Delivery status callback from the webhook, matched back to the send row. */
export const recordStatus = internalMutation({
  args: {
    messageId: v.string(),
    status: v.string(),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!args.messageId) return
    const row = await ctx.db
      .query('whatsappSends')
      .withIndex('by_message_id', q => q.eq('messageId', args.messageId))
      .first()
    if (!row) return

    await ctx.db.patch(row._id, {
      deliveryStatus: args.status,
      deliveredAt: Date.now(),
      failureReason: args.failureReason,
    })
  },
})

/** A customer replied — also means a 24-hour free-form window just opened. */
export const recordInbound = internalMutation({
  args: {
    from: v.string(),
    text: v.optional(v.string()),
    messageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('whatsappInbox', { ...args, receivedAt: Date.now() })
  },
})

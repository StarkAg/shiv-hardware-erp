import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { internal } from './_generated/api'

/**
 * Twilio WhatsApp helpers.
 *
 * Twilio replaced the direct Meta Graph API path after the original WABA was
 * banned. Templates live in Twilio's Content API and are addressed by
 * ContentSid (HX…) rather than by name + language, which removes the whole
 * class of "template does not exist in en_US" errors.
 *
 * Required Convex env vars:
 *   TWILIO_ACCOUNT_SID       AC…
 *   TWILIO_API_KEY_SID       SK…   (used as the basic-auth username)
 *   TWILIO_API_KEY_SECRET    the secret shown once at key creation
 *   TWILIO_WHATSAPP_FROM     whatsapp:+919835716123
 *   TWILIO_CONTENT_SID       HX…   the guarantee_card_ready template
 *   TEMPLATE_WATCH_NOTIFY_TO E.164 digits to ping when the template approves
 */

const WATCH_KEY = 'template_approval_notified'

function auth() {
  const sid = process.env.TWILIO_API_KEY_SID
  const secret = process.env.TWILIO_API_KEY_SECRET
  if (!sid || !secret) return null
  // Convex's runtime has btoa; Buffer is not available here.
  return 'Basic ' + btoa(`${sid}:${secret}`)
}

export const getFlag = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('watcherState')
      .withIndex('by_key', q => q.eq('key', args.key))
      .first()
    return row?.value ?? null
  },
})

export const setFlag = internalMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('watcherState')
      .withIndex('by_key', q => q.eq('key', args.key))
      .first()
    if (row) {
      await ctx.db.patch(row._id, { value: args.value, updatedAt: Date.now() })
      return
    }
    await ctx.db.insert('watcherState', { ...args, updatedAt: Date.now() })
  },
})

/**
 * Poll the template's WhatsApp approval state and, the first time it flips to
 * approved, send it once to the shop owner. Sending the guarantee template
 * itself doubles as the end-to-end test: it proves sender, credentials,
 * profile and delivery in one message, using the template exactly as intended
 * rather than for unrelated content.
 */
export const checkTemplateApproval = internalAction({
  args: {},
  handler: async (ctx): Promise<{ status: string; notified: boolean; error?: string }> => {
    const basic = auth()
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const contentSid = process.env.TWILIO_CONTENT_SID
    const from = process.env.TWILIO_WHATSAPP_FROM
    const to = process.env.TEMPLATE_WATCH_NOTIFY_TO

    if (!basic || !accountSid || !contentSid || !from || !to) {
      return { status: 'unconfigured', notified: false, error: 'missing Twilio env vars' }
    }

    // Already sent the notice — nothing left to do, so stop hitting the API.
    const already = await ctx.runQuery(internal.twilio.getFlag, { key: WATCH_KEY })
    if (already) return { status: already, notified: false }

    const res = await fetch(
      `https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests`,
      { headers: { Authorization: basic } },
    )
    const json = (await res.json().catch(() => ({}))) as any
    const status = String(json?.whatsapp?.status ?? 'unknown')

    if (status !== 'approved') {
      // Record rejections too, so a rejected template stops the polling and is
      // visible in the table rather than silently looping forever.
      if (status === 'rejected') {
        await ctx.runMutation(internal.twilio.setFlag, { key: WATCH_KEY, value: 'rejected' })
      }
      return { status, notified: false }
    }

    const body = new URLSearchParams({
      To: `whatsapp:+${to}`,
      From: from,
      ContentSid: contentSid,
      ContentVariables: JSON.stringify({
        '1': 'Harsh Agarwal',
        '2': 'SH-2026-0001',
        '3': 'Century PVC Door',
        '4': '10 years',
      }),
    })

    const send = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    )
    const sendJson = (await send.json().catch(() => ({}))) as any

    if (!send.ok || sendJson?.error_code) {
      const error = sendJson?.message ?? `HTTP ${send.status}`
      await ctx.runMutation(internal.whatsapp.recordSend, {
        number: 'TEMPLATE_APPROVAL_TEST',
        to,
        status: 'failed',
        error,
      })
      return { status, notified: false, error }
    }

    await ctx.runMutation(internal.whatsapp.recordSend, {
      number: 'TEMPLATE_APPROVAL_TEST',
      to,
      status: 'sent',
      messageId: sendJson?.sid,
    })
    await ctx.runMutation(internal.twilio.setFlag, { key: WATCH_KEY, value: 'approved-notified' })

    return { status, notified: true }
  },
})
